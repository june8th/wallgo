import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  COL_LABELS,
  ROW_LABELS,
  analyzeTerritory,
  breakWallAt,
  canCancelTurnMove,
  canToggleWallBreak,
  cancelTurnMove,
  cellToCoordLabel,
  createFreshTurnSubState,
  createInitialGameState,
  deselectPiece,
  getAdjacentInternalEdges,
  getEdgeBetweenCells,
  getInteractiveWalls,
  getLegalWallPlacements,
  getPhaseSubstate,
  getPieceBreakableWalls,
  getPieceValidMoves,
  getSelectablePieceIds,
  getWallGo1BreakableWalls,
  getWallGo1Moves,
  handleTurnTimeout,
  hasWall,
  isInBounds,
  isValidWallEdge,
  movePiece,
  placeInitialPiece,
  placeWall,
  selectPiece,
  toggleWallBreak,
  wallKey,
} from '../index';
import type {
  GameState,
  LobbyConfig,
  Piece,
  PlacedWall,
  PlayerConfig,
  WallEdge,
  WallKey,
} from '../index';

function make3pPlayers(overrides?: Partial<PlayerConfig>[]): PlayerConfig[] {
  const base: PlayerConfig[] = [
    { name: '민수', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
    { name: '지연', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
    { name: '현우', colorToken: 'p3', isAI: false, aiDifficulty: 'normal' },
  ];
  if (!overrides) {
    return base;
  }
  return base.map((p, i) => ({ ...p, ...(overrides[i] ?? {}) }));
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

function buildWallGo1PlayState(opts: {
  format?: '3p' | '2p';
  pieces: Piece[];
  walls?: PlacedWall[];
  currentPlayerIndex?: number;
  wallBreaks?: number[];
}): GameState {
  const format = opts.format ?? '3p';
  const base = createInitialGameState({
    ruleVariant: 'wallgo1',
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

function makeSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('Wall Go I — Geometry, Setup, Movement, Wall Break & Timeout', () => {
  describe('E01 (F01, F02): Perimeter immutability and coordinate validation', () => {
    it('validates 7x7 bounds, labels, and rejects out-of-bounds/non-integer coordinates', () => {
      expect(BOARD_SIZE).toBe(7);
      expect(COL_LABELS).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
      expect(ROW_LABELS).toEqual(['1', '2', '3', '4', '5', '6', '7']);

      expect(isInBounds(0, 0)).toBe(true);
      expect(isInBounds(6, 6)).toBe(true);
      expect(isInBounds(-1, 0)).toBe(false);
      expect(isInBounds(0, 7)).toBe(false);
      expect(isInBounds(1.5, 2)).toBe(false);
      expect(isInBounds(Number.NaN, 0)).toBe(false);

      expect(cellToCoordLabel({ row: 0, col: 0 })).toBe('A1');
      expect(cellToCoordLabel({ row: 1, col: 1 })).toBe('B2');
      expect(cellToCoordLabel({ row: 3, col: 3 })).toBe('D4');
      expect(cellToCoordLabel({ row: 6, col: 6 })).toBe('G7');
      expect(() => cellToCoordLabel({ row: -1, col: 0 })).toThrow(RangeError);
    });

    it('structurally excludes all outer perimeter segments at corners (0,0) and (6,6)', () => {
      expect(getAdjacentInternalEdges({ row: 0, col: 0 })).toEqual([
        { orientation: 'h', row: 0, col: 0 },
        { orientation: 'v', row: 0, col: 0 },
      ]);
      expect(getAdjacentInternalEdges({ row: 6, col: 6 })).toEqual([
        { orientation: 'h', row: 5, col: 6 },
        { orientation: 'v', row: 6, col: 5 },
      ]);
      expect(getAdjacentInternalEdges({ row: 3, col: 3 })).toHaveLength(4);
      expect(getAdjacentInternalEdges({ row: 0, col: 3 })).toHaveLength(3);

      expect(getEdgeBetweenCells({ row: 0, col: 0 }, { row: -1, col: 0 })).toBeNull();
      expect(getEdgeBetweenCells({ row: 0, col: 0 }, { row: 0, col: -1 })).toBeNull();
      expect(getEdgeBetweenCells({ row: 6, col: 6 }, { row: 7, col: 6 })).toBeNull();
      expect(getEdgeBetweenCells({ row: 0, col: 0 }, { row: 1, col: 1 })).toBeNull();
      expect(getEdgeBetweenCells({ row: 2, col: 3 }, { row: 3, col: 3 })).toEqual({
        orientation: 'h',
        row: 2,
        col: 3,
      });

      expect(isValidWallEdge({ orientation: 'h', row: 0, col: 0 })).toBe(true);
      expect(isValidWallEdge({ orientation: 'h', row: 5, col: 6 })).toBe(true);
      expect(isValidWallEdge({ orientation: 'h', row: -1, col: 0 })).toBe(false);
      expect(isValidWallEdge({ orientation: 'h', row: 6, col: 0 })).toBe(false);
      expect(isValidWallEdge({ orientation: 'v', row: 0, col: -1 })).toBe(false);
      expect(isValidWallEdge({ orientation: 'v', row: 0, col: 6 })).toBe(false);
      expect(isValidWallEdge({ orientation: 'v', row: 0.5, col: 2 })).toBe(false);
    });

    it('rejects perimeter wall placement, duplicate placement, and perimeter wall break', () => {
      const state = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 6, col: 6 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 0 },
        ],
        walls: [{ orientation: 'h', row: 0, col: 0, ownerId: 1 }],
      });

      // Attempt perimeter wall break
      const selected = selectPiece(state, 'p0_0');
      const breakMode = toggleWallBreak(selected);
      const perimeterNorth: WallEdge = { orientation: 'h', row: -1, col: 0 };
      const perimeterWest: WallEdge = { orientation: 'v', row: 0, col: -1 };
      expect(breakWallAt(breakMode, perimeterNorth)).toBe(breakMode);
      expect(breakWallAt(breakMode, perimeterWest)).toBe(breakMode);

      // Stay in place at (0,0) (east (0,1) is open) and attempt perimeter & duplicate placement
      const placePhase = movePiece(selected, { row: 0, col: 0 });
      expect(placePhase.phase).toBe('place_wall');
      expect(getLegalWallPlacements(placePhase, { row: 0, col: 0 })).toEqual([
        { orientation: 'v', row: 0, col: 0 },
      ]);
      expect(placeWall(placePhase, perimeterNorth)).toBe(placePhase);
      expect(placeWall(placePhase, perimeterWest)).toBe(placePhase);
      expect(placeWall(placePhase, { orientation: 'h', row: 0, col: 0 })).toBe(placePhase);
    });

    it('normalizes negative zero (-0) coordinates to +0 across getEdgeBetweenCells, getAdjacentInternalEdges, placeInitialPiece, movePiece, and placeWall', () => {
      const edgeH = getEdgeBetweenCells({ row: -0, col: -0 }, { row: 1, col: -0 })!;
      expect(edgeH).toEqual({ orientation: 'h', row: 0, col: 0 });
      expect(Object.is(edgeH.row, -0)).toBe(false);
      expect(Object.is(edgeH.col, -0)).toBe(false);

      const edgeV = getEdgeBetweenCells({ row: -0, col: -0 }, { row: -0, col: 1 })!;
      expect(edgeV).toEqual({ orientation: 'v', row: 0, col: 0 });
      expect(Object.is(edgeV.row, -0)).toBe(false);
      expect(Object.is(edgeV.col, -0)).toBe(false);

      const adjEdges = getAdjacentInternalEdges({ row: -0, col: -0 });
      expect(adjEdges).toEqual([
        { orientation: 'h', row: 0, col: 0 },
        { orientation: 'v', row: 0, col: 0 },
      ]);
      for (const e of adjEdges) {
        expect(Object.is(e.row, -0)).toBe(false);
        expect(Object.is(e.col, -0)).toBe(false);
      }

      const initial = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '3p',
        players: make3pPlayers(),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      const placed = placeInitialPiece(initial, { row: -0, col: -0 });
      expect(placed.pieces[0]).toEqual({
        id: 'p0_0',
        ownerId: 0,
        kind: 'standard',
        row: 0,
        col: 0,
      });
      expect(Object.is(placed.pieces[0].row, -0)).toBe(false);
      expect(Object.is(placed.pieces[0].col, -0)).toBe(false);

      const playState = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 1 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 6, col: 6 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 0 },
        ],
      });
      const moved = movePiece(selectPiece(playState, 'p0_0'), { row: -0, col: -0 });
      const movedPiece = moved.pieces.find((p) => p.id === 'p0_0')!;
      expect(movedPiece).toMatchObject({ row: 0, col: 0 });
      expect(Object.is(movedPiece.row, -0)).toBe(false);
      expect(Object.is(movedPiece.col, -0)).toBe(false);

      const walled = placeWall(moved, { orientation: 'h', row: -0, col: -0 });
      const storedWall = walled.walls['h:0:0'];
      expect(storedWall).toEqual({ orientation: 'h', row: 0, col: 0, ownerId: 0 });
      expect(Object.is(storedWall.row, -0)).toBe(false);
      expect(Object.is(storedWall.col, -0)).toBe(false);
      expect(walled.lastPlacedWall).toEqual({ orientation: 'h', row: 0, col: 0 });
      expect(Object.is(walled.lastPlacedWall!.row, -0)).toBe(false);
      expect(Object.is(walled.lastPlacedWall!.col, -0)).toBe(false);
    });
  });

  describe('E02 (F03, F05): 3P snake setup, shuffle, name fallback, and 2P standalone setup', () => {
    it('follows 3P snake order [0,1,2,2,1,0] and begins play phase with P0', () => {
      const config: LobbyConfig = {
        ruleVariant: 'wallgo1',
        format: '3p',
        players: make3pPlayers(),
        shuffleOrder: false,
        timerSeconds: 0,
      };
      let state = createInitialGameState(config);
      expect(state.phase).toBe('placement');
      expect(state.placementQueue).toEqual([0, 1, 2, 2, 1, 0]);
      expect(state.players.map((p) => p.wallBreaksRemaining)).toEqual([1, 1, 1]);
      expect(state.lastPlacedWall).toBeNull();

      const coords = [
        { row: 1, col: 1 },
        { row: 1, col: 5 },
        { row: 5, col: 1 },
        { row: 5, col: 5 },
        { row: 3, col: 1 },
        { row: 3, col: 5 },
      ];
      const expectedActors = [0, 1, 2, 2, 1, 0];

      for (let i = 0; i < coords.length; i++) {
        expect(state.currentPlayerIndex).toBe(expectedActors[i]);
        expect(state.placementStep).toBe(i);
        // Reject placing on already-occupied cell
        if (i > 0) {
          expect(placeInitialPiece(state, coords[0])).toBe(state);
        }
        state = placeInitialPiece(state, coords[i]);
      }

      expect(state.phase).toBe('select_piece');
      expect(state.currentPlayerIndex).toBe(0);
      expect(state.pieces).toHaveLength(6);
      expect(state.pieces.map((p) => p.id)).toEqual([
        'p0_0',
        'p1_0',
        'p2_0',
        'p2_1',
        'p1_1',
        'p0_1',
      ]);
    });

    it('normalizes blank names before Fisher-Yates shuffle and preserves colorToken/identity', () => {
      const config: LobbyConfig = {
        ruleVariant: 'wallgo1',
        format: '3p',
        players: [
          { name: '   ', colorToken: 'p1', isAI: false, aiDifficulty: 'easy' },
          { name: '지연', colorToken: 'p2', isAI: true, aiDifficulty: 'hard' },
          { name: '\t\n', colorToken: 'p3', isAI: false, aiDifficulty: 'normal' },
        ],
        shuffleOrder: true,
        timerSeconds: 90,
      };
      const originalSnapshot = structuredClone(config);

      // Deterministic rng = () => 0 rotates [A, B, C] -> [B, C, A] under Durstenfeld
      const shuffledZero = createInitialGameState(config, () => 0);
      expect(config).toEqual(originalSnapshot);
      expect(shuffledZero.players.map((p) => p.id)).toEqual([0, 1, 2]);
      expect(shuffledZero.players.map((p) => p.colorToken)).toEqual(['p2', 'p3', 'p1']);
      expect(shuffledZero.players.map((p) => p.name)).toEqual([
        '지연',
        '플레이어 3',
        '플레이어 1',
      ]);
      expect(shuffledZero.players[0].isAI).toBe(true);
      expect(shuffledZero.players[0].aiDifficulty).toBe('hard');

      // Boundary rng = () => 1 must clamp safely and never produce undefined
      const shuffledOne = createInitialGameState(config, () => 1);
      expect(shuffledOne.players.map((p) => p.colorToken)).toEqual(['p1', 'p2', 'p3']);
      expect(shuffledOne.players.map((p) => p.name)).toEqual([
        '플레이어 1',
        '지연',
        '플레이어 3',
      ]);
    });

    it('throws on invalid LobbyConfig player counts or bad options', () => {
      expect(() =>
        createInitialGameState({
          ruleVariant: 'wallgo1',
          format: '3p',
          players: make2pPlayers(),
          shuffleOrder: false,
          timerSeconds: 0,
        }),
      ).toThrow(/3 players/);

      expect(() =>
        createInitialGameState({
          ruleVariant: 'wallgo1',
          format: '2p',
          players: make3pPlayers(),
          shuffleOrder: false,
          timerSeconds: 0,
        }),
      ).toThrow(/2 players/);
    });

    it('sets up 2P Wall Go I with 4 fixed symmetric pieces, [0,1,1,0] queue, and 0 wall breaks', () => {
      let state = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '2p',
        players: make2pPlayers(),
        shuffleOrder: false,
        timerSeconds: 60,
      });

      expect(state.placementQueue).toEqual([0, 1, 1, 0]);
      expect(state.players.map((p) => p.wallBreaksRemaining)).toEqual([0, 0]);
      expect(state.pieces).toEqual([
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 1, col: 1 },
        { id: 'p0_1', ownerId: 0, kind: 'standard', row: 5, col: 5 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 1, col: 5 },
        { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 1 },
      ]);

      // Placing on fixed cells rejected
      expect(placeInitialPiece(state, { row: 1, col: 1 })).toBe(state);
      expect(placeInitialPiece(state, { row: 5, col: 1 })).toBe(state);

      state = placeInitialPiece(state, { row: 2, col: 2 });
      state = placeInitialPiece(state, { row: 2, col: 4 });
      state = placeInitialPiece(state, { row: 4, col: 2 });
      state = placeInitialPiece(state, { row: 4, col: 4 });

      expect(state.phase).toBe('select_piece');
      expect(state.currentPlayerIndex).toBe(0);
      expect(state.pieces).toHaveLength(8);

      // Wall break disabled in 2P
      const selected = selectPiece(state, 'p0_0');
      expect(canToggleWallBreak(selected)).toBe(false);
      expect(toggleWallBreak(selected)).toBe(selected);
    });

    it('auto-skips P0 on Turn 0 if adversarial corner placement traps both P0 pieces', () => {
      let state = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '3p',
        players: make3pPlayers(),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      // Queue: [0, 1, 2, 2, 1, 0]
      state = placeInitialPiece(state, { row: 0, col: 0 }); // P0 at A1
      state = placeInitialPiece(state, { row: 0, col: 1 }); // P1 blocks A1 east
      state = placeInitialPiece(state, { row: 1, col: 0 }); // P2 blocks A1 south
      state = placeInitialPiece(state, { row: 0, col: 5 }); // P2 blocks G1 west
      state = placeInitialPiece(state, { row: 1, col: 6 }); // P1 blocks G1 south
      state = placeInitialPiece(state, { row: 0, col: 6 }); // P0 at G1 -> both P0 pieces boxed with 0 walls!

      expect(state.phase).toBe('select_piece');
      expect(state.lastSkippedPlayerIds).toEqual([0]);
      expect(state.currentPlayerIndex).toBe(1);
    });
  });

  describe('E05 (F07, F08): Wall Go I conditional stay-in-place (0 steps)', () => {
    it('forbids 0-step stay when |D_1(p)| === 0 via walls, borders, or pieces', () => {
      // Corner (0,0) blocked by wall h(0,0) South and opponent piece at (0,1) East
      const cornerTrapped = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 1 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        walls: [{ orientation: 'h', row: 0, col: 0, ownerId: 1 }],
        wallBreaks: [0, 0, 0],
      });
      expect(getWallGo1Moves(cornerTrapped, 'p0_0')).toEqual([]);

      // Interior (3,3) walled on all 4 sides
      const walled4 = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 6, col: 6 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 0, col: 0 },
        ],
        walls: [
          { orientation: 'h', row: 2, col: 3, ownerId: 1 },
          { orientation: 'h', row: 3, col: 3, ownerId: 1 },
          { orientation: 'v', row: 3, col: 2, ownerId: 1 },
          { orientation: 'v', row: 3, col: 3, ownerId: 1 },
        ],
        wallBreaks: [0, 0, 0],
      });
      expect(getWallGo1Moves(walled4, 'p0_0')).toEqual([]);
    });

    it('allows 0-step stay with moveType "stay" when at least 1 adjacent cell is open', () => {
      const state = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 6, col: 6 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 0 },
        ],
        walls: [{ orientation: 'h', row: 0, col: 0, ownerId: 1 }],
      });

      const selected = selectPiece(state, 'p0_0');
      const options = getPieceValidMoves(selected, 'p0_0');
      const stayOpt = options.find((m) => m.row === 0 && m.col === 0);
      expect(stayOpt).toEqual({ row: 0, col: 0, moveType: 'stay' });

      const moved = movePiece(selected, { row: 0, col: 0 });
      expect(moved.phase).toBe('place_wall');
      expect(moved.turnSubState.originPos).toEqual({ row: 0, col: 0 });
    });
  });

  describe('E06 (F07): Wall Go I BFS movement & no piece jumping', () => {
    it('reaches all 13 cells from unobstructed center (3,3) and blocks jumping over own/opponent pieces', () => {
      const openState = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
      });
      expect(getWallGo1Moves(openState, 'p0_0')).toHaveLength(13);

      // Own piece at (3,4) blocks straight jump to (3,5)
      const blockedByOwn = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 3, col: 4 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
      });
      const movesOwn = getWallGo1Moves(blockedByOwn, 'p0_0');
      expect(movesOwn.some((c) => c.row === 3 && c.col === 4)).toBe(false);
      expect(movesOwn.some((c) => c.row === 3 && c.col === 5)).toBe(false);
      // L-turn via (2,3) -> (2,4) still reaches (2,4)
      expect(movesOwn.some((c) => c.row === 2 && c.col === 4)).toBe(true);

      // Opponent piece at (3,4) equally blocks straight jump to (3,5)
      const blockedByOpp = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 3, col: 4 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
      });
      const movesOpp = getWallGo1Moves(blockedByOpp, 'p0_0');
      expect(movesOpp.some((c) => c.row === 3 && c.col === 4)).toBe(false);
      expect(movesOpp.some((c) => c.row === 3 && c.col === 5)).toBe(false);
    });
  });

  describe('E07 (F09): Surrounded piece wall-break escape unlocks 0/1/2-step moves', () => {
    it('allows selecting boxed piece, toggling wall break, breaking v(3,3), and moving 0-2 steps', () => {
      const state = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        walls: [
          { orientation: 'h', row: 2, col: 3, ownerId: 1 },
          { orientation: 'h', row: 3, col: 3, ownerId: 1 },
          { orientation: 'v', row: 3, col: 2, ownerId: 2 },
          { orientation: 'v', row: 3, col: 3, ownerId: 2 },
        ],
        wallBreaks: [1, 1, 1],
      });

      expect(getWallGo1Moves(state, 'p0_0')).toEqual([]);
      expect(getSelectablePieceIds(state)).toEqual(['p0_0']);

      // selectPiece keeps wallBreakActive === false (toggleable cleanly via toggleWallBreak)
      const selected = selectPiece(state, 'p0_0');
      expect(selected.phase).toBe('move_piece');
      expect(selected.turnSubState.wallBreakActive).toBe(false);
      expect(getPhaseSubstate(selected)).toBe('idle');
      expect(canToggleWallBreak(selected)).toBe(true);

      const breakMode = toggleWallBreak(selected);
      expect(breakMode.turnSubState.wallBreakActive).toBe(true);
      expect(getPhaseSubstate(breakMode)).toBe('wall_break_select_wall');
      expect(getPieceValidMoves(breakMode, 'p0_0')).toEqual([]);
      expect(getInteractiveWalls(breakMode)).toHaveLength(4);
      expect(getInteractiveWalls(breakMode).every((w) => w.state === 'breakable')).toBe(true);

      const afterBreak = breakWallAt(breakMode, { orientation: 'v', row: 3, col: 3 });
      expect(afterBreak.phase).toBe('move_piece');
      expect(afterBreak.players[0].wallBreaksRemaining).toBe(0);
      expect(afterBreak.turnSubState.wallBreakActive).toBe(false);
      expect(afterBreak.turnSubState.brokenWallBeforeMove).toEqual({
        orientation: 'v',
        row: 3,
        col: 3,
        ownerId: 2,
      });
      expect(hasWall(afterBreak.walls, { orientation: 'v', row: 3, col: 3 })).toBe(false);

      // Post-break unlocks stay (3,3), 1-step (3,4), and 2-step via (3,4)
      const postBreakOptions = getPieceValidMoves(afterBreak, 'p0_0');
      expect(postBreakOptions).toEqual([
        { row: 2, col: 4, moveType: 'normal' },
        { row: 3, col: 3, moveType: 'stay' },
        { row: 3, col: 4, moveType: 'normal' },
        { row: 3, col: 5, moveType: 'normal' },
        { row: 4, col: 4, moveType: 'normal' },
      ]);
    });
  });

  describe('E08 & E09 (F09): Wall break into occupied cell (non-soft-lock vs open other side)', () => {
    it('E08: excludes adjacent wall if breaking it leaves 0 legal moves (prevents soft-lock)', () => {
      const state = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 4, col: 4 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 1, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 0, col: 1 },
        ],
        walls: [{ orientation: 'h', row: 0, col: 0, ownerId: 1 }],
        wallBreaks: [1, 1, 1],
      });

      expect(getWallGo1Moves(state, 'p0_0')).toEqual([]);
      expect(getWallGo1BreakableWalls(state, 'p0_0')).toEqual([]);
      expect(getPieceBreakableWalls(state, 'p0_0')).toEqual([]);
      expect(getSelectablePieceIds(state)).toEqual(['p0_1']);
      expect(selectPiece(state, 'p0_0')).toBe(state);
    });

    it('E09: permits breaking wall adjacent to occupied cell when another neighbor is open', () => {
      const state = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 1, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        walls: [{ orientation: 'h', row: 0, col: 0, ownerId: 1 }],
        wallBreaks: [1, 1, 1],
      });

      expect(getWallGo1BreakableWalls(state, 'p0_0')).toEqual([
        { orientation: 'h', row: 0, col: 0 },
      ]);

      const selected = selectPiece(state, 'p0_0');
      const breakMode = toggleWallBreak(selected);
      const afterBreak = breakWallAt(breakMode, { orientation: 'h', row: 0, col: 0 });
      expect(afterBreak).not.toBe(breakMode);

      const postMoves = getWallGo1Moves(afterBreak, 'p0_0');
      expect(postMoves.some((c) => c.row === 1 && c.col === 0)).toBe(false);
      expect(postMoves).toEqual([
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 0, col: 2 },
        { row: 1, col: 1 },
      ]);
      expect(movePiece(afterBreak, { row: 1, col: 0 })).toBe(afterBreak);
    });
  });

  describe('E10 & E11 (F09, F13): Own-wall break + reseal, and post-break piece lock', () => {
    it('E10: allows breaking own wall, stepping through it, and resealing the exact same edge', () => {
      const wall: PlacedWall = { orientation: 'v', row: 3, col: 3, ownerId: 0 };
      const state = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        walls: [wall],
        wallBreaks: [1, 1, 1],
      });

      const selected = selectPiece(state, 'p0_0');
      const toggled = toggleWallBreak(selected);
      const broken = breakWallAt(toggled, wall);
      expect(hasWall(broken.walls, wall)).toBe(false);

      const moved = movePiece(broken, { row: 3, col: 4 });
      expect(moved.phase).toBe('place_wall');
      expect(
        getLegalWallPlacements(moved, { row: 3, col: 4 }).some(
          (e) => e.orientation === 'v' && e.row === 3 && e.col === 3,
        ),
      ).toBe(true);

      const resealed = placeWall(moved, { orientation: 'v', row: 3, col: 3 });
      expect(resealed.phase).toBe('select_piece');
      expect(resealed.turnNumber).toBe(1);
      expect(resealed.walls['v:3:3']).toEqual({
        orientation: 'v',
        row: 3,
        col: 3,
        ownerId: 0,
      });
      expect(resealed.lastPlacedWall).toEqual({ orientation: 'v', row: 3, col: 3 });
    });

    it('E11: locks piece selection after Wall Go I break until move or cancelTurnMove', () => {
      const state = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 5, col: 5 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        walls: [{ orientation: 'v', row: 3, col: 3, ownerId: 1 }],
        wallBreaks: [1, 1, 1],
      });

      // Before break, switching pieces is allowed
      const selA = selectPiece(state, 'p0_0');
      const selB = selectPiece(selA, 'p0_1');
      expect(selB.turnSubState.selectedPieceId).toBe('p0_1');

      // Break wall on piece A
      const backToA = selectPiece(selB, 'p0_0');
      const broken = breakWallAt(toggleWallBreak(backToA), {
        orientation: 'v',
        row: 3,
        col: 3,
      });

      expect(getSelectablePieceIds(broken)).toEqual(['p0_0']);
      expect(getPieceValidMoves(broken, 'p0_1')).toEqual([]);
      expect(selectPiece(broken, 'p0_1')).toBe(broken);
      expect(deselectPiece(broken)).toBe(broken);

      // After cancelTurnMove, switching to piece B is allowed again
      const cancelled = cancelTurnMove(broken);
      expect(getSelectablePieceIds(cancelled)).toEqual(['p0_0', 'p0_1']);
      const switched = selectPiece(cancelled, 'p0_1');
      expect(switched.turnSubState.selectedPieceId).toBe('p0_1');
    });
  });

  describe('E16 (F14): cancelTurnMove exact restoration and input immutability', () => {
    it('restores piece origin, opponent wall ownerId, wallBreaksRemaining, and territory', () => {
      const initial = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        walls: [{ orientation: 'v', row: 3, col: 3, ownerId: 1 }],
        wallBreaks: [1, 1, 1],
      });
      const initialSnapshot = structuredClone(initial);

      // No-op in select_piece and clean move_piece
      expect(canCancelTurnMove(initial)).toBe(false);
      expect(cancelTurnMove(initial)).toBe(initial);

      const selected = selectPiece(initial, 'p0_0');
      expect(canCancelTurnMove(selected)).toBe(false);
      expect(cancelTurnMove(selected)).toBe(selected);

      // Post-break (pre-move) cancel
      const broken = breakWallAt(toggleWallBreak(selected), {
        orientation: 'v',
        row: 3,
        col: 3,
      });
      expect(canCancelTurnMove(broken)).toBe(true);
      const cancelPreMove = cancelTurnMove(broken);
      expect(cancelPreMove.phase).toBe('move_piece');
      expect(cancelPreMove.players[0].wallBreaksRemaining).toBe(1);
      expect(cancelPreMove.walls['v:3:3']).toEqual({
        orientation: 'v',
        row: 3,
        col: 3,
        ownerId: 1,
      });
      expect(cancelPreMove.turnSubState.brokenWallBeforeMove).toBeNull();

      // Post-break + post-move (place_wall) cancel
      const moved = movePiece(broken, { row: 3, col: 4 });
      expect(moved.phase).toBe('place_wall');
      expect(canCancelTurnMove(moved)).toBe(true);

      const cancelPostMove = cancelTurnMove(moved);
      expect(cancelPostMove.phase).toBe('move_piece');
      expect(cancelPostMove.turnSubState.selectedPieceId).toBe('p0_0');
      expect(cancelPostMove.turnSubState.originPos).toBeNull();
      expect(cancelPostMove.turnSubState.brokenWallBeforeMove).toBeNull();
      expect(cancelPostMove.players[0].wallBreaksRemaining).toBe(1);
      expect(cancelPostMove.pieces.find((p) => p.id === 'p0_0')).toMatchObject({
        row: 3,
        col: 3,
      });
      expect(cancelPostMove.walls['v:3:3']).toEqual({
        orientation: 'v',
        row: 3,
        col: 3,
        ownerId: 1,
      });

      // Verify zero mutation of original input state
      expect(initial).toEqual(initialSnapshot);
    });
  });

  describe('E25 (F19): Deterministic handleTurnTimeout across all Wall Go I phases', () => {
    it('completes placement, select_piece (stay), trapped wall-break fallback, post-break move, and place_wall', () => {
      const rng = makeSeededRng(42);

      // (a) Placement timeout
      const placementState = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '3p',
        players: make3pPlayers(),
        shuffleOrder: false,
        timerSeconds: 90,
      });
      const afterPlacementTimeout = handleTurnTimeout(placementState, rng);
      expect(afterPlacementTimeout.pieces).toHaveLength(1);
      expect(afterPlacementTimeout.placementStep).toBe(1);
      expect(afterPlacementTimeout.currentPlayerIndex).toBe(1);
      expect(afterPlacementTimeout.lastActionSummary).toContain('시간 초과');

      // (b) select_piece timeout prefers stay-in-place and places legal adjacent wall
      const playState = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
      });
      const afterSelectTimeout = handleTurnTimeout(playState, () => 0);
      expect(afterSelectTimeout.turnNumber).toBe(1);
      expect(afterSelectTimeout.currentPlayerIndex).toBe(1);
      expect(afterSelectTimeout.pieces.find((p) => p.id === 'p0_0')).toMatchObject({
        row: 3,
        col: 3,
      });
      expect(afterSelectTimeout.lastPlacedWall).not.toBeNull();
      expect(Object.keys(afterSelectTimeout.walls)).toHaveLength(1);

      // (b-fallback) Completely boxed piece with 0 normal moves uses wall break on timeout
      const boxedState = buildWallGo1PlayState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        walls: [
          { orientation: 'h', row: 2, col: 3, ownerId: 1 },
          { orientation: 'h', row: 3, col: 3, ownerId: 1 },
          { orientation: 'v', row: 3, col: 2, ownerId: 2 },
          { orientation: 'v', row: 3, col: 3, ownerId: 2 },
        ],
        wallBreaks: [1, 1, 1],
      });
      const afterBoxedTimeout = handleTurnTimeout(boxedState, () => 1);
      expect(afterBoxedTimeout.turnNumber).toBe(1);
      expect(afterBoxedTimeout.players[0].wallBreaksRemaining).toBe(0);
      expect(afterBoxedTimeout.lastPlacedWall).not.toBeNull();

      // (d) Post-break move_piece timeout moves locked piece and places wall
      const brokenState = breakWallAt(
        toggleWallBreak(selectPiece(boxedState, 'p0_0')),
        { orientation: 'v', row: 3, col: 3 },
      );
      const afterPostBreakTimeout = handleTurnTimeout(brokenState, () => 0);
      expect(afterPostBreakTimeout.turnNumber).toBe(1);
      expect(afterPostBreakTimeout.phase).toBe('select_piece');
      expect(afterPostBreakTimeout.lastPlacedWall).not.toBeNull();

      // (e) place_wall timeout keeps destination and places legal adjacent wall
      const movedState = movePiece(selectPiece(playState, 'p0_0'), { row: 3, col: 4 });
      const afterPlaceWallTimeout = handleTurnTimeout(movedState, () => 1);
      expect(afterPlaceWallTimeout.turnNumber).toBe(1);
      expect(afterPlaceWallTimeout.pieces.find((p) => p.id === 'p0_0')).toMatchObject({
        row: 3,
        col: 4,
      });
      expect(afterPlaceWallTimeout.lastPlacedWall).not.toBeNull();

      // pre-break move_piece with wallBreakActive=true does NOT waste wall break if normal move exists
      const preBreakActive = toggleWallBreak(
        selectPiece(
          buildWallGo1PlayState({
            pieces: [
              { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
              { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
              { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
            ],
            walls: [{ orientation: 'v', row: 3, col: 3, ownerId: 1 }],
            wallBreaks: [1, 1, 1],
          }),
          'p0_0',
        ),
      );
      expect(preBreakActive.turnSubState.wallBreakActive).toBe(true);
      const afterPreBreakTimeout = handleTurnTimeout(preBreakActive, () => 0);
      expect(afterPreBreakTimeout.turnNumber).toBe(1);
      expect(afterPreBreakTimeout.players[0].wallBreaksRemaining).toBe(1);

      // Non-adjacent placeWall & non-adjacent / empty breakWallAt are total no-ops
      expect(placeWall(movedState, { orientation: 'h', row: 0, col: 0 })).toBe(movedState);
      expect(breakWallAt(preBreakActive, { orientation: 'h', row: 3, col: 3 })).toBe(
        preBreakActive,
      );
      expect(breakWallAt(preBreakActive, { orientation: 'h', row: 0, col: 0 })).toBe(
        preBreakActive,
      );

      // game_over is a no-op
      const gameOverState: GameState = { ...playState, phase: 'game_over' };
      expect(handleTurnTimeout(gameOverState, rng)).toBe(gameOverState);
    });

    it('terminates full 3P and 2P Wall Go I games via handleTurnTimeout within theoretical bounds (<= 87 / <= 84 turns)', () => {
      for (const format of ['3p', '2p'] as const) {
        const rng = makeSeededRng(format === '3p' ? 2026 : 2027);
        let state = createInitialGameState({
          ruleVariant: 'wallgo1',
          format,
          players: format === '3p' ? make3pPlayers() : make2pPlayers(),
          shuffleOrder: false,
          timerSeconds: 90,
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
