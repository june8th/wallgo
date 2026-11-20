import { describe, expect, it } from 'vitest';
import {
  analyzeTerritory,
  canCancelTurnMove,
  canToggleWallBreak,
  cancelTurnMove,
  confirmWallGo2BreakWall,
  createFreshTurnSubState,
  createInitialGameState,
  getInteractiveWalls,
  getPhaseSubstate,
  getPieceBreakableWalls,
  getPieceValidMoves,
  getRemainingPlacementKinds,
  getWallGo2BreakTargets,
  getWallGo2NormalMoves,
  handleTurnTimeout,
  hasWall,
  movePiece,
  placeInitialPiece,
  placeWall,
  selectPiece,
  selectWallGo2BreakDestination,
  setSelectedPlacementKind,
  toggleWallBreak,
  wallKey,
} from '../index';
import type {
  GameState,
  Piece,
  PlacedWall,
  PlayerConfig,
  WallKey,
} from '../index';

function make3pPlayers(): PlayerConfig[] {
  return [
    { name: '민수', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
    { name: '지연', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
    { name: '현우', colorToken: 'p3', isAI: false, aiDifficulty: 'normal' },
  ];
}

function make2pPlayers(): PlayerConfig[] {
  return [
    { name: '민수', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
    { name: '지연', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
  ];
}

function makeWalls(entries: PlacedWall[]): Record<WallKey, PlacedWall> {
  const record: Record<WallKey, PlacedWall> = {};
  for (const w of entries) {
    record[wallKey(w)] = { ...w };
  }
  return record;
}

function buildWallGo2PlayState(opts: {
  format?: '3p' | '2p';
  pieces: Piece[];
  walls?: PlacedWall[];
  currentPlayerIndex?: number;
  wallBreaks?: number[];
}): GameState {
  const format = opts.format ?? '3p';
  const base = createInitialGameState({
    ruleVariant: 'wallgo2',
    format,
    players: format === '3p' ? make3pPlayers() : make2pPlayers(),
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

describe('Wall Go II — Setup, Square/Round Movement, Path-Through Wall Break & Timeout', () => {
  describe('E03 (F04): Wall Go II 3P piece-kind selection and 2nd-placement auto-assignment', () => {
    it('allows free choice on 1st placement, auto-locks 2nd placement, and rejects duplicate kind', () => {
      let state = createInitialGameState({
        ruleVariant: 'wallgo2',
        format: '3p',
        players: make3pPlayers(),
        shuffleOrder: false,
        timerSeconds: 0,
      });

      expect(getRemainingPlacementKinds(state, 0)).toEqual(['square', 'round']);
      expect(state.turnSubState.selectedPlacementKind).toBe('square');

      // Step 0: P0 selects 'round' via UI picker and places without explicit kind arg
      state = setSelectedPlacementKind(state, 'round');
      expect(state.turnSubState.selectedPlacementKind).toBe('round');
      state = placeInitialPiece(state, { row: 1, col: 1 });
      expect(state.pieces[0]).toMatchObject({ ownerId: 0, kind: 'round', row: 1, col: 1 });
      expect(getRemainingPlacementKinds(state, 0)).toEqual(['square']);

      // Step 1: P1's picker resets to 'square'; P1 places 'square'
      expect(state.currentPlayerIndex).toBe(1);
      expect(state.turnSubState.selectedPlacementKind).toBe('square');
      state = placeInitialPiece(state, { row: 1, col: 5 }, 'square');
      expect(state.pieces[1]).toMatchObject({ ownerId: 1, kind: 'square' });

      // Step 2: P2 places 'square'
      expect(state.currentPlayerIndex).toBe(2);
      state = placeInitialPiece(state, { row: 5, col: 1 }, 'square');

      // Step 3 (snake back-to-back): P2 auto-locked to 'round'
      expect(state.currentPlayerIndex).toBe(2);
      expect(getRemainingPlacementKinds(state, 2)).toEqual(['round']);
      expect(state.turnSubState.selectedPlacementKind).toBe('round');
      expect(setSelectedPlacementKind(state, 'square')).toBe(state);
      expect(placeInitialPiece(state, { row: 5, col: 5 }, 'square')).toBe(state);
      expect(placeInitialPiece(state, { row: 5, col: 5 }, 'standard')).toBe(state);
      state = placeInitialPiece(state, { row: 5, col: 5 });
      expect(state.pieces[3]).toMatchObject({ ownerId: 2, kind: 'round' });

      // Step 4: P1 auto-locked to 'round'
      expect(state.currentPlayerIndex).toBe(1);
      expect(state.turnSubState.selectedPlacementKind).toBe('round');
      state = placeInitialPiece(state, { row: 3, col: 5 });
      expect(state.pieces[4]).toMatchObject({ ownerId: 1, kind: 'round' });

      // Step 5: P0 (who placed 'round' at step 0) auto-locked to 'square' and rejects 'round'
      expect(state.currentPlayerIndex).toBe(0);
      expect(getRemainingPlacementKinds(state, 0)).toEqual(['square']);
      expect(state.turnSubState.selectedPlacementKind).toBe('square');
      expect(placeInitialPiece(state, { row: 3, col: 1 }, 'round')).toBe(state);
      state = placeInitialPiece(state, { row: 3, col: 1 });
      expect(state.pieces[5]).toMatchObject({ ownerId: 0, kind: 'square' });

      expect(state.phase).toBe('select_piece');
      expect(state.currentPlayerIndex).toBe(0);
      expect(getRemainingPlacementKinds(state, 0)).toEqual([]);
    });
  });

  describe('E04 (F05): Wall Go II 2P fixed round pieces and square-only snake placement', () => {
    it('pre-places 4 round pieces on fixed diagonals, rejects occupied & round placements, and disables wall break', () => {
      let state = createInitialGameState({
        ruleVariant: 'wallgo2',
        format: '2p',
        players: make2pPlayers(),
        shuffleOrder: false,
        timerSeconds: 0,
      });

      expect(state.pieces).toEqual([
        { id: 'p0_0', ownerId: 0, kind: 'round', row: 1, col: 1 },
        { id: 'p0_1', ownerId: 0, kind: 'round', row: 5, col: 5 },
        { id: 'p1_0', ownerId: 1, kind: 'round', row: 1, col: 5 },
        { id: 'p1_1', ownerId: 1, kind: 'round', row: 5, col: 1 },
      ]);
      expect(state.players.map((p) => p.wallBreaksRemaining)).toEqual([0, 0]);
      expect(getRemainingPlacementKinds(state, 0)).toEqual(['square']);

      // Reject fixed cells and 'round' placement
      expect(placeInitialPiece(state, { row: 1, col: 1 }, 'square')).toBe(state);
      expect(placeInitialPiece(state, { row: 5, col: 1 }, 'square')).toBe(state);
      expect(placeInitialPiece(state, { row: 2, col: 2 }, 'round')).toBe(state);
      expect(setSelectedPlacementKind(state, 'round')).toBe(state);

      // Snake [0, 1, 1, 0] places strictly 'square'
      state = placeInitialPiece(state, { row: 2, col: 2 });
      state = placeInitialPiece(state, { row: 2, col: 4 });
      state = placeInitialPiece(state, { row: 4, col: 4 });
      state = placeInitialPiece(state, { row: 4, col: 2 });

      expect(state.phase).toBe('select_piece');
      const placedSquares = state.pieces.slice(4);
      expect(placedSquares.every((p) => p.kind === 'square')).toBe(true);

      const selected = selectPiece(state, 'p0_0');
      expect(canToggleWallBreak(selected)).toBe(false);
      expect(toggleWallBreak(selected)).toBe(selected);
    });
  });

  describe('E12 (F10, F11): Square vs Round movement rules & strict no-stay invariant', () => {
    it('enforces straight 1-2 only for square and ortho-1 or L-diagonal for round (never 0-step stay)', () => {
      const state = buildWallGo2PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'square', row: 3, col: 3 },
          { id: 'p0_1', ownerId: 0, kind: 'round', row: 3, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        ],
      });

      // Square at center (3,3): exact 8 straight destinations, no diagonals, no origin
      const sqMoves = getWallGo2NormalMoves(state, 'p0_0');
      expect(sqMoves).toEqual([
        { row: 1, col: 3 },
        { row: 2, col: 3 },
        { row: 3, col: 1 },
        { row: 3, col: 2 },
        { row: 3, col: 4 },
        { row: 3, col: 5 },
        { row: 4, col: 3 },
        { row: 5, col: 3 },
      ]);
      expect(sqMoves.some((m) => m.row === 3 && m.col === 3)).toBe(false);
      expect(sqMoves.some((m) => m.row === 4 && m.col === 4)).toBe(false);

      // Move action rejects diagonal & origin on square
      const selSq = selectPiece(state, 'p0_0');
      expect(movePiece(selSq, { row: 3, col: 3 })).toBe(selSq);
      expect(movePiece(selSq, { row: 4, col: 4 })).toBe(selSq);

      // Round at center (3,3): exact 4 ortho-1 + 4 diagonal destinations, no straight-2, no origin
      const roundCenter = buildWallGo2PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'round', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        ],
      });
      const rdMoves = getWallGo2NormalMoves(roundCenter, 'p0_0');
      expect(rdMoves).toEqual([
        { row: 2, col: 2 },
        { row: 2, col: 3 },
        { row: 2, col: 4 },
        { row: 3, col: 2 },
        { row: 3, col: 4 },
        { row: 4, col: 2 },
        { row: 4, col: 3 },
        { row: 4, col: 4 },
      ]);
      expect(rdMoves.some((m) => m.row === 3 && m.col === 3)).toBe(false);
      expect(rdMoves.some((m) => m.row === 3 && m.col === 5)).toBe(false);

      const selRd = selectPiece(roundCenter, 'p0_0');
      expect(movePiece(selRd, { row: 3, col: 5 })).toBe(selRd);
      expect(movePiece(selRd, { row: 3, col: 3 })).toBe(selRd);

      // Piece on intermediate cell blocks 2-step straight (square) and L-path (round)
      const blockedMid = buildWallGo2PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'square', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'round', row: 3, col: 4 },
          { id: 'p2_0', ownerId: 2, kind: 'square', row: 6, col: 6 },
        ],
      });
      expect(
        getWallGo2NormalMoves(blockedMid, 'p0_0').some((m) => m.row === 3 && m.col === 5),
      ).toBe(false);
    });
  });

  describe('E13 (F12): Ambiguous diagonal Wall Go II wall break disambiguation', () => {
    it('enters pendingBreakChoice with both candidate walls, rejects unrelated wall, confirms exact choice, and supports cancel', () => {
      const initial = buildWallGo2PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'round', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        ],
        walls: [
          { orientation: 'v', row: 3, col: 3, ownerId: 1 }, // Path A: (3,3)->(3,4)->(4,4)
          { orientation: 'h', row: 3, col: 3, ownerId: 2 }, // Path B: (3,3)->(4,3)->(4,4)
        ],
        wallBreaks: [1, 1, 1],
      });
      const initialSnapshot = structuredClone(initial);

      const targets = getWallGo2BreakTargets(initial, 'p0_0');
      const diagTarget = targets.find((t) => t.row === 4 && t.col === 4);
      expect(diagTarget).toEqual({
        row: 4,
        col: 4,
        breakableWalls: [
          { orientation: 'h', row: 3, col: 3 },
          { orientation: 'v', row: 3, col: 3 },
        ],
      });
      // 0-step stay NEVER offered even with Wall Break
      expect(targets.some((t) => t.row === 3 && t.col === 3)).toBe(false);

      const selected = selectPiece(initial, 'p0_0');
      const breakMode = toggleWallBreak(selected);
      expect(getPhaseSubstate(breakMode)).toBe('wall_break_move');
      expect(getInteractiveWalls(breakMode)).toEqual([]);

      // Clicking ambiguous diagonal sets pendingBreakChoice
      const choosing = selectWallGo2BreakDestination(breakMode, { row: 4, col: 4 });
      expect(choosing.phase).toBe('move_piece');
      expect(getPhaseSubstate(choosing)).toBe('choose_break_wall');
      expect(choosing.turnSubState.pendingBreakChoice).toEqual({
        destination: { row: 4, col: 4 },
        breakableWalls: [
          { orientation: 'h', row: 3, col: 3 },
          { orientation: 'v', row: 3, col: 3 },
        ],
      });
      expect(getPieceValidMoves(choosing, 'p0_0')).toEqual([]);
      expect(getPieceBreakableWalls(choosing, 'p0_0')).toEqual([
        { orientation: 'h', row: 3, col: 3 },
        { orientation: 'v', row: 3, col: 3 },
      ]);
      expect(getInteractiveWalls(choosing)).toEqual([
        { orientation: 'h', row: 3, col: 3, state: 'breakable-choice' },
        { orientation: 'v', row: 3, col: 3, state: 'breakable-choice' },
      ]);

      // Rejects unrelated wall in confirmWallGo2BreakWall
      expect(
        confirmWallGo2BreakWall(choosing, { orientation: 'h', row: 0, col: 0 }),
      ).toBe(choosing);

      // Toggling Wall Break OFF during choose_break_wall clears pendingBreakChoice cleanly
      const toggledOff = toggleWallBreak(choosing);
      expect(toggledOff.phase).toBe('move_piece');
      expect(toggledOff.turnSubState.wallBreakActive).toBe(false);
      expect(toggledOff.turnSubState.pendingBreakChoice).toBeNull();
      expect(getPhaseSubstate(toggledOff)).toBe('idle');
      expect(getInteractiveWalls(toggledOff)).toEqual([]);

      // Cancel during choose_break_wall clears pendingBreakChoice cleanly
      expect(canCancelTurnMove(choosing)).toBe(true);
      const cancelledChoice = cancelTurnMove(choosing);
      expect(cancelledChoice.phase).toBe('move_piece');
      expect(cancelledChoice.turnSubState.pendingBreakChoice).toBeNull();
      expect(cancelledChoice.turnSubState.wallBreakActive).toBe(false);
      expect(cancelledChoice.players[0].wallBreaksRemaining).toBe(1);

      // Confirm v(3,3): destroys ONLY v(3,3), preserves h(3,3), moves piece to (4,4)
      const confirmed = confirmWallGo2BreakWall(choosing, {
        orientation: 'v',
        row: 3,
        col: 3,
      });
      expect(confirmed.phase).toBe('place_wall');
      expect(confirmed.players[0].wallBreaksRemaining).toBe(0);
      expect(hasWall(confirmed.walls, { orientation: 'v', row: 3, col: 3 })).toBe(false);
      expect(hasWall(confirmed.walls, { orientation: 'h', row: 3, col: 3 })).toBe(true);
      expect(confirmed.pieces.find((p) => p.id === 'p0_0')).toMatchObject({
        row: 4,
        col: 4,
      });
      expect(confirmed.turnSubState.brokenWallBeforeMove).toEqual({
        orientation: 'v',
        row: 3,
        col: 3,
        ownerId: 1,
      });

      // Cancel after confirm restores piece to (3,3), restores v(3,3) with ownerId 1, restores charge
      const cancelledAfter = cancelTurnMove(confirmed);
      expect(cancelledAfter.phase).toBe('move_piece');
      expect(cancelledAfter.pieces.find((p) => p.id === 'p0_0')).toMatchObject({
        row: 3,
        col: 3,
      });
      expect(cancelledAfter.walls['v:3:3']).toEqual({
        orientation: 'v',
        row: 3,
        col: 3,
        ownerId: 1,
      });
      expect(cancelledAfter.players[0].wallBreaksRemaining).toBe(1);

      // Original state untouched
      expect(initial).toEqual(initialSnapshot);
    });
  });

  describe('E14 (F12): Diagonal with 1 open L-path and 1 walled L-path', () => {
    it('moves normally without break when wallBreakActive=false, and deliberately smashes h(3,3) when wallBreakActive=true', () => {
      const state = buildWallGo2PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'round', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        ],
        walls: [{ orientation: 'h', row: 3, col: 3, ownerId: 1 }],
        wallBreaks: [1, 1, 1],
      });

      // Normal mode reaches (4,4) via open Path A without breaking h(3,3)
      expect(
        getWallGo2NormalMoves(state, 'p0_0').some((c) => c.row === 4 && c.col === 4),
      ).toBe(true);
      const normalMoved = movePiece(selectPiece(state, 'p0_0'), { row: 4, col: 4 });
      expect(normalMoved.phase).toBe('place_wall');
      expect(hasWall(normalMoved.walls, { orientation: 'h', row: 3, col: 3 })).toBe(true);
      expect(normalMoved.players[0].wallBreaksRemaining).toBe(1);

      // Wall Break mode STILL offers (4,4) with [h(3,3)] and executes immediately on tap
      const breakTarget = getWallGo2BreakTargets(state, 'p0_0').find(
        (t) => t.row === 4 && t.col === 4,
      );
      expect(breakTarget).toEqual({
        row: 4,
        col: 4,
        breakableWalls: [{ orientation: 'h', row: 3, col: 3 }],
      });

      const breakMode = toggleWallBreak(selectPiece(state, 'p0_0'));
      const validBreakMoves = getPieceValidMoves(breakMode, 'p0_0');
      expect(validBreakMoves.find((m) => m.row === 4 && m.col === 4)).toEqual({
        row: 4,
        col: 4,
        moveType: 'wall-break',
        breakableWalls: [{ orientation: 'h', row: 3, col: 3 }],
      });

      const smashed = selectWallGo2BreakDestination(breakMode, { row: 4, col: 4 });
      expect(smashed.phase).toBe('place_wall');
      expect(hasWall(smashed.walls, { orientation: 'h', row: 3, col: 3 })).toBe(false);
      expect(smashed.players[0].wallBreaksRemaining).toBe(0);
      expect(smashed.pieces.find((p) => p.id === 'p0_0')).toMatchObject({ row: 4, col: 4 });
    });
  });

  describe('E15 (F12) & E10 in Wall Go II: Two-wall path rejection, piece block, and own-wall reseal', () => {
    it('rejects 2-wall paths on square and piece-blocked paths on round, while allowing own-wall break & reseal', () => {
      const squareTwoWalls = buildWallGo2PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'square', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        ],
        walls: [
          { orientation: 'v', row: 3, col: 3, ownerId: 0 }, // own wall
          { orientation: 'v', row: 3, col: 4, ownerId: 1 },
        ],
        wallBreaks: [1, 1, 1],
      });

      const targets = getWallGo2BreakTargets(squareTwoWalls, 'p0_0');
      expect(targets.some((t) => t.row === 3 && t.col === 5)).toBe(false);
      expect(targets.find((t) => t.row === 3 && t.col === 4)).toEqual({
        row: 3,
        col: 4,
        breakableWalls: [{ orientation: 'v', row: 3, col: 3 }],
      });

      // Break own wall v(3,3) stepping to (3,4), then reseal v(3,3) (E10)
      const breakMode = toggleWallBreak(selectPiece(squareTwoWalls, 'p0_0'));
      const moved = selectWallGo2BreakDestination(breakMode, { row: 3, col: 4 });
      expect(moved.phase).toBe('place_wall');
      expect(hasWall(moved.walls, { orientation: 'v', row: 3, col: 3 })).toBe(false);
      const resealed = placeWall(moved, { orientation: 'v', row: 3, col: 3 });
      expect(resealed.phase).toBe('select_piece');
      expect(resealed.walls['v:3:3']).toEqual({
        orientation: 'v',
        row: 3,
        col: 3,
        ownerId: 0,
      });

      // Round piece where Path A has 2 walls and Path B has exact 1 wall h(3,3) PLUS a blocking piece at intermediate (4,3)
      const roundBlocked = buildWallGo2PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'round', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'square', row: 4, col: 3 }, // blocks Path B mid
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        ],
        walls: [
          { orientation: 'v', row: 3, col: 3, ownerId: 1 }, // Path A edge 1
          { orientation: 'h', row: 3, col: 4, ownerId: 2 }, // Path A edge 2
          { orientation: 'h', row: 3, col: 3, ownerId: 1 }, // Path B edge 1 (exact count = 1 wall on Path B)
        ],
        wallBreaks: [1, 1, 1],
      });
      const roundTargets = getWallGo2BreakTargets(roundBlocked, 'p0_0');
      expect(roundTargets.some((t) => t.row === 4 && t.col === 4)).toBe(false);
      expect(roundTargets.some((t) => t.row === 4 && t.col === 3)).toBe(false);

      // Square piece wall-break intermediate-piece occlusion: wall v(3,3) + piece at (3,4) -> empty (3,5) rejected
      const squareMidBlocked = buildWallGo2PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'square', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'round', row: 3, col: 4 },
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        ],
        walls: [{ orientation: 'v', row: 3, col: 3, ownerId: 1 }],
        wallBreaks: [1, 1, 1],
      });
      const squareMidTargets = getWallGo2BreakTargets(squareMidBlocked, 'p0_0');
      expect(squareMidTargets.some((t) => t.row === 3 && t.col === 5)).toBe(false);
      expect(squareMidTargets.some((t) => t.row === 3 && t.col === 4)).toBe(false);
      expect(squareMidTargets).toEqual([]);

      // Negative zero (-0) normalization on selectWallGo2BreakDestination (both 1-wall & 2-wall ambiguous diagonal)
      const wg2NegZero1Wall = buildWallGo2PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'square', row: 0, col: 1 },
          { id: 'p1_0', ownerId: 1, kind: 'square', row: 6, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        ],
        walls: [{ orientation: 'v', row: 0, col: 0, ownerId: 1 }],
        wallBreaks: [1, 1, 1],
      });
      const movedNegZero = selectWallGo2BreakDestination(
        toggleWallBreak(selectPiece(wg2NegZero1Wall, 'p0_0')),
        { row: -0, col: -0 },
      );
      const movedPieceNegZero = movedNegZero.pieces.find((p) => p.id === 'p0_0')!;
      expect(Object.is(movedPieceNegZero.row, -0)).toBe(false);
      expect(Object.is(movedPieceNegZero.col, -0)).toBe(false);
      expect(movedPieceNegZero).toMatchObject({ row: 0, col: 0 });

      const wg2NegZero2Wall = buildWallGo2PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'round', row: 1, col: 1 },
          { id: 'p1_0', ownerId: 1, kind: 'square', row: 6, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        ],
        walls: [
          { orientation: 'h', row: 0, col: 1, ownerId: 1 },
          { orientation: 'v', row: 1, col: 0, ownerId: 2 },
        ],
        wallBreaks: [1, 1, 1],
      });
      const pendingNegZero = selectWallGo2BreakDestination(
        toggleWallBreak(selectPiece(wg2NegZero2Wall, 'p0_0')),
        { row: -0, col: -0 },
      );
      expect(pendingNegZero.turnSubState.pendingBreakChoice).not.toBeNull();
      expect(Object.is(pendingNegZero.turnSubState.pendingBreakChoice!.destination.row, -0)).toBe(false);
      expect(Object.is(pendingNegZero.turnSubState.pendingBreakChoice!.destination.col, -0)).toBe(false);
    });
  });

  describe('E25 (F19): Deterministic handleTurnTimeout across Wall Go II phases', () => {
    it('completes 3P placement, 1-step normal move, 1-wall & 2-wall diagonal break fallbacks, and place_wall', () => {
      // (a) 3P placement timeout auto-picks valid kind
      let placement = createInitialGameState({
        ruleVariant: 'wallgo2',
        format: '3p',
        players: make3pPlayers(),
        shuffleOrder: false,
        timerSeconds: 60,
      });
      placement = handleTurnTimeout(placement, () => 0);
      expect(placement.pieces).toHaveLength(1);
      expect(placement.pieces[0].kind).toBe('square');

      // (c) select_piece timeout prefers 1-step normal move
      const normalState = buildWallGo2PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'square', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        ],
      });
      const afterNormalTimeout = handleTurnTimeout(normalState, () => 0);
      const movedP0 = afterNormalTimeout.pieces.find((p) => p.id === 'p0_0')!;
      expect(Math.abs(movedP0.row - 3) + Math.abs(movedP0.col - 3)).toBe(1);
      expect(afterNormalTimeout.turnNumber).toBe(1);
      expect(afterNormalTimeout.lastPlacedWall).not.toBeNull();

      // (c-fallback) 0 normal moves -> falls back to WG2 wall-break including 2-wall ambiguous diagonal
      // Corner (0,0) round piece walled by h(0,0) & v(0,0), (0,1) & (1,0) occupied by opponents ->
      // Wait: if (0,1) & (1,0) are occupied, diagonal (1,1) is blocked too!
      // Instead: round piece at (0,0) walled by h(0,0) & v(0,0), (0,1) & (1,0) EMPTY, (1,1) EMPTY ->
      // 0 normal moves; targets include (0,1) [1-wall], (1,0) [1-wall], and (1,1) [2-wall ambiguous diagonal]!
      const boxedRound = buildWallGo2PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'round', row: 0, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'square', row: 6, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        ],
        walls: [
          { orientation: 'h', row: 0, col: 0, ownerId: 1 },
          { orientation: 'v', row: 0, col: 0, ownerId: 2 },
        ],
        wallBreaks: [1, 1, 1],
      });
      // Break candidates: (0,1)->v(0,0), (1,0)->h(0,0), (1,1)->h(0,0), (1,1)->v(0,0)
      // rng = () => 0 picks index 0 (1-wall target); rng = () => 1 picks last index (2-wall ambiguous diagonal!)
      const after1WallTimeout = handleTurnTimeout(boxedRound, () => 0);
      expect(after1WallTimeout.turnNumber).toBe(1);
      expect(after1WallTimeout.players[0].wallBreaksRemaining).toBe(0);
      expect(after1WallTimeout.phase).toBe('select_piece');

      const after2WallDiagTimeout = handleTurnTimeout(boxedRound, () => 1);
      expect(after2WallDiagTimeout.turnNumber).toBe(1);
      expect(after2WallDiagTimeout.players[0].wallBreaksRemaining).toBe(0);
      expect(after2WallDiagTimeout.pieces.find((p) => p.id === 'p0_0')).toMatchObject({
        row: 1,
        col: 1,
      });
      expect(after2WallDiagTimeout.lastPlacedWall).not.toBeNull();

      // (e) place_wall timeout
      const inPlaceWall = movePiece(selectPiece(normalState, 'p0_0'), { row: 3, col: 4 });
      const afterPlaceWallTimeout = handleTurnTimeout(inPlaceWall, () => 0);
      expect(afterPlaceWallTimeout.turnNumber).toBe(1);
      expect(afterPlaceWallTimeout.lastPlacedWall).not.toBeNull();

      // Guard no-ops: selectWallGo2BreakDestination without wallBreakActive & confirmWallGo2BreakWall without pendingBreakChoice
      const selectedOnly = selectPiece(boxedRound, 'p0_0');
      expect(selectWallGo2BreakDestination(selectedOnly, { row: 0, col: 1 })).toBe(selectedOnly);
      expect(
        confirmWallGo2BreakWall(selectedOnly, { orientation: 'h', row: 0, col: 0 }),
      ).toBe(selectedOnly);
    });

    it('terminates full 3P and 2P Wall Go II games via handleTurnTimeout within theoretical bounds (<= 87 / <= 84 turns)', () => {
      const makeRng = (seed: number) => {
        let s = seed >>> 0;
        return () => {
          s = (1664525 * s + 1013904223) >>> 0;
          return s / 0x100000000;
        };
      };

      for (const format of ['3p', '2p'] as const) {
        const rng = makeRng(format === '3p' ? 3030 : 3031);
        let state = createInitialGameState({
          ruleVariant: 'wallgo2',
          format,
          players: format === '3p' ? make3pPlayers() : make2pPlayers(),
          shuffleOrder: false,
          timerSeconds: 60,
        });

        let steps = 0;
        const maxSteps = format === '3p' ? 100 : 95;
        while (state.phase !== 'game_over' && steps < maxSteps) {
          const next = handleTurnTimeout(state, rng);
          expect(next).not.toBe(state);
          state = next;
          steps += 1;
        }

        expect(state.phase).toBe('game_over');
        expect(state.territory.isGameOver).toBe(true);
        expect(state.turnNumber).toBeLessThanOrEqual(format === '3p' ? 87 : 84);
        const totalBoardCells = state.territory.components.reduce((acc, c) => acc + c.size, 0);
        expect(totalBoardCells).toBe(49);
      }
    });
  });
});
