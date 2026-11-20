import { describe, expect, it } from 'vitest';
import {
  analyzeBoardComponents,
  analyzeTerritory,
  breakWallAt,
  cancelTurnMove,
  checkGameEnd,
  computeRankings,
  computeRound2Qualification,
  createFreshTurnSubState,
  createInitialGameState,
  createPrisonMatchRound2State,
  movePiece,
  placeWall,
  selectPiece,
  selectWallGo2BreakDestination,
  shouldAutoSkipPlayer,
  toggleWallBreak,
  wallKey,
} from '../index';
import type {
  GameState,
  Piece,
  PlacedWall,
  PlayerConfig,
  PlayerScoreSummary,
  TerritoryComponent,
  WallKey,
} from '../index';

function make3pPlayers(overrides?: Partial<PlayerConfig>[]): PlayerConfig[] {
  const base: PlayerConfig[] = [
    { name: '민수', colorToken: 'p1', isAI: false, aiDifficulty: 'easy' },
    { name: '지연', colorToken: 'p2', isAI: true, aiDifficulty: 'normal' },
    { name: '현우', colorToken: 'p3', isAI: true, aiDifficulty: 'hard' },
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

function buildState(opts: {
  ruleVariant?: 'wallgo1' | 'wallgo2';
  format?: '3p' | '2p';
  pieces: Piece[];
  walls?: PlacedWall[];
  phase?: GameState['phase'];
  currentPlayerIndex?: number;
  wallBreaks?: number[];
  timerSeconds?: 0 | 90 | 60;
}): GameState {
  const format = opts.format ?? '3p';
  const base = createInitialGameState({
    ruleVariant: opts.ruleVariant ?? 'wallgo1',
    format,
    players: format === '3p' ? make3pPlayers() : make2pPlayers(),
    shuffleOrder: false,
    timerSeconds: opts.timerSeconds ?? 90,
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
    phase: opts.phase ?? 'select_piece',
    placementStep: base.placementQueue.length,
    currentPlayerIndex: opts.currentPlayerIndex ?? 0,
    turnSubState: createFreshTurnSubState('square'),
  };
  return {
    ...draft,
    territory: analyzeTerritory(draft),
  };
}

function makeFinished3pWithScores(
  scores: [PlayerScoreSummary, PlayerScoreSummary, PlayerScoreSummary],
  ruleVariant: 'wallgo1' | 'wallgo2' = 'wallgo1',
): GameState {
  const base = createInitialGameState({
    ruleVariant,
    format: '3p',
    players: make3pPlayers(),
    shuffleOrder: false,
    timerSeconds: 60,
  });
  return {
    ...base,
    phase: 'game_over',
    placementStep: base.placementQueue.length,
    territory: {
      ...base.territory,
      scores,
      isGameOver: true,
      endReason: 'all_separated',
    },
  };
}

describe('Territory Analysis, Game End, Auto-Skip, Rankings & Prison Match Round 2', () => {
  describe('E17 (F15): Multi-piece secured component, neutral pockets, and canonical anchorCell', () => {
    it('counts a multi-piece secured component once, scores neutral pockets 0, sums to 49, and anchors min(row), min(col)', () => {
      const walls: PlacedWall[] = [
        // 10-cell P0 secured rectangle: rows 0..1, cols 0..4
        { orientation: 'h', row: 1, col: 0, ownerId: 0 },
        { orientation: 'h', row: 1, col: 1, ownerId: 0 },
        { orientation: 'h', row: 1, col: 2, ownerId: 0 },
        { orientation: 'h', row: 1, col: 3, ownerId: 0 },
        { orientation: 'h', row: 1, col: 4, ownerId: 0 },
        { orientation: 'v', row: 0, col: 4, ownerId: 0 },
        { orientation: 'v', row: 1, col: 4, ownerId: 0 },
        // 5-cell neutral empty pocket: row 6, cols 0..4
        { orientation: 'h', row: 5, col: 0, ownerId: 1 },
        { orientation: 'h', row: 5, col: 1, ownerId: 1 },
        { orientation: 'h', row: 5, col: 2, ownerId: 1 },
        { orientation: 'h', row: 5, col: 3, ownerId: 1 },
        { orientation: 'h', row: 5, col: 4, ownerId: 1 },
        { orientation: 'v', row: 6, col: 4, ownerId: 1 },
        // 3-cell L-shaped P1 component: {(0,6), (1,5), (1,6)} with P1 at (1,5)
        { orientation: 'v', row: 0, col: 5, ownerId: 1 },
        { orientation: 'h', row: 0, col: 5, ownerId: 1 },
        { orientation: 'h', row: 1, col: 5, ownerId: 1 },
        { orientation: 'h', row: 1, col: 6, ownerId: 1 },
      ];

      const state = buildState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 1, col: 4 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 1, col: 5 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 4, col: 4 },
        ],
        walls,
      });

      const analysis = analyzeTerritory(state);
      const totalCells = analysis.components.reduce((acc, c) => acc + c.size, 0);
      expect(totalCells).toBe(49);

      // P0's 2 pieces share ONE 10-cell component -> counted once (10, NOT 20)
      expect(analysis.scores[0]).toMatchObject({
        playerId: 0,
        totalTerritory: 10,
        largestSingleTerritory: 10,
        securedRegions: [10],
      });

      // Empty 5-cell pocket is neutral (ownerId: null, awards 0)
      const neutral5 = analysis.components.find(
        (c) => c.kind === 'neutral' && c.size === 5,
      );
      expect(neutral5).toBeDefined();
      expect(neutral5?.ownerId).toBeNull();
      expect(neutral5?.anchorCell).toEqual({ row: 6, col: 0 });

      // L-shaped P1 component {(0,6), (1,5), (1,6)} has canonical anchorCell (0,6)
      const p1Comp = analysis.components.find((c) => c.ownerId === 1);
      expect(p1Comp).toBeDefined();
      expect(p1Comp?.size).toBe(3);
      expect(p1Comp?.anchorCell).toEqual({ row: 0, col: 6 });

      // P2 owns remaining 30 cells (cell (0,5) is isolated 1-cell neutral pocket)
      expect(analysis.scores[2].totalTerritory).toBe(30);
    });
  });

  describe('E18 (F15): Pieces never split connected components', () => {
    it('merges (0,0) P0, (0,1) P1, and empty (0,2) into a single contested component with 0 live score', () => {
      const state = buildState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 1 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        walls: [
          { orientation: 'h', row: 0, col: 0, ownerId: 0 },
          { orientation: 'h', row: 0, col: 1, ownerId: 0 },
          { orientation: 'h', row: 0, col: 2, ownerId: 0 },
          { orientation: 'v', row: 0, col: 2, ownerId: 0 },
        ],
      });

      const { components, cellToComponentId } = analyzeBoardComponents(
        state.walls,
        state.pieces,
      );
      const compId = cellToComponentId[0][0];
      expect(cellToComponentId[0][1]).toBe(compId);
      expect(cellToComponentId[0][2]).toBe(compId);

      const pocket = components[compId];
      expect(pocket.kind).toBe('contested');
      expect(pocket.size).toBe(3);
      expect(pocket.ownerIds).toEqual([0, 1]);
      expect(pocket.ownerId).toBeNull();
      expect(state.territory.scores[0].totalTerritory).toBe(0);
      expect(state.territory.scores[1].totalTerritory).toBe(0);
    });
  });

  describe('E19 (F16): Immediate game end with unused wall breaks & placement guard', () => {
    it('ends immediately on placeWall with endReason "all_separated" even when P1 & P2 still hold wall breaks', () => {
      // Seal row 0 (P2) from rows 1..6, and split rows 1..6 along col 2/3 except v(1,2)
      const walls: PlacedWall[] = [];
      for (let col = 0; col < 7; col++) {
        walls.push({ orientation: 'h', row: 0, col, ownerId: 2 });
      }
      for (let row = 2; row < 7; row++) {
        walls.push({ orientation: 'v', row, col: 2, ownerId: 0 });
      }

      const state = buildState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 1, col: 2 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 1, col: 4 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 0, col: 0 },
        ],
        walls,
        wallBreaks: [0, 1, 1],
      });

      expect(checkGameEnd(state)).toEqual({ isGameOver: false, endReason: null });

      const moved = movePiece(selectPiece(state, 'p0_0'), { row: 1, col: 2 });
      const finished = placeWall(moved, { orientation: 'v', row: 1, col: 2 });

      expect(finished.phase).toBe('game_over');
      expect(finished.territory.isGameOver).toBe(true);
      expect(finished.territory.endReason).toBe('all_separated');
      expect(finished.players[1].wallBreaksRemaining).toBe(1);
      expect(finished.players[2].wallBreaksRemaining).toBe(1);
      expect(finished.territory.scores[0].totalTerritory).toBe(18);
      expect(finished.territory.scores[1].totalTerritory).toBe(24);
      expect(finished.territory.scores[2].totalTerritory).toBe(7);
    });

    it('never triggers game end during placement phase even if only 1 player has placed a piece', () => {
      const initial = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '3p',
        players: make3pPlayers(),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      const singlePiecePlacement: GameState = {
        ...initial,
        pieces: [{ id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 }],
      };
      expect(checkGameEnd(singlePiecePlacement)).toEqual({
        isGameOver: false,
        endReason: null,
      });
    });
  });

  describe('E20 (F16, F18): Contested deadlock detection and +1 per piece scoring', () => {
    it('detects deadlock on a sealed 2-cell contested box, awards +1 per piece only at game_over, and gives 0 to empty deadlock cells', () => {
      const state = buildState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 1 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        walls: [
          { orientation: 'h', row: 0, col: 0, ownerId: 0 },
          { orientation: 'h', row: 0, col: 1, ownerId: 1 },
          { orientation: 'v', row: 0, col: 1, ownerId: 2 },
        ],
        wallBreaks: [0, 0, 0],
      });

      expect(checkGameEnd(state)).toEqual({ isGameOver: true, endReason: 'deadlock' });

      const analysis = analyzeTerritory(state);
      expect(analysis.isGameOver).toBe(true);
      expect(analysis.endReason).toBe('deadlock');
      expect(analysis.scores[0]).toMatchObject({
        playerId: 0,
        totalTerritory: 1,
        largestSingleTerritory: 1,
        securedRegions: [],
        deadlockPieceCount: 1,
        rank: 2,
      });
      expect(analysis.scores[1]).toMatchObject({
        playerId: 1,
        totalTerritory: 1,
        largestSingleTerritory: 1,
        securedRegions: [],
        deadlockPieceCount: 1,
        rank: 2,
      });
      expect(analysis.scores[2]).toMatchObject({
        playerId: 2,
        totalTerritory: 47,
        largestSingleTerritory: 47,
        securedRegions: [47],
        deadlockPieceCount: 0,
        rank: 1,
      });

      // Live (isGameOver: false) awards 0 for contested components
      const liveRankings = computeRankings(
        analysis.components,
        state.pieces,
        state.players,
        false,
      );
      expect(liveRankings.find((s) => s.playerId === 0)?.totalTerritory).toBe(0);
      expect(liveRankings.find((s) => s.playerId === 0)?.deadlockPieceCount).toBe(0);

      // Direct computeRankings check: 3-cell deadlocked contested component with 2 pieces & 1 empty cell -> empty cell awards 0
      const syntheticContestedWithEmpty: TerritoryComponent[] = [
        {
          id: 0,
          cells: [
            { row: 0, col: 0 },
            { row: 0, col: 1 },
            { row: 0, col: 2 },
          ],
          anchorCell: { row: 0, col: 0 },
          pieceIds: ['p0_0', 'p1_0'],
          ownerIds: [0, 1],
          kind: 'contested',
          ownerId: null,
          size: 3,
        },
      ];
      const rankedDeadlock = computeRankings(
        syntheticContestedWithEmpty,
        state.pieces.slice(0, 2),
        state.players,
        true,
      );
      expect(rankedDeadlock.find((s) => s.playerId === 0)).toMatchObject({
        totalTerritory: 1,
        largestSingleTerritory: 1,
        deadlockPieceCount: 1,
      });
      expect(rankedDeadlock.find((s) => s.playerId === 1)).toMatchObject({
        totalTerritory: 1,
        largestSingleTerritory: 1,
        deadlockPieceCount: 1,
      });
    });

    it('keeps largestSingleTerritory at 1 (NOT 2) when one player owns 2 pieces in a deadlocked contested box with no secured region', () => {
      const state = buildState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 1 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 2 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        walls: [
          { orientation: 'h', row: 0, col: 0, ownerId: 0 },
          { orientation: 'h', row: 0, col: 1, ownerId: 0 },
          { orientation: 'h', row: 0, col: 2, ownerId: 1 },
          { orientation: 'v', row: 0, col: 2, ownerId: 2 },
        ],
        wallBreaks: [0, 0, 0],
      });

      expect(checkGameEnd(state)).toEqual({ isGameOver: true, endReason: 'deadlock' });
      expect(state.territory.isGameOver).toBe(true);
      expect(state.territory.endReason).toBe('deadlock');
      expect(state.territory.scores[0]).toMatchObject({
        playerId: 0,
        totalTerritory: 2,
        deadlockPieceCount: 2,
        securedRegions: [],
        largestSingleTerritory: 1,
        rank: 2,
      });
      expect(state.territory.scores[1]).toMatchObject({
        playerId: 1,
        totalTerritory: 1,
        deadlockPieceCount: 1,
        securedRegions: [],
        largestSingleTerritory: 1,
        rank: 3,
      });
      expect(state.territory.scores[2]).toMatchObject({
        playerId: 2,
        totalTerritory: 46,
        deadlockPieceCount: 0,
        largestSingleTerritory: 46,
        rank: 1,
      });
    });
  });

  describe('E21 (F16): Contested component rescued by wall break (and E21+E08 non-rescue)', () => {
    it('does NOT end when non-current player in 2-cell contested box has a legal wall break (immune to turnSubState)', () => {
      const base = buildState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 1 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        walls: [
          { orientation: 'h', row: 0, col: 0, ownerId: 0 },
          { orientation: 'h', row: 0, col: 1, ownerId: 1 },
          { orientation: 'v', row: 0, col: 1, ownerId: 2 },
        ],
        currentPlayerIndex: 1, // P0 is NOT current player
        wallBreaks: [1, 0, 0],
      });
      // Even with a synthetic brokenWallBeforeMove on current player P1, P0's board-level wall break rescues!
      const withSyntheticSubState: GameState = {
        ...base,
        turnSubState: {
          ...base.turnSubState,
          brokenWallBeforeMove: { orientation: 'h', row: 5, col: 5, ownerId: 2 },
        },
      };

      expect(checkGameEnd(withSyntheticSubState)).toEqual({
        isGameOver: false,
        endReason: null,
      });

      // E21 + E08 combined: blocking (1,0) with P2 prevents P0's h(0,0) break from rescuing deadlock
      const unrescuable = buildState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 1 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 1, col: 0 },
        ],
        walls: [
          { orientation: 'h', row: 0, col: 0, ownerId: 0 },
          { orientation: 'h', row: 0, col: 1, ownerId: 1 },
          { orientation: 'v', row: 0, col: 1, ownerId: 2 },
        ],
        currentPlayerIndex: 1,
        wallBreaks: [1, 0, 0],
      });
      expect(checkGameEnd(unrescuable)).toEqual({
        isGameOver: true,
        endReason: 'deadlock',
      });
    });

    it('PROBE A1: never triggers isGameOver or deadlock credits mid-turn during Wall Break (wallgo1 & wallgo2), only on placeWall completion', () => {
      const boxWalls: PlacedWall[] = [
        // Contested box {(0,0), (0,1)} kept alive only by P0's unused wall break
        { orientation: 'h', row: 0, col: 0, ownerId: 0 },
        { orientation: 'h', row: 0, col: 1, ownerId: 1 },
        { orientation: 'v', row: 0, col: 1, ownerId: 2 },
        // Enclose p0_1 at (6,6) and adjacent neutral pocket (5,6)
        { orientation: 'h', row: 5, col: 6, ownerId: 1 },
        { orientation: 'v', row: 6, col: 5, ownerId: 2 },
        { orientation: 'h', row: 4, col: 6, ownerId: 1 },
        { orientation: 'v', row: 5, col: 5, ownerId: 2 },
      ];

      // --- Wall Go I ---
      const wg1Start = buildState({
        ruleVariant: 'wallgo1',
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 6, col: 6 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 1 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 3, col: 3 },
        ],
        walls: boxWalls,
        currentPlayerIndex: 0,
        wallBreaks: [1, 0, 0],
      });
      expect(wg1Start.territory.isGameOver).toBe(false);
      expect(wg1Start.territory.scores[1].deadlockPieceCount).toBe(0);
      expect(wg1Start.territory.scores[1].totalTerritory).toBe(0);

      // P0 breaks h(5,6) on p0_1, spending the charge needed to rescue p0_0
      const wg1AfterBreak = breakWallAt(
        toggleWallBreak(selectPiece(wg1Start, 'p0_1')),
        { orientation: 'h', row: 5, col: 6 },
      );
      expect(wg1AfterBreak.phase).toBe('move_piece');
      expect(wg1AfterBreak.territory.isGameOver).toBe(false);
      expect(wg1AfterBreak.territory.endReason).toBeNull();
      expect(checkGameEnd(wg1AfterBreak)).toEqual({ isGameOver: false, endReason: null });
      expect(wg1AfterBreak.territory.scores[0].deadlockPieceCount).toBe(0);
      expect(wg1AfterBreak.territory.scores[1].deadlockPieceCount).toBe(0);
      expect(wg1AfterBreak.territory.scores[1].totalTerritory).toBe(0);

      // cancelTurnMove from move_piece keeps isGameOver=false & deadlockPieceCount=0
      const wg1CancelAfterBreak = cancelTurnMove(wg1AfterBreak);
      expect(wg1CancelAfterBreak.phase).toBe('move_piece');
      expect(wg1CancelAfterBreak.players[0].wallBreaksRemaining).toBe(1);
      expect(wg1CancelAfterBreak.territory.isGameOver).toBe(false);
      expect(wg1CancelAfterBreak.territory.scores[0].deadlockPieceCount).toBe(0);
      expect(wg1CancelAfterBreak.territory.scores[1].deadlockPieceCount).toBe(0);

      // Moving p0_1 into (5,6) (phase: place_wall) still MUST NOT end game or add deadlock credits
      const wg1AfterMove = movePiece(wg1AfterBreak, { row: 5, col: 6 });
      expect(wg1AfterMove.phase).toBe('place_wall');
      expect(wg1AfterMove.territory.isGameOver).toBe(false);
      expect(wg1AfterMove.territory.endReason).toBeNull();
      expect(wg1AfterMove.territory.scores[0].deadlockPieceCount).toBe(0);
      expect(wg1AfterMove.territory.scores[1].deadlockPieceCount).toBe(0);
      expect(wg1AfterMove.territory.scores[1].totalTerritory).toBe(0);

      const wg1CancelAfterMove = cancelTurnMove(wg1AfterMove);
      expect(wg1CancelAfterMove.territory.isGameOver).toBe(false);
      expect(wg1CancelAfterMove.territory.scores[0].deadlockPieceCount).toBe(0);
      expect(wg1CancelAfterMove.territory.scores[1].deadlockPieceCount).toBe(0);

      // Completing the turn with placeWall commits the deadlock cleanly
      const wg1Finished = placeWall(wg1AfterMove, { orientation: 'h', row: 5, col: 6 });
      expect(wg1Finished.phase).toBe('game_over');
      expect(wg1Finished.territory.isGameOver).toBe(true);
      expect(wg1Finished.territory.endReason).toBe('deadlock');
      expect(wg1Finished.territory.scores[0].deadlockPieceCount).toBe(1);
      expect(wg1Finished.territory.scores[1].deadlockPieceCount).toBe(1);
      expect(wg1Finished.territory.scores[1].totalTerritory).toBe(1);

      // --- Wall Go II ---
      const wg2Start = buildState({
        ruleVariant: 'wallgo2',
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'square', row: 0, col: 0 },
          { id: 'p0_1', ownerId: 0, kind: 'round', row: 6, col: 6 },
          { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 1 },
          { id: 'p2_0', ownerId: 2, kind: 'square', row: 3, col: 3 },
        ],
        walls: boxWalls,
        currentPlayerIndex: 0,
        wallBreaks: [1, 0, 0],
      });
      expect(wg2Start.territory.isGameOver).toBe(false);
      expect(wg2Start.territory.scores[1].deadlockPieceCount).toBe(0);
      expect(wg2Start.territory.scores[1].totalTerritory).toBe(0);

      const wg2AfterBreakMove = selectWallGo2BreakDestination(
        toggleWallBreak(selectPiece(wg2Start, 'p0_1')),
        { row: 5, col: 6 },
      );
      expect(wg2AfterBreakMove.phase).toBe('place_wall');
      expect(wg2AfterBreakMove.territory.isGameOver).toBe(false);
      expect(wg2AfterBreakMove.territory.endReason).toBeNull();
      expect(checkGameEnd(wg2AfterBreakMove)).toEqual({ isGameOver: false, endReason: null });
      expect(wg2AfterBreakMove.territory.scores[0].deadlockPieceCount).toBe(0);
      expect(wg2AfterBreakMove.territory.scores[1].deadlockPieceCount).toBe(0);
      expect(wg2AfterBreakMove.territory.scores[1].totalTerritory).toBe(0);

      const wg2Cancelled = cancelTurnMove(wg2AfterBreakMove);
      expect(wg2Cancelled.phase).toBe('move_piece');
      expect(wg2Cancelled.players[0].wallBreaksRemaining).toBe(1);
      expect(wg2Cancelled.territory.isGameOver).toBe(false);
      expect(wg2Cancelled.territory.scores[0].deadlockPieceCount).toBe(0);
      expect(wg2Cancelled.territory.scores[1].deadlockPieceCount).toBe(0);

      const wg2Finished = placeWall(wg2AfterBreakMove, { orientation: 'h', row: 5, col: 6 });
      expect(wg2Finished.phase).toBe('game_over');
      expect(wg2Finished.territory.isGameOver).toBe(true);
      expect(wg2Finished.territory.endReason).toBe('deadlock');
      expect(wg2Finished.territory.scores[0].deadlockPieceCount).toBe(1);
      expect(wg2Finished.territory.scores[1].deadlockPieceCount).toBe(1);
      expect(wg2Finished.territory.scores[1].totalTerritory).toBe(1);
    });

    it('PROBE A2: never triggers isGameOver or deadlock credits mid-turn during normal movePiece (wallgo1 & wallgo2), only on placeWall completion', () => {
      const boxWalls: PlacedWall[] = [
        // Contested box {(0,0), (1,0)} kept alive only by P1's E21 break into empty (0,1)
        { orientation: 'v', row: 0, col: 0, ownerId: 0 },
        { orientation: 'v', row: 1, col: 0, ownerId: 1 },
        { orientation: 'h', row: 1, col: 0, ownerId: 2 },
      ];

      for (const variant of ['wallgo1', 'wallgo2'] as const) {
        const start = buildState({
          ruleVariant: variant,
          pieces: [
            { id: 'p0_0', ownerId: 0, kind: variant === 'wallgo1' ? 'standard' : 'square', row: 0, col: 2 },
            { id: 'p0_1', ownerId: 0, kind: variant === 'wallgo1' ? 'standard' : 'round', row: 1, col: 1 },
            { id: 'p1_0', ownerId: 1, kind: variant === 'wallgo1' ? 'standard' : 'square', row: 0, col: 0 },
            { id: 'p2_0', ownerId: 2, kind: variant === 'wallgo1' ? 'standard' : 'square', row: 1, col: 0 },
          ],
          walls: boxWalls,
          currentPlayerIndex: 0,
          wallBreaks: [1, 1, 0],
        });
        expect(start.territory.isGameOver).toBe(false);
        expect(start.territory.scores[1].totalTerritory).toBe(0);
        expect(start.territory.scores[2].totalTerritory).toBe(0);

        // Normal move onto (0,1) blocks P1's sole E21 escape cell
        const afterMove = movePiece(selectPiece(start, 'p0_0'), { row: 0, col: 1 });
        expect(afterMove.phase).toBe('place_wall');
        expect(afterMove.territory.isGameOver).toBe(false);
        expect(afterMove.territory.endReason).toBeNull();
        expect(checkGameEnd(afterMove)).toEqual({ isGameOver: false, endReason: null });
        expect(afterMove.territory.scores[1].deadlockPieceCount).toBe(0);
        expect(afterMove.territory.scores[2].deadlockPieceCount).toBe(0);
        expect(afterMove.territory.scores[1].totalTerritory).toBe(0);
        expect(afterMove.territory.scores[2].totalTerritory).toBe(0);

        const cancelled = cancelTurnMove(afterMove);
        expect(cancelled.territory.isGameOver).toBe(false);
        expect(cancelled.territory.scores[1].deadlockPieceCount).toBe(0);
        expect(cancelled.territory.scores[2].deadlockPieceCount).toBe(0);

        const finished = placeWall(afterMove, { orientation: 'v', row: 0, col: 1 });
        expect(finished.phase).toBe('game_over');
        expect(finished.territory.isGameOver).toBe(true);
        expect(finished.territory.endReason).toBe('deadlock');
        expect(finished.territory.scores[1].deadlockPieceCount).toBe(1);
        expect(finished.territory.scores[2].deadlockPieceCount).toBe(1);
        expect(finished.territory.scores[1].totalTerritory).toBe(1);
        expect(finished.territory.scores[2].totalTerritory).toBe(1);
      }
    });
  });

  describe('E22 & E23 (F17): 3P secured auto-skip (0 vs 1 wall break), double-skip, and 2P partial-block auto-skip', () => {
    it('E22: auto-skips secured P2 when wallBreaksRemaining===0, does NOT skip when wallBreaksRemaining===1, and handles double-skip', () => {
      // P2 secured in (0,0); P0 & P1 contest remaining 48 cells
      const securedWalls: PlacedWall[] = [
        { orientation: 'h', row: 0, col: 0, ownerId: 2 },
        { orientation: 'v', row: 0, col: 0, ownerId: 2 },
      ];
      const pieces: Piece[] = [
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
        { id: 'p2_0', ownerId: 2, kind: 'standard', row: 0, col: 0 },
      ];

      // P2 has 0 wall breaks -> auto-skipped on P1's placeWall
      const noBreakState = buildState({
        pieces,
        walls: securedWalls,
        currentPlayerIndex: 1,
        wallBreaks: [0, 0, 0],
      });
      expect(shouldAutoSkipPlayer(noBreakState, 2)).toBe(true);
      const p1Moved = movePiece(selectPiece(noBreakState, 'p1_0'), { row: 5, col: 4 });
      const afterP1Wall = placeWall(p1Moved, { orientation: 'h', row: 5, col: 4 });
      expect(afterP1Wall.currentPlayerIndex).toBe(0);
      expect(afterP1Wall.lastSkippedPlayerIds).toEqual([2]);

      // P2 has 1 wall break (and legal break target) -> NOT skipped
      const withBreakState = buildState({
        pieces,
        walls: securedWalls,
        currentPlayerIndex: 1,
        wallBreaks: [0, 0, 1],
      });
      expect(shouldAutoSkipPlayer(withBreakState, 2)).toBe(false);
      const p1Moved2 = movePiece(selectPiece(withBreakState, 'p1_0'), { row: 5, col: 4 });
      const afterP1Wall2 = placeWall(p1Moved2, { orientation: 'h', row: 5, col: 4 });
      expect(afterP1Wall2.currentPlayerIndex).toBe(2);
      expect(afterP1Wall2.lastSkippedPlayerIds).toEqual([]);

      // Double-skip: P1 secured with 0 breaks AND P2 trapped by P0 pieces in contested corner (6,6)
      const doubleSkipState = buildState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 6, col: 5 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 5, col: 6 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        walls: [
          { orientation: 'h', row: 0, col: 0, ownerId: 1 },
          { orientation: 'v', row: 0, col: 0, ownerId: 1 },
        ],
        currentPlayerIndex: 0,
        wallBreaks: [0, 0, 0],
      });
      const p0Stay = movePiece(selectPiece(doubleSkipState, 'p0_0'), { row: 6, col: 5 });
      const afterP0Wall = placeWall(p0Stay, { orientation: 'h', row: 5, col: 5 });
      expect(afterP0Wall.phase).toBe('select_piece');
      expect(afterP0Wall.lastSkippedPlayerIds).toEqual([1, 2]);
      expect(afterP0Wall.currentPlayerIndex).toBe(0);

      // Secured player with wallBreaksRemaining===1 but 0 legal actions (E08: outer cells occupied) IS skipped
      const trappedWithBreak = buildState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 1 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 1, col: 0 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 0, col: 0 },
        ],
        walls: [
          { orientation: 'h', row: 0, col: 0, ownerId: 0 },
          { orientation: 'v', row: 0, col: 0, ownerId: 1 },
        ],
        wallBreaks: [0, 0, 1],
      });
      expect(shouldAutoSkipPlayer(trappedWithBreak, 2)).toBe(true);
    });

    it('E23: auto-skips blocked P0 in 2P while contested game continues for P1', () => {
      const state = buildState({
        format: '2p',
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 6 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 1 },
          { id: 'p1_1', ownerId: 1, kind: 'standard', row: 1, col: 0 },
          { id: 'p1_2', ownerId: 1, kind: 'standard', row: 0, col: 5 },
          { id: 'p1_3', ownerId: 1, kind: 'standard', row: 1, col: 6 },
        ],
        currentPlayerIndex: 1,
        wallBreaks: [0, 0],
      });

      expect(checkGameEnd(state).isGameOver).toBe(false);
      expect(shouldAutoSkipPlayer(state, 0)).toBe(true);
      expect(shouldAutoSkipPlayer(state, 1)).toBe(false);

      const moved = movePiece(selectPiece(state, 'p1_1'), { row: 1, col: 0 });
      const afterWall = placeWall(moved, { orientation: 'h', row: 1, col: 0 });
      expect(afterWall.phase).toBe('select_piece');
      expect(afterWall.lastSkippedPlayerIds).toEqual([0]);
      expect(afterWall.currentPlayerIndex).toBe(1);
    });

    it('recomputes from live walls/pieces in checkGameEnd and shouldAutoSkipPlayer even when state.territory is stale', () => {
      // Truly live contested board (all 3 players share 49 cells, P2 has legal moves)
      const liveContested = buildState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 0, col: 0 },
        ],
        walls: [],
        wallBreaks: [0, 0, 0],
      });

      // Truly game-over separated board (P0 in (3,3) sealed, P1 in (5,5) sealed, P2 in (0,0) sealed)
      const separatedWalls: PlacedWall[] = [
        // Seal (0,0) for P2
        { orientation: 'h', row: 0, col: 0, ownerId: 2 },
        { orientation: 'v', row: 0, col: 0, ownerId: 2 },
        // Seal (3,3) for P0
        { orientation: 'h', row: 2, col: 3, ownerId: 0 },
        { orientation: 'h', row: 3, col: 3, ownerId: 0 },
        { orientation: 'v', row: 3, col: 2, ownerId: 0 },
        { orientation: 'v', row: 3, col: 3, ownerId: 0 },
      ];
      const actuallyOver = buildState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 0, col: 0 },
        ],
        walls: separatedWalls,
        wallBreaks: [0, 0, 0],
      });

      // Truly live board where P2 is secured in {(0,0),(0,1)} with 0 wall breaks (so P2 has legal moves inside secured box -> skip depends strictly on secured check!)
      const p2SecuredBox = buildState({
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 0, col: 0 },
        ],
        walls: [
          { orientation: 'h', row: 0, col: 0, ownerId: 2 },
          { orientation: 'h', row: 0, col: 1, ownerId: 2 },
          { orientation: 'v', row: 0, col: 1, ownerId: 2 },
        ],
        wallBreaks: [0, 0, 0],
      });

      // checkGameEnd: stale non-over territory on actually over board -> MUST return isGameOver: true
      const overWithStaleLive: GameState = {
        ...actuallyOver,
        territory: liveContested.territory,
      };
      expect(checkGameEnd(overWithStaleLive)).toEqual({
        isGameOver: true,
        endReason: 'all_separated',
      });

      // checkGameEnd: stale over territory on actually live board -> MUST return isGameOver: false
      const liveWithStaleOver: GameState = {
        ...liveContested,
        territory: actuallyOver.territory,
      };
      expect(checkGameEnd(liveWithStaleOver)).toEqual({
        isGameOver: false,
        endReason: null,
      });

      // shouldAutoSkipPlayer: P2 actually secured (has moves in 2-cell box, 0 wall breaks) but stale territory claims contested -> MUST return true
      const securedWithStaleContested: GameState = {
        ...p2SecuredBox,
        territory: liveContested.territory,
      };
      expect(shouldAutoSkipPlayer(securedWithStaleContested, 2)).toBe(true);

      // shouldAutoSkipPlayer: P2 actually contested (has moves, 0 wall breaks) but stale territory claims secured -> MUST return false
      const contestedWithStaleSecured: GameState = {
        ...liveContested,
        territory: p2SecuredBox.territory,
      };
      expect(shouldAutoSkipPlayer(contestedWithStaleSecured, 2)).toBe(false);
    });
  });

  describe('E24 (F18, F06): Competition rankings, tiebreakers, and Prison Match Round 2 continuation', () => {
    it('returns ranked order from computeRankings vs playerId-indexed scores from analyzeTerritory', () => {
      const comps: TerritoryComponent[] = [
        {
          id: 0,
          cells: Array.from({ length: 10 }, (_, i) => ({ row: 0, col: i % 7 })),
          anchorCell: { row: 0, col: 0 },
          pieceIds: ['p2_0'],
          ownerIds: [2],
          kind: 'secured',
          ownerId: 2,
          size: 10,
        },
        {
          id: 1,
          cells: Array.from({ length: 4 }, (_, i) => ({ row: 2, col: i })),
          anchorCell: { row: 2, col: 0 },
          pieceIds: ['p2_1'],
          ownerIds: [2],
          kind: 'secured',
          ownerId: 2,
          size: 4,
        },
        {
          id: 2,
          cells: Array.from({ length: 8 }, (_, i) => ({ row: 3, col: i % 7 })),
          anchorCell: { row: 3, col: 0 },
          pieceIds: ['p1_0'],
          ownerIds: [1],
          kind: 'secured',
          ownerId: 1,
          size: 8,
        },
        {
          id: 3,
          cells: Array.from({ length: 6 }, (_, i) => ({ row: 4, col: i })),
          anchorCell: { row: 4, col: 0 },
          pieceIds: ['p1_1'],
          ownerIds: [1],
          kind: 'secured',
          ownerId: 1,
          size: 6,
        },
        {
          id: 4,
          cells: Array.from({ length: 20 }, (_, i) => ({ row: 5, col: i % 7 })),
          anchorCell: { row: 5, col: 0 },
          pieceIds: ['p0_0'],
          ownerIds: [0],
          kind: 'secured',
          ownerId: 0,
          size: 20,
        },
      ];
      const base = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '3p',
        players: make3pPlayers(),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      const ranked = computeRankings(comps, [], base.players, true);
      expect(ranked.map((r) => [r.playerId, r.totalTerritory, r.largestSingleTerritory, r.rank])).toEqual([
        [0, 20, 20, 1],
        [2, 14, 10, 2],
        [1, 14, 8, 3],
      ]);
    });

    it('resolves all 4 E24 Round 2 qualification cases (a: clear, b: tied 2nd/3rd, c: [1,1,3], d: [1,1,1])', () => {
      // (a) Clear 1st, 2nd/3rd broken by largestSingleTerritory: P2 (14, max 10) > P1 (14, max 8)
      const caseA = makeFinished3pWithScores([
        { playerId: 0, totalTerritory: 20, largestSingleTerritory: 20, securedRegions: [20], deadlockPieceCount: 0, rank: 1 },
        { playerId: 1, totalTerritory: 14, largestSingleTerritory: 8, securedRegions: [8, 6], deadlockPieceCount: 0, rank: 3 },
        { playerId: 2, totalTerritory: 14, largestSingleTerritory: 10, securedRegions: [10, 4], deadlockPieceCount: 0, rank: 2 },
      ]);
      expect(computeRound2Qualification(caseA)).toEqual({
        status: 'clear',
        survivorId: 0,
        tiedLeaderIds: [],
        defaultFirstPlayerId: 2,
        defaultSecondPlayerId: 1,
        isFirstPlayerOrderTied: false,
      });

      // (b) Clear 1st, exact tie for 2nd/3rd -> deterministic P1 = lower Round 1 ID
      const caseB = makeFinished3pWithScores([
        { playerId: 0, totalTerritory: 20, largestSingleTerritory: 20, securedRegions: [20], deadlockPieceCount: 0, rank: 1 },
        { playerId: 1, totalTerritory: 14, largestSingleTerritory: 8, securedRegions: [8, 6], deadlockPieceCount: 0, rank: 2 },
        { playerId: 2, totalTerritory: 14, largestSingleTerritory: 8, securedRegions: [8, 6], deadlockPieceCount: 0, rank: 2 },
      ]);
      expect(computeRound2Qualification(caseB)).toEqual({
        status: 'clear',
        survivorId: 0,
        tiedLeaderIds: [],
        defaultFirstPlayerId: 1,
        defaultSecondPlayerId: 2,
        isFirstPlayerOrderTied: true,
      });

      // (c) 2-way tie for 1st [1, 1, 3]
      const caseC = makeFinished3pWithScores([
        { playerId: 0, totalTerritory: 18, largestSingleTerritory: 10, securedRegions: [10, 8], deadlockPieceCount: 0, rank: 1 },
        { playerId: 1, totalTerritory: 18, largestSingleTerritory: 10, securedRegions: [10, 8], deadlockPieceCount: 0, rank: 1 },
        { playerId: 2, totalTerritory: 10, largestSingleTerritory: 10, securedRegions: [10], deadlockPieceCount: 0, rank: 3 },
      ]);
      expect(computeRound2Qualification(caseC)).toEqual({
        status: 'tied_for_first',
        survivorId: null,
        tiedLeaderIds: [0, 1],
        defaultFirstPlayerId: 1,
        defaultSecondPlayerId: 2,
        isFirstPlayerOrderTied: false,
      });

      // (d) 3-way tie [1, 1, 1]
      const caseD = makeFinished3pWithScores([
        { playerId: 0, totalTerritory: 15, largestSingleTerritory: 9, securedRegions: [9, 6], deadlockPieceCount: 0, rank: 1 },
        { playerId: 1, totalTerritory: 15, largestSingleTerritory: 9, securedRegions: [9, 6], deadlockPieceCount: 0, rank: 1 },
        { playerId: 2, totalTerritory: 15, largestSingleTerritory: 9, securedRegions: [9, 6], deadlockPieceCount: 0, rank: 1 },
      ]);
      expect(computeRound2Qualification(caseD)).toEqual({
        status: 'three_way_tie',
        survivorId: null,
        tiedLeaderIds: [0, 1, 2],
        defaultFirstPlayerId: 1,
        defaultSecondPlayerId: 2,
        isFirstPlayerOrderTied: true,
      });
    });

    it('creates Prison Match Round 2 preserving attributes, supporting overridePair, and throwing on invalid inputs', () => {
      const finishedWG2 = makeFinished3pWithScores(
        [
          { playerId: 0, totalTerritory: 20, largestSingleTerritory: 20, securedRegions: [20], deadlockPieceCount: 0, rank: 1 },
          { playerId: 1, totalTerritory: 14, largestSingleTerritory: 8, securedRegions: [8, 6], deadlockPieceCount: 0, rank: 3 },
          { playerId: 2, totalTerritory: 14, largestSingleTerritory: 10, securedRegions: [10, 4], deadlockPieceCount: 0, rank: 2 },
        ],
        'wallgo2',
      );

      // Default continuation: P2 (현우, p3, AI hard) is Round 2 P1 (id 0), P1 (지연, p2, AI normal) is Round 2 P2 (id 1)
      const round2 = createPrisonMatchRound2State(finishedWG2);
      expect(round2.isPrisonMatchRound2).toBe(true);
      expect(round2.format).toBe('2p');
      expect(round2.ruleVariant).toBe('wallgo2');
      expect(round2.timerSeconds).toBe(60);
      expect(round2.phase).toBe('placement');
      expect(round2.placementQueue).toEqual([0, 1, 1, 0]);
      expect(round2.players).toEqual([
        { id: 0, name: '현우', colorToken: 'p3', isAI: true, aiDifficulty: 'hard', wallBreaksRemaining: 0 },
        { id: 1, name: '지연', colorToken: 'p2', isAI: true, aiDifficulty: 'normal', wallBreaksRemaining: 0 },
      ]);
      expect(round2.pieces).toHaveLength(4);
      expect(round2.pieces.every((p) => p.kind === 'round')).toBe(true);
      expect(round2.lastPlacedWall).toBeNull();

      // Explicit overridePair [0, 2]
      const overrideR2 = createPrisonMatchRound2State(finishedWG2, [0, 2]);
      expect(overrideR2.players.map((p) => p.colorToken)).toEqual(['p1', 'p3']);

      // Error validation
      expect(() => createPrisonMatchRound2State(finishedWG2, [1, 1])).toThrow(/distinct/);
      expect(() => createPrisonMatchRound2State(finishedWG2, [0, 9])).toThrow(/unknown/);
      const unfinished: GameState = { ...finishedWG2, phase: 'select_piece' };
      expect(() => computeRound2Qualification(unfinished)).toThrow(/finished/);
      expect(() => createPrisonMatchRound2State(unfinished)).toThrow(/finished/);
      expect(() => computeRound2Qualification(round2)).toThrow(/3-player/);
    });
  });
});
