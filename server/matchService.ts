import type {
  MatchDetailResponse,
  MatchRecord,
  MatchSummary,
  MatchesListResponse,
} from '../src/shared/historyTypes.js';
import { MAX_ONLINE_MATCHES, type ApiErrorBody, type ApiErrorCode } from '../src/shared/onlineTypes.js';
import {
  buildMatchPlayerSummaries,
  extractMatchFinalBoard,
  extractReplayFromHistory,
  toMatchSummary,
} from '../src/shared/replay.js';
import type { ApiRouteContext } from './router.js';
import { RedisNotConfiguredError, type StorageAdapter } from './store/types.js';
import type { RoomRecord } from './types.js';

const NO_STORE_CACHE_CONTROL = 'no-store, max-age=0';
const MAX_MATCH_ID_LENGTH = 128;

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': NO_STORE_CACHE_CONTROL,
    },
  });
}

function makeErrorResponse(status: number, code: ApiErrorCode, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return makeJsonResponse(body, status);
}

/**
 * Deterministic online match identifier used for atomic server-side deduplication.
 */
export function buildOnlineMatchId(roomCode: string, gameSequence: number): string {
  return `online_${roomCode}_g${gameSequence}`;
}

/**
 * Validates an incoming match ID from `/api/matches/:id`.
 */
export function isValidMatchId(matchId: string): boolean {
  if (typeof matchId !== 'string') {
    return false;
  }
  const trimmed = matchId.trim();
  if (trimmed.length === 0 || matchId.length > MAX_MATCH_ID_LENGTH) {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(matchId)) {
    return false;
  }
  return true;
}

/**
 * Builds the full MatchRecord (with deterministic ReplayData) and lightweight
 * MatchSummary for a finished online room.
 */
export function buildOnlineMatchRecord(
  room: RoomRecord,
  playedAtMs: number,
): { record: MatchRecord; summary: MatchSummary } | null {
  const gs = room.gameState;
  if (!gs || gs.phase !== 'game_over' || !room.replayDraft) {
    return null;
  }

  const substitutedPlayerIds = new Set<number>();
  for (const seat of room.seats) {
    if (seat.substitutedFromNickname !== null && seat.gamePlayerId !== null) {
      substitutedPlayerIds.add(seat.gamePlayerId);
    }
  }

  const id = room.matchSavedId ?? buildOnlineMatchId(room.code, room.gameSequence);
  const replay = extractReplayFromHistory(room.replayDraft.initialConfig, room.replayDraft.steps);
  const players = buildMatchPlayerSummaries(gs, { substitutedPlayerIds });
  const finalBoard = extractMatchFinalBoard(gs);

  const record: MatchRecord = {
    id,
    schemaVersion: 1,
    mode: 'online',
    roomCode: room.code,
    playedAt: new Date(playedAtMs).toISOString(),
    ruleVariant: gs.ruleVariant,
    format: gs.format,
    isPrisonMatchRound2: gs.isPrisonMatchRound2,
    timerSeconds: gs.timerSeconds,
    endReason: gs.territory.endReason ?? 'all_separated',
    totalTurns: gs.turnNumber,
    totalSteps: replay.steps.length,
    players,
    finalBoard,
    hasReplay: true,
    replay,
  };

  const summary = toMatchSummary(record);
  return { record, summary };
}

/**
 * Atomically persists a finished online room's match record & summary once.
 * Must be invoked strictly AFTER the room's finishing Lua CAS succeeds.
 */
export async function saveOnlineMatchForRoom(
  store: StorageAdapter,
  room: RoomRecord,
  playedAtMs: number,
): Promise<boolean> {
  const built = buildOnlineMatchRecord(room, playedAtMs);
  if (!built) {
    return false;
  }
  return store.saveMatchAtomic(built.record, built.summary, MAX_ONLINE_MATCHES);
}

/**
 * Default handler for `GET | HEAD /api/matches`.
 * Calls `ctx.store.listMatchSummaries(limit)` directly so unconfigured mode
 * returns `200 { storage: 'unconfigured', onlineAvailable: false, matches: [] }`.
 */
export async function handleListMatches(ctx: ApiRouteContext, limit: number): Promise<Response> {
  const matches = await ctx.store.listMatchSummaries(limit);
  const body: MatchesListResponse = {
    storage: ctx.store.mode,
    onlineAvailable: ctx.store.mode !== 'unconfigured',
    matches,
  };
  return makeJsonResponse(body, 200);
}

/**
 * Default handler for `GET | HEAD /api/matches/:id`.
 */
export async function handleGetMatch(ctx: ApiRouteContext, matchId: string): Promise<Response> {
  if (ctx.store.mode === 'unconfigured') {
    throw new RedisNotConfiguredError();
  }
  if (!isValidMatchId(matchId)) {
    return makeErrorResponse(400, 'INVALID_REQUEST', 'Invalid match ID');
  }
  const match = await ctx.store.getMatchRecord(matchId);
  if (!match) {
    return makeErrorResponse(404, 'MATCH_NOT_FOUND', `Match "${matchId}" not found`);
  }
  const body: MatchDetailResponse = { match };
  return makeJsonResponse(body, 200);
}
