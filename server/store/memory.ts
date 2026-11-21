import type { MatchRecord, MatchSummary } from '../../src/shared/historyTypes.js';
import { MAX_ONLINE_MATCHES, type StorageMode } from '../../src/shared/onlineTypes.js';
import type { PresenceEntry, PresenceMap, RoomRecord } from '../types.js';
import type { CasResult, StorageAdapter } from './types.js';

interface StoredMemoryRoom {
  version: number;
  dataJson: string;
  expiresAt: number;
}

interface StoredMemoryPresence {
  entries: Map<string, string>;
  expiresAt: number;
}

declare global {
  var __wallgoMemoryStore: MemoryStore | undefined;
}

function normalizeTtlMs(ttlSeconds: number): number {
  const safeSeconds = Number.isFinite(ttlSeconds) ? Math.max(1, Math.floor(ttlSeconds)) : 1;
  return safeSeconds * 1_000;
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

export class MemoryStore implements StorageAdapter {
  readonly mode: StorageMode = 'memory';
  private readonly now: () => number;
  private readonly rooms = new Map<string, StoredMemoryRoom>();
  private readonly presence = new Map<string, StoredMemoryPresence>();
  private matchIds: string[] = [];
  private readonly matchSummaries = new Map<string, string>();
  private readonly matchRecords = new Map<string, string>();

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  private pruneRoomIfExpired(code: string): StoredMemoryRoom | null {
    const existing = this.rooms.get(code);
    if (!existing) {
      return null;
    }
    if (existing.expiresAt <= this.now()) {
      this.rooms.delete(code);
      return null;
    }
    return existing;
  }

  private prunePresenceIfExpired(code: string): StoredMemoryPresence | null {
    const existing = this.presence.get(code);
    if (!existing) {
      return null;
    }
    if (existing.expiresAt <= this.now()) {
      this.presence.delete(code);
      return null;
    }
    return existing;
  }

  async createRoomNx(room: RoomRecord, ttlSeconds: number): Promise<boolean> {
    if (this.pruneRoomIfExpired(room.code) !== null) {
      return false;
    }
    const storedRoom: RoomRecord = { ...room, version: 1 };
    this.rooms.set(room.code, {
      version: 1,
      dataJson: JSON.stringify(storedRoom),
      expiresAt: this.now() + normalizeTtlMs(ttlSeconds),
    });
    return true;
  }

  async getRoom(code: string): Promise<RoomRecord | null> {
    const existing = this.pruneRoomIfExpired(code);
    if (!existing) {
      return null;
    }
    return JSON.parse(existing.dataJson) as RoomRecord;
  }

  async casUpdateRoom(
    code: string,
    expectedVersion: number,
    nextRoom: RoomRecord,
    ttlSeconds: number,
  ): Promise<CasResult> {
    const existing = this.pruneRoomIfExpired(code);
    if (!existing) {
      return { ok: false, reason: 'NOT_FOUND' };
    }
    if (existing.version !== expectedVersion) {
      return {
        ok: false,
        reason: 'CONFLICT',
        currentVersion: existing.version,
        currentRoom: JSON.parse(existing.dataJson) as RoomRecord,
      };
    }

    const nextVersion = expectedVersion + 1;
    const storedRoom: RoomRecord = { ...nextRoom, version: nextVersion };
    const serialized = JSON.stringify(storedRoom);
    this.rooms.set(code, {
      version: nextVersion,
      dataJson: serialized,
      expiresAt: this.now() + normalizeTtlMs(ttlSeconds),
    });

    return {
      ok: true,
      version: nextVersion,
      room: JSON.parse(serialized) as RoomRecord,
    };
  }

  async deleteRoom(code: string): Promise<void> {
    this.rooms.delete(code);
    this.presence.delete(code);
  }

  async setPresence(
    code: string,
    memberId: string,
    entry: PresenceEntry,
    ttlSeconds: number,
  ): Promise<void> {
    const existing = this.prunePresenceIfExpired(code);
    const entries = existing ? existing.entries : new Map<string, string>();
    entries.set(memberId, JSON.stringify(entry));
    this.presence.set(code, {
      entries,
      expiresAt: this.now() + normalizeTtlMs(ttlSeconds),
    });
  }

  async getPresenceMap(code: string): Promise<PresenceMap> {
    const existing = this.prunePresenceIfExpired(code);
    const map: PresenceMap = {};
    if (!existing) {
      return map;
    }
    existing.entries.forEach((value, memberId) => {
      if (isUnsafeRecordKey(memberId)) {
        return;
      }
      setSafePresenceEntry(map, memberId, JSON.parse(value) as PresenceEntry);
    });
    return map;
  }

  async saveMatchAtomic(
    record: MatchRecord,
    summary: MatchSummary,
    maxMatches = MAX_ONLINE_MATCHES,
  ): Promise<boolean> {
    if (this.matchRecords.has(record.id)) {
      return false;
    }
    const cap = Number.isFinite(maxMatches)
      ? Math.max(1, Math.floor(maxMatches))
      : MAX_ONLINE_MATCHES;
    this.matchRecords.set(record.id, JSON.stringify(record));
    this.matchSummaries.set(record.id, JSON.stringify(summary));
    this.matchIds.unshift(record.id);

    while (this.matchIds.length > cap) {
      const oldId = this.matchIds.pop();
      if (oldId !== undefined) {
        this.matchSummaries.delete(oldId);
        this.matchRecords.delete(oldId);
      }
    }
    return true;
  }

  async listMatchSummaries(limit: number): Promise<MatchSummary[]> {
    if (!Number.isFinite(limit) || limit <= 0) {
      return [];
    }
    const clamped = Math.max(1, Math.min(MAX_ONLINE_MATCHES, Math.floor(limit)));
    const ids = this.matchIds.slice(0, clamped);
    const results: MatchSummary[] = [];
    for (let i = 0; i < ids.length; i++) {
      const serialized = this.matchSummaries.get(ids[i]);
      if (serialized !== undefined) {
        results.push(JSON.parse(serialized) as MatchSummary);
      }
    }
    return results;
  }

  async getMatchRecord(matchId: string): Promise<MatchRecord | null> {
    const serialized = this.matchRecords.get(matchId);
    if (serialized === undefined) {
      return null;
    }
    return JSON.parse(serialized) as MatchRecord;
  }

  clear(): void {
    this.rooms.clear();
    this.presence.clear();
    this.matchIds = [];
    this.matchSummaries.clear();
    this.matchRecords.clear();
  }

  reset(): void {
    this.clear();
  }
}

export function getSharedMemoryStore(): MemoryStore {
  if (!globalThis.__wallgoMemoryStore) {
    globalThis.__wallgoMemoryStore = new MemoryStore();
  }
  return globalThis.__wallgoMemoryStore;
}

export function resetSharedMemoryStore(): void {
  if (globalThis.__wallgoMemoryStore) {
    globalThis.__wallgoMemoryStore.clear();
  }
}
