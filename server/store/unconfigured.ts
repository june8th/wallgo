import type { MatchRecord, MatchSummary } from '../../src/shared/historyTypes.js';
import type { StorageMode } from '../../src/shared/onlineTypes.js';
import type { PresenceEntry, PresenceMap, RoomRecord } from '../types.js';
import { RedisNotConfiguredError, type CasResult, type StorageAdapter } from './types.js';

export class UnconfiguredStore implements StorageAdapter {
  readonly mode: StorageMode = 'unconfigured';

  async createRoomNx(_room: RoomRecord, _ttlSeconds: number): Promise<boolean> {
    throw new RedisNotConfiguredError();
  }

  async getRoom(_code: string): Promise<RoomRecord | null> {
    throw new RedisNotConfiguredError();
  }

  async casUpdateRoom(
    _code: string,
    _expectedVersion: number,
    _nextRoom: RoomRecord,
    _ttlSeconds: number,
  ): Promise<CasResult> {
    throw new RedisNotConfiguredError();
  }

  async deleteRoom(_code: string): Promise<void> {
    throw new RedisNotConfiguredError();
  }

  async setPresence(
    _code: string,
    _memberId: string,
    _entry: PresenceEntry,
    _ttlSeconds: number,
  ): Promise<void> {
    throw new RedisNotConfiguredError();
  }

  async getPresenceMap(_code: string): Promise<PresenceMap> {
    throw new RedisNotConfiguredError();
  }

  async saveMatchAtomic(
    _record: MatchRecord,
    _summary: MatchSummary,
    _maxMatches?: number,
  ): Promise<boolean> {
    throw new RedisNotConfiguredError();
  }

  async listMatchSummaries(_limit: number): Promise<MatchSummary[]> {
    return [];
  }

  async getMatchRecord(_matchId: string): Promise<MatchRecord | null> {
    throw new RedisNotConfiguredError();
  }
}
