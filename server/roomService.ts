import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chooseAiPlacement, chooseAiTurn } from '../src/ai/index.js';
import {
  DEFAULT_PLAYER_NAMES,
  DEFAULT_PLAYER_NAMES_BY_LOCALE,
  applyAtomicTurnAction,
  breakWallAt,
  computeRound2Qualification,
  confirmWallGo2BreakWall,
  createInitialGameState,
  createPrisonMatchRound2State,
  getLegalWallPlacements,
  isInBounds,
  isSameWallEdge,
  isValidWallEdge,
  movePiece,
  placeInitialPiece,
  resolveTurnTimeout,
  selectPiece,
  selectWallGo2BreakDestination,
  setPlayerControllerInGame,
  toggleWallBreak,
  type AIDifficulty,
  type CellPos,
  type GameFormat,
  type GameState,
  type PieceKind,
  type PlayerColorToken,
  type PlayerConfig,
  type RngFn,
  type RuleVariant,
  type TimerSeconds,
  type WallEdge,
} from '../src/engine/index.js';
import {
  MAX_SPECTATORS_PER_ROOM,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_TTL_ACTIVE_SECONDS,
  TIMEOUT_ACTOR_SKEW_MS,
  TIMEOUT_NON_ACTOR_GRACE_MS,
  actionEventToReplayStep,
  createInitialStateFromReplayConfig,
  createReplayInitialConfig,
  extractReplayFromHistory,
  normalizeNickname,
  parseRoomCode,
  type ApiErrorBody,
  type ApiErrorCode,
  type ConnectionStatus,
  type CreateRoomResponse,
  type GetRoomResponse,
  type Locale,
  type OnlineGameAction,
  type OnlineRoomConfig,
  type PublicOnlineSeat,
  type PublicRoomSnapshot,
  type PublicSpectator,
  type RoomCommandResponse,
  type RoomEventNotice,
  type RoomPresenceSummary,
  type RoomViewerInfo,
  type TimeoutPartialMove,
} from '../src/shared/index.js';
import { buildOnlineMatchId, saveOnlineMatchForRoom } from './matchService.js';
import type { ApiRouteContext, ApiRouteHandlers } from './router.js';
import { RedisNotConfiguredError, type StorageAdapter } from './store/types.js';
import {
  MAX_KICKED_TOKENS,
  getAiStepDelayMs,
  getAwayGraceMs,
  getDisconnectTimeoutMs,
  getHeartbeatWriteThrottleMs,
  getRoomTtlSeconds,
  type EnvMap,
  type InternalOnlineSeat,
  type InternalSpectator,
  type PresenceEntry,
  type PresenceMap,
  type RoomRecord,
  type StoredRound1Roster,
} from './types.js';

const NO_STORE_CACHE_CONTROL = 'no-store, max-age=0';
const PLAYER_COLOR_TOKENS: readonly [PlayerColorToken, PlayerColorToken, PlayerColorToken] = [
  'p1',
  'p2',
  'p3',
];
const SPECTATOR_DEFAULT_NAME: Record<Locale, string> = {
  ko: '관전자',
  en: 'Spectator',
};

const MAX_CREATE_CODE_ATTEMPTS = 5;
const MAX_JOIN_CAS_RETRIES = 32;
const AI_STEP_EARLY_TOLERANCE_MS = 50;
const MAX_RAW_ROOM_CODE_LENGTH = 64;
const MAX_CLIENT_ID_LENGTH = 128;
const MAX_SESSION_TOKEN_LENGTH = 256;
const MAX_PIECE_ID_LENGTH = 64;
const MAX_UNSAFE_KEY_DEPTH = 6;

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const VALID_CONFIG_KEYS = new Set(['ruleVariant', 'format', 'timerSeconds', 'shuffleOrder']);
const VALID_ROOM_OPS = new Set([
  'join',
  'leave',
  'ping_away',
  'update_nickname',
  'update_config',
  'set_seat',
  'kick_seat',
  'start_game',
  'game_action',
  'ai_step',
  'timeout',
  'substitute_ai',
  'claim_host',
  'start_round2',
  'rematch',
  'return_to_waiting',
]);

export interface RoomServiceDeps {
  generateCode?: () => string;
  rng?: RngFn;
}

export type RoomRouteHandlers = Required<
  Pick<ApiRouteHandlers, 'createRoom' | 'getRoom' | 'postRoomCommand'>
>;

type MatchedMember =
  | { kind: 'seat'; seat: InternalOnlineSeat }
  | { kind: 'spectator'; spectator: InternalSpectator };

// ============================================================================
// HTTP & JSON Helpers (Zero runtime dependency on ./router.js)
// ============================================================================

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': NO_STORE_CACHE_CONTROL,
    },
  });
}

function makeErrorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  const body: ApiErrorBody & Record<string, unknown> = {
    ...(extra ?? {}),
    error: { code, message },
  };
  return makeJsonResponse(body, status);
}

async function parseJsonRequestBody(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return {
      ok: false,
      response: makeErrorResponse(400, 'INVALID_REQUEST', 'Failed to read request body'),
    };
  }
  if (raw.trim().length === 0) {
    return {
      ok: false,
      response: makeErrorResponse(400, 'INVALID_REQUEST', 'Request body must be valid JSON'),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      ok: false,
      response: makeErrorResponse(400, 'INVALID_REQUEST', 'Request body contains malformed JSON'),
    };
  }
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      response: makeErrorResponse(400, 'INVALID_REQUEST', 'Request body must be a JSON object'),
    };
  }
  if (containsUnsafeKeys(parsed)) {
    return {
      ok: false,
      response: makeErrorResponse(400, 'INVALID_REQUEST', 'Request body contains disallowed keys'),
    };
  }
  return { ok: true, body: parsed };
}

// ============================================================================
// Cryptographic Identifiers & Constant-Time Comparisons
// ============================================================================

export function generateDefaultRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[bytes[i] & 31];
  }
  return code;
}

function generateMemberId(): string {
  return `m_${randomBytes(9).toString('base64url')}`;
}

function generateSessionToken(): string {
  return `st_${randomBytes(24).toString('base64url')}`;
}

function tokensEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// ============================================================================
// Defensive Input Validation & Prototype Pollution Guards
// ============================================================================

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function containsUnsafeKeys(value: unknown, depth = 0): boolean {
  if (depth > MAX_UNSAFE_KEY_DEPTH) {
    return true;
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsUnsafeKeys(item, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) {
      return true;
    }
    if (containsUnsafeKeys((value as Record<string, unknown>)[key], depth + 1)) {
      return true;
    }
  }
  return false;
}

function hasControlChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001F\u007F]/.test(value);
}

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
}

function validateRawRoomCode(rawCode: string): string | null {
  if (typeof rawCode !== 'string' || rawCode.length > MAX_RAW_ROOM_CODE_LENGTH) {
    return null;
  }
  return parseRoomCode(rawCode);
}

function validateClientId(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CLIENT_ID_LENGTH || hasControlChars(trimmed)) {
    return null;
  }
  return trimmed;
}

function validateSessionToken(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_SESSION_TOKEN_LENGTH ||
    hasControlChars(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function parseExpectedVersion(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) {
    return null;
  }
  return raw;
}

function isValidRuleVariant(v: unknown): v is RuleVariant {
  return v === 'wallgo1' || v === 'wallgo2';
}

function isValidGameFormat(v: unknown): v is GameFormat {
  return v === '3p' || v === '2p';
}

function isValidTimerSeconds(v: unknown): v is TimerSeconds {
  return v === 0 || v === 90 || v === 60;
}

function isValidAiDifficulty(v: unknown): v is AIDifficulty {
  return v === 'easy' || v === 'normal' || v === 'hard';
}

function isValidLocale(v: unknown): v is Locale {
  return v === 'ko' || v === 'en';
}

function isValidPieceKind(v: unknown): v is PieceKind {
  return v === 'standard' || v === 'square' || v === 'round';
}

function parseCellPos(raw: unknown): CellPos | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (
    typeof raw.row !== 'number' ||
    !Number.isInteger(raw.row) ||
    typeof raw.col !== 'number' ||
    !Number.isInteger(raw.col)
  ) {
    return null;
  }
  return { row: normalizeZero(raw.row), col: normalizeZero(raw.col) };
}

function parseWallEdge(raw: unknown): WallEdge | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (
    (raw.orientation !== 'h' && raw.orientation !== 'v') ||
    typeof raw.row !== 'number' ||
    !Number.isInteger(raw.row) ||
    typeof raw.col !== 'number' ||
    !Number.isInteger(raw.col)
  ) {
    return null;
  }
  return {
    orientation: raw.orientation,
    row: normalizeZero(raw.row),
    col: normalizeZero(raw.col),
  };
}

function validateOnlineRoomConfig(raw: unknown): OnlineRoomConfig | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  for (const key of Object.keys(raw)) {
    if (!VALID_CONFIG_KEYS.has(key)) {
      return null;
    }
  }
  if (
    !isValidRuleVariant(raw.ruleVariant) ||
    !isValidGameFormat(raw.format) ||
    !isValidTimerSeconds(raw.timerSeconds) ||
    typeof raw.shuffleOrder !== 'boolean'
  ) {
    return null;
  }
  return {
    ruleVariant: raw.ruleVariant,
    format: raw.format,
    timerSeconds: raw.timerSeconds,
    shuffleOrder: raw.shuffleOrder,
  };
}

function validateConfigPatch(raw: unknown): Partial<OnlineRoomConfig> | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  const out: Partial<OnlineRoomConfig> = {};
  for (const key of Object.keys(raw)) {
    if (!VALID_CONFIG_KEYS.has(key)) {
      return null;
    }
    const val = raw[key];
    if (key === 'ruleVariant') {
      if (!isValidRuleVariant(val)) return null;
      out.ruleVariant = val;
    } else if (key === 'format') {
      if (!isValidGameFormat(val)) return null;
      out.format = val;
    } else if (key === 'timerSeconds') {
      if (!isValidTimerSeconds(val)) return null;
      out.timerSeconds = val;
    } else if (key === 'shuffleOrder') {
      if (typeof val !== 'boolean') return null;
      out.shuffleOrder = val;
    }
  }
  return out;
}

function parseOnlineGameAction(raw: unknown): OnlineGameAction | null {
  if (!isPlainObject(raw) || typeof raw.type !== 'string') {
    return null;
  }
  if (raw.type === 'commit_placement') {
    const pos = parseCellPos(raw.pos);
    if (!pos) {
      return null;
    }
    if (hasOwn(raw, 'kind') && raw.kind !== undefined) {
      if (!isValidPieceKind(raw.kind)) {
        return null;
      }
      return { type: 'commit_placement', pos, kind: raw.kind };
    }
    return { type: 'commit_placement', pos };
  }
  if (raw.type === 'commit_turn') {
    if (
      typeof raw.pieceId !== 'string' ||
      raw.pieceId.trim().length === 0 ||
      raw.pieceId.length > MAX_PIECE_ID_LENGTH ||
      typeof raw.useWallBreak !== 'boolean'
    ) {
      return null;
    }
    const destination = parseCellPos(raw.destination);
    const placeWall = parseWallEdge(raw.placeWall);
    if (!destination || !placeWall) {
      return null;
    }
    let breakWall: WallEdge | null = null;
    if (raw.breakWall !== null) {
      breakWall = parseWallEdge(raw.breakWall);
      if (!breakWall) {
        return null;
      }
    }
    return {
      type: 'commit_turn',
      pieceId: raw.pieceId,
      useWallBreak: raw.useWallBreak,
      breakWall,
      destination,
      placeWall,
    };
  }
  return null;
}

function parseTimeoutPartialMove(raw: unknown): TimeoutPartialMove | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (
    typeof raw.pieceId !== 'string' ||
    raw.pieceId.trim().length === 0 ||
    raw.pieceId.length > MAX_PIECE_ID_LENGTH ||
    typeof raw.useWallBreak !== 'boolean'
  ) {
    return null;
  }
  const destination = parseCellPos(raw.destination);
  if (!destination) {
    return null;
  }
  let breakWall: WallEdge | null = null;
  if (raw.breakWall !== null) {
    breakWall = parseWallEdge(raw.breakWall);
    if (!breakWall) {
      return null;
    }
  }
  return {
    pieceId: raw.pieceId,
    useWallBreak: raw.useWallBreak,
    breakWall,
    destination,
  };
}

function parseOverridePair(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) {
    return null;
  }
  const [a, b] = raw;
  if (
    typeof a !== 'number' ||
    typeof b !== 'number' ||
    !Number.isInteger(a) ||
    !Number.isInteger(b) ||
    a < 0 ||
    a > 2 ||
    b < 0 ||
    b > 2 ||
    a === b
  ) {
    return null;
  }
  return [normalizeZero(a), normalizeZero(b)];
}

// ============================================================================
// Seat Builders, Member Lookups, Presence & Sanitization
// ============================================================================

function createOpenSeat(seatIndex: number, colorToken?: PlayerColorToken): InternalOnlineSeat {
  return {
    seatIndex,
    kind: 'open',
    colorToken: colorToken ?? PLAYER_COLOR_TOKENS[seatIndex] ?? 'p1',
    memberId: null,
    sessionToken: null,
    clientId: null,
    nickname: '',
    aiDifficulty: 'normal',
    gamePlayerId: null,
    joinedAt: null,
    explicitlyLeft: false,
    substitutedFromNickname: null,
  };
}

function findMemberBySessionToken(room: RoomRecord, token: string | null): MatchedMember | null {
  if (!token) {
    return null;
  }
  for (const seat of room.seats) {
    if (seat.kind === 'human' && tokensEqual(seat.sessionToken, token)) {
      return { kind: 'seat', seat };
    }
  }
  for (const spectator of room.spectators) {
    if (tokensEqual(spectator.sessionToken, token)) {
      return { kind: 'spectator', spectator };
    }
  }
  return null;
}

function findMemberByClientId(room: RoomRecord, clientId: string): MatchedMember | null {
  for (const seat of room.seats) {
    if (seat.kind === 'human' && tokensEqual(seat.clientId, clientId)) {
      return { kind: 'seat', seat };
    }
  }
  for (const spectator of room.spectators) {
    if (tokensEqual(spectator.clientId, clientId)) {
      return { kind: 'spectator', spectator };
    }
  }
  return null;
}

function isKickedToken(room: RoomRecord, token: string | null): boolean {
  if (!token) {
    return false;
  }
  return room.kickedTokens.some((kicked) => tokensEqual(kicked, token));
}

function getMemberId(member: MatchedMember): string {
  return member.kind === 'seat' ? member.seat.memberId! : member.spectator.memberId;
}

function getMemberNickname(member: MatchedMember): string {
  return member.kind === 'seat' ? member.seat.nickname : member.spectator.nickname;
}

function getMemberExplicitlyLeft(member: MatchedMember): boolean {
  return member.kind === 'seat' ? member.seat.explicitlyLeft : member.spectator.explicitlyLeft;
}

function getMemberJoinedAt(member: MatchedMember): number | null {
  return member.kind === 'seat' ? member.seat.joinedAt : member.spectator.joinedAt;
}

function computeSeatConnectionStatus(
  seat: InternalOnlineSeat,
  presence: PresenceMap,
  now: number,
  awayGraceMs: number,
  disconnectTimeoutMs: number,
  roomCreatedAt: number,
): ConnectionStatus {
  if (seat.kind !== 'human') {
    return 'connected';
  }
  if (seat.explicitlyLeft) {
    return 'left';
  }
  const entry = seat.memberId && hasOwn(presence, seat.memberId) ? presence[seat.memberId] : undefined;
  const lastSeenAt = entry ? entry.lastSeenAt : (seat.joinedAt ?? roomCreatedAt);
  const awaySince = entry ? entry.awaySince : null;
  if (awaySince !== null && now - awaySince >= awayGraceMs) {
    return 'disconnected';
  }
  if (now - lastSeenAt >= disconnectTimeoutMs) {
    return 'disconnected';
  }
  return 'connected';
}

function computeSpectatorConnectionStatus(
  spectator: InternalSpectator,
  presence: PresenceMap,
  now: number,
  awayGraceMs: number,
  disconnectTimeoutMs: number,
  roomCreatedAt: number,
): ConnectionStatus {
  if (spectator.explicitlyLeft) {
    return 'left';
  }
  const entry = hasOwn(presence, spectator.memberId) ? presence[spectator.memberId] : undefined;
  const lastSeenAt = entry ? entry.lastSeenAt : (spectator.joinedAt ?? roomCreatedAt);
  const awaySince = entry ? entry.awaySince : null;
  if (awaySince !== null && now - awaySince >= awayGraceMs) {
    return 'disconnected';
  }
  if (now - lastSeenAt >= disconnectTimeoutMs) {
    return 'disconnected';
  }
  return 'connected';
}

function isHostConnected(
  room: RoomRecord,
  presence: PresenceMap,
  now: number,
  awayGraceMs: number,
  disconnectTimeoutMs: number,
): boolean {
  for (const seat of room.seats) {
    if (seat.kind === 'human' && seat.memberId === room.hostMemberId) {
      return (
        computeSeatConnectionStatus(
          seat,
          presence,
          now,
          awayGraceMs,
          disconnectTimeoutMs,
          room.createdAt,
        ) === 'connected'
      );
    }
  }
  for (const spec of room.spectators) {
    if (spec.memberId === room.hostMemberId) {
      return (
        computeSpectatorConnectionStatus(
          spec,
          presence,
          now,
          awayGraceMs,
          disconnectTimeoutMs,
          room.createdAt,
        ) === 'connected'
      );
    }
  }
  return false;
}

function hasConnectedSeatOrSurvivorOtherThanHost(
  room: RoomRecord,
  presence: PresenceMap,
  now: number,
  awayGraceMs: number,
  disconnectTimeoutMs: number,
): boolean {
  for (const seat of room.seats) {
    if (
      seat.kind === 'human' &&
      !seat.explicitlyLeft &&
      seat.memberId !== null &&
      seat.memberId !== room.hostMemberId &&
      computeSeatConnectionStatus(
        seat,
        presence,
        now,
        awayGraceMs,
        disconnectTimeoutMs,
        room.createdAt,
      ) === 'connected'
    ) {
      return true;
    }
  }
  for (const spec of room.spectators) {
    if (
      spec.role === 'survivor_spectator' &&
      !spec.explicitlyLeft &&
      spec.memberId !== room.hostMemberId &&
      computeSpectatorConnectionStatus(
        spec,
        presence,
        now,
        awayGraceMs,
        disconnectTimeoutMs,
        room.createdAt,
      ) === 'connected'
    ) {
      return true;
    }
  }
  return false;
}

function computeCanClaimHost(
  room: RoomRecord,
  presence: PresenceMap,
  viewerMember: MatchedMember | null,
  now: number,
  awayGraceMs: number,
  disconnectTimeoutMs: number,
): boolean {
  if (!viewerMember) {
    return false;
  }
  if (getMemberExplicitlyLeft(viewerMember)) {
    return false;
  }
  if (getMemberId(viewerMember) === room.hostMemberId) {
    return false;
  }
  if (isHostConnected(room, presence, now, awayGraceMs, disconnectTimeoutMs)) {
    return false;
  }
  if (viewerMember.kind === 'seat') {
    return true;
  }
  if (viewerMember.spectator.role === 'survivor_spectator') {
    return true;
  }
  return !hasConnectedSeatOrSurvivorOtherThanHost(
    room,
    presence,
    now,
    awayGraceMs,
    disconnectTimeoutMs,
  );
}

function selectNextHost(
  room: RoomRecord,
  excludeMemberId: string,
  presence: PresenceMap,
  now: number,
  awayGraceMs: number,
  disconnectTimeoutMs: number,
): { memberId: string; nickname: string } | null {
  type Candidate = { memberId: string; nickname: string; joinedAt: number; order: number };

  const tier1: Candidate[] = [];
  const tier2: Candidate[] = [];
  const tier3: Candidate[] = [];
  const tier4: Candidate[] = [];
  const tier5: Candidate[] = [];

  for (const seat of room.seats) {
    if (
      seat.kind !== 'human' ||
      seat.explicitlyLeft ||
      !seat.memberId ||
      seat.memberId === excludeMemberId
    ) {
      continue;
    }
    const candidate: Candidate = {
      memberId: seat.memberId,
      nickname: seat.nickname,
      joinedAt: seat.joinedAt ?? Number.MAX_SAFE_INTEGER,
      order: seat.seatIndex,
    };
    const status = computeSeatConnectionStatus(
      seat,
      presence,
      now,
      awayGraceMs,
      disconnectTimeoutMs,
      room.createdAt,
    );
    if (status === 'connected') {
      tier1.push(candidate);
    } else {
      tier4.push(candidate);
    }
  }

  room.spectators.forEach((spec, idx) => {
    if (spec.explicitlyLeft || spec.memberId === excludeMemberId) {
      return;
    }
    const candidate: Candidate = {
      memberId: spec.memberId,
      nickname: spec.nickname,
      joinedAt: spec.joinedAt,
      order: idx,
    };
    const status = computeSpectatorConnectionStatus(
      spec,
      presence,
      now,
      awayGraceMs,
      disconnectTimeoutMs,
      room.createdAt,
    );
    if (status === 'connected') {
      if (spec.role === 'survivor_spectator') {
        tier2.push(candidate);
      } else {
        tier3.push(candidate);
      }
    } else {
      tier5.push(candidate);
    }
  });

  const sortCandidates = (list: Candidate[]): Candidate[] =>
    list.sort((a, b) => (a.joinedAt !== b.joinedAt ? a.joinedAt - b.joinedAt : a.order - b.order));

  for (const tier of [tier1, tier2, tier3, tier4, tier5]) {
    if (tier.length > 0) {
      const winner = sortCandidates(tier)[0];
      return { memberId: winner.memberId, nickname: winner.nickname };
    }
  }
  return null;
}

function isClosingEmptyWaitingRoom(room: RoomRecord): boolean {
  if (room.status !== 'waiting') {
    return false;
  }
  const remainingHumans =
    room.seats.filter((s) => s.kind === 'human' && !s.explicitlyLeft).length +
    room.spectators.filter((s) => !s.explicitlyLeft).length;
  return remainingHumans === 0;
}

async function touchPresenceIfNeeded(
  store: StorageAdapter,
  room: RoomRecord,
  memberId: string,
  presence: PresenceMap,
  now: number,
  env: EnvMap,
  force = false,
): Promise<void> {
  const throttleMs = getHeartbeatWriteThrottleMs(env);
  const disconnectTimeoutMs = getDisconnectTimeoutMs(env);
  const effectiveThrottleMs = Math.min(throttleMs, Math.floor(disconnectTimeoutMs / 2));
  const existing = hasOwn(presence, memberId) ? presence[memberId] : undefined;
  const shouldWrite =
    force ||
    !existing ||
    existing.awaySince !== null ||
    now - existing.lastSeenAt >= effectiveThrottleMs;

  if (!shouldWrite) {
    return;
  }

  const nextEntry: PresenceEntry = { lastSeenAt: now, awaySince: null };
  await store.setPresence(room.code, memberId, nextEntry, getRoomTtlSeconds(room.status));
  presence[memberId] = nextEntry;
}

function buildPresenceSummary(
  room: RoomRecord,
  presence: PresenceMap,
  viewerMember: MatchedMember | null,
  now: number,
  env: EnvMap,
): RoomPresenceSummary {
  const awayGraceMs = getAwayGraceMs(env);
  const disconnectTimeoutMs = getDisconnectTimeoutMs(env);

  return {
    seats: room.seats.map((seat) => ({
      seatIndex: seat.seatIndex,
      connectionStatus: computeSeatConnectionStatus(
        seat,
        presence,
        now,
        awayGraceMs,
        disconnectTimeoutMs,
        room.createdAt,
      ),
    })),
    spectators: room.spectators.map((spec) => ({
      memberId: spec.memberId,
      connectionStatus: computeSpectatorConnectionStatus(
        spec,
        presence,
        now,
        awayGraceMs,
        disconnectTimeoutMs,
        room.createdAt,
      ),
    })),
    canClaimHost: computeCanClaimHost(
      room,
      presence,
      viewerMember,
      now,
      awayGraceMs,
      disconnectTimeoutMs,
    ),
  };
}

function cloneEventNotice(notice: RoomEventNotice | null): RoomEventNotice | null {
  if (!notice) {
    return null;
  }
  if (notice.type === 'player_auto_skipped') {
    return {
      id: notice.id,
      type: notice.type,
      skippedPlayerIds: notice.skippedPlayerIds.slice(),
      at: notice.at,
    };
  }
  return { ...notice };
}

/**
 * Projects internal RoomRecord to strictly sanitized PublicRoomSnapshot.
 * NEVER exposes sessionToken, clientId, kickedTokens, round1Roster, replayDraft,
 * eventCounter, explicitlyLeft, joinedAt, createdAt, or updatedAt.
 */
export function sanitizeRoomForViewer(
  room: RoomRecord,
  presence: PresenceMap,
  viewerSessionToken: string | null,
  now: number,
  env: EnvMap = process.env,
): PublicRoomSnapshot {
  const awayGraceMs = getAwayGraceMs(env);
  const disconnectTimeoutMs = getDisconnectTimeoutMs(env);
  const viewerMember = findMemberBySessionToken(room, viewerSessionToken);

  const seats: PublicOnlineSeat[] = room.seats.map((seat) => ({
    seatIndex: seat.seatIndex,
    kind: seat.kind,
    colorToken: seat.colorToken,
    memberId: seat.memberId,
    nickname: seat.nickname,
    aiDifficulty: seat.aiDifficulty,
    gamePlayerId: seat.gamePlayerId,
    isHost: seat.memberId !== null && seat.memberId === room.hostMemberId,
    connectionStatus: computeSeatConnectionStatus(
      seat,
      presence,
      now,
      awayGraceMs,
      disconnectTimeoutMs,
      room.createdAt,
    ),
    substitutedFromNickname: seat.substitutedFromNickname,
  }));

  const spectators: PublicSpectator[] = room.spectators.map((spec) => ({
    memberId: spec.memberId,
    nickname: spec.nickname,
    role: spec.role,
    isHost: spec.memberId === room.hostMemberId,
    connectionStatus: computeSpectatorConnectionStatus(
      spec,
      presence,
      now,
      awayGraceMs,
      disconnectTimeoutMs,
      room.createdAt,
    ),
  }));

  let viewer: RoomViewerInfo;
  if (viewerMember?.kind === 'seat') {
    const s = viewerMember.seat;
    viewer = {
      role: 'player',
      memberId: s.memberId,
      seatIndex: s.seatIndex,
      gamePlayerId: s.gamePlayerId,
      isHost: s.memberId !== null && s.memberId === room.hostMemberId,
      spectatorRole: null,
      wasKicked: false,
    };
  } else if (viewerMember?.kind === 'spectator') {
    const sp = viewerMember.spectator;
    viewer = {
      role: 'spectator',
      memberId: sp.memberId,
      seatIndex: null,
      gamePlayerId: null,
      isHost: sp.memberId === room.hostMemberId,
      spectatorRole: sp.role,
      wasKicked: false,
    };
  } else {
    viewer = {
      role: 'anonymous',
      memberId: null,
      seatIndex: null,
      gamePlayerId: null,
      isHost: false,
      spectatorRole: null,
      wasKicked: isKickedToken(room, viewerSessionToken),
    };
  }

  return {
    code: room.code,
    version: room.version,
    status: room.status,
    roundNumber: room.roundNumber,
    gameSequence: room.gameSequence,
    config: {
      ruleVariant: room.config.ruleVariant,
      format: room.config.format,
      timerSeconds: room.config.timerSeconds,
      shuffleOrder: room.config.shuffleOrder,
    },
    hostMemberId: room.hostMemberId,
    seats,
    spectators,
    gameState: room.gameState,
    turnStartedAt: room.turnStartedAt,
    nextAiStepAt: room.nextAiStepAt,
    matchSavedId: room.matchSavedId,
    lastEvent: cloneEventNotice(room.lastEvent),
    canClaimHost: computeCanClaimHost(
      room,
      presence,
      viewerMember,
      now,
      awayGraceMs,
      disconnectTimeoutMs,
    ),
    serverNow: now,
    viewer,
  };
}

function evictSpectatorIfAtCap(room: RoomRecord): void {
  if (room.spectators.length < MAX_SPECTATORS_PER_ROOM) {
    return;
  }
  let evictIdx = room.spectators.findIndex(
    (s) => s.role === 'spectator' && s.memberId !== room.hostMemberId,
  );
  if (evictIdx === -1) {
    evictIdx = room.spectators.findIndex(
      (s) => s.role === 'replaced_spectator' && s.memberId !== room.hostMemberId,
    );
  }
  if (evictIdx === -1) {
    evictIdx = room.spectators.findIndex((s) => s.memberId !== room.hostMemberId);
  }
  if (evictIdx !== -1) {
    room.spectators.splice(evictIdx, 1);
  }
}

// ============================================================================
// Game Initialization, Post-Move Commit & Partial Move Helpers
// ============================================================================

function shuffleSeatOrder(seatCount: number, rng: RngFn, shouldShuffle: boolean): number[] {
  const order = Array.from({ length: seatCount }, (_, idx) => idx);
  if (!shouldShuffle) {
    return order;
  }
  for (let i = order.length - 1; i > 0; i--) {
    const raw = rng();
    const bounded = Number.isFinite(raw) ? Math.max(0, Math.min(0.999999999999, raw)) : 0;
    const j = Math.floor(bounded * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  return order;
}

function hasLegalWallPlacementForSelectedPiece(state: GameState): boolean {
  const pieceId = state.turnSubState.selectedPieceId;
  if (!pieceId) {
    return false;
  }
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) {
    return false;
  }
  return getLegalWallPlacements(state, { row: piece.row, col: piece.col }).length > 0;
}

function applyTimeoutPartialMove(
  state: GameState,
  partialMove: TimeoutPartialMove,
): GameState | null {
  if (state.phase !== 'select_piece') {
    return null;
  }
  if (!isInBounds(partialMove.destination.row, partialMove.destination.col)) {
    return null;
  }
  if (partialMove.useWallBreak) {
    if (!partialMove.breakWall || !isValidWallEdge(partialMove.breakWall)) {
      return null;
    }
  } else if (partialMove.breakWall !== null) {
    return null;
  }

  let cur = selectPiece(state, partialMove.pieceId);
  if (cur === state) {
    return null;
  }

  if (!partialMove.useWallBreak) {
    const moved = movePiece(cur, partialMove.destination);
    if (moved === cur || moved.phase !== 'place_wall') {
      return null;
    }
    return hasLegalWallPlacementForSelectedPiece(moved) ? moved : null;
  }

  const toggled = toggleWallBreak(cur);
  if (toggled === cur) {
    return null;
  }
  cur = toggled;

  if (state.ruleVariant === 'wallgo1') {
    const broken = breakWallAt(cur, partialMove.breakWall!);
    if (broken === cur) {
      return null;
    }
    const moved = movePiece(broken, partialMove.destination);
    if (moved === broken || moved.phase !== 'place_wall') {
      return null;
    }
    return hasLegalWallPlacementForSelectedPiece(moved) ? moved : null;
  }

  const selected = selectWallGo2BreakDestination(cur, partialMove.destination);
  if (selected === cur) {
    return null;
  }
  cur = selected;

  if (cur.turnSubState.pendingBreakChoice !== null) {
    const confirmed = confirmWallGo2BreakWall(cur, partialMove.breakWall!);
    if (confirmed === cur) {
      return null;
    }
    cur = confirmed;
  }

  if (
    cur.phase !== 'place_wall' ||
    cur.turnSubState.brokenWallBeforeMove === null ||
    !isSameWallEdge(cur.turnSubState.brokenWallBeforeMove, partialMove.breakWall!)
  ) {
    return null;
  }

  return hasLegalWallPlacementForSelectedPiece(cur) ? cur : null;
}

function buildPostMoveRoomState(
  room: RoomRecord,
  nextGs: GameState,
  now: number,
  env: EnvMap,
  options: { isTimeout: boolean; timedOutActorNickname?: string },
): { nextRoom: RoomRecord; ttlSeconds: number } {
  const nextRoom = structuredClone(room);
  nextRoom.gameState = nextGs;
  nextRoom.updatedAt = now;

  const event = nextGs.lastActionEvent;
  if (event) {
    const existingDraft =
      nextRoom.replayDraft ?? extractReplayFromHistory(createReplayInitialConfig(room.gameState!), []);
    const nextStep = actionEventToReplayStep(event, existingDraft.steps.length + 1);
    existingDraft.steps.push(nextStep);
    nextRoom.replayDraft = existingDraft;
  }

  if (options.isTimeout && options.timedOutActorNickname !== undefined) {
    nextRoom.eventCounter += 1;
    nextRoom.lastEvent = {
      id: nextRoom.eventCounter,
      type: 'player_timed_out',
      nickname: options.timedOutActorNickname,
      at: now,
    };
  } else if (event && event.skippedPlayerIds.length > 0 && nextGs.phase !== 'game_over') {
    nextRoom.eventCounter += 1;
    nextRoom.lastEvent = {
      id: nextRoom.eventCounter,
      type: 'player_auto_skipped',
      skippedPlayerIds: event.skippedPlayerIds.slice(),
      at: now,
    };
  }

  if (nextGs.phase === 'game_over') {
    nextRoom.status = 'finished';
    nextRoom.turnStartedAt = null;
    nextRoom.nextAiStepAt = null;
    nextRoom.matchSavedId = buildOnlineMatchId(nextRoom.code, nextRoom.gameSequence);
  } else {
    const nextActive = nextGs.players[nextGs.currentPlayerIndex];
    if (nextActive?.isAI) {
      nextRoom.turnStartedAt = null;
      nextRoom.nextAiStepAt = now + getAiStepDelayMs(env);
    } else if (nextGs.phase === 'placement') {
      nextRoom.turnStartedAt = null;
      nextRoom.nextAiStepAt = null;
    } else {
      nextRoom.turnStartedAt = nextGs.timerSeconds > 0 ? now : null;
      nextRoom.nextAiStepAt = null;
    }
  }

  return {
    nextRoom,
    ttlSeconds: getRoomTtlSeconds(nextRoom.status),
  };
}

function requireHostAuthorization(room: RoomRecord, caller: MatchedMember): Response | null {
  if (getMemberId(caller) === room.hostMemberId) {
    return null;
  }
  if (caller.kind === 'spectator') {
    return makeErrorResponse(403, 'FORBIDDEN_SPECTATOR', 'Spectators cannot perform host actions');
  }
  return makeErrorResponse(403, 'HOST_ONLY', 'Only the room host can perform this action');
}

function makeVersionConflictResponse(
  currentRoom: RoomRecord,
  presence: PresenceMap,
  viewerToken: string,
  now: number,
  env: EnvMap,
): Response {
  const snapshot = sanitizeRoomForViewer(currentRoom, presence, viewerToken, now, env);
  return makeErrorResponse(
    409,
    'VERSION_CONFLICT',
    `Room version conflict (current version ${currentRoom.version})`,
    { room: snapshot },
  );
}

// ============================================================================
// Factory for Room Route Handlers (Injectable Code Generator & RNG for Tests)
// ============================================================================

export function createRoomHandlers(deps: RoomServiceDeps = {}): RoomRouteHandlers {
  const generateCode = deps.generateCode ?? generateDefaultRoomCode;
  const rng: RngFn = deps.rng ?? Math.random;

  async function createRoom(ctx: ApiRouteContext): Promise<Response> {
    if (ctx.store.mode === 'unconfigured') {
      throw new RedisNotConfiguredError();
    }

    const parsed = await parseJsonRequestBody(ctx.request);
    if (!parsed.ok) {
      return parsed.response;
    }
    const body = parsed.body;

    if (typeof body.nickname !== 'string') {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'nickname must be a string');
    }
    const clientId = validateClientId(body.clientId);
    if (!clientId) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'clientId must be a valid non-empty string');
    }
    const config = validateOnlineRoomConfig(body.config);
    if (!config) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'Invalid room configuration');
    }

    let locale: Locale = 'ko';
    if (hasOwn(body, 'locale') && body.locale !== undefined) {
      if (!isValidLocale(body.locale)) {
        return makeErrorResponse(400, 'INVALID_REQUEST', 'locale must be "ko" or "en"');
      }
      locale = body.locale;
    }

    const now = ctx.now();
    const hostMemberId = generateMemberId();
    const hostSessionToken = generateSessionToken();
    const hostNickname = normalizeNickname(body.nickname, DEFAULT_PLAYER_NAMES_BY_LOCALE[locale][0]);
    const seatCount = config.format === '3p' ? 3 : 2;

    const seats: InternalOnlineSeat[] = [
      {
        seatIndex: 0,
        kind: 'human',
        colorToken: 'p1',
        memberId: hostMemberId,
        sessionToken: hostSessionToken,
        clientId,
        nickname: hostNickname,
        aiDifficulty: 'normal',
        gamePlayerId: null,
        joinedAt: now,
        explicitlyLeft: false,
        substitutedFromNickname: null,
      },
    ];
    for (let i = 1; i < seatCount; i++) {
      seats.push(createOpenSeat(i, PLAYER_COLOR_TOKENS[i]));
    }

    let createdRoom: RoomRecord | null = null;
    for (let attempt = 0; attempt < MAX_CREATE_CODE_ATTEMPTS; attempt++) {
      const candidate = parseRoomCode(generateCode());
      if (!candidate) {
        continue;
      }
      const room: RoomRecord = {
        code: candidate,
        version: 1,
        status: 'waiting',
        roundNumber: 1,
        gameSequence: 0,
        createdAt: now,
        updatedAt: now,
        config,
        hostMemberId,
        seats,
        spectators: [],
        kickedTokens: [],
        gameState: null,
        turnStartedAt: null,
        nextAiStepAt: null,
        matchSavedId: null,
        lastEvent: null,
        eventCounter: 0,
        round1Roster: null,
        replayDraft: null,
      };
      const created = await ctx.store.createRoomNx(room, ROOM_TTL_ACTIVE_SECONDS);
      if (created) {
        createdRoom = room;
        break;
      }
    }

    if (!createdRoom) {
      return makeErrorResponse(500, 'INTERNAL_ERROR', 'Failed to allocate a unique room code');
    }

    const initialPresence: PresenceEntry = { lastSeenAt: now, awaySince: null };
    await ctx.store.setPresence(
      createdRoom.code,
      hostMemberId,
      initialPresence,
      ROOM_TTL_ACTIVE_SECONDS,
    );

    const responseBody: CreateRoomResponse = {
      room: sanitizeRoomForViewer(
        createdRoom,
        { [hostMemberId]: initialPresence },
        hostSessionToken,
        now,
        ctx.env,
      ),
      sessionToken: hostSessionToken,
    };
    return makeJsonResponse(responseBody, 201);
  }

  async function getRoom(ctx: ApiRouteContext, rawCode: string): Promise<Response> {
    if (ctx.store.mode === 'unconfigured') {
      throw new RedisNotConfiguredError();
    }

    const code = validateRawRoomCode(rawCode);
    if (!code) {
      return makeErrorResponse(400, 'INVALID_ROOM_CODE', 'Invalid room code');
    }

    const room = await ctx.store.getRoom(code);
    if (!room || isClosingEmptyWaitingRoom(room)) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const now = ctx.now();
    const headerToken = ctx.request.headers.get('x-session-token');
    const queryToken = ctx.url.searchParams.get('sessionToken');
    const rawToken =
      headerToken !== null && headerToken.trim().length > 0 ? headerToken : queryToken;
    const viewerToken = validateSessionToken(rawToken);

    const presence = await ctx.store.getPresenceMap(code);
    const viewerMember = findMemberBySessionToken(room, viewerToken);
    const isHead = ctx.request.method.toUpperCase() === 'HEAD';

    if (!isHead && viewerMember && !getMemberExplicitlyLeft(viewerMember)) {
      await touchPresenceIfNeeded(
        ctx.store,
        room,
        getMemberId(viewerMember),
        presence,
        now,
        ctx.env,
      );
    }

    const sinceRaw = ctx.url.searchParams.get('sinceVersion');
    if (sinceRaw !== null && /^\d+$/.test(sinceRaw)) {
      const sinceVersion = Number(sinceRaw);
      if (Number.isSafeInteger(sinceVersion) && sinceVersion === room.version) {
        const unchangedBody: GetRoomResponse = {
          unchanged: true,
          version: room.version,
          serverNow: now,
          presenceSummary: buildPresenceSummary(room, presence, viewerMember, now, ctx.env),
        };
        return makeJsonResponse(unchangedBody, 200);
      }
    }

    const fullBody: GetRoomResponse = {
      unchanged: false,
      room: sanitizeRoomForViewer(room, presence, viewerToken, now, ctx.env),
    };
    return makeJsonResponse(fullBody, 200);
  }

  async function postRoomCommand(ctx: ApiRouteContext, rawCode: string): Promise<Response> {
    if (ctx.store.mode === 'unconfigured') {
      throw new RedisNotConfiguredError();
    }

    const code = validateRawRoomCode(rawCode);
    if (!code) {
      return makeErrorResponse(400, 'INVALID_ROOM_CODE', 'Invalid room code');
    }

    const parsed = await parseJsonRequestBody(ctx.request);
    if (!parsed.ok) {
      return parsed.response;
    }
    const body = parsed.body;
    const op = body.op;

    if (op === 'undo' || op === 'redo') {
      return makeErrorResponse(
        400,
        'UNDO_DISABLED_ONLINE',
        'Undo and redo are disabled in online games',
      );
    }

    if (
      op === 'game_action' &&
      isPlainObject(body.action) &&
      (body.action.type === 'undo' || body.action.type === 'redo')
    ) {
      return makeErrorResponse(
        400,
        'UNDO_DISABLED_ONLINE',
        'Undo and redo are disabled in online games',
      );
    }

    if (typeof op !== 'string' || !VALID_ROOM_OPS.has(op)) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'Unknown or missing room command op');
    }

    switch (op) {
      case 'join':
        return handleJoin(ctx, code, body);
      case 'ping_away':
        return handlePingAway(ctx, code, body);
      case 'leave':
        return handleLeave(ctx, code, body);
      case 'update_nickname':
        return handleUpdateNickname(ctx, code, body);
      case 'update_config':
        return handleUpdateConfig(ctx, code, body);
      case 'set_seat':
        return handleSetSeat(ctx, code, body);
      case 'kick_seat':
        return handleKickSeat(ctx, code, body);
      case 'start_game':
        return handleStartGame(ctx, code, body);
      case 'game_action':
        return handleGameAction(ctx, code, body);
      case 'ai_step':
        return handleAiStep(ctx, code, body);
      case 'timeout':
        return handleTimeout(ctx, code, body);
      case 'substitute_ai':
        return handleSubstituteAi(ctx, code, body);
      case 'claim_host':
        return handleClaimHost(ctx, code, body);
      case 'start_round2':
        return handleStartRound2(ctx, code, body);
      case 'rematch':
        return handleRematch(ctx, code, body);
      case 'return_to_waiting':
        return handleReturnToWaiting(ctx, code, body);
      default:
        return makeErrorResponse(400, 'INVALID_REQUEST', 'Unknown room command op');
    }
  }

  // --------------------------------------------------------------------------
  // 1. join
  // --------------------------------------------------------------------------
  async function handleJoin(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    if (typeof body.nickname !== 'string') {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'nickname must be a string');
    }
    const clientId = validateClientId(body.clientId);
    if (!clientId) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'clientId must be a valid non-empty string');
    }

    let providedSessionToken: string | null = null;
    if (hasOwn(body, 'sessionToken') && body.sessionToken !== undefined) {
      providedSessionToken = validateSessionToken(body.sessionToken);
      if (!providedSessionToken) {
        return makeErrorResponse(400, 'INVALID_REQUEST', 'Invalid sessionToken format');
      }
    }

    let locale: Locale = 'ko';
    if (hasOwn(body, 'locale') && body.locale !== undefined) {
      if (!isValidLocale(body.locale)) {
        return makeErrorResponse(400, 'INVALID_REQUEST', 'locale must be "ko" or "en"');
      }
      locale = body.locale;
    }

    const now = ctx.now();
    const initialRoom = await ctx.store.getRoom(code);
    if (!initialRoom) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }
    let room: RoomRecord = initialRoom;

    for (let attempt = 0; attempt < MAX_JOIN_CAS_RETRIES; attempt++) {
      if (isClosingEmptyWaitingRoom(room)) {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }

      let matched: MatchedMember | null = null;

      if (providedSessionToken !== null) {
        if (isKickedToken(room, providedSessionToken)) {
          return makeErrorResponse(
            401,
            'UNAUTHORIZED',
            'You were removed from this room by the host',
          );
        }
        matched = findMemberBySessionToken(room, providedSessionToken);
      } else {
        matched = findMemberByClientId(room, clientId);
      }

      if (matched) {
        const matchedToken =
          matched.kind === 'seat' ? matched.seat.sessionToken! : matched.spectator.sessionToken;
        const matchedMemberId = getMemberId(matched);

        if (getMemberExplicitlyLeft(matched)) {
          const nextRoom = structuredClone(room);
          const nextMatched = findMemberBySessionToken(nextRoom, matchedToken);
          if (nextMatched) {
            if (nextMatched.kind === 'seat') {
              nextMatched.seat.explicitlyLeft = false;
            } else {
              nextMatched.spectator.explicitlyLeft = false;
            }
          }
          nextRoom.updatedAt = now;
          const cas = await ctx.store.casUpdateRoom(
            code,
            room.version,
            nextRoom,
            getRoomTtlSeconds(nextRoom.status),
          );
          if (!cas.ok) {
            if (cas.reason === 'NOT_FOUND') {
              return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
            }
            room = cas.currentRoom;
            continue;
          }
          room = cas.room;
        }

        const presence = await ctx.store.getPresenceMap(code);
        await touchPresenceIfNeeded(ctx.store, room, matchedMemberId, presence, now, ctx.env, true);
        const resBody: RoomCommandResponse = {
          room: sanitizeRoomForViewer(room, presence, matchedToken, now, ctx.env),
          sessionToken: matchedToken,
        };
        return makeJsonResponse(resBody, 200);
      }

      // Fresh joiner
      const nextRoom = structuredClone(room);
      const newMemberId = generateMemberId();
      const newSessionToken = generateSessionToken();

      const openSeatIdx =
        nextRoom.status === 'waiting'
          ? nextRoom.seats.findIndex((s) => s.kind === 'open')
          : -1;

      if (openSeatIdx !== -1) {
        const seatNickname = normalizeNickname(
          body.nickname,
          DEFAULT_PLAYER_NAMES_BY_LOCALE[locale][openSeatIdx] ?? DEFAULT_PLAYER_NAMES[0],
        );
        nextRoom.seats[openSeatIdx] = {
          ...nextRoom.seats[openSeatIdx],
          kind: 'human',
          memberId: newMemberId,
          sessionToken: newSessionToken,
          clientId,
          nickname: seatNickname,
          aiDifficulty: 'normal',
          gamePlayerId: null,
          joinedAt: now,
          explicitlyLeft: false,
          substitutedFromNickname: null,
        };
      } else {
        if (nextRoom.spectators.length >= MAX_SPECTATORS_PER_ROOM) {
          return makeErrorResponse(
            409,
            'ROOM_SPECTATORS_FULL',
            `Room spectator limit (${MAX_SPECTATORS_PER_ROOM}) reached`,
          );
        }
        const specNickname = normalizeNickname(body.nickname, SPECTATOR_DEFAULT_NAME[locale]);
        nextRoom.spectators.push({
          memberId: newMemberId,
          sessionToken: newSessionToken,
          clientId,
          nickname: specNickname,
          role: 'spectator',
          joinedAt: now,
          explicitlyLeft: false,
        });
      }

      nextRoom.updatedAt = now;
      const cas = await ctx.store.casUpdateRoom(
        code,
        room.version,
        nextRoom,
        getRoomTtlSeconds(nextRoom.status),
      );
      if (!cas.ok) {
        if (cas.reason === 'NOT_FOUND') {
          return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
        }
        room = cas.currentRoom;
        continue;
      }

      const presence = await ctx.store.getPresenceMap(code);
      await touchPresenceIfNeeded(ctx.store, cas.room, newMemberId, presence, now, ctx.env, true);
      const resBody: RoomCommandResponse = {
        room: sanitizeRoomForViewer(cas.room, presence, newSessionToken, now, ctx.env),
        sessionToken: newSessionToken,
      };
      return makeJsonResponse(resBody, 200);
    }

    const latestPresence = await ctx.store.getPresenceMap(code);
    return makeVersionConflictResponse(room, latestPresence, providedSessionToken ?? '', now, ctx.env);
  }

  // --------------------------------------------------------------------------
  // 2. ping_away (supports text/plain sendBeacon; ZERO room.version bump)
  // --------------------------------------------------------------------------
  async function handlePingAway(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Session token is not a member of this room');
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);
    const memberId = getMemberId(caller);

    if (!getMemberExplicitlyLeft(caller)) {
      const existing = hasOwn(presence, memberId) ? presence[memberId] : undefined;
      const nextEntry: PresenceEntry = {
        lastSeenAt: existing?.lastSeenAt ?? getMemberJoinedAt(caller) ?? room.createdAt,
        awaySince: existing?.awaySince ?? now,
      };
      await ctx.store.setPresence(code, memberId, nextEntry, getRoomTtlSeconds(room.status));
      presence[memberId] = nextEntry;
    }

    const resBody: RoomCommandResponse = {
      room: sanitizeRoomForViewer(room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  // --------------------------------------------------------------------------
  // 3. leave (internal CAS retry loop; deletes waiting room only after CAS if 0 humans)
  // --------------------------------------------------------------------------
  async function handleLeave(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const now = ctx.now();
    const awayGraceMs = getAwayGraceMs(ctx.env);
    const disconnectTimeoutMs = getDisconnectTimeoutMs(ctx.env);

    const initialRoom = await ctx.store.getRoom(code);
    if (!initialRoom) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }
    let room: RoomRecord = initialRoom;

    for (let attempt = 0; attempt < MAX_JOIN_CAS_RETRIES; attempt++) {
      const caller = findMemberBySessionToken(room, sessionToken);
      if (!caller) {
        return makeErrorResponse(401, 'UNAUTHORIZED', 'Session token is not a member of this room');
      }

      const presence = await ctx.store.getPresenceMap(code);
      if (getMemberExplicitlyLeft(caller)) {
        const resBody: RoomCommandResponse = {
          room: sanitizeRoomForViewer(room, presence, sessionToken, now, ctx.env),
        };
        return makeJsonResponse(resBody, 200);
      }

      const nextRoom = structuredClone(room);
      const callerMemberId = getMemberId(caller);
      const wasHost = callerMemberId === nextRoom.hostMemberId;

      let shouldDeleteAfterCas = false;

      if (nextRoom.status === 'waiting') {
        if (caller.kind === 'seat') {
          const idx = caller.seat.seatIndex;
          nextRoom.seats[idx] = createOpenSeat(idx, nextRoom.seats[idx].colorToken);
        } else {
          nextRoom.spectators = nextRoom.spectators.filter((s) => s.memberId !== callerMemberId);
        }

        const remainingHumans =
          nextRoom.seats.filter((s) => s.kind === 'human' && !s.explicitlyLeft).length +
          nextRoom.spectators.filter((s) => !s.explicitlyLeft).length;

        if (remainingHumans === 0) {
          nextRoom.hostMemberId = '';
          shouldDeleteAfterCas = true;
        } else if (wasHost) {
          const nextHost = selectNextHost(
            nextRoom,
            callerMemberId,
            presence,
            now,
            awayGraceMs,
            disconnectTimeoutMs,
          );
          if (nextHost) {
            nextRoom.hostMemberId = nextHost.memberId;
            nextRoom.eventCounter += 1;
            nextRoom.lastEvent = {
              id: nextRoom.eventCounter,
              type: 'host_transferred',
              newHostNickname: nextHost.nickname,
              at: now,
            };
          }
        }
      } else {
        // playing or finished
        if (caller.kind === 'seat') {
          nextRoom.seats[caller.seat.seatIndex].explicitlyLeft = true;
        } else {
          nextRoom.spectators = nextRoom.spectators.filter((s) => s.memberId !== callerMemberId);
        }

        if (wasHost) {
          const nextHost = selectNextHost(
            nextRoom,
            callerMemberId,
            presence,
            now,
            awayGraceMs,
            disconnectTimeoutMs,
          );
          if (nextHost) {
            nextRoom.hostMemberId = nextHost.memberId;
            nextRoom.eventCounter += 1;
            nextRoom.lastEvent = {
              id: nextRoom.eventCounter,
              type: 'host_transferred',
              newHostNickname: nextHost.nickname,
              at: now,
            };
          }
        }
      }

      nextRoom.updatedAt = now;
      const cas = await ctx.store.casUpdateRoom(
        code,
        room.version,
        nextRoom,
        getRoomTtlSeconds(nextRoom.status),
      );
      if (!cas.ok) {
        if (cas.reason === 'NOT_FOUND') {
          return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
        }
        room = cas.currentRoom;
        continue;
      }

      if (shouldDeleteAfterCas) {
        await ctx.store.deleteRoom(code);
      }

      const resBody: RoomCommandResponse = {
        room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
      };
      return makeJsonResponse(resBody, 200);
    }

    const latestPresence = await ctx.store.getPresenceMap(code);
    return makeVersionConflictResponse(room, latestPresence, sessionToken, now, ctx.env);
  }

  // --------------------------------------------------------------------------
  // 4. update_nickname (allowed in waiting, playing, finished + replay sync)
  // --------------------------------------------------------------------------
  async function handleUpdateNickname(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    if (typeof body.nickname !== 'string') {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'nickname must be a string');
    }
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    if (expectedVersion === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'expectedVersion must be a positive integer');
    }
    let locale: Locale = 'ko';
    if (hasOwn(body, 'locale') && body.locale !== undefined) {
      if (!isValidLocale(body.locale)) {
        return makeErrorResponse(400, 'INVALID_REQUEST', 'locale must be "ko" or "en"');
      }
      locale = body.locale;
    }

    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller || getMemberExplicitlyLeft(caller)) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'You have left this room; rejoin first');
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);

    if (room.version !== expectedVersion) {
      return makeVersionConflictResponse(room, presence, sessionToken, now, ctx.env);
    }

    const nextRoom = structuredClone(room);
    const callerMemberId = getMemberId(caller);
    let nextNickname: string;

    if (caller.kind === 'seat') {
      const seatIdx = caller.seat.seatIndex;
      const fallback =
        DEFAULT_PLAYER_NAMES_BY_LOCALE[locale][seatIdx] ?? DEFAULT_PLAYER_NAMES[0];
      nextNickname = normalizeNickname(body.nickname, fallback);
      const seat = nextRoom.seats[seatIdx];
      seat.nickname = nextNickname;

      if (seat.gamePlayerId !== null) {
        if (nextRoom.gameState) {
          const gp = nextRoom.gameState.players[seat.gamePlayerId];
          if (gp) {
            gp.name = nextNickname;
          }
        }
        if (nextRoom.replayDraft) {
          const rp = nextRoom.replayDraft.initialConfig.players[seat.gamePlayerId];
          if (rp) {
            rp.name = nextNickname;
          }
        }
      }
    } else {
      nextNickname = normalizeNickname(body.nickname, SPECTATOR_DEFAULT_NAME[locale]);
      const spec = nextRoom.spectators.find((s) => s.memberId === callerMemberId);
      if (spec) {
        spec.nickname = nextNickname;
      }
    }

    if (nextRoom.round1Roster) {
      for (const snap of nextRoom.round1Roster.seats) {
        if (snap.memberId === callerMemberId) {
          snap.nickname = nextNickname;
        }
      }
    }

    nextRoom.updatedAt = now;
    const cas = await ctx.store.casUpdateRoom(
      code,
      expectedVersion,
      nextRoom,
      getRoomTtlSeconds(nextRoom.status),
    );
    if (!cas.ok) {
      if (cas.reason === 'NOT_FOUND') {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }
      return makeVersionConflictResponse(cas.currentRoom, presence, sessionToken, now, ctx.env);
    }

    if (!getMemberExplicitlyLeft(caller)) {
      await touchPresenceIfNeeded(ctx.store, cas.room, callerMemberId, presence, now, ctx.env);
    }

    const resBody: RoomCommandResponse = {
      room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  // --------------------------------------------------------------------------
  // 5. update_config (Host-only in waiting; handles 3p <-> 2p safely)
  // --------------------------------------------------------------------------
  async function handleUpdateConfig(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    if (expectedVersion === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'expectedVersion must be a positive integer');
    }
    const patch = validateConfigPatch(body.patch);
    if (!patch) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'Invalid config patch');
    }
    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Session token is not a member of this room');
    }

    const hostErr = requireHostAuthorization(room, caller);
    if (hostErr) {
      return hostErr;
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);

    if (room.version !== expectedVersion) {
      return makeVersionConflictResponse(room, presence, sessionToken, now, ctx.env);
    }

    if (room.status !== 'waiting') {
      return makeErrorResponse(
        400,
        'INVALID_ROOM_STATUS',
        'Room configuration can only be updated while waiting',
      );
    }

    const nextRoom = structuredClone(room);
    nextRoom.config = {
      ruleVariant: patch.ruleVariant ?? room.config.ruleVariant,
      format: patch.format ?? room.config.format,
      timerSeconds: patch.timerSeconds ?? room.config.timerSeconds,
      shuffleOrder: patch.shuffleOrder ?? room.config.shuffleOrder,
    };

    // Handle 3p -> 2p seat shrink
    if (nextRoom.seats.length === 3 && nextRoom.config.format === '2p') {
      const seat2 = nextRoom.seats[2];
      if (seat2.kind === 'human' && seat2.memberId && seat2.sessionToken && seat2.clientId) {
        if (seat2.memberId === nextRoom.hostMemberId) {
          // Relocate host from Seat 2 to first open seat, else first AI seat, else spectators
          let targetIdx = nextRoom.seats
            .slice(0, 2)
            .findIndex((s) => s.kind === 'open');
          if (targetIdx === -1) {
            targetIdx = nextRoom.seats
              .slice(0, 2)
              .findIndex((s) => s.kind === 'ai');
          }
          if (targetIdx !== -1) {
            nextRoom.seats[targetIdx] = {
              ...seat2,
              seatIndex: targetIdx,
              colorToken: PLAYER_COLOR_TOKENS[targetIdx],
            };
          } else {
            if (nextRoom.spectators.length >= MAX_SPECTATORS_PER_ROOM) {
              return makeErrorResponse(
                409,
                'ROOM_SPECTATORS_FULL',
                `Room spectator limit (${MAX_SPECTATORS_PER_ROOM}) reached`,
              );
            }
            nextRoom.spectators.push({
              memberId: seat2.memberId,
              sessionToken: seat2.sessionToken,
              clientId: seat2.clientId,
              nickname: seat2.nickname,
              role: 'spectator',
              joinedAt: seat2.joinedAt ?? now,
              explicitlyLeft: false,
            });
          }
        } else {
          if (nextRoom.spectators.length >= MAX_SPECTATORS_PER_ROOM) {
            return makeErrorResponse(
              409,
              'ROOM_SPECTATORS_FULL',
              `Room spectator limit (${MAX_SPECTATORS_PER_ROOM}) reached`,
            );
          }
          nextRoom.spectators.push({
            memberId: seat2.memberId,
            sessionToken: seat2.sessionToken,
            clientId: seat2.clientId,
            nickname: seat2.nickname,
            role: 'spectator',
            joinedAt: seat2.joinedAt ?? now,
            explicitlyLeft: false,
          });
        }
      }
      nextRoom.seats = nextRoom.seats.slice(0, 2);
    } else if (nextRoom.seats.length === 2 && nextRoom.config.format === '3p') {
      nextRoom.seats.push(createOpenSeat(2, 'p3'));
    }

    nextRoom.updatedAt = now;
    const cas = await ctx.store.casUpdateRoom(
      code,
      expectedVersion,
      nextRoom,
      ROOM_TTL_ACTIVE_SECONDS,
    );
    if (!cas.ok) {
      if (cas.reason === 'NOT_FOUND') {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }
      return makeVersionConflictResponse(cas.currentRoom, presence, sessionToken, now, ctx.env);
    }

    await touchPresenceIfNeeded(ctx.store, cas.room, getMemberId(caller), presence, now, ctx.env);
    const resBody: RoomCommandResponse = {
      room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  // --------------------------------------------------------------------------
  // 6. set_seat (Host-only in waiting)
  // --------------------------------------------------------------------------
  async function handleSetSeat(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    if (expectedVersion === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'expectedVersion must be a positive integer');
    }
    if (typeof body.seatIndex !== 'number' || !Number.isSafeInteger(body.seatIndex)) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'seatIndex must be an integer');
    }
    if (body.kind !== 'open' && body.kind !== 'ai') {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'kind must be "open" or "ai"');
    }
    let aiDifficulty: AIDifficulty = 'normal';
    if (hasOwn(body, 'aiDifficulty') && body.aiDifficulty !== undefined) {
      if (!isValidAiDifficulty(body.aiDifficulty)) {
        return makeErrorResponse(400, 'INVALID_REQUEST', 'Invalid aiDifficulty');
      }
      aiDifficulty = body.aiDifficulty;
    }

    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Session token is not a member of this room');
    }

    const hostErr = requireHostAuthorization(room, caller);
    if (hostErr) {
      return hostErr;
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);

    if (room.version !== expectedVersion) {
      return makeVersionConflictResponse(room, presence, sessionToken, now, ctx.env);
    }

    if (room.status !== 'waiting') {
      return makeErrorResponse(
        400,
        'INVALID_ROOM_STATUS',
        'Seats can only be modified while waiting',
      );
    }

    const seatIndex = normalizeZero(body.seatIndex);
    if (seatIndex < 0 || seatIndex >= room.seats.length) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'seatIndex out of bounds');
    }

    const target = room.seats[seatIndex];
    if (target.kind === 'human' && target.memberId === room.hostMemberId) {
      return makeErrorResponse(400, 'CANNOT_MODIFY_HOST_SEAT', 'Cannot modify the host seat');
    }
    if (target.kind === 'human') {
      return makeErrorResponse(
        400,
        'INVALID_REQUEST',
        'Use kick_seat to remove a human player from a seat',
      );
    }

    const nextRoom = structuredClone(room);
    if (body.kind === 'open') {
      nextRoom.seats[seatIndex] = createOpenSeat(seatIndex, target.colorToken);
    } else {
      nextRoom.seats[seatIndex] = {
        seatIndex,
        kind: 'ai',
        colorToken: target.colorToken,
        memberId: null,
        sessionToken: null,
        clientId: null,
        nickname: `AI ${seatIndex + 1}`,
        aiDifficulty,
        gamePlayerId: null,
        joinedAt: null,
        explicitlyLeft: false,
        substitutedFromNickname: null,
      };
    }
    nextRoom.updatedAt = now;

    const cas = await ctx.store.casUpdateRoom(
      code,
      expectedVersion,
      nextRoom,
      ROOM_TTL_ACTIVE_SECONDS,
    );
    if (!cas.ok) {
      if (cas.reason === 'NOT_FOUND') {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }
      return makeVersionConflictResponse(cas.currentRoom, presence, sessionToken, now, ctx.env);
    }

    await touchPresenceIfNeeded(ctx.store, cas.room, getMemberId(caller), presence, now, ctx.env);
    const resBody: RoomCommandResponse = {
      room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  // --------------------------------------------------------------------------
  // 7. kick_seat (Host-only in waiting)
  // --------------------------------------------------------------------------
  async function handleKickSeat(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    if (expectedVersion === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'expectedVersion must be a positive integer');
    }
    if (typeof body.seatIndex !== 'number' || !Number.isSafeInteger(body.seatIndex)) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'seatIndex must be an integer');
    }
    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Session token is not a member of this room');
    }

    const hostErr = requireHostAuthorization(room, caller);
    if (hostErr) {
      return hostErr;
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);

    if (room.version !== expectedVersion) {
      return makeVersionConflictResponse(room, presence, sessionToken, now, ctx.env);
    }

    if (room.status !== 'waiting') {
      return makeErrorResponse(
        400,
        'INVALID_ROOM_STATUS',
        'Players can only be kicked while waiting',
      );
    }

    const seatIndex = normalizeZero(body.seatIndex);
    if (seatIndex < 0 || seatIndex >= room.seats.length) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'seatIndex out of bounds');
    }

    const target = room.seats[seatIndex];
    if (target.kind === 'human' && target.memberId === room.hostMemberId) {
      return makeErrorResponse(400, 'CANNOT_MODIFY_HOST_SEAT', 'Host cannot kick themselves');
    }
    if (target.kind !== 'human' || !target.sessionToken) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'Seat is not occupied by a human player');
    }

    const nextRoom = structuredClone(room);
    nextRoom.kickedTokens.push(target.sessionToken);
    if (nextRoom.kickedTokens.length > MAX_KICKED_TOKENS) {
      nextRoom.kickedTokens = nextRoom.kickedTokens.slice(-MAX_KICKED_TOKENS);
    }
    nextRoom.seats[seatIndex] = createOpenSeat(seatIndex, target.colorToken);
    nextRoom.updatedAt = now;

    const cas = await ctx.store.casUpdateRoom(
      code,
      expectedVersion,
      nextRoom,
      ROOM_TTL_ACTIVE_SECONDS,
    );
    if (!cas.ok) {
      if (cas.reason === 'NOT_FOUND') {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }
      return makeVersionConflictResponse(cas.currentRoom, presence, sessionToken, now, ctx.env);
    }

    await touchPresenceIfNeeded(ctx.store, cas.room, getMemberId(caller), presence, now, ctx.env);
    const resBody: RoomCommandResponse = {
      room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  // --------------------------------------------------------------------------
  // 8. start_game (Host-only in waiting; server-side Fisher-Yates shuffleOrder)
  // --------------------------------------------------------------------------
  async function handleStartGame(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    if (expectedVersion === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'expectedVersion must be a positive integer');
    }
    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Session token is not a member of this room');
    }

    const hostErr = requireHostAuthorization(room, caller);
    if (hostErr) {
      return hostErr;
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);

    if (room.version !== expectedVersion) {
      return makeVersionConflictResponse(room, presence, sessionToken, now, ctx.env);
    }

    if (room.status !== 'waiting') {
      return makeErrorResponse(400, 'INVALID_ROOM_STATUS', 'Room is not in waiting status');
    }

    const expectedSeatCount = room.config.format === '3p' ? 3 : 2;
    const allFilled =
      room.seats.length === expectedSeatCount &&
      room.seats.every((s) => s.kind === 'human' || s.kind === 'ai');
    const hasHuman = room.seats.some((s) => s.kind === 'human');
    if (!allFilled || !hasHuman) {
      return makeErrorResponse(
        400,
        'SEATS_NOT_READY',
        'All seats must be filled (human or AI) with at least one human player',
      );
    }

    const nextRoom = structuredClone(room);
    const seatOrder = shuffleSeatOrder(expectedSeatCount, rng, nextRoom.config.shuffleOrder);

    const players: PlayerConfig[] = seatOrder.map((seatIdx, gamePlayerId) => {
      const seat = nextRoom.seats[seatIdx];
      seat.gamePlayerId = gamePlayerId;
      seat.explicitlyLeft = false;
      seat.substitutedFromNickname = null;
      return {
        name: seat.nickname || DEFAULT_PLAYER_NAMES[seatIdx] || DEFAULT_PLAYER_NAMES[0],
        colorToken: seat.colorToken,
        isAI: seat.kind === 'ai',
        aiDifficulty: seat.aiDifficulty,
      };
    });

    const gameState = createInitialGameState({
      ruleVariant: nextRoom.config.ruleVariant,
      format: nextRoom.config.format,
      timerSeconds: nextRoom.config.timerSeconds,
      shuffleOrder: false,
      players,
    });

    const activePlayer = gameState.players[gameState.currentPlayerIndex];
    nextRoom.status = 'playing';
    nextRoom.roundNumber = 1;
    nextRoom.gameSequence = room.gameSequence + 1;
    nextRoom.gameState = gameState;
    nextRoom.turnStartedAt = null;
    nextRoom.nextAiStepAt = activePlayer?.isAI ? now + getAiStepDelayMs(ctx.env) : null;
    nextRoom.matchSavedId = null;
    nextRoom.lastEvent = null;
    nextRoom.round1Roster = null;
    nextRoom.replayDraft = extractReplayFromHistory(createReplayInitialConfig(gameState), []);
    nextRoom.updatedAt = now;

    const cas = await ctx.store.casUpdateRoom(
      code,
      expectedVersion,
      nextRoom,
      ROOM_TTL_ACTIVE_SECONDS,
    );
    if (!cas.ok) {
      if (cas.reason === 'NOT_FOUND') {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }
      return makeVersionConflictResponse(cas.currentRoom, presence, sessionToken, now, ctx.env);
    }

    await touchPresenceIfNeeded(ctx.store, cas.room, getMemberId(caller), presence, now, ctx.env);
    const resBody: RoomCommandResponse = {
      room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  // --------------------------------------------------------------------------
  // 9. game_action (commit_placement / commit_turn; atomic CAS + match save)
  // --------------------------------------------------------------------------
  async function handleGameAction(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    if (expectedVersion === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'expectedVersion must be a positive integer');
    }
    const action = parseOnlineGameAction(body.action);
    if (!action) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'Invalid game_action payload');
    }
    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller || getMemberExplicitlyLeft(caller)) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'You have left this room; rejoin first');
    }
    if (caller.kind !== 'seat') {
      return makeErrorResponse(403, 'FORBIDDEN_SPECTATOR', 'Spectators cannot submit game actions');
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);

    // Version check BEFORE status/turn check so double-submits reconcile cleanly via 409 + snapshot
    if (room.version !== expectedVersion) {
      return makeVersionConflictResponse(room, presence, sessionToken, now, ctx.env);
    }

    if (room.status !== 'playing' || !room.gameState || room.gameState.phase === 'game_over') {
      return makeErrorResponse(400, 'INVALID_ROOM_STATUS', 'Room is not currently in an active game');
    }

    const gs = room.gameState;
    const activePlayer = gs.players[gs.currentPlayerIndex];
    const activeSeat = room.seats.find((s) => s.gamePlayerId === activePlayer?.id);

    if (
      !activePlayer ||
      activePlayer.isAI ||
      !activeSeat ||
      activeSeat.kind !== 'human' ||
      activeSeat.seatIndex !== caller.seat.seatIndex
    ) {
      return makeErrorResponse(403, 'NOT_YOUR_TURN', 'It is not your turn');
    }

    let nextGs: GameState;
    if (action.type === 'commit_placement') {
      if (gs.phase !== 'placement') {
        return makeErrorResponse(400, 'ILLEGAL_MOVE', 'Game is not in placement phase');
      }
      nextGs = placeInitialPiece(gs, action.pos, action.kind);
      if (nextGs === gs) {
        return makeErrorResponse(400, 'ILLEGAL_MOVE', 'Illegal piece placement');
      }
    } else {
      if (gs.phase !== 'select_piece') {
        return makeErrorResponse(400, 'ILLEGAL_MOVE', 'Game is not awaiting a turn move');
      }
      try {
        nextGs = applyAtomicTurnAction(gs, {
          pieceId: action.pieceId,
          useWallBreak: action.useWallBreak,
          breakWall: action.breakWall,
          destination: action.destination,
          placeWall: action.placeWall,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Illegal turn action';
        return makeErrorResponse(400, 'ILLEGAL_MOVE', msg);
      }
    }

    const { nextRoom, ttlSeconds } = buildPostMoveRoomState(room, nextGs, now, ctx.env, {
      isTimeout: false,
    });

    const cas = await ctx.store.casUpdateRoom(code, expectedVersion, nextRoom, ttlSeconds);
    if (!cas.ok) {
      if (cas.reason === 'NOT_FOUND') {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }
      return makeVersionConflictResponse(cas.currentRoom, presence, sessionToken, now, ctx.env);
    }

    if (cas.room.status === 'finished') {
      await saveOnlineMatchForRoom(ctx.store, cas.room, now);
    }

    if (!caller.seat.explicitlyLeft) {
      await touchPresenceIfNeeded(ctx.store, cas.room, caller.seat.memberId!, presence, now, ctx.env);
    }

    const resBody: RoomCommandResponse = {
      room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  // --------------------------------------------------------------------------
  // 10. ai_step (paced, strictly 1 move, idempotent on race/early/stale)
  // --------------------------------------------------------------------------
  async function handleAiStep(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    if (expectedVersion === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'expectedVersion must be a positive integer');
    }
    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller || getMemberExplicitlyLeft(caller)) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'You have left this room; rejoin first');
    }

    const callerIsHost = getMemberId(caller) === room.hostMemberId;
    if (caller.kind === 'spectator' && !callerIsHost) {
      return makeErrorResponse(
        403,
        'FORBIDDEN_SPECTATOR',
        'Only seated players or the host can trigger AI turns',
      );
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);
    if (!getMemberExplicitlyLeft(caller)) {
      await touchPresenceIfNeeded(ctx.store, room, getMemberId(caller), presence, now, ctx.env);
    }

    if (
      room.status !== 'playing' ||
      !room.gameState ||
      room.gameState.phase === 'game_over' ||
      room.version !== expectedVersion
    ) {
      const resBody: RoomCommandResponse = {
        executed: false,
        room: sanitizeRoomForViewer(room, presence, sessionToken, now, ctx.env),
      };
      return makeJsonResponse(resBody, 200);
    }

    const gs = room.gameState;
    const activePlayer = gs.players[gs.currentPlayerIndex];
    if (!activePlayer || !activePlayer.isAI) {
      const resBody: RoomCommandResponse = {
        executed: false,
        room: sanitizeRoomForViewer(room, presence, sessionToken, now, ctx.env),
      };
      return makeJsonResponse(resBody, 200);
    }

    if (room.nextAiStepAt !== null && now < room.nextAiStepAt - AI_STEP_EARLY_TOLERANCE_MS) {
      const resBody: RoomCommandResponse = {
        executed: false,
        retryAfterMs: Math.max(0, room.nextAiStepAt - now),
        room: sanitizeRoomForViewer(room, presence, sessionToken, now, ctx.env),
      };
      return makeJsonResponse(resBody, 200);
    }

    let nextGs: GameState;
    if (gs.phase === 'placement') {
      const pick = chooseAiPlacement(gs, activePlayer.aiDifficulty, rng);
      nextGs = placeInitialPiece(gs, { row: pick.row, col: pick.col }, pick.kind);
    } else if (gs.phase === 'select_piece') {
      const turn = chooseAiTurn(gs, activePlayer.aiDifficulty, rng);
      nextGs = applyAtomicTurnAction(gs, turn);
    } else {
      const resBody: RoomCommandResponse = {
        executed: false,
        room: sanitizeRoomForViewer(room, presence, sessionToken, now, ctx.env),
      };
      return makeJsonResponse(resBody, 200);
    }

    if (nextGs === gs) {
      return makeErrorResponse(500, 'INTERNAL_ERROR', 'AI failed to produce a legal move');
    }

    const { nextRoom, ttlSeconds } = buildPostMoveRoomState(room, nextGs, now, ctx.env, {
      isTimeout: false,
    });

    const cas = await ctx.store.casUpdateRoom(code, expectedVersion, nextRoom, ttlSeconds);
    if (!cas.ok) {
      if (cas.reason === 'NOT_FOUND') {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }
      const conflictBody: RoomCommandResponse = {
        executed: false,
        room: sanitizeRoomForViewer(cas.currentRoom, presence, sessionToken, now, ctx.env),
      };
      return makeJsonResponse(conflictBody, 200);
    }

    if (cas.room.status === 'finished') {
      await saveOnlineMatchForRoom(ctx.store, cas.room, now);
    }

    const resBody: RoomCommandResponse = {
      executed: true,
      room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  // --------------------------------------------------------------------------
  // 11. timeout (grace windows, partialMove validation, idempotent CAS + save)
  // --------------------------------------------------------------------------
  async function handleTimeout(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    if (expectedVersion === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'expectedVersion must be a positive integer');
    }
    let partialMove: TimeoutPartialMove | undefined;
    if (hasOwn(body, 'partialMove') && body.partialMove !== undefined) {
      const parsedPartial = parseTimeoutPartialMove(body.partialMove);
      if (!parsedPartial) {
        return makeErrorResponse(400, 'INVALID_REQUEST', 'Invalid partialMove payload');
      }
      partialMove = parsedPartial;
    }

    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller || getMemberExplicitlyLeft(caller)) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'You have left this room; rejoin first');
    }

    const callerIsHost = getMemberId(caller) === room.hostMemberId;
    if (caller.kind === 'spectator' && !callerIsHost) {
      return makeErrorResponse(
        403,
        'FORBIDDEN_SPECTATOR',
        'Only seated players or the host can trigger turn timeouts',
      );
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);
    if (!getMemberExplicitlyLeft(caller)) {
      await touchPresenceIfNeeded(ctx.store, room, getMemberId(caller), presence, now, ctx.env);
    }

    if (
      room.status !== 'playing' ||
      !room.gameState ||
      room.gameState.phase === 'game_over' ||
      room.version !== expectedVersion ||
      room.turnStartedAt === null ||
      room.gameState.timerSeconds <= 0 ||
      room.gameState.phase === 'placement'
    ) {
      const resBody: RoomCommandResponse = {
        executed: false,
        room: sanitizeRoomForViewer(room, presence, sessionToken, now, ctx.env),
      };
      return makeJsonResponse(resBody, 200);
    }

    const gs = room.gameState;
    const activePlayer = gs.players[gs.currentPlayerIndex];
    const activeSeat = room.seats.find((s) => s.gamePlayerId === activePlayer?.id);

    if (!activePlayer || activePlayer.isAI || !activeSeat || activeSeat.kind !== 'human') {
      const resBody: RoomCommandResponse = {
        executed: false,
        room: sanitizeRoomForViewer(room, presence, sessionToken, now, ctx.env),
      };
      return makeJsonResponse(resBody, 200);
    }

    const isActivePlayer =
      caller.kind === 'seat' && caller.seat.seatIndex === activeSeat.seatIndex;

    if (!isActivePlayer && partialMove !== undefined) {
      return makeErrorResponse(
        403,
        'NOT_YOUR_TURN',
        'Only the active player may submit partialMove on timeout',
      );
    }

    const timerMs = gs.timerSeconds * 1000;
    const requiredMs = isActivePlayer
      ? timerMs - TIMEOUT_ACTOR_SKEW_MS
      : timerMs + TIMEOUT_NON_ACTOR_GRACE_MS;
    const elapsed = now - room.turnStartedAt;

    if (elapsed < requiredMs) {
      const resBody: RoomCommandResponse = {
        executed: false,
        retryAfterMs: Math.max(0, requiredMs - elapsed),
        room: sanitizeRoomForViewer(room, presence, sessionToken, now, ctx.env),
      };
      return makeJsonResponse(resBody, 200);
    }

    let baseState = gs;
    if (isActivePlayer && partialMove !== undefined) {
      const partialState = applyTimeoutPartialMove(gs, partialMove);
      if (partialState !== null) {
        baseState = partialState;
      }
    }

    const { state: nextGs, event } = resolveTurnTimeout(baseState, rng);
    if (!event || nextGs === baseState) {
      const resBody: RoomCommandResponse = {
        executed: false,
        room: sanitizeRoomForViewer(room, presence, sessionToken, now, ctx.env),
      };
      return makeJsonResponse(resBody, 200);
    }

    const { nextRoom, ttlSeconds } = buildPostMoveRoomState(room, nextGs, now, ctx.env, {
      isTimeout: true,
      timedOutActorNickname: activePlayer.name,
    });

    const cas = await ctx.store.casUpdateRoom(code, expectedVersion, nextRoom, ttlSeconds);
    if (!cas.ok) {
      if (cas.reason === 'NOT_FOUND') {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }
      const conflictBody: RoomCommandResponse = {
        executed: false,
        room: sanitizeRoomForViewer(cas.currentRoom, presence, sessionToken, now, ctx.env),
      };
      return makeJsonResponse(conflictBody, 200);
    }

    if (cas.room.status === 'finished') {
      await saveOnlineMatchForRoom(ctx.store, cas.room, now);
    }

    const resBody: RoomCommandResponse = {
      executed: true,
      room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  // --------------------------------------------------------------------------
  // 12. substitute_ai (Host-only in playing for disconnected/left human seat)
  // --------------------------------------------------------------------------
  async function handleSubstituteAi(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    if (expectedVersion === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'expectedVersion must be a positive integer');
    }
    if (typeof body.seatIndex !== 'number' || !Number.isSafeInteger(body.seatIndex)) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'seatIndex must be an integer');
    }
    if (!isValidAiDifficulty(body.aiDifficulty)) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'Invalid aiDifficulty');
    }

    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller || getMemberExplicitlyLeft(caller)) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'You have left this room; rejoin first');
    }

    const hostErr = requireHostAuthorization(room, caller);
    if (hostErr) {
      return hostErr;
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);

    if (room.version !== expectedVersion) {
      return makeVersionConflictResponse(room, presence, sessionToken, now, ctx.env);
    }

    if (room.status !== 'playing' || !room.gameState || room.gameState.phase === 'game_over') {
      return makeErrorResponse(
        400,
        'INVALID_ROOM_STATUS',
        'AI substitution is only allowed during an active game',
      );
    }

    const seatIndex = normalizeZero(body.seatIndex);
    if (seatIndex < 0 || seatIndex >= room.seats.length) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'seatIndex out of bounds');
    }

    const target = room.seats[seatIndex];
    if (target.kind === 'human' && target.memberId === room.hostMemberId) {
      return makeErrorResponse(400, 'CANNOT_MODIFY_HOST_SEAT', 'Cannot substitute the host seat');
    }
    if (target.kind !== 'human' || target.gamePlayerId === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'Target seat is not a human player');
    }

    const awayGraceMs = getAwayGraceMs(ctx.env);
    const disconnectTimeoutMs = getDisconnectTimeoutMs(ctx.env);
    const targetStatus = computeSeatConnectionStatus(
      target,
      presence,
      now,
      awayGraceMs,
      disconnectTimeoutMs,
      room.createdAt,
    );
    if (targetStatus === 'connected') {
      return makeErrorResponse(
        400,
        'SEAT_NOT_DISCONNECTED',
        'Cannot substitute AI while the player is still connected',
      );
    }

    const nextRoom = structuredClone(room);
    const nextSeat = nextRoom.seats[seatIndex];
    const origNickname = nextSeat.nickname;
    const origMemberId = nextSeat.memberId!;
    const origSessionToken = nextSeat.sessionToken!;
    const origClientId = nextSeat.clientId!;
    const origJoinedAt = nextSeat.joinedAt ?? now;
    const origExplicitlyLeft = nextSeat.explicitlyLeft;
    const targetGamePlayerId = nextSeat.gamePlayerId!;

    evictSpectatorIfAtCap(nextRoom);
    nextRoom.spectators.push({
      memberId: origMemberId,
      sessionToken: origSessionToken,
      clientId: origClientId,
      nickname: origNickname,
      role: 'replaced_spectator',
      joinedAt: origJoinedAt,
      explicitlyLeft: origExplicitlyLeft,
    });

    nextSeat.kind = 'ai';
    nextSeat.memberId = null;
    nextSeat.sessionToken = null;
    nextSeat.clientId = null;
    nextSeat.joinedAt = null;
    nextSeat.explicitlyLeft = false;
    nextSeat.nickname = origNickname;
    nextSeat.substitutedFromNickname = origNickname;
    nextSeat.aiDifficulty = body.aiDifficulty;

    nextRoom.gameState = setPlayerControllerInGame(
      nextRoom.gameState!,
      targetGamePlayerId,
      true,
      body.aiDifficulty,
    );

    const activePlayer = nextRoom.gameState.players[nextRoom.gameState.currentPlayerIndex];
    if (activePlayer?.id === targetGamePlayerId) {
      nextRoom.turnStartedAt = null;
      nextRoom.nextAiStepAt = now + getAiStepDelayMs(ctx.env);
    }

    nextRoom.eventCounter += 1;
    nextRoom.lastEvent = {
      id: nextRoom.eventCounter,
      type: 'ai_substituted',
      nickname: origNickname,
      aiDifficulty: body.aiDifficulty,
      at: now,
    };
    nextRoom.updatedAt = now;

    const cas = await ctx.store.casUpdateRoom(
      code,
      expectedVersion,
      nextRoom,
      ROOM_TTL_ACTIVE_SECONDS,
    );
    if (!cas.ok) {
      if (cas.reason === 'NOT_FOUND') {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }
      return makeVersionConflictResponse(cas.currentRoom, presence, sessionToken, now, ctx.env);
    }

    await touchPresenceIfNeeded(ctx.store, cas.room, getMemberId(caller), presence, now, ctx.env);
    const resBody: RoomCommandResponse = {
      room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  // --------------------------------------------------------------------------
  // 13. claim_host (when host is disconnected/left)
  // --------------------------------------------------------------------------
  async function handleClaimHost(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    if (expectedVersion === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'expectedVersion must be a positive integer');
    }
    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller || getMemberExplicitlyLeft(caller)) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Session token is not an active member');
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);

    if (room.version !== expectedVersion) {
      return makeVersionConflictResponse(room, presence, sessionToken, now, ctx.env);
    }

    const awayGraceMs = getAwayGraceMs(ctx.env);
    const disconnectTimeoutMs = getDisconnectTimeoutMs(ctx.env);
    const callerMemberId = getMemberId(caller);

    if (
      callerMemberId === room.hostMemberId ||
      isHostConnected(room, presence, now, awayGraceMs, disconnectTimeoutMs)
    ) {
      return makeErrorResponse(409, 'HOST_STILL_CONNECTED', 'Current host is still connected');
    }

    if (
      caller.kind === 'spectator' &&
      caller.spectator.role !== 'survivor_spectator' &&
      hasConnectedSeatOrSurvivorOtherThanHost(
        room,
        presence,
        now,
        awayGraceMs,
        disconnectTimeoutMs,
      )
    ) {
      return makeErrorResponse(
        403,
        'FORBIDDEN_SPECTATOR',
        'Spectators cannot claim host while seated players are connected',
      );
    }

    const nextRoom = structuredClone(room);
    nextRoom.hostMemberId = callerMemberId;
    nextRoom.eventCounter += 1;
    nextRoom.lastEvent = {
      id: nextRoom.eventCounter,
      type: 'host_transferred',
      newHostNickname: getMemberNickname(caller),
      at: now,
    };
    nextRoom.updatedAt = now;

    const cas = await ctx.store.casUpdateRoom(
      code,
      expectedVersion,
      nextRoom,
      getRoomTtlSeconds(nextRoom.status),
    );
    if (!cas.ok) {
      if (cas.reason === 'NOT_FOUND') {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }
      return makeVersionConflictResponse(cas.currentRoom, presence, sessionToken, now, ctx.env);
    }

    await touchPresenceIfNeeded(ctx.store, cas.room, callerMemberId, presence, now, ctx.env, true);
    const resBody: RoomCommandResponse = {
      room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  // --------------------------------------------------------------------------
  // 14. start_round2 (Host-only after finished 3P Round 1; survivor_spectator)
  // --------------------------------------------------------------------------
  async function handleStartRound2(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    if (expectedVersion === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'expectedVersion must be a positive integer');
    }
    let overridePair: [number, number] | undefined;
    if (hasOwn(body, 'overridePair') && body.overridePair !== undefined) {
      const parsedPair = parseOverridePair(body.overridePair);
      if (!parsedPair) {
        return makeErrorResponse(
          400,
          'INVALID_REQUEST',
          'overridePair must be two distinct player IDs in 0..2',
        );
      }
      overridePair = parsedPair;
    }

    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller || getMemberExplicitlyLeft(caller)) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'You have left this room; rejoin first');
    }

    const hostErr = requireHostAuthorization(room, caller);
    if (hostErr) {
      return hostErr;
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);

    if (room.version !== expectedVersion) {
      return makeVersionConflictResponse(room, presence, sessionToken, now, ctx.env);
    }

    if (
      room.status !== 'finished' ||
      !room.gameState ||
      room.gameState.phase !== 'game_over' ||
      room.gameState.format !== '3p' ||
      room.gameState.isPrisonMatchRound2
    ) {
      return makeErrorResponse(
        400,
        'INVALID_ROOM_STATUS',
        'Round 2 can only be started after a finished 3-player game',
      );
    }

    let round2State: GameState;
    try {
      round2State = createPrisonMatchRound2State(room.gameState, overridePair);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid Round 2 qualification';
      return makeErrorResponse(400, 'INVALID_REQUEST', msg);
    }

    let firstR1Id: number;
    let secondR1Id: number;
    if (overridePair) {
      [firstR1Id, secondR1Id] = overridePair;
    } else {
      const qual = computeRound2Qualification(room.gameState);
      firstR1Id = qual.defaultFirstPlayerId;
      secondR1Id = qual.defaultSecondPlayerId;
    }
    const survivorR1Id = [0, 1, 2].find((id) => id !== firstR1Id && id !== secondR1Id);
    if (survivorR1Id === undefined) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'Unable to determine Round 2 survivor');
    }

    // Resolve seats strictly via seat.gamePlayerId (NEVER seatIndex, supporting shuffleOrder)
    const firstSeat = room.seats.find((s) => s.gamePlayerId === firstR1Id);
    const secondSeat = room.seats.find((s) => s.gamePlayerId === secondR1Id);
    const survivorSeat = room.seats.find((s) => s.gamePlayerId === survivorR1Id);
    if (!firstSeat || !secondSeat || !survivorSeat) {
      return makeErrorResponse(500, 'INTERNAL_ERROR', 'Inconsistent Round 1 seat mapping');
    }

    const nextRoom = structuredClone(room);
    const round1Roster: StoredRound1Roster = {
      seats: room.seats.map((s) => ({
        seatIndex: s.seatIndex,
        kind: s.kind,
        colorToken: s.colorToken,
        memberId: s.memberId,
        sessionToken: s.sessionToken,
        clientId: s.clientId,
        nickname: s.nickname,
        aiDifficulty: s.aiDifficulty,
        joinedAt: s.joinedAt,
      })),
      survivorMemberId: survivorSeat.kind === 'human' ? survivorSeat.memberId : null,
      survivorSeatIndex: survivorSeat.seatIndex,
    };

    if (
      survivorSeat.kind === 'human' &&
      !survivorSeat.explicitlyLeft &&
      survivorSeat.memberId &&
      survivorSeat.sessionToken &&
      survivorSeat.clientId
    ) {
      evictSpectatorIfAtCap(nextRoom);
      nextRoom.spectators.push({
        memberId: survivorSeat.memberId,
        sessionToken: survivorSeat.sessionToken,
        clientId: survivorSeat.clientId,
        nickname: survivorSeat.nickname,
        role: 'survivor_spectator',
        joinedAt: survivorSeat.joinedAt ?? now,
        explicitlyLeft: false,
      });
    }

    nextRoom.seats = [
      {
        ...structuredClone(firstSeat),
        seatIndex: 0,
        gamePlayerId: 0,
        substitutedFromNickname: null,
      },
      {
        ...structuredClone(secondSeat),
        seatIndex: 1,
        gamePlayerId: 1,
        substitutedFromNickname: null,
      },
    ];

    const activePlayer = round2State.players[round2State.currentPlayerIndex];
    nextRoom.status = 'playing';
    nextRoom.roundNumber = 2;
    nextRoom.gameSequence = room.gameSequence + 1;
    nextRoom.gameState = round2State;
    nextRoom.turnStartedAt = null;
    nextRoom.nextAiStepAt = activePlayer?.isAI ? now + getAiStepDelayMs(ctx.env) : null;
    nextRoom.matchSavedId = null;
    nextRoom.round1Roster = round1Roster;
    nextRoom.replayDraft = extractReplayFromHistory(createReplayInitialConfig(round2State), []);
    nextRoom.eventCounter = room.eventCounter + 1;
    nextRoom.lastEvent = {
      id: nextRoom.eventCounter,
      type: 'round2_started',
      survivorNickname: survivorSeat.nickname || null,
      at: now,
    };
    nextRoom.updatedAt = now;

    const cas = await ctx.store.casUpdateRoom(
      code,
      expectedVersion,
      nextRoom,
      ROOM_TTL_ACTIVE_SECONDS,
    );
    if (!cas.ok) {
      if (cas.reason === 'NOT_FOUND') {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }
      return makeVersionConflictResponse(cas.currentRoom, presence, sessionToken, now, ctx.env);
    }

    await touchPresenceIfNeeded(ctx.store, cas.room, getMemberId(caller), presence, now, ctx.env);
    const resBody: RoomCommandResponse = {
      room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  // --------------------------------------------------------------------------
  // 15. rematch (Host-only in finished; supports both Round 1 and Round 2)
  // --------------------------------------------------------------------------
  async function handleRematch(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    if (expectedVersion === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'expectedVersion must be a positive integer');
    }
    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller || getMemberExplicitlyLeft(caller)) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'You have left this room; rejoin first');
    }

    const hostErr = requireHostAuthorization(room, caller);
    if (hostErr) {
      return hostErr;
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);

    if (room.version !== expectedVersion) {
      return makeVersionConflictResponse(room, presence, sessionToken, now, ctx.env);
    }

    if (room.status !== 'finished' || !room.gameState || room.gameState.phase !== 'game_over') {
      return makeErrorResponse(
        400,
        'INVALID_ROOM_STATUS',
        'Rematch can only be started after a game has finished',
      );
    }

    const nextRoom = structuredClone(room);
    let nextGs: GameState;

    if (nextRoom.roundNumber === 2) {
      if (nextRoom.seats.length !== 2) {
        return makeErrorResponse(400, 'INVALID_ROOM_STATUS', 'Round 2 requires exactly 2 seats');
      }
      const players: PlayerConfig[] = nextRoom.seats.map((seat, idx) => {
        if (seat.substitutedFromNickname !== null) {
          seat.substitutedFromNickname = null;
          seat.nickname = `AI ${idx + 1}`;
        }
        seat.gamePlayerId = idx;
        return {
          name: seat.nickname || DEFAULT_PLAYER_NAMES[idx] || DEFAULT_PLAYER_NAMES[0],
          colorToken: seat.colorToken,
          isAI: seat.kind === 'ai',
          aiDifficulty: seat.aiDifficulty,
        };
      });
      nextGs = createInitialStateFromReplayConfig({
        ruleVariant: nextRoom.config.ruleVariant,
        format: '2p',
        isPrisonMatchRound2: true,
        timerSeconds: nextRoom.config.timerSeconds,
        players,
      });
    } else {
      const seatCount = nextRoom.seats.length;
      for (let i = 0; i < seatCount; i++) {
        const seat = nextRoom.seats[i];
        if (seat.substitutedFromNickname !== null) {
          seat.substitutedFromNickname = null;
          seat.nickname = `AI ${i + 1}`;
        }
      }
      const seatOrder = shuffleSeatOrder(seatCount, rng, nextRoom.config.shuffleOrder);
      const players: PlayerConfig[] = seatOrder.map((seatIdx, gamePlayerId) => {
        const seat = nextRoom.seats[seatIdx];
        seat.gamePlayerId = gamePlayerId;
        return {
          name: seat.nickname || DEFAULT_PLAYER_NAMES[seatIdx] || DEFAULT_PLAYER_NAMES[0],
          colorToken: seat.colorToken,
          isAI: seat.kind === 'ai',
          aiDifficulty: seat.aiDifficulty,
        };
      });
      nextGs = createInitialGameState({
        ruleVariant: nextRoom.config.ruleVariant,
        format: nextRoom.config.format,
        timerSeconds: nextRoom.config.timerSeconds,
        shuffleOrder: false,
        players,
      });
    }

    const activePlayer = nextGs.players[nextGs.currentPlayerIndex];
    nextRoom.status = 'playing';
    nextRoom.gameSequence = room.gameSequence + 1;
    nextRoom.gameState = nextGs;
    nextRoom.turnStartedAt = null;
    nextRoom.nextAiStepAt = activePlayer?.isAI ? now + getAiStepDelayMs(ctx.env) : null;
    nextRoom.matchSavedId = null;
    nextRoom.lastEvent = null;
    nextRoom.replayDraft = extractReplayFromHistory(createReplayInitialConfig(nextGs), []);
    nextRoom.updatedAt = now;

    const cas = await ctx.store.casUpdateRoom(
      code,
      expectedVersion,
      nextRoom,
      ROOM_TTL_ACTIVE_SECONDS,
    );
    if (!cas.ok) {
      if (cas.reason === 'NOT_FOUND') {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }
      return makeVersionConflictResponse(cas.currentRoom, presence, sessionToken, now, ctx.env);
    }

    await touchPresenceIfNeeded(ctx.store, cas.room, getMemberId(caller), presence, now, ctx.env);
    const resBody: RoomCommandResponse = {
      room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  // --------------------------------------------------------------------------
  // 16. return_to_waiting (Host-only in finished; restores round1Roster; keeps gameSequence)
  // --------------------------------------------------------------------------
  async function handleReturnToWaiting(
    ctx: ApiRouteContext,
    code: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    if (expectedVersion === null) {
      return makeErrorResponse(400, 'INVALID_REQUEST', 'expectedVersion must be a positive integer');
    }
    const sessionToken = validateSessionToken(body.sessionToken);
    if (!sessionToken) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'Missing or invalid session token');
    }

    const room = await ctx.store.getRoom(code);
    if (!room) {
      return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
    }

    const caller = findMemberBySessionToken(room, sessionToken);
    if (!caller || getMemberExplicitlyLeft(caller)) {
      return makeErrorResponse(401, 'UNAUTHORIZED', 'You have left this room; rejoin first');
    }

    const hostErr = requireHostAuthorization(room, caller);
    if (hostErr) {
      return hostErr;
    }

    const now = ctx.now();
    const presence = await ctx.store.getPresenceMap(code);

    if (room.version !== expectedVersion) {
      return makeVersionConflictResponse(room, presence, sessionToken, now, ctx.env);
    }

    if (room.status !== 'finished') {
      return makeErrorResponse(
        400,
        'INVALID_ROOM_STATUS',
        'Can only return to waiting room after a game has finished',
      );
    }

    const nextRoom = structuredClone(room);

    if (nextRoom.round1Roster !== null) {
      // Collect currently present non-left humans across current seats and spectators
      const presentHumans = new Map<
        string,
        { memberId: string; sessionToken: string; clientId: string; nickname: string; joinedAt: number }
      >();
      for (const seat of nextRoom.seats) {
        if (
          seat.kind === 'human' &&
          !seat.explicitlyLeft &&
          seat.memberId &&
          seat.sessionToken &&
          seat.clientId
        ) {
          presentHumans.set(seat.memberId, {
            memberId: seat.memberId,
            sessionToken: seat.sessionToken,
            clientId: seat.clientId,
            nickname: seat.nickname,
            joinedAt: seat.joinedAt ?? now,
          });
        }
      }
      for (const spec of nextRoom.spectators) {
        if (!spec.explicitlyLeft) {
          presentHumans.set(spec.memberId, {
            memberId: spec.memberId,
            sessionToken: spec.sessionToken,
            clientId: spec.clientId,
            nickname: spec.nickname,
            joinedAt: spec.joinedAt,
          });
        }
      }

      const reSeatedMemberIds = new Set<string>();
      const restoredSeats: InternalOnlineSeat[] = nextRoom.round1Roster.seats.map((snap, idx) => {
        const seatIndex = snap.seatIndex ?? idx;
        const colorToken = PLAYER_COLOR_TOKENS[seatIndex] ?? snap.colorToken;

        if (snap.kind === 'human' && snap.memberId) {
          const present = presentHumans.get(snap.memberId);
          if (present) {
            reSeatedMemberIds.add(present.memberId);
            return {
              seatIndex,
              kind: 'human',
              colorToken,
              memberId: present.memberId,
              sessionToken: present.sessionToken,
              clientId: present.clientId,
              nickname: present.nickname,
              aiDifficulty: 'normal',
              gamePlayerId: null,
              joinedAt: present.joinedAt,
              explicitlyLeft: false,
              substitutedFromNickname: null,
            };
          }
          return createOpenSeat(seatIndex, colorToken);
        }

        if (snap.kind === 'ai') {
          return {
            seatIndex,
            kind: 'ai',
            colorToken,
            memberId: null,
            sessionToken: null,
            clientId: null,
            nickname: `AI ${seatIndex + 1}`,
            aiDifficulty: snap.aiDifficulty,
            gamePlayerId: null,
            joinedAt: null,
            explicitlyLeft: false,
            substitutedFromNickname: null,
          };
        }

        return createOpenSeat(seatIndex, colorToken);
      });

      nextRoom.seats = restoredSeats;
      nextRoom.spectators = nextRoom.spectators
        .filter((s) => !s.explicitlyLeft && !reSeatedMemberIds.has(s.memberId))
        .map((s) => ({ ...s, role: 'spectator' }));
    } else {
      nextRoom.seats = nextRoom.seats.map((seat, idx) => {
        if (seat.kind === 'human' && seat.explicitlyLeft) {
          return createOpenSeat(idx, seat.colorToken);
        }
        if (seat.kind === 'ai') {
          const nickname = seat.substitutedFromNickname !== null ? `AI ${idx + 1}` : seat.nickname;
          return {
            ...seat,
            seatIndex: idx,
            nickname,
            gamePlayerId: null,
            substitutedFromNickname: null,
          };
        }
        return {
          ...seat,
          seatIndex: idx,
          gamePlayerId: null,
          substitutedFromNickname: null,
        };
      });
      nextRoom.spectators = nextRoom.spectators
        .filter((s) => !s.explicitlyLeft)
        .map((s) => ({ ...s, role: 'spectator' }));
    }

    nextRoom.status = 'waiting';
    nextRoom.roundNumber = 1;
    // CRITICAL: NEVER reset gameSequence (prevents match ID collisions on subsequent games!)
    nextRoom.gameState = null;
    nextRoom.turnStartedAt = null;
    nextRoom.nextAiStepAt = null;
    nextRoom.matchSavedId = null;
    nextRoom.lastEvent = null;
    nextRoom.round1Roster = null;
    nextRoom.replayDraft = null;
    nextRoom.updatedAt = now;

    const cas = await ctx.store.casUpdateRoom(
      code,
      expectedVersion,
      nextRoom,
      ROOM_TTL_ACTIVE_SECONDS,
    );
    if (!cas.ok) {
      if (cas.reason === 'NOT_FOUND') {
        return makeErrorResponse(404, 'ROOM_NOT_FOUND', `Room "${code}" not found`);
      }
      return makeVersionConflictResponse(cas.currentRoom, presence, sessionToken, now, ctx.env);
    }

    await touchPresenceIfNeeded(ctx.store, cas.room, getMemberId(caller), presence, now, ctx.env);
    const resBody: RoomCommandResponse = {
      room: sanitizeRoomForViewer(cas.room, presence, sessionToken, now, ctx.env),
    };
    return makeJsonResponse(resBody, 200);
  }

  return {
    createRoom,
    getRoom,
    postRoomCommand,
  };
}

export const defaultRoomHandlers: RoomRouteHandlers = createRoomHandlers();
