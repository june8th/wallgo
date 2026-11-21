import type { AIDifficulty, GameState, PlayerColorToken } from '../src/engine/types.js';
import type { ReplayData } from '../src/shared/historyTypes.js';
import {
  AI_STEP_DELAY_MS,
  AWAY_GRACE_MS,
  DISCONNECT_TIMEOUT_MS,
  HEARTBEAT_WRITE_THROTTLE_MS,
  ROOM_TTL_ACTIVE_SECONDS,
  ROOM_TTL_FINISHED_SECONDS,
  type OnlineRoomConfig,
  type RoomEventNotice,
  type RoomStatus,
  type SeatKind,
  type SpectatorRole,
} from '../src/shared/onlineTypes.js';

export { ROOM_TTL_ACTIVE_SECONDS, ROOM_TTL_FINISHED_SECONDS };

// ============================================================================
// Decoupled Redis Keyspace Constants & Builders
// ============================================================================

export const ROOM_KEY_PREFIX = 'wallgo:room:';
export const PRESENCE_KEY_PREFIX = 'wallgo:presence:';
export const MATCH_KEY_PREFIX = 'wallgo:match:';
export const MATCHES_IDS_KEY = 'wallgo:matches:ids';
export const MATCHES_SUMMARIES_KEY = 'wallgo:matches:summaries';

export function roomKey(code: string): string {
  return `${ROOM_KEY_PREFIX}${code}`;
}

export function presenceKey(code: string): string {
  return `${PRESENCE_KEY_PREFIX}${code}`;
}

export function matchKey(matchId: string): string {
  return `${MATCH_KEY_PREFIX}${matchId}`;
}

// ============================================================================
// TTL, Capacity & Env-Overrideable Timing Helpers
// ============================================================================

export const MAX_KICKED_TOKENS = 20;

export function getRoomTtlSeconds(status: RoomStatus): number {
  return status === 'finished' ? ROOM_TTL_FINISHED_SECONDS : ROOM_TTL_ACTIVE_SECONDS;
}

export type EnvMap = Record<string, string | undefined>;

export function readNonNegativeIntEnv(
  env: EnvMap,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (typeof raw !== 'string') {
    return fallback;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function getAwayGraceMs(env: EnvMap = process.env): number {
  return readNonNegativeIntEnv(env, 'WALLGO_AWAY_GRACE_MS', AWAY_GRACE_MS);
}

export function getDisconnectTimeoutMs(env: EnvMap = process.env): number {
  return readNonNegativeIntEnv(env, 'WALLGO_DISCONNECT_TIMEOUT_MS', DISCONNECT_TIMEOUT_MS);
}

export function getAiStepDelayMs(env: EnvMap = process.env): number {
  return readNonNegativeIntEnv(env, 'WALLGO_AI_STEP_MIN_DELAY_MS', AI_STEP_DELAY_MS);
}

export function getHeartbeatWriteThrottleMs(env: EnvMap = process.env): number {
  return readNonNegativeIntEnv(
    env,
    'WALLGO_HEARTBEAT_WRITE_THROTTLE_MS',
    HEARTBEAT_WRITE_THROTTLE_MS,
  );
}

// ============================================================================
// Server-Only Internal Room & Presence Records (NEVER exposed raw over HTTP)
// ============================================================================

export interface PresenceEntry {
  lastSeenAt: number;
  awaySince: number | null;
}

export type PresenceMap = Record<string, PresenceEntry>;

export interface InternalOnlineSeat {
  seatIndex: number;
  kind: SeatKind;
  colorToken: PlayerColorToken;
  memberId: string | null;
  sessionToken: string | null;
  clientId: string | null;
  nickname: string;
  aiDifficulty: AIDifficulty;
  gamePlayerId: number | null;
  joinedAt: number | null;
  explicitlyLeft: boolean;
  substitutedFromNickname: string | null;
}

export interface InternalSpectator {
  memberId: string;
  sessionToken: string;
  clientId: string;
  nickname: string;
  role: SpectatorRole;
  joinedAt: number;
  explicitlyLeft: boolean;
}

export interface StoredRound1SeatSnapshot {
  seatIndex: number;
  kind: SeatKind;
  colorToken: PlayerColorToken;
  memberId: string | null;
  sessionToken: string | null;
  clientId: string | null;
  nickname: string;
  aiDifficulty: AIDifficulty;
  joinedAt: number | null;
}

export interface StoredRound1Roster {
  seats: StoredRound1SeatSnapshot[];
  survivorMemberId: string | null;
  survivorSeatIndex: number | null;
}

export interface RoomRecord {
  code: string;
  version: number;
  status: RoomStatus;
  roundNumber: 1 | 2;
  gameSequence: number;
  createdAt: number;
  updatedAt: number;
  config: OnlineRoomConfig;
  hostMemberId: string;
  seats: InternalOnlineSeat[];
  spectators: InternalSpectator[];
  kickedTokens: string[];
  gameState: GameState | null;
  turnStartedAt: number | null;
  nextAiStepAt: number | null;
  matchSavedId: string | null;
  lastEvent: RoomEventNotice | null;
  eventCounter: number;
  round1Roster: StoredRound1Roster | null;
  replayDraft: ReplayData | null;
}
