import { describe, expect, it } from 'vitest';
import {
  analyzeTerritory,
  breakWallAt,
  canSmartRedo,
  canSmartUndo,
  commitTurnSnapshot,
  createFreshTurnSubState,
  createHistory,
  createInitialGameState,
  isDirtyIntraTurn,
  movePiece,
  placeWall,
  selectPiece,
  smartRedo,
  smartUndo,
  toggleWallBreak,
  updatePresentTransient,
  wallKey,
} from '../index';
import type {
  GameState,
  Piece,
  PlacedWall,
  PlayerConfig,
  WallKey,
} from '../index';

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === 'object') {
    Object.freeze(obj);
    for (const value of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(value);
    }
  }
  return obj;
}

function makeWalls(entries: PlacedWall[]): Record<WallKey, PlacedWall> {
  const record: Record<WallKey, PlacedWall> = {};
  for (const w of entries) {
    record[wallKey(w)] = { ...w };
  }
  return record;
}

function buildPlayState(opts: {
  players: PlayerConfig[];
  pieces: Piece[];
  walls?: PlacedWall[];
  currentPlayerIndex?: number;
  wallBreaks?: number[];
}): GameState {
  const format = opts.players.length === 3 ? '3p' : '2p';
  const base = createInitialGameState({
    ruleVariant: 'wallgo1',
    format,
    players: opts.players,
    shuffleOrder: false,
    timerSeconds: 0,
  });
  const players = base.players.map((pl, idx) => ({
    ...pl,
    wallBreaksRemaining:
      opts.wallBreaks !== undefined ? opts.wallBreaks[idx] : pl.wallBreaksRemaining,
  }));
  const draft: GameState = {
    ...base,
    players,
    pieces: opts.pieces.map((p) => ({ ...p })),
    walls: makeWalls(opts.walls ?? []),
    phase: 'select_piece',
    placementStep: base.placementQueue.length,
    currentPlayerIndex: opts.currentPlayerIndex ?? 0,
    turnSubState: createFreshTurnSubState('square'),
  };
  return {
    ...draft,
    territory: analyzeTerritory(draft),
  };
}

function playStayAndWall(
  state: GameState,
  pieceId: string,
  wall: { orientation: 'h' | 'v'; row: number; col: number },
): GameState {
  const piece = state.pieces.find((p) => p.id === pieceId)!;
  const s1 = selectPiece(state, pieceId);
  const s2 = movePiece(s1, { row: piece.row, col: piece.col });
  return placeWall(s2, wall);
}

describe('Smart Undo / Redo History Manager (F20 & E26)', () => {
  describe('E26(a): Dirty-turn-first rollback without popping past or mutating future', () => {
    it('rolls back uncommitted piece move (place_wall) to clean select_piece without popping previous turn', () => {
      const s0 = buildPlayState({
        players: [
          { name: '민수', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
          { name: '지연', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
          { name: '현우', colorToken: 'p3', isAI: false, aiDifficulty: 'normal' },
        ],
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 2, col: 2 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 2, col: 5 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 5, col: 5 },
        ],
      });

      let hist = createHistory(s0);
      expect(canSmartUndo(hist)).toBe(false);

      // P0 moves piece transiently (dirty even with empty past!)
      const p0Selected = selectPiece(s0, 'p0_0');
      hist = updatePresentTransient(hist, p0Selected);
      expect(isDirtyIntraTurn(hist.present)).toBe(false);
      expect(canSmartUndo(hist)).toBe(false);

      const p0Moved = movePiece(p0Selected, { row: 2, col: 3 });
      hist = updatePresentTransient(hist, p0Moved);
      expect(isDirtyIntraTurn(hist.present)).toBe(true);
      expect(canSmartUndo(hist)).toBe(true);

      // Undo rolls back to clean select_piece (s0) with empty past untouched
      const rolledBack = smartUndo(hist);
      expect(rolledBack.present).toBe(s0);
      expect(rolledBack.present.phase).toBe('select_piece');
      expect(rolledBack.past).toHaveLength(0);
      expect(rolledBack.future).toHaveLength(0);
      expect(canSmartUndo(rolledBack)).toBe(false);

      // Now commit Turn 0 cleanly (even though present is dirty place_wall at commit time!)
      hist = updatePresentTransient(rolledBack, p0Selected);
      hist = updatePresentTransient(hist, p0Moved);
      const s1 = placeWall(p0Moved, { orientation: 'v', row: 2, col: 3 });
      hist = commitTurnSnapshot(hist, s1);

      // Past MUST contain clean turn-entry s0 (select_piece), NOT dirty p0Moved (place_wall)!
      expect(hist.past).toHaveLength(1);
      expect(hist.past[0].state).toBe(s0);
      expect(hist.past[0].state.phase).toBe('select_piece');
      expect(hist.present).toBe(s1);
      expect(hist.future).toHaveLength(0);

      // P1 moves piece (dirty), then Undo rolls back to s1 WITHOUT popping s0!
      const p1Moved = movePiece(selectPiece(s1, 'p1_0'), { row: 2, col: 4 });
      hist = updatePresentTransient(hist, p1Moved);
      const undo1 = smartUndo(hist);
      expect(undo1.present).toBe(s1);
      expect(undo1.present.phase).toBe('select_piece');
      expect(undo1.past).toHaveLength(1);
      expect(undo1.past[0].state).toBe(s0);
      expect(undo1.future).toHaveLength(0);

      // Second Undo (now clean) pops s0 from past and moves s1 to future
      const undo2 = smartUndo(undo1);
      expect(undo2.present).toBe(s0);
      expect(undo2.past).toHaveLength(0);
      expect(undo2.future).toHaveLength(1);
      expect(undo2.future[0].state).toBe(s1);
    });

    it('rolls back dirty Wall Go I post-break state (including seeded dirty history) restoring opponent wall ownerId & charge', () => {
      const s0 = buildPlayState({
        players: [
          { name: '민수', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
          { name: '지연', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
          { name: '현우', colorToken: 'p3', isAI: false, aiDifficulty: 'normal' },
        ],
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        walls: [{ orientation: 'v', row: 3, col: 3, ownerId: 1 }],
        wallBreaks: [1, 1, 1],
      });

      const broken = breakWallAt(toggleWallBreak(selectPiece(s0, 'p0_0')), {
        orientation: 'v',
        row: 3,
        col: 3,
      });
      expect(isDirtyIntraTurn(broken)).toBe(true);

      // Seed history directly with dirty post-break state
      const seededHist = createHistory(broken);
      expect(canSmartUndo(seededHist)).toBe(true);
      const undone = smartUndo(seededHist);
      expect(undone.present.phase).toBe('select_piece');
      expect(undone.present.players[0].wallBreaksRemaining).toBe(1);
      expect(undone.present.walls['v:3:3']).toEqual({
        orientation: 'v',
        row: 3,
        col: 3,
        ownerId: 1,
      });
      expect(undone.present.turnSubState.brokenWallBeforeMove).toBeNull();
    });
  });

  describe('E26(b): Mixed Human+AI Smart Undo & Symmetric Redo', () => {
    it('skips AI turns symmetrically across H -> AI1 -> AI2 -> H and handles mid-AI-think undo/redo', () => {
      const s0 = buildPlayState({
        players: [
          { name: '민수', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
          { name: 'AI 1', colorToken: 'p2', isAI: true, aiDifficulty: 'normal' },
          { name: 'AI 2', colorToken: 'p3', isAI: true, aiDifficulty: 'hard' },
        ],
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 1, col: 1 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 3, col: 3 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 5, col: 5 },
        ],
      });

      let hist = createHistory(s0);

      // H0 finishes turn -> AI1 thinking (mid-450ms delay)
      const s1 = playStayAndWall(s0, 'p0_0', { orientation: 'h', row: 1, col: 1 });
      hist = commitTurnSnapshot(hist, s1);
      expect(hist.present.currentPlayerIndex).toBe(1);

      // Mid-AI-think Undo restores H0's turn start (s0)
      const midUndo = smartUndo(hist);
      expect(midUndo.present).toBe(s0);
      expect(midUndo.past).toHaveLength(0);
      expect(midUndo.future).toHaveLength(1);
      expect(midUndo.future[0].actorIsAI).toBe(true);

      // Mid-AI-think Redo restores AI1 turn (s1) cleanly
      expect(canSmartRedo(midUndo)).toBe(true);
      const midRedo = smartRedo(midUndo);
      expect(midRedo.present).toBe(s1);
      expect(midRedo.past).toHaveLength(1);
      expect(midRedo.future).toHaveLength(0);

      // AI1 and AI2 both complete their turns -> back to H0 (s3)
      const s2 = playStayAndWall(s1, 'p1_0', { orientation: 'h', row: 3, col: 3 });
      hist = commitTurnSnapshot(midRedo, s2);
      const s3 = playStayAndWall(s2, 'p2_0', { orientation: 'h', row: 5, col: 5 });
      hist = commitTurnSnapshot(hist, s3);

      expect(hist.present).toBe(s3);
      expect(hist.past.map((snap) => snap.actorIsAI)).toEqual([false, true, true]);

      // Single smartUndo skips AI2 & AI1 straight back to s0 (Human)
      const afterSmartUndo = smartUndo(hist);
      expect(afterSmartUndo.present).toBe(s0);
      expect(afterSmartUndo.past).toHaveLength(0);
      expect(afterSmartUndo.future.map((snap) => snap.state)).toEqual([s1, s2, s3]);

      // Single smartRedo skips AI1 & AI2 straight back to s3 (exact inverse!)
      const afterSmartRedo = smartRedo(afterSmartUndo);
      expect(afterSmartRedo.present).toBe(s3);
      expect(afterSmartRedo.past.map((snap) => snap.state)).toEqual([s0, s1, s2]);
      expect(afterSmartRedo.future).toHaveLength(0);
    });

    it('handles 2-Human + 1-AI (skipping only AI2) and AI-first mixed mode (disabling undo past first human turn)', () => {
      // 2-Human + 1-AI: H0 -> H1 -> AI2 -> H0
      const twoHumanStart = buildPlayState({
        players: [
          { name: '민수', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
          { name: '지연', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
          { name: 'AI 2', colorToken: 'p3', isAI: true, aiDifficulty: 'normal' },
        ],
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 1, col: 1 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 3, col: 3 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 5, col: 5 },
        ],
      });
      const h1Turn = playStayAndWall(twoHumanStart, 'p0_0', { orientation: 'h', row: 1, col: 1 });
      const ai2Turn = playStayAndWall(h1Turn, 'p1_0', { orientation: 'h', row: 3, col: 3 });
      const h0Again = playStayAndWall(ai2Turn, 'p2_0', { orientation: 'h', row: 5, col: 5 });

      let hist2H = createHistory(twoHumanStart);
      hist2H = commitTurnSnapshot(hist2H, h1Turn);
      hist2H = commitTurnSnapshot(hist2H, ai2Turn);
      hist2H = commitTurnSnapshot(hist2H, h0Again);

      // Undo from H0 skips AI2 and lands on H1 (not H0!)
      const backToH1 = smartUndo(hist2H);
      expect(backToH1.present).toBe(h1Turn);
      // Next undo lands on H0
      const backToH0 = smartUndo(backToH1);
      expect(backToH0.present).toBe(twoHumanStart);

      // AI-first mixed mode: P0=AI, P1=Human
      const aiFirst0 = buildPlayState({
        players: [
          { name: 'AI 0', colorToken: 'p1', isAI: true, aiDifficulty: 'normal' },
          { name: '민수', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
        ],
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 1, col: 1 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
        ],
      });
      const humanFirst = playStayAndWall(aiFirst0, 'p0_0', { orientation: 'h', row: 1, col: 1 });
      let aiFirstHist = commitTurnSnapshot(createHistory(aiFirst0), humanFirst);

      // Clean on Human's first turn with only AI in past -> canSmartUndo MUST be false
      expect(canSmartUndo(aiFirstHist)).toBe(false);
      expect(smartUndo(aiFirstHist)).toBe(aiFirstHist);

      // Once Human moves transiently (dirty), canSmartUndo becomes true and rolls back to clean P1
      const p1Dirty = movePiece(selectPiece(humanFirst, 'p1_0'), { row: 5, col: 4 });
      aiFirstHist = updatePresentTransient(aiFirstHist, p1Dirty);
      expect(canSmartUndo(aiFirstHist)).toBe(true);
      const rolledClean = smartUndo(aiFirstHist);
      expect(rolledClean.present).toBe(humanFirst);
      expect(canSmartUndo(rolledClean)).toBe(false);
    });
  });

  describe('E26(c): Undo from game_over & Symmetric Redo back to game_over', () => {
    it('restores human last decision point before AI winning move and redoes symmetrically to game_over', () => {
      // Build 2P mixed board 1 wall away from separating P0 (Human) and P1 (AI)
      const walls: PlacedWall[] = [];
      for (let row = 0; row < 6; row++) {
        walls.push({ orientation: 'v', row, col: 2, ownerId: 0 });
      }
      // Missing only v(6,2) to split cols 0..2 (P0) from cols 3..6 (P1)
      const sHuman = buildPlayState({
        players: [
          { name: '민수', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
          { name: 'AI 1', colorToken: 'p2', isAI: true, aiDifficulty: 'hard' },
        ],
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 1, col: 1 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 6, col: 3 },
        ],
        walls,
        currentPlayerIndex: 0,
      });

      let hist = createHistory(sHuman);
      // Human makes a non-ending turn
      const sAI = playStayAndWall(sHuman, 'p0_0', { orientation: 'h', row: 1, col: 1 });
      expect(sAI.phase).toBe('select_piece');
      expect(sAI.currentPlayerIndex).toBe(1);
      hist = commitTurnSnapshot(hist, sAI);

      // AI places v(6,2) -> game_over!
      const sGameOver = playStayAndWall(sAI, 'p1_0', { orientation: 'v', row: 6, col: 2 });
      expect(sGameOver.phase).toBe('game_over');
      expect(sGameOver.territory.isGameOver).toBe(true);
      expect(sGameOver.territory.endReason).toBe('all_separated');
      hist = commitTurnSnapshot(hist, sGameOver);

      // Smart Undo from game_over skips AI's winning turn back to Human's decision point (sHuman)
      expect(canSmartUndo(hist)).toBe(true);
      const undone = smartUndo(hist);
      expect(undone.present).toBe(sHuman);
      expect(undone.present.phase).toBe('select_piece');
      expect(undone.future.map((f) => f.state)).toEqual([sAI, sGameOver]);

      // Symmetric Smart Redo restores exact game_over state, scores & lastPlacedWall
      expect(canSmartRedo(undone)).toBe(true);
      const redone = smartRedo(undone);
      expect(redone.present).toBe(sGameOver);
      expect(redone.present.phase).toBe('game_over');
      expect(redone.present.lastPlacedWall).toEqual({ orientation: 'v', row: 6, col: 2 });
      expect(redone.present.territory.scores).toEqual(sGameOver.territory.scores);
      expect(redone.future).toHaveLength(0);
    });
  });

  describe('All-Human, All-AI stepping & strict Object.freeze immutability', () => {
    it('steps 1 snapshot per undo/redo in all-AI mode and never mutates frozen input snapshots', () => {
      const s0 = deepFreeze(
        buildPlayState({
          players: [
            { name: 'AI 1', colorToken: 'p1', isAI: true, aiDifficulty: 'easy' },
            { name: 'AI 2', colorToken: 'p2', isAI: true, aiDifficulty: 'hard' },
          ],
          pieces: [
            { id: 'p0_0', ownerId: 0, kind: 'standard', row: 1, col: 1 },
            { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
          ],
        }),
      );

      const s1 = deepFreeze(playStayAndWall(s0, 'p0_0', { orientation: 'h', row: 1, col: 1 }));
      const s2 = deepFreeze(playStayAndWall(s1, 'p1_0', { orientation: 'h', row: 5, col: 5 }));

      const h0 = deepFreeze(createHistory(s0));
      const h1 = deepFreeze(commitTurnSnapshot(h0, s1));
      const h2 = deepFreeze(commitTurnSnapshot(h1, s2));

      // All-AI steps 1 snapshot at a time
      const u1 = deepFreeze(smartUndo(h2));
      expect(u1.present).toBe(s1);
      const u2 = deepFreeze(smartUndo(u1));
      expect(u2.present).toBe(s0);
      expect(smartUndo(u2)).toBe(u2);

      // Redo steps 1 snapshot at a time
      const r1 = deepFreeze(smartRedo(u2));
      expect(r1.present).toBe(s1);
      const r2 = deepFreeze(smartRedo(r1));
      expect(r2.present).toBe(s2);
      expect(smartRedo(r2)).toBe(r2);

      // New commit after undo clears future
      const altS2 = playStayAndWall(s1, 'p1_0', { orientation: 'v', row: 5, col: 5 });
      const branched = commitTurnSnapshot(u1, altS2);
      expect(branched.future).toHaveLength(0);
      expect(canSmartRedo(branched)).toBe(false);

      // Clean move_piece selection + undo pushes clean turnEntry (select_piece) to future
      const selectedOnS1 = updatePresentTransient(u1, selectPiece(s1, 'p1_0'));
      expect(isDirtyIntraTurn(selectedOnS1.present)).toBe(false);
      const undoneFromSelect = smartUndo(selectedOnS1);
      expect(undoneFromSelect.present).toBe(s0);
      expect(undoneFromSelect.future[0].state).toBe(s1);
      expect(undoneFromSelect.future[0].state.phase).toBe('select_piece');

      // Dirty present + smartRedo pushes clean turnEntry (not dirty place_wall) onto past
      const dirtyOnS0 = updatePresentTransient(
        undoneFromSelect,
        movePiece(selectPiece(s0, 'p0_0'), { row: 1, col: 2 }),
      );
      expect(isDirtyIntraTurn(dirtyOnS0.present)).toBe(true);
      const redoneFromDirty = smartRedo(dirtyOnS0);
      expect(redoneFromDirty.present).toBe(s1);
      expect(redoneFromDirty.past[0].state).toBe(s0);
      expect(redoneFromDirty.past[0].state.phase).toBe('select_piece');
    });
  });
});
