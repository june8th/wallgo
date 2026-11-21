import {
  MAX_ROOM_SESSION_CACHE,
  STORAGE_KEY_PROFILE,
  STORAGE_KEY_ROOM_SESSIONS,
  isValidRoomCode,
  normalizeNickname,
  normalizeRoomCode,
} from '../shared';
import type { PlayerProfile, StoredRoomSession } from '../shared';
import { safeGetItem, safeSetItem } from './safeStorage';

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function generateClientId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (typeof randomUuid === 'string' && randomUuid.length > 0) {
    return `c_${randomUuid}`;
  }
  const timePart = Date.now().toString(36);
  const randPart = Math.random().toString(36).slice(2, 10);
  return `c_${timePart}_${randPart}`;
}

/**
 * Pure read of `wallgo.profile` (never mutates storage).
 * Returns `null` when unset, corrupt, or inaccessible.
 */
export function getSavedProfile(storage?: Storage | null): PlayerProfile | null {
  const raw = safeGetItem(STORAGE_KEY_PROFILE, storage);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const candidate = parsed as Partial<PlayerProfile>;
    if (
      typeof candidate.clientId !== 'string' ||
      candidate.clientId.trim().length === 0
    ) {
      return null;
    }
    const nickname =
      typeof candidate.nickname === 'string'
        ? normalizeNickname(candidate.nickname, '')
        : '';
    const updatedAt =
      typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : 0;
    return {
      clientId: candidate.clientId.trim(),
      nickname,
      updatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Returns the saved non-empty player nickname, or `null` if none has been saved.
 * Preserves fresh-browser locale defaults in Local Lobby (`플레이어 1..3` / `Player 1..3`).
 */
export function getSavedNickname(storage?: Storage | null): string | null {
  const profile = getSavedProfile(storage);
  if (!profile || profile.nickname.length === 0) {
    return null;
  }
  return profile.nickname;
}

/**
 * Reads an existing profile or initializes and persists a fresh `clientId` identity.
 * Never throws even when localStorage is blocked in Private Mode.
 */
export function getOrCreateProfile(
  storage?: Storage | null,
  now = Date.now(),
): PlayerProfile {
  const existing = getSavedProfile(storage);
  if (existing) {
    return existing;
  }
  const created: PlayerProfile = {
    clientId: generateClientId(),
    nickname: '',
    updatedAt: now,
  };
  safeSetItem(STORAGE_KEY_PROFILE, JSON.stringify(created), storage);
  return created;
}

/**
 * Normalizes and saves the player's nickname while preserving `clientId`.
 */
export function saveProfileNickname(
  rawNickname: string,
  storage?: Storage | null,
  now = Date.now(),
): PlayerProfile {
  const current = getOrCreateProfile(storage, now);
  const nickname = normalizeNickname(rawNickname, '');
  const updated: PlayerProfile = {
    clientId: current.clientId,
    nickname,
    updatedAt: now,
  };
  safeSetItem(STORAGE_KEY_PROFILE, JSON.stringify(updated), storage);
  return updated;
}

// ============================================================================
// Per-Room Session Token LRU Cache (`wallgo.roomSessions`, max 20 entries)
// ============================================================================

function loadSessionsMap(storage?: Storage | null): Map<string, StoredRoomSession> {
  const map = new Map<string, StoredRoomSession>();
  const raw = safeGetItem(STORAGE_KEY_ROOM_SESSIONS, storage);
  if (!raw) {
    return map;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return map;
    }
    for (const [rawKey, rawVal] of Object.entries(parsed as Record<string, unknown>)) {
      if (FORBIDDEN_OBJECT_KEYS.has(rawKey)) {
        continue;
      }
      const code = normalizeRoomCode(rawKey);
      if (!isValidRoomCode(code)) {
        continue;
      }
      if (!rawVal || typeof rawVal !== 'object' || Array.isArray(rawVal)) {
        continue;
      }
      const entry = rawVal as Partial<StoredRoomSession>;
      if (
        typeof entry.sessionToken !== 'string' ||
        entry.sessionToken.trim().length === 0 ||
        typeof entry.savedAt !== 'number' ||
        !Number.isFinite(entry.savedAt)
      ) {
        continue;
      }
      const existing = map.get(code);
      if (!existing || entry.savedAt >= existing.savedAt) {
        map.set(code, {
          sessionToken: entry.sessionToken.trim(),
          savedAt: entry.savedAt,
        });
      }
    }
  } catch {
    return map;
  }
  return map;
}

function persistSessionsMap(
  map: Map<string, StoredRoomSession>,
  storage?: Storage | null,
): void {
  const sorted = Array.from(map.entries()).sort(
    (a, b) =>
      b[1].savedAt - a[1].savedAt || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  const capped = sorted.slice(0, MAX_ROOM_SESSION_CACHE);
  const plain: Record<string, StoredRoomSession> = Object.create(null);
  for (const [code, entry] of capped) {
    plain[code] = entry;
  }
  safeSetItem(STORAGE_KEY_ROOM_SESSIONS, JSON.stringify(plain), storage);
}

export function getRoomSession(
  roomCode: string,
  storage?: Storage | null,
): StoredRoomSession | null {
  const code = normalizeRoomCode(roomCode);
  if (!isValidRoomCode(code)) {
    return null;
  }
  const map = loadSessionsMap(storage);
  return map.get(code) ?? null;
}

export function saveRoomSession(
  roomCode: string,
  sessionToken: string,
  storage?: Storage | null,
  now = Date.now(),
): void {
  const code = normalizeRoomCode(roomCode);
  const trimmedToken = typeof sessionToken === 'string' ? sessionToken.trim() : '';
  if (!isValidRoomCode(code) || trimmedToken.length === 0) {
    return;
  }
  const map = loadSessionsMap(storage);
  const baseNow = Number.isFinite(now) ? now : Date.now();
  let maxExistingSavedAt = -Infinity;
  for (const [existingCode, existingEntry] of map.entries()) {
    if (existingCode !== code && existingEntry.savedAt > maxExistingSavedAt) {
      maxExistingSavedAt = existingEntry.savedAt;
    }
  }
  const effectiveSavedAt =
    maxExistingSavedAt !== -Infinity && baseNow <= maxExistingSavedAt
      ? maxExistingSavedAt + 1
      : baseNow;
  map.set(code, {
    sessionToken: trimmedToken,
    savedAt: effectiveSavedAt,
  });
  persistSessionsMap(map, storage);
}

export function removeRoomSession(
  roomCode: string,
  storage?: Storage | null,
): void {
  const code = normalizeRoomCode(roomCode);
  if (!isValidRoomCode(code)) {
    return;
  }
  const map = loadSessionsMap(storage);
  if (!map.has(code)) {
    return;
  }
  map.delete(code);
  persistSessionsMap(map, storage);
}

export interface RoomSessionListEntry {
  roomCode: string;
  sessionToken: string;
  savedAt: number;
}

export function listRoomSessions(
  storage?: Storage | null,
): RoomSessionListEntry[] {
  const map = loadSessionsMap(storage);
  return Array.from(map.entries())
    .sort(
      (a, b) =>
        b[1].savedAt - a[1].savedAt || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    )
    .map(([roomCode, entry]) => ({
      roomCode,
      sessionToken: entry.sessionToken,
      savedAt: entry.savedAt,
    }));
}
