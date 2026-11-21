import type { MatchRecord, MatchSummary } from '../../src/shared/historyTypes.js';
import { MAX_ONLINE_MATCHES, type StorageMode } from '../../src/shared/onlineTypes.js';
import {
  MATCHES_IDS_KEY,
  MATCHES_SUMMARIES_KEY,
  MATCH_KEY_PREFIX,
  matchKey,
  presenceKey,
  roomKey,
  type PresenceEntry,
  type PresenceMap,
  type RoomRecord,
} from '../types.js';
import { StorageBackendError, type CasResult, type StorageAdapter } from './types.js';

export const CREATE_ROOM_NX_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
redis.call('HSET', KEYS[1], 'v', '1', 'data', ARGV[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
`.trim();

export const CAS_UPDATE_ROOM_SCRIPT = `
local curV = redis.call('HGET', KEYS[1], 'v')
if not curV then
  return {0, 'NOT_FOUND'}
end
if curV ~= ARGV[1] then
  local curData = redis.call('HGET', KEYS[1], 'data')
  return {0, 'CONFLICT', curV, curData}
end
redis.call('HSET', KEYS[1], 'v', ARGV[2], 'data', ARGV[3])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return {1, ARGV[2]}
`.trim();

export const SAVE_MATCH_ATOMIC_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('HSET', KEYS[3], ARGV[1], ARGV[3])
redis.call('LPUSH', KEYS[2], ARGV[1])
local maxN = tonumber(ARGV[4])
local prefix = ARGV[5]
while redis.call('LLEN', KEYS[2]) > maxN do
  local oldId = redis.call('RPOP', KEYS[2])
  if oldId then
    redis.call('HDEL', KEYS[3], oldId)
    redis.call('DEL', prefix .. oldId)
  else
    break
  end
end
return 1
`.trim();

function normalizeTtl(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds)) {
    return 1;
  }
  return Math.max(1, Math.floor(ttlSeconds));
}

function isValidPresenceEntry(value: unknown): value is PresenceEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const obj = value as Partial<PresenceEntry>;
  return (
    typeof obj.lastSeenAt === 'number' &&
    Number.isFinite(obj.lastSeenAt) &&
    (obj.awaySince === null ||
      (typeof obj.awaySince === 'number' && Number.isFinite(obj.awaySince)))
  );
}

function isUnsafeRecordKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function setSafePresenceEntry(
  map: PresenceMap,
  memberId: string,
  entry: PresenceEntry,
): void {
  if (isUnsafeRecordKey(memberId)) {
    return;
  }
  Object.defineProperty(map, memberId, {
    value: entry,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function parsePositiveIntVersion(raw: unknown, context: string): number {
  let parsed: number;
  if (typeof raw === 'number') {
    parsed = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new StorageBackendError(`Upstash ${context} returned empty version`);
    }
    parsed = Number(trimmed);
  } else {
    throw new StorageBackendError(`Upstash ${context} returned non-numeric version`);
  }
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new StorageBackendError(`Upstash ${context} returned invalid version`);
  }
  return parsed;
}

function parseJsonObject<T>(raw: string, context: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StorageBackendError(`Failed to parse ${context} JSON from Upstash Redis`, {
      cause: err,
    });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StorageBackendError(`Expected ${context} JSON from Upstash Redis to be an object`);
  }
  return parsed as T;
}

export class UpstashRedisStore implements StorageAdapter {
  readonly mode: StorageMode = 'redis';
  private readonly url: string;
  private readonly token: string;
  private readonly fetchImpl?: typeof fetch;

  constructor(url: string, token: string, fetchImpl?: typeof fetch) {
    this.url = url.trim().replace(/\/+$/, '');
    this.token = token.trim();
    this.fetchImpl = fetchImpl;
  }

  private redact(text: string): string {
    return this.token.length > 0 ? text.replaceAll(this.token, '[REDACTED]') : text;
  }

  private async command(args: ReadonlyArray<string | number>): Promise<unknown> {
    const fetcher = this.fetchImpl ?? globalThis.fetch;
    let response: Response;
    try {
      response = await fetcher(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
      });
    } catch (err) {
      throw new StorageBackendError('Upstash Redis network request failed', {
        cause: err,
      });
    }

    if (!response.ok) {
      let snippet = '';
      try {
        const text = await response.text();
        snippet = this.redact(text).slice(0, 160);
      } catch {
        // ignore body read error
      }
      throw new StorageBackendError(
        snippet.length > 0
          ? `Upstash HTTP ${response.status}: ${snippet}`
          : `Upstash HTTP ${response.status}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      throw new StorageBackendError('Upstash Redis returned non-JSON payload', {
        cause: err,
      });
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new StorageBackendError('Upstash Redis returned invalid envelope');
    }

    const record = payload as { result?: unknown; error?: unknown };
    if (typeof record.error === 'string' && record.error.length > 0) {
      throw new StorageBackendError(`Upstash command error: ${this.redact(record.error)}`);
    }

    return record.result;
  }

  async createRoomNx(room: RoomRecord, ttlSeconds: number): Promise<boolean> {
    const storedRoom: RoomRecord = { ...room, version: 1 };
    const result = await this.command([
      'EVAL',
      CREATE_ROOM_NX_SCRIPT,
      1,
      roomKey(room.code),
      JSON.stringify(storedRoom),
      String(normalizeTtl(ttlSeconds)),
    ]);
    return result === 1 || result === '1';
  }

  async getRoom(code: string): Promise<RoomRecord | null> {
    const result = await this.command(['HGET', roomKey(code), 'data']);
    if (result === null || result === undefined) {
      return null;
    }
    if (typeof result !== 'string') {
      throw new StorageBackendError('Upstash HGET room data returned non-string');
    }
    return parseJsonObject<RoomRecord>(result, 'room');
  }

  async casUpdateRoom(
    code: string,
    expectedVersion: number,
    nextRoom: RoomRecord,
    ttlSeconds: number,
  ): Promise<CasResult> {
    const nextVersion = expectedVersion + 1;
    const storedRoom: RoomRecord = { ...nextRoom, version: nextVersion };
    const result = await this.command([
      'EVAL',
      CAS_UPDATE_ROOM_SCRIPT,
      1,
      roomKey(code),
      String(expectedVersion),
      String(nextVersion),
      JSON.stringify(storedRoom),
      String(normalizeTtl(ttlSeconds)),
    ]);

    if (!Array.isArray(result) || result.length < 2) {
      throw new StorageBackendError('Upstash CAS script returned unexpected shape');
    }

    const okFlag = result[0];
    if (okFlag === 1 || okFlag === '1') {
      const returnedVersion = parsePositiveIntVersion(result[1], 'CAS script');
      return {
        ok: true,
        version: returnedVersion,
        room: parseJsonObject<RoomRecord>(JSON.stringify(storedRoom), 'room'),
      };
    }

    const reason = result[1];
    if (reason === 'NOT_FOUND') {
      return { ok: false, reason: 'NOT_FOUND' };
    }
    if (reason === 'CONFLICT') {
      const currentVersion = parsePositiveIntVersion(result[2], 'CAS conflict');
      const currentData = result[3];
      if (typeof currentData !== 'string') {
        throw new StorageBackendError('Upstash CAS conflict payload is malformed');
      }
      return {
        ok: false,
        reason: 'CONFLICT',
        currentVersion,
        currentRoom: parseJsonObject<RoomRecord>(currentData, 'conflict room'),
      };
    }

    throw new StorageBackendError(`Upstash CAS script returned unknown reason: ${String(reason)}`);
  }

  async deleteRoom(code: string): Promise<void> {
    await this.command(['DEL', roomKey(code), presenceKey(code)]);
  }

  async setPresence(
    code: string,
    memberId: string,
    entry: PresenceEntry,
    ttlSeconds: number,
  ): Promise<void> {
    const key = presenceKey(code);
    await this.command(['HSET', key, memberId, JSON.stringify(entry)]);
    await this.command(['EXPIRE', key, normalizeTtl(ttlSeconds)]);
  }

  async getPresenceMap(code: string): Promise<PresenceMap> {
    const raw = await this.command(['HGETALL', presenceKey(code)]);
    const map: PresenceMap = {};
    if (raw === null || raw === undefined) {
      return map;
    }

    if (Array.isArray(raw)) {
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const field = raw[i];
        const value = raw[i + 1];
        if (
          typeof field !== 'string' ||
          typeof value !== 'string' ||
          isUnsafeRecordKey(field)
        ) {
          continue;
        }
        try {
          const parsed: unknown = JSON.parse(value);
          if (isValidPresenceEntry(parsed)) {
            setSafePresenceEntry(map, field, parsed);
          }
        } catch {
          // Skip corrupt presence field without breaking room reads
        }
      }
      return map;
    }

    if (typeof raw === 'object') {
      const entries = Object.entries(raw as Record<string, unknown>);
      for (let i = 0; i < entries.length; i++) {
        const [field, value] = entries[i];
        if (typeof value !== 'string' || isUnsafeRecordKey(field)) {
          continue;
        }
        try {
          const parsed: unknown = JSON.parse(value);
          if (isValidPresenceEntry(parsed)) {
            setSafePresenceEntry(map, field, parsed);
          }
        } catch {
          // Skip corrupt presence field without breaking room reads
        }
      }
    }

    return map;
  }

  async saveMatchAtomic(
    record: MatchRecord,
    summary: MatchSummary,
    maxMatches = MAX_ONLINE_MATCHES,
  ): Promise<boolean> {
    const cap = Number.isFinite(maxMatches)
      ? Math.max(1, Math.floor(maxMatches))
      : MAX_ONLINE_MATCHES;
    const result = await this.command([
      'EVAL',
      SAVE_MATCH_ATOMIC_SCRIPT,
      3,
      matchKey(record.id),
      MATCHES_IDS_KEY,
      MATCHES_SUMMARIES_KEY,
      record.id,
      JSON.stringify(record),
      JSON.stringify(summary),
      String(cap),
      MATCH_KEY_PREFIX,
    ]);
    return result === 1 || result === '1';
  }

  async listMatchSummaries(limit: number): Promise<MatchSummary[]> {
    if (!Number.isFinite(limit) || limit <= 0) {
      return [];
    }
    const clamped = Math.max(1, Math.min(MAX_ONLINE_MATCHES, Math.floor(limit)));
    const idsRaw = await this.command(['LRANGE', MATCHES_IDS_KEY, 0, clamped - 1]);
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return [];
    }

    const ids = idsRaw.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) {
      return [];
    }

    const summariesRaw = await this.command(['HMGET', MATCHES_SUMMARIES_KEY, ...ids]);
    if (!Array.isArray(summariesRaw)) {
      return [];
    }

    const summaries: MatchSummary[] = [];
    for (let i = 0; i < summariesRaw.length; i++) {
      const item = summariesRaw[i];
      if (typeof item !== 'string') {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(item);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          summaries.push(parsed as MatchSummary);
        }
      } catch {
        // Skip corrupt summary item safely
      }
    }
    return summaries;
  }

  async getMatchRecord(matchId: string): Promise<MatchRecord | null> {
    const result = await this.command(['GET', matchKey(matchId)]);
    if (result === null || result === undefined) {
      return null;
    }
    if (typeof result !== 'string') {
      throw new StorageBackendError('Upstash GET match record returned non-string');
    }
    return parseJsonObject<MatchRecord>(result, 'match record');
  }
}
