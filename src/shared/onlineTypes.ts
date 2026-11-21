import type {
  AIDifficulty,
  CellPos,
  GameFormat,
  GameState,
  PieceKind,
  PlayerColorToken,
  RuleVariant,
  TimerSeconds,
  WallEdge,
} from '../engine/index.js';

// ============================================================================
// Frozen LocalStorage Keys (PROJECT.md §1 — Authoritative)
// ============================================================================

export const STORAGE_KEY_LOCALE = 'wallgo.locale';
export const STORAGE_KEY_PROFILE = 'wallgo.profile';
export const STORAGE_KEY_ROOM_SESSIONS = 'wallgo.roomSessions';
export const STORAGE_KEY_LOCAL_MATCHES = 'wallgo.localMatches';

// ============================================================================
// Room Code, Nickname, Capacity & Timing Constants
// ============================================================================

/** 32 unambiguous characters (excludes 0, O, 1, I; exact power-of-2 for unbiased RNG) */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export const NICKNAME_MAX_LENGTH = 12;
export const MAX_SPECTATORS_PER_ROOM = 20;
export const MAX_ROOM_SESSION_CACHE = 20;
export const MAX_ONLINE_MATCHES = 200;
export const MAX_LOCAL_MATCHES = 100;

export const POLL_INTERVAL_ACTIVE_MS = 1_500;
export const POLL_INTERVAL_FINISHED_MS = 3_000;
export const POLL_INTERVAL_BACKGROUND_MS = 5_000;
export const HEARTBEAT_WRITE_THROTTLE_MS = 4_000;
export const AWAY_GRACE_MS = 4_000;
export const DISCONNECT_TIMEOUT_MS = 15_000;
export const AI_STEP_DELAY_MS = 450;
export const AI_STEP_FAILOVER_EXTRA_MS = 800;
export const TIMEOUT_NON_ACTOR_GRACE_MS = 1_500;
export const TIMEOUT_ACTOR_SKEW_MS = 250;

export const ROOM_TTL_ACTIVE_SECONDS = 21_600; // 6h (waiting / playing)
export const ROOM_TTL_FINISHED_SECONDS = 7_200; // 2h (finished)

// ============================================================================
// Core Domain Union & Config Types
// ============================================================================

export type Locale = 'ko' | 'en';
export type RoomStatus = 'waiting' | 'playing' | 'finished';
export type SeatKind = 'open' | 'human' | 'ai';
export type ConnectionStatus = 'connected' | 'disconnected' | 'left';
export type SpectatorRole = 'spectator' | 'survivor_spectator' | 'replaced_spectator';
export type StorageMode = 'redis' | 'memory' | 'unconfigured';

export interface OnlineRoomConfig {
  ruleVariant: RuleVariant;
  format: GameFormat;
  timerSeconds: TimerSeconds;
  shuffleOrder: boolean;
}

/** Browser-persisted player identity (`wallgo.profile`) */
export interface PlayerProfile {
  clientId: string;
  nickname: string;
  updatedAt: number;
}

/** Browser-persisted per-room session entry (`wallgo.roomSessions`) */
export interface StoredRoomSession {
  sessionToken: string;
  savedAt: number;
}

// ============================================================================
// Public Room Projections (NEVER contain sessionToken or clientId!)
// ============================================================================

export interface PublicOnlineSeat {
  seatIndex: number;
  kind: SeatKind;
  colorToken: PlayerColorToken;
  memberId: string | null;
  nickname: string;
  aiDifficulty: AIDifficulty;
  gamePlayerId: number | null;
  isHost: boolean;
  connectionStatus: ConnectionStatus;
  substitutedFromNickname: string | null;
}

export interface PublicSpectator {
  memberId: string;
  nickname: string;
  role: SpectatorRole;
  isHost: boolean;
  connectionStatus: ConnectionStatus;
}

export interface RoomViewerInfo {
  role: 'player' | 'spectator' | 'anonymous';
  memberId: string | null;
  seatIndex: number | null;
  gamePlayerId: number | null;
  isHost: boolean;
  spectatorRole: SpectatorRole | null;
  wasKicked: boolean;
}

export type RoomEventNotice =
  | {
      id: number;
      type: 'ai_substituted';
      nickname: string;
      aiDifficulty: AIDifficulty;
      at: number;
    }
  | {
      id: number;
      type: 'host_transferred';
      newHostNickname: string;
      at: number;
    }
  | {
      id: number;
      type: 'round2_started';
      survivorNickname: string | null;
      at: number;
    }
  | {
      id: number;
      type: 'player_timed_out';
      nickname: string;
      at: number;
    }
  | {
      id: number;
      type: 'player_auto_skipped';
      skippedPlayerIds: number[];
      at: number;
    };

export interface RoomPresenceSummary {
  seats: Array<{ seatIndex: number; connectionStatus: ConnectionStatus }>;
  spectators: Array<{ memberId: string; connectionStatus: ConnectionStatus }>;
  canClaimHost: boolean;
}

export interface PublicRoomSnapshot {
  code: string;
  version: number;
  status: RoomStatus;
  roundNumber: 1 | 2;
  gameSequence: number;
  config: OnlineRoomConfig;
  hostMemberId: string;
  seats: PublicOnlineSeat[];
  spectators: PublicSpectator[];
  gameState: GameState | null;
  turnStartedAt: number | null;
  nextAiStepAt: number | null;
  matchSavedId: string | null;
  lastEvent: RoomEventNotice | null;
  canClaimHost: boolean;
  serverNow: number;
  viewer: RoomViewerInfo;
}

// ============================================================================
// Authoritative Online Actions & Room Commands (STRICTLY NO undo/redo!)
// ============================================================================

export type OnlineGameAction =
  | { type: 'commit_placement'; pos: CellPos; kind?: PieceKind }
  | {
      type: 'commit_turn';
      pieceId: string;
      useWallBreak: boolean;
      breakWall: WallEdge | null;
      destination: CellPos;
      placeWall: WallEdge;
    };

export interface TimeoutPartialMove {
  pieceId: string;
  useWallBreak: boolean;
  breakWall: WallEdge | null;
  destination: CellPos;
}

export type RoomCommand =
  | { op: 'join'; nickname: string; clientId: string; sessionToken?: string; locale?: Locale }
  | { op: 'leave'; sessionToken: string }
  | { op: 'ping_away'; sessionToken: string }
  | { op: 'update_nickname'; sessionToken: string; expectedVersion: number; nickname: string }
  | {
      op: 'update_config';
      sessionToken: string;
      expectedVersion: number;
      patch: Partial<OnlineRoomConfig>;
    }
  | {
      op: 'set_seat';
      sessionToken: string;
      expectedVersion: number;
      seatIndex: number;
      kind: 'open' | 'ai';
      aiDifficulty?: AIDifficulty;
    }
  | { op: 'kick_seat'; sessionToken: string; expectedVersion: number; seatIndex: number }
  | { op: 'start_game'; sessionToken: string; expectedVersion: number }
  | {
      op: 'game_action';
      sessionToken: string;
      expectedVersion: number;
      action: OnlineGameAction;
    }
  | { op: 'ai_step'; sessionToken: string; expectedVersion: number }
  | {
      op: 'timeout';
      sessionToken: string;
      expectedVersion: number;
      partialMove?: TimeoutPartialMove;
    }
  | {
      op: 'substitute_ai';
      sessionToken: string;
      expectedVersion: number;
      seatIndex: number;
      aiDifficulty: AIDifficulty;
    }
  | { op: 'claim_host'; sessionToken: string; expectedVersion: number }
  | {
      op: 'start_round2';
      sessionToken: string;
      expectedVersion: number;
      overridePair?: [number, number];
    }
  | { op: 'rematch'; sessionToken: string; expectedVersion: number }
  | { op: 'return_to_waiting'; sessionToken: string; expectedVersion: number };

// ============================================================================
// API Error Codes & Response Envelopes
// ============================================================================

export type ApiErrorCode =
  | 'REDIS_NOT_CONFIGURED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_REQUEST'
  | 'INVALID_ROOM_CODE'
  | 'ROOM_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'HOST_ONLY'
  | 'FORBIDDEN_SPECTATOR'
  | 'NOT_YOUR_TURN'
  | 'INVALID_ROOM_STATUS'
  | 'SEATS_NOT_READY'
  | 'SEAT_NOT_DISCONNECTED'
  | 'CANNOT_MODIFY_HOST_SEAT'
  | 'UNDO_DISABLED_ONLINE'
  | 'ILLEGAL_MOVE'
  | 'VERSION_CONFLICT'
  | 'ROOM_SPECTATORS_FULL'
  | 'HOST_STILL_CONNECTED'
  | 'MATCH_NOT_FOUND'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
  room?: PublicRoomSnapshot;
}

export interface HealthResponse {
  ok: true;
  storage: StorageMode;
  onlineAvailable: boolean;
  serverNow: number;
}

export interface CreateRoomRequest {
  nickname: string;
  clientId: string;
  config: OnlineRoomConfig;
  locale?: Locale;
}

export interface CreateRoomResponse {
  room: PublicRoomSnapshot;
  sessionToken: string;
}

export type GetRoomResponse =
  | {
      unchanged: false;
      room: PublicRoomSnapshot;
    }
  | {
      unchanged: true;
      version: number;
      serverNow: number;
      presenceSummary: RoomPresenceSummary;
    };

export interface RoomCommandResponse {
  room: PublicRoomSnapshot;
  sessionToken?: string;
  executed?: boolean;
  retryAfterMs?: number;
}

// ============================================================================
// Pure Isomorphic Normalization & Validation Helpers
// ============================================================================

/** Strips whitespace/hyphens and uppercases a room code (e.g. " ab3-k9m " -> "AB3K9M"). */
export function normalizeRoomCode(raw: string): string {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.replace(/[\s-]+/g, '').toUpperCase();
}

/** Validates an already-normalized 6-char room code against ROOM_CODE_REGEX. */
export function isValidRoomCode(code: string): boolean {
  return typeof code === 'string' && ROOM_CODE_REGEX.test(code);
}

/** Normalizes and validates a raw room code, returning the 6-char code or null. */
export function parseRoomCode(raw: string): string | null {
  const normalized = normalizeRoomCode(raw);
  return isValidRoomCode(normalized) ? normalized : null;
}

/**
 * Normalizes a nickname:
 * - Strips non-whitespace C0/C1 controls, BiDi formatting controls, and zero-width invisible chars
 *   while preserving single ZWJ (\u200D) joiners inside intact emoji clusters (e.g. '👨‍👩‍👧‍👦')
 * - Collapses consecutive ZWJ runs (\u200D+ -> \u200D) and strips orphaned ZWJs at boundaries or
 *   adjacent to whitespace in strictly linear O(n) time
 * - Collapses whitespace runs (\s+, including \r, \n, \t) to a single space and trims
 * - Slices safely by Unicode codepoint (Array.from) to NICKNAME_MAX_LENGTH (12) without splitting surrogate pairs
 * - Strips any leading/trailing orphaned ZWJs and whitespace exposed by slicing
 * - Returns fallback if empty
 */
export function normalizeNickname(raw: string, fallback = ''): string {
  if (typeof raw !== 'string') {
    return fallback;
  }
  const stripped = raw
    // eslint-disable-next-line no-control-regex
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g,
      '',
    )
    .replace(/\u200D+/g, '\u200D')
    .replace(/\s+/g, ' ')
    .replace(/(?:^|(?<=\s))\u200D|\u200D(?=\s|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sliced = Array.from(stripped)
    .slice(0, NICKNAME_MAX_LENGTH)
    .join('')
    .replace(/^[\s\u200D]+|[\s\u200D]+$/g, '');
  return sliced.length > 0 ? sliced : fallback;
}
