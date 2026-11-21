import {
  commitTurnSnapshot,
  createHistory,
  isInBounds,
  isValidWallEdge,
  smartRedo,
  smartUndo,
  updatePresentTransient,
} from '../engine';
import type { ActionEvent, GameHistoryState, GameState, Piece, PlacedWall, WallEdge } from '../engine';
import {
  MAX_LOCAL_MATCHES,
  STORAGE_KEY_LOCAL_MATCHES,
  actionEventToReplayStep,
  buildMatchPlayerSummaries,
  createReplayInitialConfig,
  extractMatchFinalBoard,
  extractReplayFromHistory,
} from '../shared';
import type {
  MatchRecord,
  ReplayInitialConfig,
  ReplayStep,
} from '../shared';
import { getBrowserStorage, safeSetItem } from './safeStorage';

export function generateLocalMatchId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (typeof randomUuid === 'string' && randomUuid.length > 0) {
    return `local_${randomUuid}`;
  }
  const timePart = Date.now().toString(36);
  const randPart = Math.random().toString(36).slice(2, 10);
  return `local_${timePart}_${randPart}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const VALID_PIECE_KINDS = new Set(['standard', 'square', 'round']);
const VALID_AI_DIFFICULTIES = new Set(['easy', 'normal', 'hard']);
const FORBIDDEN_WALL_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isValidWallEdgeShape(value: unknown): value is WallEdge {
  if (!isPlainObject(value)) {
    return false;
  }
  if (
    (value.orientation !== 'h' && value.orientation !== 'v') ||
    typeof value.row !== 'number' ||
    typeof value.col !== 'number'
  ) {
    return false;
  }
  return isValidWallEdge({
    orientation: value.orientation,
    row: value.row,
    col: value.col,
  });
}

function isValidPlacedWallShape(value: unknown): value is PlacedWall {
  if (!isValidWallEdgeShape(value)) {
    return false;
  }
  const ownerId = (value as unknown as Record<string, unknown>).ownerId;
  return typeof ownerId === 'number' && Number.isInteger(ownerId);
}

function isValidPieceShape(value: unknown): value is Piece {
  if (!isPlainObject(value)) {
    return false;
  }
  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    return false;
  }
  if (typeof value.ownerId !== 'number' || !Number.isInteger(value.ownerId)) {
    return false;
  }
  if (typeof value.kind !== 'string' || !VALID_PIECE_KINDS.has(value.kind)) {
    return false;
  }
  if (typeof value.row !== 'number' || typeof value.col !== 'number') {
    return false;
  }
  return isInBounds(value.row, value.col);
}

/**
 * Runtime structural validator for persisted `wallgo.localMatches` entries.
 * Malformed or partially corrupted entries are skipped without throwing.
 */
export function isValidLocalMatchRecord(raw: unknown): raw is MatchRecord {
  if (!isPlainObject(raw)) {
    return false;
  }
  if (typeof raw.id !== 'string' || raw.id.trim().length === 0) {
    return false;
  }
  if (raw.schemaVersion !== 1 || raw.mode !== 'local') {
    return false;
  }
  if (typeof raw.playedAt !== 'string' || raw.playedAt.trim().length === 0) {
    return false;
  }
  if (raw.ruleVariant !== 'wallgo1' && raw.ruleVariant !== 'wallgo2') {
    return false;
  }
  if (raw.format !== '3p' && raw.format !== '2p') {
    return false;
  }
  if (typeof raw.isPrisonMatchRound2 !== 'boolean') {
    return false;
  }
  if (raw.timerSeconds !== 0 && raw.timerSeconds !== 60 && raw.timerSeconds !== 90) {
    return false;
  }
  if (raw.endReason !== 'all_separated' && raw.endReason !== 'deadlock') {
    return false;
  }
  if (
    typeof raw.totalTurns !== 'number' ||
    !Number.isFinite(raw.totalTurns) ||
    raw.totalTurns < 0 ||
    typeof raw.totalSteps !== 'number' ||
    !Number.isFinite(raw.totalSteps) ||
    raw.totalSteps < 0
  ) {
    return false;
  }
  if (typeof raw.hasReplay !== 'boolean') {
    return false;
  }
  if (!Array.isArray(raw.players) || raw.players.length === 0) {
    return false;
  }
  for (let i = 0; i < raw.players.length; i++) {
    const p = raw.players[i];
    if (!isPlainObject(p)) {
      return false;
    }
    if (
      typeof p.playerId !== 'number' ||
      !Number.isInteger(p.playerId) ||
      typeof p.name !== 'string' ||
      (p.colorToken !== 'p1' && p.colorToken !== 'p2' && p.colorToken !== 'p3') ||
      typeof p.isAI !== 'boolean' ||
      typeof p.aiDifficulty !== 'string' ||
      !VALID_AI_DIFFICULTIES.has(p.aiDifficulty) ||
      typeof p.rank !== 'number' ||
      !Number.isFinite(p.rank) ||
      typeof p.totalTerritory !== 'number' ||
      !Number.isFinite(p.totalTerritory) ||
      typeof p.largestSingleTerritory !== 'number' ||
      !Number.isFinite(p.largestSingleTerritory) ||
      typeof p.isWinner !== 'boolean' ||
      typeof p.isDraw !== 'boolean' ||
      !Array.isArray(p.securedRegions) ||
      !p.securedRegions.every(
        (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0,
      ) ||
      typeof p.deadlockPieceCount !== 'number' ||
      !Number.isFinite(p.deadlockPieceCount) ||
      p.deadlockPieceCount < 0 ||
      (p.wasSubstitutedToAI !== undefined && typeof p.wasSubstitutedToAI !== 'boolean') ||
      (p.advancingRound2 !== undefined && typeof p.advancingRound2 !== 'boolean')
    ) {
      return false;
    }
  }
  if (
    !isPlainObject(raw.finalBoard) ||
    !Array.isArray(raw.finalBoard.pieces) ||
    !isPlainObject(raw.finalBoard.walls)
  ) {
    return false;
  }
  if (
    raw.finalBoard.lastPlacedWall !== null &&
    !isValidWallEdgeShape(raw.finalBoard.lastPlacedWall)
  ) {
    return false;
  }
  for (let i = 0; i < raw.finalBoard.pieces.length; i++) {
    if (!isValidPieceShape(raw.finalBoard.pieces[i])) {
      return false;
    }
  }
  for (const [key, wall] of Object.entries(raw.finalBoard.walls)) {
    if (FORBIDDEN_WALL_KEYS.has(key) || !isValidPlacedWallShape(wall)) {
      return false;
    }
  }
  if (
    !isPlainObject(raw.replay) ||
    raw.replay.schemaVersion !== 1 ||
    !isPlainObject(raw.replay.initialConfig) ||
    !Array.isArray(raw.replay.initialConfig.players) ||
    !Array.isArray(raw.replay.steps)
  ) {
    return false;
  }
  return true;
}

function parseTimestampMs(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function sortRecordsNewestFirst(records: MatchRecord[]): MatchRecord[] {
  return records.slice().sort((a, b) => {
    const ta = parseTimestampMs(a.playedAt);
    const tb = parseTimestampMs(b.playedAt);
    if (tb !== ta) {
      return tb - ta;
    }
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

function parseLocalMatchesJson(raw: string): MatchRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const byId = new Map<string, MatchRecord>();
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!isValidLocalMatchRecord(entry)) {
      continue;
    }
    const existing = byId.get(entry.id);
    if (!existing || parseTimestampMs(entry.playedAt) >= parseTimestampMs(existing.playedAt)) {
      byId.set(entry.id, entry);
    }
  }

  return sortRecordsNewestFirst(Array.from(byId.values())).slice(0, MAX_LOCAL_MATCHES);
}

export interface ReadLocalMatchesResult {
  /** `true` when storage was accessible and readable; `false` under SSR or Private Mode SecurityError */
  ok: boolean;
  matches: MatchRecord[];
}

/**
 * Reads `wallgo.localMatches` while distinguishing blocked/unavailable storage (`ok: false`)
 * from an accessible empty store (`ok: true, matches: []`) so UI state can preserve in-memory
 * matches when Safari Private Mode blocks `localStorage`.
 */
export function readLocalMatchesSafe(
  storage?: Storage | null,
): ReadLocalMatchesResult {
  const target = storage === undefined ? getBrowserStorage() : storage;
  if (!target) {
    return { ok: false, matches: [] };
  }
  let raw: string | null;
  try {
    raw = target.getItem(STORAGE_KEY_LOCAL_MATCHES);
  } catch {
    return { ok: false, matches: [] };
  }
  if (!raw) {
    return { ok: true, matches: [] };
  }
  return { ok: true, matches: parseLocalMatchesJson(raw) };
}

/**
 * Loads all valid local match records from `wallgo.localMatches`, sorted newest-first
 * and capped at `MAX_LOCAL_MATCHES` (100). Corrupt JSON or invalid items never throw.
 */
export function loadLocalMatches(storage?: Storage | null): MatchRecord[] {
  return readLocalMatchesSafe(storage).matches;
}

/**
 * Idempotently inserts or replaces a `MatchRecord` by `record.id`, sorted newest-first,
 * capped at `MAX_LOCAL_MATCHES` (100). On `QuotaExceededError`, evicts the oldest 25%
 * of matches and retries until persistence succeeds; on `SecurityError`, returns the
 * updated in-memory list without throwing.
 */
export function upsertLocalMatch(
  record: MatchRecord,
  storage?: Storage | null,
): MatchRecord[] {
  const existing = loadLocalMatches(storage);
  const filtered = existing.filter((m) => m.id !== record.id);
  const nextRecords = sortRecordsNewestFirst([record, ...filtered]).slice(
    0,
    MAX_LOCAL_MATCHES,
  );

  let candidate = nextRecords;
  while (candidate.length > 0) {
    const res = safeSetItem(
      STORAGE_KEY_LOCAL_MATCHES,
      JSON.stringify(candidate),
      storage,
    );
    if (res.ok) {
      return candidate;
    }
    if (!res.quotaExceeded) {
      // Private Mode SecurityError or missing storage: return updated in-memory list cleanly.
      return nextRecords;
    }
    if (candidate.length === 1) {
      break;
    }
    const evictCount = Math.max(1, Math.ceil(candidate.length * 0.25));
    candidate = candidate.slice(0, candidate.length - evictCount);
  }

  return nextRecords;
}

export interface BuildLocalMatchRecordParams {
  id: string;
  finalState: GameState;
  initialConfig: ReplayInitialConfig;
  steps: readonly ReplayStep[];
  playedAt?: string;
}

/**
 * Builds a complete, schema-v1 local `MatchRecord` from a finished `GameState`
 * and its lockstep replay steps.
 */
export function buildLocalMatchRecord(
  params: BuildLocalMatchRecordParams,
): MatchRecord {
  const { id, finalState, initialConfig, steps, playedAt } = params;
  const replay = extractReplayFromHistory(initialConfig, steps);
  const players = buildMatchPlayerSummaries(finalState);
  const finalBoard = extractMatchFinalBoard(finalState);
  const endReason = finalState.territory.endReason ?? 'all_separated';

  return {
    id,
    schemaVersion: 1,
    mode: 'local',
    playedAt: playedAt ?? new Date().toISOString(),
    ruleVariant: finalState.ruleVariant,
    format: finalState.format,
    isPrisonMatchRound2: finalState.isPrisonMatchRound2,
    timerSeconds: finalState.timerSeconds,
    endReason,
    totalTurns: finalState.turnNumber,
    totalSteps: replay.steps.length,
    players,
    finalBoard,
    hasReplay: true,
    replay,
  };
}

// ============================================================================
// Atomic Lockstep LocalGameSession Helpers
// Invariant: `session.replay.past.length === session.history.past.length`
//        AND `session.replay.future.length === session.history.future.length`
// ============================================================================

export interface LocalReplayHistory {
  past: ReplayStep[];
  future: ReplayStep[];
}

export interface LocalGameSession {
  matchId: string;
  initialConfig: ReplayInitialConfig;
  history: GameHistoryState;
  replay: LocalReplayHistory;
}

export function createLocalGameSession(
  initialState: GameState,
  matchId?: string,
): LocalGameSession {
  return {
    matchId: matchId ?? generateLocalMatchId(),
    initialConfig: createReplayInitialConfig(initialState),
    history: createHistory(initialState),
    replay: {
      past: [],
      future: [],
    },
  };
}

export function updateLocalSessionTransient(
  session: LocalGameSession,
  nextState: GameState,
): LocalGameSession {
  const nextHistory = updatePresentTransient(session.history, nextState);
  if (nextHistory === session.history) {
    return session;
  }
  return {
    ...session,
    history: nextHistory,
  };
}

export function commitLocalSessionTurn(
  session: LocalGameSession,
  nextState: GameState,
  explicitEvent?: ActionEvent | null,
): LocalGameSession {
  const nextHistory = commitTurnSnapshot(session.history, nextState);
  if (nextHistory === session.history) {
    return session;
  }
  const event = explicitEvent ?? nextState.lastActionEvent;
  if (event === null) {
    return {
      ...session,
      history: nextHistory,
    };
  }
  const nextStep = actionEventToReplayStep(event, session.replay.past.length + 1);
  return {
    ...session,
    history: nextHistory,
    replay: {
      past: [...session.replay.past, nextStep],
      future: [],
    },
  };
}

export function undoLocalSession(session: LocalGameSession): LocalGameSession {
  const nextHistory = smartUndo(session.history);
  if (nextHistory === session.history) {
    return session;
  }
  const targetLen = nextHistory.past.length;
  if (targetLen === session.history.past.length) {
    // Dirty intra-turn rollback: past snapshots unchanged, replay history untouched.
    return {
      ...session,
      history: nextHistory,
    };
  }
  const popped = session.replay.past.slice(targetLen);
  return {
    ...session,
    history: nextHistory,
    replay: {
      past: session.replay.past.slice(0, targetLen),
      future: [...popped, ...session.replay.future],
    },
  };
}

export function redoLocalSession(session: LocalGameSession): LocalGameSession {
  const nextHistory = smartRedo(session.history);
  if (nextHistory === session.history) {
    return session;
  }
  const delta = nextHistory.past.length - session.history.past.length;
  if (delta <= 0) {
    return {
      ...session,
      history: nextHistory,
    };
  }
  const restored = session.replay.future.slice(0, delta);
  return {
    ...session,
    history: nextHistory,
    replay: {
      past: [...session.replay.past, ...restored],
      future: session.replay.future.slice(delta),
    },
  };
}
