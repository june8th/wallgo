import { describe, expect, it } from 'vitest';
import { applyBotTurnAction, chooseAiPlacement, chooseAiTurn } from '../../ai';
import {
  cancelTurnMove,
  createInitialGameState,
  createPrisonMatchRound2State,
  getLegalWallPlacements,
  getPieceValidMoves,
  getSelectablePieceIds,
  movePiece,
  placeInitialPiece,
  placeWall,
  resolveTurnTimeout,
  selectPiece,
} from '../../engine';
import type { GameState } from '../../engine';
import {
  MAX_LOCAL_MATCHES,
  STORAGE_KEY_LOCAL_MATCHES,
  buildReplayFrames,
  createReplayInitialConfig,
} from '../../shared';
import type { MatchRecord } from '../../shared';
import {
  buildLocalMatchRecord,
  commitLocalSessionTurn,
  createLocalGameSession,
  loadLocalMatches,
  redoLocalSession,
  undoLocalSession,
  updateLocalSessionTransient,
  upsertLocalMatch,
} from '../localHistory';
import type { LocalGameSession } from '../localHistory';

function createMockStorage(
  initial: Record<string, string> = {},
  options?: { maxChars?: number; throwSecurityError?: boolean },
): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      if (options?.throwSecurityError) {
        throw new DOMException('Blocked', 'SecurityError');
      }
      store.clear();
    },
    getItem(key: string) {
      if (options?.throwSecurityError) {
        throw new DOMException('Blocked', 'SecurityError');
      }
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      if (options?.throwSecurityError) {
        throw new DOMException('Blocked', 'SecurityError');
      }
      store.delete(key);
    },
    setItem(key: string, value: string) {
      if (options?.throwSecurityError) {
        throw new DOMException('Blocked', 'SecurityError');
      }
      const str = String(value);
      if (options?.maxChars !== undefined && str.length > options.maxChars) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      store.set(key, str);
    },
  };
}

function makeDummyRecord(id: string, playedAt: string): MatchRecord {
  const initial = createInitialGameState({
    ruleVariant: 'wallgo1',
    format: '2p',
    players: [
      { name: 'Alice', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
      { name: 'Bob', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
    ],
    shuffleOrder: false,
    timerSeconds: 0,
  });
  return {
    id,
    schemaVersion: 1,
    mode: 'local',
    playedAt,
    ruleVariant: 'wallgo1',
    format: '2p',
    isPrisonMatchRound2: false,
    timerSeconds: 0,
    endReason: 'all_separated',
    totalTurns: 4,
    totalSteps: 0,
    players: [
      {
        playerId: 0,
        name: 'Alice',
        colorToken: 'p1',
        isAI: false,
        aiDifficulty: 'normal',
        totalTerritory: 25,
        largestSingleTerritory: 25,
        securedRegions: [25],
        deadlockPieceCount: 0,
        rank: 1,
        isWinner: true,
        isDraw: false,
      },
      {
        playerId: 1,
        name: 'Bob',
        colorToken: 'p2',
        isAI: false,
        aiDifficulty: 'normal',
        totalTerritory: 24,
        largestSingleTerritory: 24,
        securedRegions: [24],
        deadlockPieceCount: 0,
        rank: 2,
        isWinner: false,
        isDraw: false,
      },
    ],
    finalBoard: {
      pieces: initial.pieces,
      walls: initial.walls,
      lastPlacedWall: null,
    },
    hasReplay: true,
    replay: {
      schemaVersion: 1,
      initialConfig: createReplayInitialConfig(initial),
      steps: [],
    },
  };
}

function assertLockstep(session: LocalGameSession): void {
  expect(session.replay.past.length).toBe(session.history.past.length);
  expect(session.replay.future.length).toBe(session.history.future.length);
}

function finishSessionWithAi(startSession: LocalGameSession, maxSteps = 200): LocalGameSession {
  let session = startSession;
  let steps = 0;
  while (session.history.present.phase !== 'game_over' && steps < maxSteps) {
    const cur = session.history.present;
    if (cur.phase === 'placement') {
      const p = chooseAiPlacement(cur, 'easy');
      const next = placeInitialPiece(cur, { row: p.row, col: p.col }, p.kind);
      session = commitLocalSessionTurn(session, next);
    } else {
      const act = chooseAiTurn(cur, 'easy');
      const next = applyBotTurnAction(cur, act);
      session = commitLocalSessionTurn(session, next);
    }
    assertLockstep(session);
    steps += 1;
  }
  expect(session.history.present.phase).toBe('game_over');
  return session;
}

describe('local match history storage (wallgo.localMatches)', () => {
  it('handles empty, corrupt JSON, non-array JSON, and partial malformed entries cleanly', () => {
    expect(loadLocalMatches(createMockStorage())).toEqual([]);
    expect(
      loadLocalMatches(createMockStorage({ [STORAGE_KEY_LOCAL_MATCHES]: '{corrupt' })),
    ).toEqual([]);
    expect(
      loadLocalMatches(createMockStorage({ [STORAGE_KEY_LOCAL_MATCHES]: '{}' })),
    ).toEqual([]);

    const older = makeDummyRecord('local_old', '2026-11-20T01:00:00.000Z');
    const newer = makeDummyRecord('local_new', '2026-11-20T05:00:00.000Z');
    const mixed = createMockStorage({
      [STORAGE_KEY_LOCAL_MATCHES]: JSON.stringify([
        older,
        null,
        { id: 'bad_1', mode: 'online' },
        { id: 'bad_2', mode: 'local', schemaVersion: 2 },
        newer,
      ]),
    });

    const loaded = loadLocalMatches(mixed);
    expect(loaded.map((m) => m.id)).toEqual(['local_new', 'local_old']);
  });

  it('upserts idempotently by match ID and caps strictly at MAX_LOCAL_MATCHES (100)', () => {
    const storage = createMockStorage();
    const r1 = makeDummyRecord('local_same', '2026-11-20T01:00:00.000Z');
    upsertLocalMatch(r1, storage);
    const r1Updated = {
      ...makeDummyRecord('local_same', '2026-11-20T02:00:00.000Z'),
      totalTurns: 99,
    };
    const afterUpdate = upsertLocalMatch(r1Updated, storage);
    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0].totalTurns).toBe(99);

    for (let i = 0; i < 105; i++) {
      const ts = new Date(Date.UTC(2026, 10, 20, 3, i)).toISOString();
      upsertLocalMatch(makeDummyRecord(`local_cap_${i}`, ts), storage);
    }
    const capped = loadLocalMatches(storage);
    expect(capped).toHaveLength(MAX_LOCAL_MATCHES);
    expect(capped[0].id).toBe('local_cap_104');
    expect(capped[99].id).toBe('local_cap_5');
  });

  it('evicts oldest 25% on QuotaExceededError and retries cleanly', () => {
    const sample = makeDummyRecord('local_q_0', '2026-11-20T00:00:00.000Z');
    const singleSize = JSON.stringify([sample]).length;
    // Allow 6 records, reject 8 records
    const budget = Math.floor(singleSize * 6.4);
    const seed = Array.from({ length: 7 }, (_, i) =>
      makeDummyRecord(`local_q_${i}`, new Date(Date.UTC(2026, 10, 20, i)).toISOString()),
    );
    // Start by storing 6 records cleanly under budget, then force 7->8 eviction with an exact budget
    const storage = createMockStorage(
      { [STORAGE_KEY_LOCAL_MATCHES]: JSON.stringify(seed) },
      { maxChars: budget },
    );

    const newest = makeDummyRecord(
      'local_q_7',
      new Date(Date.UTC(2026, 10, 20, 7)).toISOString(),
    );
    const persisted = upsertLocalMatch(newest, storage);
    // 8 candidates failed -> evicted Math.ceil(8 * 0.25) = 2 oldest -> 6 retained!
    expect(persisted).toHaveLength(6);
    expect(persisted[0].id).toBe('local_q_7');
    expect(persisted.map((r) => r.id)).not.toContain('local_q_0');
    expect(persisted.map((r) => r.id)).not.toContain('local_q_1');
    expect(loadLocalMatches(storage)).toHaveLength(6);
  });

  it('does not throw under Private Mode SecurityError', () => {
    const blocked = createMockStorage({}, { throwSecurityError: true });
    const record = makeDummyRecord('local_pm', '2026-11-20T01:00:00.000Z');
    expect(() => loadLocalMatches(blocked)).not.toThrow();
    const res = upsertLocalMatch(record, blocked);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('local_pm');
  });
});

describe('LocalGameSession lockstep & end-to-end buildReplayFrames parity', () => {
  it('maintains strict lockstep across shuffle, cancel, dirty-undo, mixed-AI undo/redo, timeout, and undo-from-game_over', () => {
    const storage = createMockStorage();
    const initial = createInitialGameState(
      {
        ruleVariant: 'wallgo1',
        format: '3p',
        players: [
          { name: 'Human', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
          { name: 'BotA', colorToken: 'p2', isAI: true, aiDifficulty: 'easy' },
          { name: 'BotB', colorToken: 'p3', isAI: true, aiDifficulty: 'easy' },
        ],
        shuffleOrder: true,
        timerSeconds: 60,
      },
      () => 0.37,
    );

    let session = createLocalGameSession(initial);
    assertLockstep(session);

    // Complete all 6 initial placements
    while (session.history.present.phase === 'placement') {
      const cur = session.history.present;
      const p = chooseAiPlacement(cur, 'easy');
      const next = placeInitialPiece(cur, { row: p.row, col: p.col }, p.kind);
      session = commitLocalSessionTurn(session, next);
      assertLockstep(session);
    }

    // Advance until human turn
    while (
      session.history.present.phase !== 'game_over' &&
      session.history.present.players[session.history.present.currentPlayerIndex].isAI
    ) {
      const cur = session.history.present;
      const act = chooseAiTurn(cur, 'easy');
      session = commitLocalSessionTurn(session, applyBotTurnAction(cur, act));
      assertLockstep(session);
    }

    // Perform intra-turn select -> move -> cancelTurnMove (transient only)
    if (session.history.present.phase === 'select_piece') {
      const cur = session.history.present;
      const selectableIds = getSelectablePieceIds(cur);
      const selected = selectPiece(cur, selectableIds[0]);
      session = updateLocalSessionTransient(session, selected);
      assertLockstep(session);

      const moves = getPieceValidMoves(session.history.present, selectableIds[0]);
      const moved = movePiece(session.history.present, { row: moves[0].row, col: moves[0].col });
      session = updateLocalSessionTransient(session, moved);
      assertLockstep(session);

      // Dirty-turn undo rolls back move without touching replay.past
      const pastLenBeforeDirtyUndo = session.replay.past.length;
      session = undoLocalSession(session);
      expect(session.replay.past.length).toBe(pastLenBeforeDirtyUndo);
      assertLockstep(session);

      // Re-move and cancelTurnMove explicitly
      const reselected = selectPiece(session.history.present, selectableIds[0]);
      const removed = movePiece(reselected, { row: moves[0].row, col: moves[0].col });
      session = updateLocalSessionTransient(session, removed);
      session = updateLocalSessionTransient(session, cancelTurnMove(session.history.present));
      assertLockstep(session);

      // Now commit a real human turn (move + placeWall)
      const s2 = selectPiece(session.history.present, selectableIds[0]);
      const destPos = { row: moves[0].row, col: moves[0].col };
      const m2 = movePiece(s2, destPos);
      const walls = getLegalWallPlacements(m2, destPos);
      const committed = placeWall(m2, walls[0]);
      session = commitLocalSessionTurn(session, committed);
      assertLockstep(session);
    }

    // Execute one resolveTurnTimeout step
    if (session.history.present.phase !== 'game_over') {
      const { state: timedOut, event } = resolveTurnTimeout(
        session.history.present,
        () => 0.12,
      );
      expect(event?.timedOut).toBe(true);
      session = commitLocalSessionTurn(session, timedOut, event);
      assertLockstep(session);
    }

    // Undo and Redo across mixed human/AI commits
    const lenBeforeUndo = session.replay.past.length;
    session = undoLocalSession(session);
    assertLockstep(session);
    expect(session.replay.past.length).toBeLessThan(lenBeforeUndo);
    expect(session.replay.future.length).toBeGreaterThan(0);

    session = redoLocalSession(session);
    assertLockstep(session);
    expect(session.replay.past.length).toBe(lenBeforeUndo);
    expect(session.replay.future.length).toBe(0);

    // Finish match & save initial game_over record
    session = finishSessionWithAi(session);
    const firstRecord = buildLocalMatchRecord({
      id: session.matchId,
      finalState: session.history.present,
      initialConfig: session.initialConfig,
      steps: session.replay.past,
      playedAt: '2026-11-20T12:00:00.000Z',
    });
    upsertLocalMatch(firstRecord, storage);
    expect(loadLocalMatches(storage)).toHaveLength(1);

    // Undo out of game_over and finish again under the SAME matchId -> idempotent in-place update!
    session = undoLocalSession(session);
    assertLockstep(session);
    expect(session.history.present.phase).not.toBe('game_over');
    session = finishSessionWithAi(session);
    const secondRecord = buildLocalMatchRecord({
      id: session.matchId,
      finalState: session.history.present,
      initialConfig: session.initialConfig,
      steps: session.replay.past,
      playedAt: '2026-11-20T12:01:00.000Z',
    });
    upsertLocalMatch(secondRecord, storage);

    const storedList = loadLocalMatches(storage);
    expect(storedList).toHaveLength(1);
    const stored = storedList[0];

    // Verify deterministic buildReplayFrames exact parity with final GameState
    const frames = buildReplayFrames(stored.replay);
    expect(frames).toHaveLength(stored.replay.steps.length + 1);
    const finalFrameState: GameState = frames[frames.length - 1].state;
    expect(finalFrameState.phase).toBe('game_over');
    expect(finalFrameState.pieces).toEqual(session.history.present.pieces);
    expect(finalFrameState.walls).toEqual(session.history.present.walls);
    expect(finalFrameState.lastPlacedWall).toEqual(session.history.present.lastPlacedWall);
    expect(finalFrameState.territory.scores).toEqual(
      session.history.present.territory.scores,
    );

    // Also verify Prison Match Round 2 preserves fixed diagonal pieces at Step 0
    const round2Initial = createPrisonMatchRound2State(session.history.present);
    let r2Session = createLocalGameSession(round2Initial);
    r2Session = finishSessionWithAi(r2Session);
    const r2Record = buildLocalMatchRecord({
      id: r2Session.matchId,
      finalState: r2Session.history.present,
      initialConfig: r2Session.initialConfig,
      steps: r2Session.replay.past,
    });
    const r2Frames = buildReplayFrames(r2Record.replay);
    expect(r2Record.isPrisonMatchRound2).toBe(true);
    expect(r2Frames[0].state.isPrisonMatchRound2).toBe(true);
    expect(r2Frames[0].state.pieces).toHaveLength(4);
    expect(r2Frames[r2Frames.length - 1].state.pieces).toEqual(
      r2Session.history.present.pieces,
    );
    expect(r2Frames[r2Frames.length - 1].state.walls).toEqual(
      r2Session.history.present.walls,
    );
  });
});
