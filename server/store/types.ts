import type { MatchRecord, MatchSummary } from '../../src/shared/historyTypes.js';
import type { StorageMode } from '../../src/shared/onlineTypes.js';
import type { PresenceEntry, PresenceMap, RoomRecord } from '../types.js';

export type CasResult =
  | { ok: true; version: number; room: RoomRecord }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'CONFLICT'; currentVersion: number; currentRoom: RoomRecord };

export class RedisNotConfiguredError extends Error {
  readonly code = 'REDIS_NOT_CONFIGURED' as const;
  readonly status = 503 as const;

  constructor(
    message = 'Online multiplayer requires Upstash Redis (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL / KV_REST_API_TOKEN).',
  ) {
    super(message);
    this.name = 'RedisNotConfiguredError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class StorageBackendError extends Error {
  readonly code = 'INTERNAL_ERROR' as const;
  readonly status = 500 as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageBackendError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface StorageAdapter {
  readonly mode: StorageMode;
  createRoomNx(room: RoomRecord, ttlSeconds: number): Promise<boolean>;
  getRoom(code: string): Promise<RoomRecord | null>;
  casUpdateRoom(
    code: string,
    expectedVersion: number,
    nextRoom: RoomRecord,
    ttlSeconds: number,
  ): Promise<CasResult>;
  deleteRoom(code: string): Promise<void>;
  setPresence(
    code: string,
    memberId: string,
    entry: PresenceEntry,
    ttlSeconds: number,
  ): Promise<void>;
  getPresenceMap(code: string): Promise<PresenceMap>;
  saveMatchAtomic(
    record: MatchRecord,
    summary: MatchSummary,
    maxMatches?: number,
  ): Promise<boolean>;
  listMatchSummaries(limit: number): Promise<MatchSummary[]>;
  getMatchRecord(matchId: string): Promise<MatchRecord | null>;
  clear?(): void;
}
