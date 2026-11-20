import { describe, expect, it } from 'vitest';
import {
  analyzeTerritory,
  checkGameEnd,
  createFreshTurnSubState,
  createInitialGameState,
  createPrisonMatchRound2State,
  getLegalWallPlacements,
  getRemainingPlacementKinds,
  getWallGo1BreakableWalls,
  getWallGo1Moves,
  getWallGo2BreakTargets,
  getWallGo2NormalMoves,
  hasWall,
  isInBounds,
  movePiece,
  placeInitialPiece,
  selectPiece,
  shouldAutoSkipPlayer,
  wallKey,
} from '../../engine';
import type {
  AIDifficulty,
  GameFormat,
  GameState,
  LobbyConfig,
  Piece,
  PlacedWall,
  PlayerConfig,
  RuleVariant,
  WallEdge,
  WallKey,
} from '../../engine';
import {
  applyBotTurnAction,
  chooseAiPlacement,
  chooseAiTurn,
  evaluatePosition,
} from '../index';
import type { BotTurnAction } from '../index';

function makeSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === 'object') {
    Object.freeze(obj);
    const values = Object.values(obj as Record<string, unknown>);
    for (let i = 0; i < values.length; i++) {
      deepFreeze(values[i]);
    }
  }
  return obj;
}

function makeAiPlayers(format: GameFormat, difficulties: AIDifficulty[]): PlayerConfig[] {
  const count = format === '3p' ? 3 : 2;
  const tokens: readonly ('p1' | 'p2' | 'p3')[] = ['p1', 'p2', 'p3'];
  const players: PlayerConfig[] = [];
  for (let i = 0; i < count; i++) {
    players.push({
      name: `AI ${i + 1}`,
      colorToken: tokens[i],
      isAI: true,
      aiDifficulty: difficulties[i] ?? difficulties[0],
    });
  }
  return players;
}

function makeWalls(entries: PlacedWall[]): Record<WallKey, PlacedWall> {
  const walls: Record<WallKey, PlacedWall> = {};
  for (let i = 0; i < entries.length; i++) {
    const w = entries[i];
    walls[wallKey(w)] = {
      orientation: w.orientation,
      row: w.row,
      col: w.col,
      ownerId: w.ownerId,
    };
  }
  return walls;
}

function buildPlayState(opts: {
  ruleVariant?: RuleVariant;
  format?: GameFormat;
  pieces: Piece[];
  walls?: PlacedWall[];
  phase?: GameState['phase'];
  currentPlayerIndex?: number;
  wallBreaks?: number[];
  difficulties?: AIDifficulty[];
}): GameState {
  const ruleVariant = opts.ruleVariant ?? 'wallgo1';
  const format = opts.format ?? '3p';
  const difficulties =
    opts.difficulties ?? (format === '3p' ? ['hard', 'hard', 'hard'] : ['hard', 'hard']);
  const base = createInitialGameState({
    ruleVariant,
    format,
    players: makeAiPlayers(format, difficulties),
    shuffleOrder: false,
    timerSeconds: 0,
  });

  const defaultBreak = format === '3p' ? 1 : 0;
  const players = base.players.map((pl, idx) => ({
    ...pl,
    wallBreaksRemaining:
      opts.wallBreaks !== undefined && opts.wallBreaks[idx] !== undefined
        ? opts.wallBreaks[idx]
        : defaultBreak,
  }));

  const draft: GameState = {
    ...base,
    players,
    pieces: opts.pieces.map((p) => ({ ...p })),
    walls: makeWalls(opts.walls ?? []),
    phase: opts.phase ?? 'select_piece',
    placementStep: base.placementQueue.length,
    currentPlayerIndex: opts.currentPlayerIndex ?? 0,
    turnNumber: 0,
    turnSubState: createFreshTurnSubState('square'),
  };

  return {
    ...draft,
    territory: analyzeTerritory(draft),
  };
}

function runFullAiGame(
  config: LobbyConfig,
  rng: () => number,
  hardTurnBudgetMs?: number,
): {
  finalState: GameState;
  placementCount: number;
  maxObservedHardMs: number;
  hardTurnCount: number;
} {
  let state = createInitialGameState(config, rng);
  let placementCount = 0;

  while (state.phase === 'placement') {
    const pid = state.placementQueue[state.placementStep];
    const diff = state.players[pid].aiDifficulty;
    const placement = chooseAiPlacement(state, diff, rng);
    const next = placeInitialPiece(
      state,
      { row: placement.row, col: placement.col },
      placement.kind,
    );
    expect(next).not.toBe(state);
    state = next;
    placementCount++;
  }

  const maxTurns = config.format === '3p' ? 87 : 84;
  let maxObservedHardMs = 0;
  let hardTurnCount = 0;

  while (state.phase !== 'game_over') {
    expect(state.phase).toBe('select_piece');
    expect(state.turnNumber).toBeLessThan(maxTurns);

    const actor = state.players[state.currentPlayerIndex];
    const t0 = performance.now();
    const action = chooseAiTurn(state, actor.aiDifficulty, rng);
    const elapsed = performance.now() - t0;

    if (actor.aiDifficulty === 'hard') {
      hardTurnCount++;
      if (elapsed > maxObservedHardMs) {
        maxObservedHardMs = elapsed;
      }
      if (hardTurnBudgetMs !== undefined) {
        expect(elapsed).toBeLessThan(hardTurnBudgetMs);
      }
    }

    const next = applyBotTurnAction(state, action);
    expect(next.turnNumber).toBe(state.turnNumber + 1);
    state = next;
  }

  expect(state.phase).toBe('game_over');
  expect(state.territory.isGameOver).toBe(true);
  expect(['all_separated', 'deadlock']).toContain(state.territory.endReason);
  expect(state.turnNumber).toBeLessThanOrEqual(maxTurns);

  const totalCells = state.territory.components.reduce((sum, c) => sum + c.size, 0);
  expect(totalCells).toBe(49);

  for (let i = 0; i < state.players.length; i++) {
    expect(state.players[i].wallBreaksRemaining).toBeGreaterThanOrEqual(0);
    if (config.format === '2p') {
      expect(state.players[i].wallBreaksRemaining).toBe(0);
    }
  }

  return {
    finalState: state,
    placementCount,
    maxObservedHardMs,
    hardTurnCount,
  };
}

// =============================================================================
// Section A: Opening Placement (F21)
// =============================================================================
describe('Section A: Opening Placement (F21)', () => {
  const STRATEGIC_HUBS = new Set(['2,2', '2,4', '4,2', '4,4', '3,3']);
  const CORNERS = new Set(['0,0', '0,6', '6,0', '6,6']);

  it('A1: normal and hard prefer strategic hubs (C3, E3, C5, E5, D4) and avoid corners on empty 3P board', () => {
    const variants: RuleVariant[] = ['wallgo1', 'wallgo2'];
    const difficulties: AIDifficulty[] = ['normal', 'hard'];
    const seeds = [1, 2, 3, 4, 5];

    for (let v = 0; v < variants.length; v++) {
      const ruleVariant = variants[v];
      const state = createInitialGameState({
        ruleVariant,
        format: '3p',
        players: makeAiPlayers('3p', ['hard', 'hard', 'hard']),
        shuffleOrder: false,
        timerSeconds: 0,
      });

      for (let d = 0; d < difficulties.length; d++) {
        const diff = difficulties[d];
        for (let s = 0; s < seeds.length; s++) {
          const action = chooseAiPlacement(state, diff, makeSeededRng(seeds[s]));
          expect(isInBounds(action.row, action.col)).toBe(true);
          const coordKey = `${action.row},${action.col}`;
          expect(STRATEGIC_HUBS.has(coordKey)).toBe(true);
          expect(CORNERS.has(coordKey)).toBe(false);

          if (ruleVariant === 'wallgo1') {
            expect(action.kind).toBe('standard');
          } else {
            expect(['square', 'round']).toContain(action.kind);
          }

          const next = placeInitialPiece(
            state,
            { row: action.row, col: action.col },
            action.kind,
          );
          expect(next).not.toBe(state);
        }
      }
    }
  });

  it('A2: normal and hard spread own 2nd piece to optimal Manhattan distance 3..5', () => {
    let state = createInitialGameState({
      ruleVariant: 'wallgo1',
      format: '3p',
      players: makeAiPlayers('3p', ['hard', 'hard', 'hard']),
      shuffleOrder: false,
      timerSeconds: 0,
    });

    // Queue [0, 1, 2, 2, 1, 0]: place steps 0..4 leaving P0's 2nd placement at step 5
    const openingMoves = [
      { row: 2, col: 2 }, // P0: C3
      { row: 2, col: 4 }, // P1: E3
      { row: 4, col: 2 }, // P2: C5
      { row: 1, col: 5 }, // P2: F2
      { row: 5, col: 1 }, // P1: B6
    ];
    for (let i = 0; i < openingMoves.length; i++) {
      const next = placeInitialPiece(state, openingMoves[i], 'standard');
      expect(next).not.toBe(state);
      state = next;
    }

    expect(state.phase).toBe('placement');
    expect(state.placementStep).toBe(5);
    expect(state.currentPlayerIndex).toBe(0);

    const difficulties: AIDifficulty[] = ['normal', 'hard'];
    const seeds = [11, 22, 33];
    for (let d = 0; d < difficulties.length; d++) {
      for (let s = 0; s < seeds.length; s++) {
        const action = chooseAiPlacement(state, difficulties[d], makeSeededRng(seeds[s]));
        const dist = Math.abs(action.row - 2) + Math.abs(action.col - 2);
        expect(dist).toBeGreaterThanOrEqual(3);
        expect(dist).toBeLessThanOrEqual(5);
        expect(
          placeInitialPiece(state, { row: action.row, col: action.col }, action.kind),
        ).not.toBe(state);
      }
    }
  });

  it('A3: Wall Go II 3P assigns valid remaining piece kinds and 2P places only square avoiding fixed cells', () => {
    const difficulties: AIDifficulty[] = ['easy', 'normal', 'hard'];
    const fixed2p = new Set(['1,1', '5,5', '1,5', '5,1']);

    for (let d = 0; d < difficulties.length; d++) {
      const diff = difficulties[d];
      const rng3p = makeSeededRng(300 + d);
      let state3p = createInitialGameState({
        ruleVariant: 'wallgo2',
        format: '3p',
        players: makeAiPlayers('3p', [diff, diff, diff]),
        shuffleOrder: false,
        timerSeconds: 0,
      });

      for (let step = 0; step < 6; step++) {
        const pid = state3p.placementQueue[state3p.placementStep];
        const remaining = getRemainingPlacementKinds(state3p, pid);
        const action = chooseAiPlacement(state3p, diff, rng3p);

        if (step < 3) {
          expect(remaining).toEqual(['square', 'round']);
          expect(['square', 'round']).toContain(action.kind);
        } else {
          expect(remaining).toHaveLength(1);
          expect(action.kind).toBe(remaining[0]);
        }

        const next = placeInitialPiece(
          state3p,
          { row: action.row, col: action.col },
          action.kind,
        );
        expect(next).not.toBe(state3p);
        state3p = next;
      }

      expect(state3p.phase).toBe('select_piece');
      expect(state3p.pieces).toHaveLength(6);
      const uniquePos3p = new Set(state3p.pieces.map((p) => `${p.row},${p.col}`));
      expect(uniquePos3p.size).toBe(6);
      for (let pid = 0; pid < 3; pid++) {
        const kinds = state3p.pieces
          .filter((p) => p.ownerId === pid)
          .map((p) => p.kind)
          .slice()
          .sort();
        expect(kinds).toEqual(['round', 'square']);
      }

      const rng2p = makeSeededRng(400 + d);
      let state2p = createInitialGameState({
        ruleVariant: 'wallgo2',
        format: '2p',
        players: makeAiPlayers('2p', [diff, diff]),
        shuffleOrder: false,
        timerSeconds: 0,
      });

      for (let step = 0; step < 4; step++) {
        const action = chooseAiPlacement(state2p, diff, rng2p);
        expect(action.kind).toBe('square');
        expect(fixed2p.has(`${action.row},${action.col}`)).toBe(false);
        expect(
          state2p.pieces.some((p) => p.row === action.row && p.col === action.col),
        ).toBe(false);

        const next = placeInitialPiece(
          state2p,
          { row: action.row, col: action.col },
          action.kind,
        );
        expect(next).not.toBe(state2p);
        state2p = next;
      }

      expect(state2p.phase).toBe('select_piece');
      expect(state2p.pieces).toHaveLength(8);
      expect(state2p.pieces.filter((p) => p.kind === 'round')).toHaveLength(4);
      expect(state2p.pieces.filter((p) => p.kind === 'square')).toHaveLength(4);
    }
  });

  it('A4: easy placement is valid across 10 seeds and chooseAiPlacement throws on non-placement phases', () => {
    const variants: RuleVariant[] = ['wallgo1', 'wallgo2'];
    const formats: GameFormat[] = ['3p', '2p'];

    for (let v = 0; v < variants.length; v++) {
      for (let f = 0; f < formats.length; f++) {
        for (let seed = 100; seed <= 109; seed++) {
          const rng = makeSeededRng(seed + v * 1000 + f * 500);
          let state = createInitialGameState({
            ruleVariant: variants[v],
            format: formats[f],
            players: makeAiPlayers(formats[f], ['easy', 'easy', 'easy']),
            shuffleOrder: false,
            timerSeconds: 0,
          });
          while (state.phase === 'placement') {
            const action = chooseAiPlacement(state, 'easy', rng);
            expect(isInBounds(action.row, action.col)).toBe(true);
            expect(
              state.pieces.some((p) => p.row === action.row && p.col === action.col),
            ).toBe(false);
            const next = placeInitialPiece(
              state,
              { row: action.row, col: action.col },
              action.kind,
            );
            expect(next).not.toBe(state);
            state = next;
          }
          expect(state.phase).toBe('select_piece');
        }
      }
    }

    const playState = buildPlayState({
      ruleVariant: 'wallgo1',
      format: '3p',
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 2, col: 2 },
        { id: 'p0_1', ownerId: 0, kind: 'standard', row: 4, col: 4 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 2, col: 4 },
        { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 1 },
        { id: 'p2_0', ownerId: 2, kind: 'standard', row: 4, col: 2 },
        { id: 'p2_1', ownerId: 2, kind: 'standard', row: 1, col: 5 },
      ],
    });
    const overState: GameState = { ...playState, phase: 'game_over' };
    expect(() => chooseAiPlacement(playState, 'normal', makeSeededRng(1))).toThrow(Error);
    expect(() => chooseAiPlacement(overState, 'hard', makeSeededRng(1))).toThrow(Error);
  });
});

// =============================================================================
// Section B: Full 12-Combination Self-Play Matrix + Mixed Difficulty + Round 2
// =============================================================================
describe('Section B: Full Self-Play Matrix, Mixed Difficulty & Prison Match Round 2', () => {
  const selfPlayCases: readonly [GameFormat, RuleVariant, AIDifficulty, number][] = [
    ['3p', 'wallgo1', 'easy', 1001],
    ['3p', 'wallgo1', 'normal', 1002],
    ['3p', 'wallgo1', 'hard', 1003],
    ['3p', 'wallgo2', 'easy', 1004],
    ['3p', 'wallgo2', 'normal', 1005],
    ['3p', 'wallgo2', 'hard', 1006],
    ['2p', 'wallgo1', 'easy', 1007],
    ['2p', 'wallgo1', 'normal', 1008],
    ['2p', 'wallgo1', 'hard', 1009],
    ['2p', 'wallgo2', 'easy', 1010],
    ['2p', 'wallgo2', 'normal', 1011],
    ['2p', 'wallgo2', 'hard', 1012],
  ];

  it.each(selfPlayCases)(
    'B1: full self-play completes legally (%s / %s / %s, seed=%i)',
    (format, ruleVariant, difficulty, seed) => {
      const config: LobbyConfig = {
        ruleVariant,
        format,
        players: makeAiPlayers(format, [difficulty, difficulty, difficulty]),
        shuffleOrder: false,
        timerSeconds: 0,
      };
      const result = runFullAiGame(
        config,
        makeSeededRng(seed),
        difficulty === 'hard' ? 200 : undefined,
      );
      expect(result.placementCount).toBe(format === '3p' ? 6 : 4);
      if (difficulty === 'hard') {
        expect(result.hardTurnCount).toBeGreaterThan(0);
        expect(result.maxObservedHardMs).toBeLessThan(200);
      }
    },
    15_000,
  );

  it(
    'B2: mixed-difficulty 3P self-play (hard vs normal vs easy) completes in both variants',
    () => {
      const variants: readonly [RuleVariant, number][] = [
        ['wallgo1', 2001],
        ['wallgo2', 2002],
      ];
      for (let i = 0; i < variants.length; i++) {
        const [ruleVariant, seed] = variants[i];
        const res = runFullAiGame(
          {
            ruleVariant,
            format: '3p',
            players: makeAiPlayers('3p', ['hard', 'normal', 'easy']),
            shuffleOrder: false,
            timerSeconds: 0,
          },
          makeSeededRng(seed),
          200,
        );
        expect(res.finalState.phase).toBe('game_over');
        expect(res.maxObservedHardMs).toBeLessThan(200);
      }
    },
    15_000,
  );

  it(
    'B3: Prison Match Round 2 continuation (3P -> 2P) completes cleanly in both variants',
    () => {
      const variants: readonly [RuleVariant, number][] = [
        ['wallgo1', 3001],
        ['wallgo2', 3002],
      ];

      for (let i = 0; i < variants.length; i++) {
        const [ruleVariant, seed] = variants[i];
        const rng = makeSeededRng(seed);
        const r1 = runFullAiGame(
          {
            ruleVariant,
            format: '3p',
            players: makeAiPlayers('3p', ['normal', 'normal', 'normal']),
            shuffleOrder: false,
            timerSeconds: 0,
          },
          rng,
        );

        let r2 = createPrisonMatchRound2State(r1.finalState);
        expect(r2.isPrisonMatchRound2).toBe(true);
        expect(r2.format).toBe('2p');
        expect(r2.phase).toBe('placement');
        expect(r2.pieces).toHaveLength(4);
        expect(r2.players.every((p) => p.wallBreaksRemaining === 0)).toBe(true);

        while (r2.phase === 'placement') {
          const pid = r2.placementQueue[r2.placementStep];
          const placement = chooseAiPlacement(r2, r2.players[pid].aiDifficulty, rng);
          const next = placeInitialPiece(
            r2,
            { row: placement.row, col: placement.col },
            placement.kind,
          );
          expect(next).not.toBe(r2);
          r2 = next;
        }

        while (r2.phase !== 'game_over') {
          expect(r2.turnNumber).toBeLessThan(84);
          const actor = r2.players[r2.currentPlayerIndex];
          const action = chooseAiTurn(r2, actor.aiDifficulty, rng);
          r2 = applyBotTurnAction(r2, action);
        }

        expect(r2.phase).toBe('game_over');
        expect(r2.isPrisonMatchRound2).toBe(true);
        expect(r2.turnNumber).toBeLessThanOrEqual(84);
        const totalCells = r2.territory.components.reduce((sum, c) => sum + c.size, 0);
        expect(totalCells).toBe(49);
      }
    },
    15_000,
  );
});

// =============================================================================
// Section C: E27 Wall-Break-Only Escape (Wall Go I & Wall Go II)
// =============================================================================
describe('Section C: E27 Wall-Break-Only Escape (Wall Go I & Wall Go II)', () => {
  const allDiffs: AIDifficulty[] = ['easy', 'normal', 'hard'];

  it('C1: Wall Go I escapes when all own pieces have 0 normal moves and respects E08 soft-lock immunity', () => {
    const state = buildPlayState({
      ruleVariant: 'wallgo1',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [1, 1, 1],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
        { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 0 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 1 },
        { id: 'p1_1', ownerId: 1, kind: 'standard', row: 0, col: 6 },
        { id: 'p2_0', ownerId: 2, kind: 'standard', row: 1, col: 0 },
        { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 6 },
      ],
      walls: [
        { orientation: 'h', row: 2, col: 3, ownerId: 1 },
        { orientation: 'h', row: 3, col: 3, ownerId: 1 },
        { orientation: 'v', row: 3, col: 2, ownerId: 2 },
        { orientation: 'v', row: 3, col: 3, ownerId: 2 },
        { orientation: 'h', row: 0, col: 0, ownerId: 1 },
        { orientation: 'v', row: 0, col: 0, ownerId: 2 },
      ],
    });

    // Non-vacuous preconditions
    expect(checkGameEnd(state).isGameOver).toBe(false);
    expect(shouldAutoSkipPlayer(state, 0)).toBe(false);
    expect(getWallGo1Moves(state, 'p0_0')).toEqual([]);
    expect(getWallGo1Moves(state, 'p0_1')).toEqual([]);
    expect(getWallGo1BreakableWalls(state, 'p0_1')).toEqual([]);
    expect(getWallGo1BreakableWalls(state, 'p0_0')).toHaveLength(4);

    for (let i = 0; i < allDiffs.length; i++) {
      const diff = allDiffs[i];
      const action = chooseAiTurn(state, diff, makeSeededRng(501 + i));
      expect(action.pieceId).toBe('p0_0');
      expect(action.useWallBreak).toBe(true);
      expect(action.breakWall).not.toBeNull();
      expect(['h:2:3', 'h:3:3', 'v:3:2', 'v:3:3']).toContain(wallKey(action.breakWall!));

      const next = applyBotTurnAction(state, action);
      expect(next.players[0].wallBreaksRemaining).toBe(0);
      expect(next.turnNumber).toBe(1);
    }
  });

  it('C2a: Wall Go II square piece escapes when boxed in and round piece is piece-blocked', () => {
    const state = buildPlayState({
      ruleVariant: 'wallgo2',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [1, 1, 1],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'square', row: 3, col: 3 },
        { id: 'p0_1', ownerId: 0, kind: 'round', row: 0, col: 0 },
        { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 1 },
        { id: 'p1_1', ownerId: 1, kind: 'round', row: 0, col: 6 },
        { id: 'p2_0', ownerId: 2, kind: 'round', row: 1, col: 0 },
        { id: 'p2_1', ownerId: 2, kind: 'square', row: 6, col: 6 },
      ],
      walls: [
        { orientation: 'h', row: 2, col: 3, ownerId: 1 },
        { orientation: 'h', row: 3, col: 3, ownerId: 1 },
        { orientation: 'v', row: 3, col: 2, ownerId: 2 },
        { orientation: 'v', row: 3, col: 3, ownerId: 2 },
      ],
    });

    expect(checkGameEnd(state).isGameOver).toBe(false);
    expect(getWallGo2NormalMoves(state, 'p0_0')).toEqual([]);
    expect(getWallGo2NormalMoves(state, 'p0_1')).toEqual([]);
    expect(getWallGo2BreakTargets(state, 'p0_1')).toEqual([]);
    expect(getWallGo2BreakTargets(state, 'p0_0')).toHaveLength(8);

    for (let i = 0; i < allDiffs.length; i++) {
      const diff = allDiffs[i];
      const action = chooseAiTurn(state, diff, makeSeededRng(511 + i));
      expect(action.pieceId).toBe('p0_0');
      expect(action.useWallBreak).toBe(true);
      expect(action.breakWall).not.toBeNull();
      expect(['h:2:3', 'h:3:3', 'v:3:2', 'v:3:3']).toContain(wallKey(action.breakWall!));

      const next = applyBotTurnAction(state, action);
      expect(next.players[0].wallBreaksRemaining).toBe(0);
      expect(next.turnNumber).toBe(1);
    }
  });

  it('C2b: Wall Go II round piece boxed in corner escapes cleanly (incl. ambiguous diagonal)', () => {
    const state = buildPlayState({
      ruleVariant: 'wallgo2',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [1, 1, 1],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'round', row: 0, col: 0 },
        { id: 'p0_1', ownerId: 0, kind: 'square', row: 6, col: 6 },
        { id: 'p1_0', ownerId: 1, kind: 'square', row: 5, col: 6 },
        { id: 'p1_1', ownerId: 1, kind: 'round', row: 3, col: 6 },
        { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 5 },
        { id: 'p2_1', ownerId: 2, kind: 'square', row: 6, col: 3 },
      ],
      walls: [
        { orientation: 'h', row: 0, col: 0, ownerId: 1 },
        { orientation: 'v', row: 0, col: 0, ownerId: 2 },
      ],
    });

    expect(getWallGo2NormalMoves(state, 'p0_0')).toEqual([]);
    expect(getWallGo2NormalMoves(state, 'p0_1')).toEqual([]);
    expect(getWallGo2BreakTargets(state, 'p0_1')).toEqual([]);
    expect(getWallGo2BreakTargets(state, 'p0_0')).toHaveLength(3);

    for (let i = 0; i < allDiffs.length; i++) {
      const diff = allDiffs[i];
      const action = chooseAiTurn(state, diff, makeSeededRng(521 + i));
      expect(action.pieceId).toBe('p0_0');
      expect(action.useWallBreak).toBe(true);
      expect(action.breakWall).not.toBeNull();
      expect(['h:0:0', 'v:0:0']).toContain(wallKey(action.breakWall!));

      const next = applyBotTurnAction(state, action);
      expect(next.players[0].wallBreaksRemaining).toBe(0);
      expect(next.turnNumber).toBe(1);
    }
  });
});

// =============================================================================
// Section D: Wall Go II E13 Ambiguous Diagonal, E14 Deliberate Smash & E10 Reseal
// =============================================================================
describe('Section D: Wall Go II E13 Ambiguous Diagonal, E14 Deliberate Smash & E10 Reseal', () => {
  function makeE13State(): GameState {
    return buildPlayState({
      ruleVariant: 'wallgo2',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [1, 1, 1],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'round', row: 3, col: 3 },
        { id: 'p0_1', ownerId: 0, kind: 'square', row: 0, col: 3 },
        { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 0 },
        { id: 'p1_1', ownerId: 1, kind: 'round', row: 0, col: 6 },
        { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        { id: 'p2_1', ownerId: 2, kind: 'square', row: 6, col: 0 },
      ],
      walls: [
        { orientation: 'v', row: 3, col: 3, ownerId: 1 },
        { orientation: 'h', row: 3, col: 3, ownerId: 2 },
      ],
    });
  }

  it('D1 & D2: applies BOTH candidate walls (v(3,3) and h(3,3)) on E13 ambiguous diagonal', () => {
    const state = makeE13State();

    // D1: Break v(3,3)
    const nextA = applyBotTurnAction(state, {
      pieceId: 'p0_0',
      useWallBreak: true,
      breakWall: { orientation: 'v', row: 3, col: 3 },
      destination: { row: 4, col: 4 },
      placeWall: { orientation: 'h', row: 4, col: 4 },
    });
    expect(hasWall(nextA.walls, { orientation: 'v', row: 3, col: 3 })).toBe(false);
    expect(nextA.walls['h:3:3']).toEqual({ orientation: 'h', row: 3, col: 3, ownerId: 2 });
    expect(nextA.pieces.find((p) => p.id === 'p0_0')).toMatchObject({ row: 4, col: 4 });
    expect(nextA.walls['h:4:4']).toEqual({ orientation: 'h', row: 4, col: 4, ownerId: 0 });
    expect(nextA.lastPlacedWall).toEqual({ orientation: 'h', row: 4, col: 4 });
    expect(nextA.players[0].wallBreaksRemaining).toBe(0);
    expect(nextA.turnNumber).toBe(1);
    expect(nextA.phase).toBe('select_piece');

    // D2: Break h(3,3)
    const nextB = applyBotTurnAction(state, {
      pieceId: 'p0_0',
      useWallBreak: true,
      breakWall: { orientation: 'h', row: 3, col: 3 },
      destination: { row: 4, col: 4 },
      placeWall: { orientation: 'v', row: 4, col: 4 },
    });
    expect(hasWall(nextB.walls, { orientation: 'h', row: 3, col: 3 })).toBe(false);
    expect(nextB.walls['v:3:3']).toEqual({ orientation: 'v', row: 3, col: 3, ownerId: 1 });
    expect(nextB.pieces.find((p) => p.id === 'p0_0')).toMatchObject({ row: 4, col: 4 });
    expect(nextB.walls['v:4:4']).toEqual({ orientation: 'v', row: 4, col: 4, ownerId: 0 });
    expect(nextB.players[0].wallBreaksRemaining).toBe(0);
    expect(nextB.turnNumber).toBe(1);
  });

  it('D3: rejects wrong breakWall on BOTH 1-wall path break and 2-wall ambiguous diagonal', () => {
    const state = makeE13State();

    // 1-wall target (3,3) -> (3,4) requires breakWall v(3,3), NOT h(3,3) or h(0,0)
    expect(() =>
      applyBotTurnAction(state, {
        pieceId: 'p0_0',
        useWallBreak: true,
        breakWall: { orientation: 'h', row: 3, col: 3 },
        destination: { row: 3, col: 4 },
        placeWall: { orientation: 'h', row: 3, col: 4 },
      }),
    ).toThrow(Error);

    expect(() =>
      applyBotTurnAction(state, {
        pieceId: 'p0_0',
        useWallBreak: true,
        breakWall: { orientation: 'h', row: 0, col: 0 },
        destination: { row: 3, col: 4 },
        placeWall: { orientation: 'h', row: 3, col: 4 },
      }),
    ).toThrow(Error);

    // 2-wall ambiguous diagonal (3,3) -> (4,4) with unrelated wall h(0,0)
    expect(() =>
      applyBotTurnAction(state, {
        pieceId: 'p0_0',
        useWallBreak: true,
        breakWall: { orientation: 'h', row: 0, col: 0 },
        destination: { row: 4, col: 4 },
        placeWall: { orientation: 'h', row: 4, col: 4 },
      }),
    ).toThrow(Error);
  });

  it('D4: supports E14 deliberate smash vs normal diagonal move via applyBotTurnAction', () => {
    const state = buildPlayState({
      ruleVariant: 'wallgo2',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [1, 1, 1],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'round', row: 3, col: 3 },
        { id: 'p0_1', ownerId: 0, kind: 'square', row: 0, col: 3 },
        { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 0 },
        { id: 'p1_1', ownerId: 1, kind: 'round', row: 0, col: 6 },
        { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        { id: 'p2_1', ownerId: 2, kind: 'square', row: 6, col: 0 },
      ],
      walls: [{ orientation: 'h', row: 3, col: 3, ownerId: 2 }],
    });

    // Deliberate smash of h(3,3) while moving to (4,4)
    const smashed = applyBotTurnAction(state, {
      pieceId: 'p0_0',
      useWallBreak: true,
      breakWall: { orientation: 'h', row: 3, col: 3 },
      destination: { row: 4, col: 4 },
      placeWall: { orientation: 'h', row: 4, col: 4 },
    });
    expect(hasWall(smashed.walls, { orientation: 'h', row: 3, col: 3 })).toBe(false);
    expect(smashed.players[0].wallBreaksRemaining).toBe(0);

    // Normal diagonal via open Path A preserves h(3,3)
    const normal = applyBotTurnAction(state, {
      pieceId: 'p0_0',
      useWallBreak: false,
      breakWall: null,
      destination: { row: 4, col: 4 },
      placeWall: { orientation: 'h', row: 4, col: 4 },
    });
    expect(hasWall(normal.walls, { orientation: 'h', row: 3, col: 3 })).toBe(true);
    expect(normal.players[0].wallBreaksRemaining).toBe(1);
  });

  it('D5: supports E10 breaking own wall and resealing the exact same edge in WG1 and WG2', () => {
    const wg1State = buildPlayState({
      ruleVariant: 'wallgo1',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [1, 1, 1],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
        { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 3 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
        { id: 'p1_1', ownerId: 1, kind: 'standard', row: 0, col: 6 },
        { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 0 },
      ],
      walls: [{ orientation: 'v', row: 3, col: 3, ownerId: 0 }],
    });
    const wg1Resealed = applyBotTurnAction(wg1State, {
      pieceId: 'p0_0',
      useWallBreak: true,
      breakWall: { orientation: 'v', row: 3, col: 3 },
      destination: { row: 3, col: 4 },
      placeWall: { orientation: 'v', row: 3, col: 3 },
    });
    expect(wg1Resealed.walls['v:3:3']).toEqual({
      orientation: 'v',
      row: 3,
      col: 3,
      ownerId: 0,
    });
    expect(wg1Resealed.players[0].wallBreaksRemaining).toBe(0);

    const wg2State = buildPlayState({
      ruleVariant: 'wallgo2',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [1, 1, 1],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'square', row: 3, col: 3 },
        { id: 'p0_1', ownerId: 0, kind: 'round', row: 0, col: 3 },
        { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 0 },
        { id: 'p1_1', ownerId: 1, kind: 'round', row: 0, col: 6 },
        { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        { id: 'p2_1', ownerId: 2, kind: 'square', row: 6, col: 0 },
      ],
      walls: [{ orientation: 'v', row: 3, col: 3, ownerId: 0 }],
    });
    const wg2Resealed = applyBotTurnAction(wg2State, {
      pieceId: 'p0_0',
      useWallBreak: true,
      breakWall: { orientation: 'v', row: 3, col: 3 },
      destination: { row: 3, col: 4 },
      placeWall: { orientation: 'v', row: 3, col: 3 },
    });
    expect(wg2Resealed.walls['v:3:3']).toEqual({
      orientation: 'v',
      row: 3,
      col: 3,
      ownerId: 0,
    });
    expect(wg2Resealed.players[0].wallBreaksRemaining).toBe(0);
  });
});

// =============================================================================
// Section E: applyBotTurnAction 8-Category Rule-Enforcement Negative Tests
// =============================================================================
describe('Section E: applyBotTurnAction Rule-Enforcement Negative Tests', () => {
  const wg1Base = buildPlayState({
    ruleVariant: 'wallgo1',
    format: '3p',
    currentPlayerIndex: 0,
    wallBreaks: [1, 1, 1],
    pieces: [
      { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
      { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 0 },
      { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 1 },
      { id: 'p1_1', ownerId: 1, kind: 'standard', row: 0, col: 6 },
      { id: 'p2_0', ownerId: 2, kind: 'standard', row: 1, col: 0 },
      { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 6 },
    ],
    walls: [
      { orientation: 'v', row: 3, col: 3, ownerId: 1 },
      { orientation: 'h', row: 0, col: 0, ownerId: 1 },
      { orientation: 'v', row: 0, col: 0, ownerId: 2 },
      { orientation: 'h', row: 5, col: 5, ownerId: 2 },
    ],
  });

  const validWg1Action: BotTurnAction = {
    pieceId: 'p0_0',
    useWallBreak: false,
    breakWall: null,
    destination: { row: 3, col: 2 },
    placeWall: { orientation: 'h', row: 3, col: 2 },
  };

  it('E1: rejects wrong phase (placement, move_piece, place_wall, game_over) and chooseAiTurn wrong phase', () => {
    const placementState = createInitialGameState({
      ruleVariant: 'wallgo1',
      format: '3p',
      players: makeAiPlayers('3p', ['hard', 'hard', 'hard']),
      shuffleOrder: false,
      timerSeconds: 0,
    });
    const movePieceState = selectPiece(wg1Base, 'p0_0');
    const placeWallState = movePiece(movePieceState, { row: 3, col: 2 });
    const gameOverState: GameState = { ...wg1Base, phase: 'game_over' };

    expect(() => applyBotTurnAction(placementState, validWg1Action)).toThrow(Error);
    expect(() => applyBotTurnAction(movePieceState, validWg1Action)).toThrow(Error);
    expect(() => applyBotTurnAction(placeWallState, validWg1Action)).toThrow(Error);
    expect(() => applyBotTurnAction(gameOverState, validWg1Action)).toThrow(Error);

    expect(() => chooseAiTurn(placementState, 'normal', makeSeededRng(1))).toThrow(Error);
    expect(() => chooseAiTurn(movePieceState, 'hard', makeSeededRng(1))).toThrow(Error);
    expect(() => chooseAiTurn(gameOverState, 'easy', makeSeededRng(1))).toThrow(Error);

    // Zero legal actions for active player (all pieces trapped, 0 wall breaks)
    const noActionState = buildPlayState({
      ruleVariant: 'wallgo1',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [0, 1, 1],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
        { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 0 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 1 },
        { id: 'p1_1', ownerId: 1, kind: 'standard', row: 0, col: 6 },
        { id: 'p2_0', ownerId: 2, kind: 'standard', row: 1, col: 0 },
        { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 6 },
      ],
      walls: [
        { orientation: 'h', row: 2, col: 3, ownerId: 1 },
        { orientation: 'h', row: 3, col: 3, ownerId: 1 },
        { orientation: 'v', row: 3, col: 2, ownerId: 2 },
        { orientation: 'v', row: 3, col: 3, ownerId: 2 },
        { orientation: 'h', row: 0, col: 0, ownerId: 1 },
        { orientation: 'v', row: 0, col: 0, ownerId: 2 },
      ],
    });
    expect(() => chooseAiTurn(noActionState, 'easy', makeSeededRng(1))).toThrow(Error);
    expect(() => chooseAiTurn(noActionState, 'normal', makeSeededRng(1))).toThrow(Error);
    expect(() => chooseAiTurn(noActionState, 'hard', makeSeededRng(1))).toThrow(Error);
  });

  it('E2: rejects wrong owner piece and unknown pieceId', () => {
    expect(() =>
      applyBotTurnAction(wg1Base, {
        ...validWg1Action,
        pieceId: 'p1_0',
        destination: { row: 0, col: 2 },
        placeWall: { orientation: 'h', row: 0, col: 2 },
      }),
    ).toThrow(Error);

    expect(() =>
      applyBotTurnAction(wg1Base, {
        ...validWg1Action,
        pieceId: 'p9_9',
      }),
    ).toThrow(Error);
  });

  it('E3: rejects illegal Wall Go I destinations (3-step, occupied, blocked stay)', () => {
    // 3-step destination
    expect(() =>
      applyBotTurnAction(wg1Base, {
        pieceId: 'p0_0',
        useWallBreak: false,
        breakWall: null,
        destination: { row: 3, col: 0 },
        placeWall: { orientation: 'h', row: 3, col: 0 },
      }),
    ).toThrow(Error);

    // Occupied cell (0,1)
    expect(() =>
      applyBotTurnAction(wg1Base, {
        pieceId: 'p0_0',
        useWallBreak: false,
        breakWall: null,
        destination: { row: 0, col: 1 },
        placeWall: { orientation: 'h', row: 0, col: 1 },
      }),
    ).toThrow(Error);

    // Blocked 0-step stay when boxed by 4 walls
    const boxedState = buildPlayState({
      ruleVariant: 'wallgo1',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [1, 1, 1],
      pieces: wg1Base.pieces,
      walls: [
        { orientation: 'h', row: 2, col: 3, ownerId: 1 },
        { orientation: 'h', row: 3, col: 3, ownerId: 1 },
        { orientation: 'v', row: 3, col: 2, ownerId: 2 },
        { orientation: 'v', row: 3, col: 3, ownerId: 2 },
      ],
    });
    expect(() =>
      applyBotTurnAction(boxedState, {
        pieceId: 'p0_0',
        useWallBreak: false,
        breakWall: null,
        destination: { row: 3, col: 3 },
        placeWall: { orientation: 'h', row: 2, col: 3 },
      }),
    ).toThrow(Error);
  });

  it('E4: rejects illegal Wall Go II destinations (square diagonal, round straight-2, 0-step stay)', () => {
    const wg2Base = buildPlayState({
      ruleVariant: 'wallgo2',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [1, 1, 1],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'square', row: 3, col: 3 },
        { id: 'p0_1', ownerId: 0, kind: 'round', row: 3, col: 1 },
        { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 0 },
        { id: 'p1_1', ownerId: 1, kind: 'round', row: 0, col: 6 },
        { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 6 },
        { id: 'p2_1', ownerId: 2, kind: 'square', row: 6, col: 0 },
      ],
    });

    // square diagonal
    expect(() =>
      applyBotTurnAction(wg2Base, {
        pieceId: 'p0_0',
        useWallBreak: false,
        breakWall: null,
        destination: { row: 4, col: 4 },
        placeWall: { orientation: 'h', row: 4, col: 4 },
      }),
    ).toThrow(Error);

    // round straight-2
    expect(() =>
      applyBotTurnAction(wg2Base, {
        pieceId: 'p0_1',
        useWallBreak: false,
        breakWall: null,
        destination: { row: 1, col: 1 },
        placeWall: { orientation: 'h', row: 1, col: 1 },
      }),
    ).toThrow(Error);

    // 0-step stay on square and round
    expect(() =>
      applyBotTurnAction(wg2Base, {
        pieceId: 'p0_0',
        useWallBreak: false,
        breakWall: null,
        destination: { row: 3, col: 3 },
        placeWall: { orientation: 'h', row: 3, col: 3 },
      }),
    ).toThrow(Error);
    expect(() =>
      applyBotTurnAction(wg2Base, {
        pieceId: 'p0_1',
        useWallBreak: false,
        breakWall: null,
        destination: { row: 3, col: 1 },
        placeWall: { orientation: 'h', row: 3, col: 1 },
      }),
    ).toThrow(Error);
  });

  it('E5: rejects illegal placeWall (occupied, non-adjacent, perimeter/out-of-bounds)', () => {
    // Occupied wall v(3,3) adjacent to stay-at-(3,3)
    expect(() =>
      applyBotTurnAction(wg1Base, {
        pieceId: 'p0_0',
        useWallBreak: false,
        breakWall: null,
        destination: { row: 3, col: 3 },
        placeWall: { orientation: 'v', row: 3, col: 3 },
      }),
    ).toThrow(Error);

    // Non-adjacent internal wall h(0,4)
    expect(() =>
      applyBotTurnAction(wg1Base, {
        pieceId: 'p0_0',
        useWallBreak: false,
        breakWall: null,
        destination: { row: 3, col: 2 },
        placeWall: { orientation: 'h', row: 0, col: 4 },
      }),
    ).toThrow(Error);

    // Out-of-bounds / perimeter walls
    const badEdges: WallEdge[] = [
      { orientation: 'h', row: -1, col: 0 },
      { orientation: 'h', row: 6, col: 0 },
      { orientation: 'v', row: 0, col: 6 },
    ];
    for (let i = 0; i < badEdges.length; i++) {
      expect(() =>
        applyBotTurnAction(wg1Base, {
          ...validWg1Action,
          placeWall: badEdges[i],
        }),
      ).toThrow(Error);
    }
  });

  it('E6: rejects useWallBreak / breakWall consistency mismatches', () => {
    expect(() =>
      applyBotTurnAction(wg1Base, {
        ...validWg1Action,
        useWallBreak: true,
        breakWall: null,
      }),
    ).toThrow(Error);

    expect(() =>
      applyBotTurnAction(wg1Base, {
        ...validWg1Action,
        useWallBreak: false,
        breakWall: { orientation: 'v', row: 3, col: 3 },
      }),
    ).toThrow(Error);

    expect(() =>
      applyBotTurnAction(wg1Base, {
        ...validWg1Action,
        useWallBreak: true,
        breakWall: { orientation: 'h', row: 6, col: 0 },
      }),
    ).toThrow(Error);
  });

  it('E7: rejects wall break when wallBreaksRemaining is 0 (3P depleted & 2P format)', () => {
    const depleted3p = buildPlayState({
      ruleVariant: 'wallgo1',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [0, 1, 1],
      pieces: wg1Base.pieces,
      walls: [{ orientation: 'v', row: 3, col: 3, ownerId: 1 }],
    });
    expect(() =>
      applyBotTurnAction(depleted3p, {
        pieceId: 'p0_0',
        useWallBreak: true,
        breakWall: { orientation: 'v', row: 3, col: 3 },
        destination: { row: 3, col: 4 },
        placeWall: { orientation: 'h', row: 3, col: 4 },
      }),
    ).toThrow(Error);

    const state2p = buildPlayState({
      ruleVariant: 'wallgo1',
      format: '2p',
      currentPlayerIndex: 0,
      wallBreaks: [0, 0],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
        { id: 'p0_1', ownerId: 0, kind: 'standard', row: 1, col: 1 },
        { id: 'p0_2', ownerId: 0, kind: 'standard', row: 5, col: 5 },
        { id: 'p0_3', ownerId: 0, kind: 'standard', row: 2, col: 0 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 1, col: 5 },
        { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 1 },
        { id: 'p1_2', ownerId: 1, kind: 'standard', row: 0, col: 6 },
        { id: 'p1_3', ownerId: 1, kind: 'standard', row: 6, col: 0 },
      ],
      walls: [{ orientation: 'v', row: 3, col: 3, ownerId: 1 }],
    });
    expect(() =>
      applyBotTurnAction(state2p, {
        pieceId: 'p0_0',
        useWallBreak: true,
        breakWall: { orientation: 'v', row: 3, col: 3 },
        destination: { row: 3, col: 4 },
        placeWall: { orientation: 'h', row: 3, col: 4 },
      }),
    ).toThrow(Error);
  });

  it('E8: rejects invalid Wall Go I breakWall (non-adjacent, empty edge, E08 soft-lock)', () => {
    // Non-adjacent existing wall h(5,5)
    expect(() =>
      applyBotTurnAction(wg1Base, {
        pieceId: 'p0_0',
        useWallBreak: true,
        breakWall: { orientation: 'h', row: 5, col: 5 },
        destination: { row: 3, col: 2 },
        placeWall: { orientation: 'h', row: 3, col: 2 },
      }),
    ).toThrow(Error);

    // Adjacent empty edge h(3,3) (no wall present)
    expect(() =>
      applyBotTurnAction(wg1Base, {
        pieceId: 'p0_0',
        useWallBreak: true,
        breakWall: { orientation: 'h', row: 3, col: 3 },
        destination: { row: 3, col: 2 },
        placeWall: { orientation: 'h', row: 3, col: 2 },
      }),
    ).toThrow(Error);

    // E08 soft-lock wall: p0_1 at (0,0) with walls h(0,0),v(0,0) and pieces at (0,1),(1,0)
    expect(() =>
      applyBotTurnAction(wg1Base, {
        pieceId: 'p0_1',
        useWallBreak: true,
        breakWall: { orientation: 'h', row: 0, col: 0 },
        destination: { row: 0, col: 0 },
        placeWall: { orientation: 'h', row: 0, col: 0 },
      }),
    ).toThrow(Error);
  });
});

// =============================================================================
// Section F: Strategic Skill Sanity Checks (F22) & Input Immutability
// =============================================================================
describe('Section F: Strategic Skill Sanity Checks & Recursive Immutability', () => {
  it('F1: normal and hard find clear 1-move 28-21 winning territory enclosure (WG1 & WG2)', () => {
    const dividerWalls: PlacedWall[] = [
      { orientation: 'v', row: 0, col: 3, ownerId: 0 },
      { orientation: 'v', row: 1, col: 3, ownerId: 0 },
      { orientation: 'v', row: 2, col: 3, ownerId: 0 },
      { orientation: 'v', row: 4, col: 3, ownerId: 0 },
      { orientation: 'v', row: 5, col: 3, ownerId: 0 },
      { orientation: 'v', row: 6, col: 3, ownerId: 0 },
    ];

    const wg1Puzzle = buildPlayState({
      ruleVariant: 'wallgo1',
      format: '2p',
      currentPlayerIndex: 0,
      wallBreaks: [0, 0],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
        { id: 'p0_1', ownerId: 0, kind: 'standard', row: 1, col: 1 },
        { id: 'p0_2', ownerId: 0, kind: 'standard', row: 5, col: 1 },
        { id: 'p0_3', ownerId: 0, kind: 'standard', row: 2, col: 0 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 3, col: 4 },
        { id: 'p1_1', ownerId: 1, kind: 'standard', row: 1, col: 5 },
        { id: 'p1_2', ownerId: 1, kind: 'standard', row: 5, col: 5 },
        { id: 'p1_3', ownerId: 1, kind: 'standard', row: 0, col: 6 },
      ],
      walls: dividerWalls,
    });

    expect(checkGameEnd(wg1Puzzle).isGameOver).toBe(false);

    const diffs: AIDifficulty[] = ['normal', 'hard'];
    const seeds = [7, 8, 9];
    for (let d = 0; d < diffs.length; d++) {
      for (let s = 0; s < seeds.length; s++) {
        const action = chooseAiTurn(wg1Puzzle, diffs[d], makeSeededRng(seeds[s]));
        const next = applyBotTurnAction(wg1Puzzle, action);
        expect(action.placeWall).toEqual({ orientation: 'v', row: 3, col: 3 });
        expect(next.phase).toBe('game_over');
        expect(next.territory.endReason).toBe('all_separated');
        expect(next.territory.scores[0].rank).toBe(1);
        expect(next.territory.scores[0].totalTerritory).toBe(28);
        expect(next.territory.scores[1].totalTerritory).toBe(21);
      }
    }

    // Wall Go II companion 1-move seal: p0_0 ('square') at (3,2) steps to (3,3) and seals v(3,3)
    const wg2Puzzle = buildPlayState({
      ruleVariant: 'wallgo2',
      format: '2p',
      currentPlayerIndex: 0,
      wallBreaks: [0, 0],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'square', row: 3, col: 2 },
        { id: 'p0_1', ownerId: 0, kind: 'round', row: 1, col: 1 },
        { id: 'p0_2', ownerId: 0, kind: 'round', row: 5, col: 1 },
        { id: 'p0_3', ownerId: 0, kind: 'square', row: 2, col: 0 },
        { id: 'p1_0', ownerId: 1, kind: 'square', row: 3, col: 4 },
        { id: 'p1_1', ownerId: 1, kind: 'round', row: 1, col: 5 },
        { id: 'p1_2', ownerId: 1, kind: 'round', row: 5, col: 5 },
        { id: 'p1_3', ownerId: 1, kind: 'square', row: 0, col: 6 },
      ],
      walls: dividerWalls,
    });

    expect(checkGameEnd(wg2Puzzle).isGameOver).toBe(false);
    for (let d = 0; d < diffs.length; d++) {
      const action = chooseAiTurn(wg2Puzzle, diffs[d], makeSeededRng(70 + d));
      const next = applyBotTurnAction(wg2Puzzle, action);
      expect(action.placeWall).toEqual({ orientation: 'v', row: 3, col: 3 });
      expect(next.phase).toBe('game_over');
      expect(next.territory.scores[0].rank).toBe(1);
      expect(next.territory.scores[0].totalTerritory).toBe(28);
    }
  });

  it('F2: hard triggers strategic Wall Break to escape 1-cell trap into 20-cell region even when normal moves exist', () => {
    const state = buildPlayState({
      ruleVariant: 'wallgo1',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [1, 0, 0],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
        { id: 'p0_1', ownerId: 0, kind: 'standard', row: 6, col: 0 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 1 },
        { id: 'p1_1', ownerId: 1, kind: 'standard', row: 4, col: 5 },
        { id: 'p2_0', ownerId: 2, kind: 'standard', row: 4, col: 3 },
        { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 5 },
      ],
      walls: [
        // 1-cell box around (0,0)
        { orientation: 'h', row: 0, col: 0, ownerId: 1 },
        { orientation: 'v', row: 0, col: 0, ownerId: 1 },
        // Horizontal divider isolating rows 0..2 (21 cells) from rows 3..6
        { orientation: 'h', row: 2, col: 0, ownerId: 2 },
        { orientation: 'h', row: 2, col: 1, ownerId: 2 },
        { orientation: 'h', row: 2, col: 2, ownerId: 2 },
        { orientation: 'h', row: 2, col: 3, ownerId: 2 },
        { orientation: 'h', row: 2, col: 4, ownerId: 2 },
        { orientation: 'h', row: 2, col: 5, ownerId: 2 },
        { orientation: 'h', row: 2, col: 6, ownerId: 2 },
        // 4-cell contested pocket {(5,0),(5,1),(6,0),(6,1)}
        { orientation: 'h', row: 4, col: 0, ownerId: 1 },
        { orientation: 'h', row: 4, col: 1, ownerId: 1 },
        { orientation: 'v', row: 5, col: 1, ownerId: 1 },
        { orientation: 'v', row: 6, col: 1, ownerId: 1 },
      ],
    });

    // Non-vacuous preconditions: NOT an E27 forced-break state!
    expect(checkGameEnd(state).isGameOver).toBe(false);
    expect(getWallGo1Moves(state, 'p0_0')).toEqual([]);
    expect(getWallGo1Moves(state, 'p0_1')).toHaveLength(3);
    expect(state.territory.scores[0].totalTerritory).toBe(1);

    const action = chooseAiTurn(state, 'hard', makeSeededRng(42));
    expect(action.useWallBreak).toBe(true);
    expect(action.pieceId).toBe('p0_0');
    expect(action.breakWall).not.toBeNull();
    expect(['h:0:0', 'v:0:0']).toContain(wallKey(action.breakWall!));

    const next = applyBotTurnAction(state, action);
    expect(next.players[0].wallBreaksRemaining).toBe(0);
    expect(next.territory.scores[0].totalTerritory).toBeGreaterThanOrEqual(18);
  });

  it('F3: hard preserves Wall Break reserve on open board when Wall Break is available but unnecessary (WG1 & WG2)', () => {
    const wg1Open = buildPlayState({
      ruleVariant: 'wallgo1',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [1, 1, 1],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 2, col: 2 },
        { id: 'p0_1', ownerId: 0, kind: 'standard', row: 4, col: 4 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 2, col: 4 },
        { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 1 },
        { id: 'p2_0', ownerId: 2, kind: 'standard', row: 4, col: 2 },
        { id: 'p2_1', ownerId: 2, kind: 'standard', row: 1, col: 5 },
      ],
      walls: [{ orientation: 'v', row: 2, col: 1, ownerId: 1 }],
    });

    expect(getWallGo1BreakableWalls(wg1Open, 'p0_0')).toEqual([
      { orientation: 'v', row: 2, col: 1 },
    ]);

    const seeds = [77, 78, 79];
    for (let i = 0; i < seeds.length; i++) {
      const action = chooseAiTurn(wg1Open, 'hard', makeSeededRng(seeds[i]));
      expect(action.useWallBreak).toBe(false);
      expect(action.breakWall).toBeNull();
      expect(applyBotTurnAction(wg1Open, action).players[0].wallBreaksRemaining).toBe(1);
    }

    const wg2Open = buildPlayState({
      ruleVariant: 'wallgo2',
      format: '3p',
      currentPlayerIndex: 0,
      wallBreaks: [1, 1, 1],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'square', row: 2, col: 2 },
        { id: 'p0_1', ownerId: 0, kind: 'round', row: 4, col: 4 },
        { id: 'p1_0', ownerId: 1, kind: 'square', row: 2, col: 4 },
        { id: 'p1_1', ownerId: 1, kind: 'round', row: 5, col: 1 },
        { id: 'p2_0', ownerId: 2, kind: 'round', row: 4, col: 2 },
        { id: 'p2_1', ownerId: 2, kind: 'square', row: 1, col: 5 },
      ],
      walls: [{ orientation: 'v', row: 2, col: 1, ownerId: 1 }],
    });

    expect(getWallGo2BreakTargets(wg2Open, 'p0_0').length).toBeGreaterThan(0);
    for (let i = 0; i < seeds.length; i++) {
      const action = chooseAiTurn(wg2Open, 'hard', makeSeededRng(seeds[i] + 10));
      expect(action.useWallBreak).toBe(false);
      expect(action.breakWall).toBeNull();
      expect(applyBotTurnAction(wg2Open, action).players[0].wallBreaksRemaining).toBe(1);
    }
  });

  it('F4: strictly preserves recursive deepFreeze immutability across all public AI APIs', () => {
    const diffs: AIDifficulty[] = ['easy', 'normal', 'hard'];
    const variants: RuleVariant[] = ['wallgo1', 'wallgo2'];

    for (let v = 0; v < variants.length; v++) {
      const placementState = createInitialGameState({
        ruleVariant: variants[v],
        format: '3p',
        players: makeAiPlayers('3p', ['hard', 'normal', 'easy']),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      const placementSnap = structuredClone(placementState);
      deepFreeze(placementState);

      for (let d = 0; d < diffs.length; d++) {
        const res = chooseAiPlacement(placementState, diffs[d], makeSeededRng(900 + d));
        expect(isInBounds(res.row, res.col)).toBe(true);
      }
      expect(placementState).toEqual(placementSnap);

      const playState = buildPlayState({
        ruleVariant: variants[v],
        format: '3p',
        currentPlayerIndex: 0,
        wallBreaks: [1, 1, 1],
        pieces:
          variants[v] === 'wallgo1'
            ? [
                { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
                { id: 'p0_1', ownerId: 0, kind: 'standard', row: 1, col: 1 },
                { id: 'p1_0', ownerId: 1, kind: 'standard', row: 1, col: 5 },
                { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 1 },
                { id: 'p2_0', ownerId: 2, kind: 'standard', row: 5, col: 5 },
                { id: 'p2_1', ownerId: 2, kind: 'standard', row: 0, col: 3 },
              ]
            : [
                { id: 'p0_0', ownerId: 0, kind: 'round', row: 3, col: 3 },
                { id: 'p0_1', ownerId: 0, kind: 'square', row: 1, col: 1 },
                { id: 'p1_0', ownerId: 1, kind: 'square', row: 1, col: 5 },
                { id: 'p1_1', ownerId: 1, kind: 'round', row: 5, col: 1 },
                { id: 'p2_0', ownerId: 2, kind: 'round', row: 5, col: 5 },
                { id: 'p2_1', ownerId: 2, kind: 'square', row: 0, col: 3 },
              ],
        walls: [
          { orientation: 'v', row: 3, col: 3, ownerId: 1 },
          { orientation: 'h', row: 3, col: 3, ownerId: 2 },
        ],
      });
      const playSnap = structuredClone(playState);
      deepFreeze(playState);

      expect(Number.isFinite(evaluatePosition(playState, 0))).toBe(true);

      for (let d = 0; d < diffs.length; d++) {
        const turnAction = chooseAiTurn(playState, diffs[d], makeSeededRng(950 + d));
        const next = applyBotTurnAction(playState, turnAction);
        expect(next.turnNumber).toBe(1);
      }

      // Also test frozen applyBotTurnAction on Wall Break (WG1 & WG2 E13 ambiguous diagonal)
      if (variants[v] === 'wallgo1') {
        const nextBreak = applyBotTurnAction(playState, {
          pieceId: 'p0_0',
          useWallBreak: true,
          breakWall: { orientation: 'v', row: 3, col: 3 },
          destination: { row: 3, col: 4 },
          placeWall: { orientation: 'h', row: 3, col: 4 },
        });
        expect(nextBreak.players[0].wallBreaksRemaining).toBe(0);
      } else {
        const nextE13 = applyBotTurnAction(playState, {
          pieceId: 'p0_0',
          useWallBreak: true,
          breakWall: { orientation: 'h', row: 3, col: 3 },
          destination: { row: 4, col: 4 },
          placeWall: { orientation: 'h', row: 4, col: 4 },
        });
        expect(nextE13.players[0].wallBreaksRemaining).toBe(0);
      }

      expect(playState).toEqual(playSnap);
    }
  });

  it('F5: evaluatePosition scores winning terminal > leading live > losing terminal and handles E23 auto-skip', () => {
    const winState = buildPlayState({
      ruleVariant: 'wallgo1',
      format: '2p',
      phase: 'game_over',
      wallBreaks: [0, 0],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
        { id: 'p0_1', ownerId: 0, kind: 'standard', row: 1, col: 1 },
        { id: 'p0_2', ownerId: 0, kind: 'standard', row: 5, col: 1 },
        { id: 'p0_3', ownerId: 0, kind: 'standard', row: 2, col: 0 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 3, col: 4 },
        { id: 'p1_1', ownerId: 1, kind: 'standard', row: 1, col: 5 },
        { id: 'p1_2', ownerId: 1, kind: 'standard', row: 5, col: 5 },
        { id: 'p1_3', ownerId: 1, kind: 'standard', row: 0, col: 6 },
      ],
      walls: [
        { orientation: 'v', row: 0, col: 3, ownerId: 0 },
        { orientation: 'v', row: 1, col: 3, ownerId: 0 },
        { orientation: 'v', row: 2, col: 3, ownerId: 0 },
        { orientation: 'v', row: 3, col: 3, ownerId: 0 },
        { orientation: 'v', row: 4, col: 3, ownerId: 0 },
        { orientation: 'v', row: 5, col: 3, ownerId: 0 },
        { orientation: 'v', row: 6, col: 3, ownerId: 0 },
      ],
    });
    const p0WinScore = evaluatePosition(winState, 0);
    const p1LossScore = evaluatePosition(winState, 1);
    expect(p0WinScore).toBeGreaterThan(10000);
    expect(p1LossScore).toBeLessThan(-10000);
    expect(() => evaluatePosition(winState, 9)).toThrow(Error);

    // E23: P1 completely piece/wall-blocked inside contested region -> P0 gets consecutive MAX turn
    const e23State = buildPlayState({
      ruleVariant: 'wallgo1',
      format: '2p',
      currentPlayerIndex: 0,
      wallBreaks: [0, 0],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 1 },
        { id: 'p0_1', ownerId: 0, kind: 'standard', row: 1, col: 0 },
        { id: 'p0_2', ownerId: 0, kind: 'standard', row: 4, col: 4 },
        { id: 'p0_3', ownerId: 0, kind: 'standard', row: 5, col: 5 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
        { id: 'p1_1', ownerId: 1, kind: 'standard', row: 6, col: 6 },
        { id: 'p1_2', ownerId: 1, kind: 'standard', row: 6, col: 5 },
        { id: 'p1_3', ownerId: 1, kind: 'standard', row: 5, col: 6 },
      ],
      walls: [
        { orientation: 'h', row: 4, col: 5, ownerId: 0 },
        { orientation: 'h', row: 4, col: 6, ownerId: 0 },
        { orientation: 'v', row: 5, col: 4, ownerId: 0 },
        { orientation: 'v', row: 6, col: 4, ownerId: 0 },
        { orientation: 'h', row: 5, col: 5, ownerId: 0 },
        { orientation: 'v', row: 5, col: 5, ownerId: 0 },
      ],
    });
    expect(checkGameEnd(e23State).isGameOver).toBe(false);
    expect(shouldAutoSkipPlayer(e23State, 1)).toBe(true);

    const action = chooseAiTurn(e23State, 'hard', makeSeededRng(404));
    const next = applyBotTurnAction(e23State, action);
    expect(next.turnNumber).toBe(1);
  });

  it('F6: hard 2-ply lookahead blocks opponent immediate 28-21 winning enclosure threat', () => {
    const threatState = buildPlayState({
      ruleVariant: 'wallgo1',
      format: '2p',
      currentPlayerIndex: 0,
      wallBreaks: [0, 0],
      pieces: [
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 4 },
        { id: 'p0_1', ownerId: 0, kind: 'standard', row: 1, col: 5 },
        { id: 'p0_2', ownerId: 0, kind: 'standard', row: 5, col: 5 },
        { id: 'p0_3', ownerId: 0, kind: 'standard', row: 0, col: 6 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 3, col: 2 },
        { id: 'p1_1', ownerId: 1, kind: 'standard', row: 1, col: 1 },
        { id: 'p1_2', ownerId: 1, kind: 'standard', row: 5, col: 1 },
        { id: 'p1_3', ownerId: 1, kind: 'standard', row: 2, col: 0 },
      ],
      walls: [
        { orientation: 'v', row: 0, col: 3, ownerId: 1 },
        { orientation: 'v', row: 1, col: 3, ownerId: 1 },
        { orientation: 'v', row: 2, col: 3, ownerId: 1 },
        { orientation: 'v', row: 4, col: 3, ownerId: 1 },
        { orientation: 'v', row: 5, col: 3, ownerId: 1 },
        { orientation: 'v', row: 6, col: 3, ownerId: 1 },
      ],
    });

    // If P0 fails to invade cols 0..3, P1 moves p1_0 (3,2)->(3,3) and seals v(3,3) to win 28-21.
    const action = chooseAiTurn(threatState, 'hard', makeSeededRng(606));
    const afterP0 = applyBotTurnAction(threatState, action);
    expect(afterP0.phase).toBe('select_piece');
    expect(action.pieceId).toBe('p0_0');
    expect(action.destination.col).toBeLessThanOrEqual(3);

    // Verify P1 can no longer force an immediate 1-move win on its reply
    const p1Reply = chooseAiTurn(afterP0, 'hard', makeSeededRng(607));
    const afterP1 = applyBotTurnAction(afterP0, p1Reply);
    expect(afterP1.phase).not.toBe('game_over');
  });
});

// =============================================================================
// Section G: Hard Performance Budget (E27: Strictly < 200ms)
// =============================================================================
describe('Section G: Hard AI Performance Budget (< 200ms on Peak Branching)', () => {
  it(
    'G1: completes >= 16 peak-branching hard turns across 4 high-branching boards strictly under 200ms each',
    () => {
      // Position 1: Peak 2P Wall Go I (>= 180 legal normal actions on Turn 1)
      const peak2pWg1 = buildPlayState({
        ruleVariant: 'wallgo1',
        format: '2p',
        currentPlayerIndex: 0,
        wallBreaks: [0, 0],
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 2, col: 2 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 4, col: 4 },
          { id: 'p0_2', ownerId: 0, kind: 'standard', row: 1, col: 4 },
          { id: 'p0_3', ownerId: 0, kind: 'standard', row: 4, col: 1 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
          { id: 'p1_1', ownerId: 1, kind: 'standard', row: 0, col: 6 },
          { id: 'p1_2', ownerId: 1, kind: 'standard', row: 6, col: 0 },
          { id: 'p1_3', ownerId: 1, kind: 'standard', row: 6, col: 6 },
        ],
      });

      // Pre-assert genuine peak branching (>= 180 normal actions)
      let p0NormalCount = 0;
      const p0Pieces = peak2pWg1.pieces.filter((p) => p.ownerId === 0);
      for (let i = 0; i < p0Pieces.length; i++) {
        const dests = getWallGo1Moves(peak2pWg1, p0Pieces[i].id);
        for (let j = 0; j < dests.length; j++) {
          p0NormalCount += getLegalWallPlacements(peak2pWg1, dests[j]).length;
        }
      }
      expect(p0NormalCount).toBeGreaterThanOrEqual(180);

      // Position 2: Peak 3P Wall Go I with 4 adjacent breakable walls (~250+ actions)
      const peak3pWg1 = buildPlayState({
        ruleVariant: 'wallgo1',
        format: '3p',
        currentPlayerIndex: 0,
        wallBreaks: [1, 1, 1],
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 2, col: 2 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 4, col: 4 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 1, col: 5 },
          { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 1 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 0, col: 3 },
          { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 3 },
        ],
        walls: [
          { orientation: 'h', row: 1, col: 2, ownerId: 1 },
          { orientation: 'v', row: 2, col: 1, ownerId: 1 },
          { orientation: 'h', row: 4, col: 4, ownerId: 1 },
          { orientation: 'v', row: 4, col: 4, ownerId: 1 },
        ],
      });

      // Position 3: Peak 2P Wall Go II opening
      const peak2pWg2 = buildPlayState({
        ruleVariant: 'wallgo2',
        format: '2p',
        currentPlayerIndex: 0,
        wallBreaks: [0, 0],
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'round', row: 1, col: 1 },
          { id: 'p0_1', ownerId: 0, kind: 'round', row: 5, col: 5 },
          { id: 'p0_2', ownerId: 0, kind: 'square', row: 2, col: 4 },
          { id: 'p0_3', ownerId: 0, kind: 'square', row: 4, col: 2 },
          { id: 'p1_0', ownerId: 1, kind: 'round', row: 1, col: 5 },
          { id: 'p1_1', ownerId: 1, kind: 'round', row: 5, col: 1 },
          { id: 'p1_2', ownerId: 1, kind: 'square', row: 2, col: 2 },
          { id: 'p1_3', ownerId: 1, kind: 'square', row: 4, col: 4 },
        ],
      });

      // Position 4: Peak 3P Wall Go II with 1-wall & 2-wall ambiguous diagonal break targets
      const peak3pWg2 = buildPlayState({
        ruleVariant: 'wallgo2',
        format: '3p',
        currentPlayerIndex: 0,
        wallBreaks: [1, 1, 1],
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'square', row: 3, col: 3 },
          { id: 'p0_1', ownerId: 0, kind: 'round', row: 2, col: 4 },
          { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 0 },
          { id: 'p1_1', ownerId: 1, kind: 'round', row: 6, col: 6 },
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 0, col: 6 },
          { id: 'p2_1', ownerId: 2, kind: 'square', row: 6, col: 0 },
        ],
        walls: [
          { orientation: 'h', row: 2, col: 3, ownerId: 1 },
          { orientation: 'v', row: 3, col: 3, ownerId: 1 },
          { orientation: 'h', row: 2, col: 4, ownerId: 1 },
          { orientation: 'v', row: 2, col: 4, ownerId: 1 },
        ],
      });

      const positions = [peak2pWg1, peak3pWg1, peak2pWg2, peak3pWg2];
      let measuredCalls = 0;

      for (let p = 0; p < positions.length; p++) {
        let state = positions[p];
        const rng = makeSeededRng(7000 + p);
        for (let t = 0; t < 4 && state.phase !== 'game_over'; t++) {
          const t0 = performance.now();
          const action = chooseAiTurn(state, 'hard', rng);
          const elapsedMs = performance.now() - t0;
          expect(elapsedMs).toBeLessThan(200);
          measuredCalls++;
          state = applyBotTurnAction(state, action);
        }
      }

      expect(measuredCalls).toBeGreaterThanOrEqual(16);
    },
    15_000,
  );
});

// =============================================================================
// Section H: Seeded Determinism & Boundary RNG Safety
// =============================================================================
describe('Section H: Determinism & Boundary RNG Safety', () => {
  it('H1: produces identical placement and turn outputs under identical seeded RNG', () => {
    const diffs: AIDifficulty[] = ['easy', 'normal', 'hard'];
    const variants: RuleVariant[] = ['wallgo1', 'wallgo2'];

    for (let v = 0; v < variants.length; v++) {
      const ruleVariant = variants[v];
      const placementState = createInitialGameState({
        ruleVariant,
        format: '3p',
        players: makeAiPlayers('3p', ['hard', 'normal', 'easy']),
        shuffleOrder: false,
        timerSeconds: 0,
      });

      for (let d = 0; d < diffs.length; d++) {
        const diff = diffs[d];
        const p1 = chooseAiPlacement(placementState, diff, makeSeededRng(12345));
        const p2 = chooseAiPlacement(placementState, diff, makeSeededRng(12345));
        expect(p1).toEqual(p2);
      }

      // Representative mid-game board (12 walls placed) completes full Top-K beam far below 145ms
      const midGameState = buildPlayState({
        ruleVariant,
        format: '3p',
        currentPlayerIndex: 0,
        wallBreaks: [1, 1, 1],
        pieces:
          ruleVariant === 'wallgo1'
            ? [
                { id: 'p0_0', ownerId: 0, kind: 'standard', row: 2, col: 2 },
                { id: 'p0_1', ownerId: 0, kind: 'standard', row: 4, col: 4 },
                { id: 'p1_0', ownerId: 1, kind: 'standard', row: 2, col: 4 },
                { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 1 },
                { id: 'p2_0', ownerId: 2, kind: 'standard', row: 4, col: 2 },
                { id: 'p2_1', ownerId: 2, kind: 'standard', row: 1, col: 5 },
              ]
            : [
                { id: 'p0_0', ownerId: 0, kind: 'square', row: 2, col: 2 },
                { id: 'p0_1', ownerId: 0, kind: 'round', row: 4, col: 4 },
                { id: 'p1_0', ownerId: 1, kind: 'square', row: 2, col: 4 },
                { id: 'p1_1', ownerId: 1, kind: 'round', row: 5, col: 1 },
                { id: 'p2_0', ownerId: 2, kind: 'round', row: 4, col: 2 },
                { id: 'p2_1', ownerId: 2, kind: 'square', row: 1, col: 5 },
              ],
        walls: [
          { orientation: 'h', row: 1, col: 2, ownerId: 0 },
          { orientation: 'v', row: 2, col: 2, ownerId: 1 },
          { orientation: 'h', row: 2, col: 4, ownerId: 2 },
          { orientation: 'v', row: 4, col: 3, ownerId: 0 },
          { orientation: 'h', row: 4, col: 4, ownerId: 1 },
          { orientation: 'v', row: 5, col: 1, ownerId: 2 },
          { orientation: 'h', row: 3, col: 1, ownerId: 0 },
          { orientation: 'v', row: 1, col: 4, ownerId: 1 },
          { orientation: 'h', row: 5, col: 3, ownerId: 2 },
          { orientation: 'v', row: 0, col: 2, ownerId: 0 },
          { orientation: 'h', row: 0, col: 4, ownerId: 1 },
          { orientation: 'v', row: 3, col: 5, ownerId: 2 },
        ],
      });

      for (let d = 0; d < diffs.length; d++) {
        const diff = diffs[d];
        const t1 = chooseAiTurn(midGameState, diff, makeSeededRng(54321));
        const t2 = chooseAiTurn(midGameState, diff, makeSeededRng(54321));
        expect(t1).toEqual(t2);
      }
    }
  });

  it('H2: handles boundary and adversarial RNG outputs safely without out-of-bounds picks', () => {
    const boundaryRngs: readonly (() => number)[] = [
      () => 0,
      () => 0.999999999,
      () => 1,
      () => -1,
      () => Number.NaN,
      () => Number.POSITIVE_INFINITY,
    ];
    const diffs: AIDifficulty[] = ['easy', 'normal', 'hard'];
    const variants: RuleVariant[] = ['wallgo1', 'wallgo2'];

    for (let v = 0; v < variants.length; v++) {
      const ruleVariant = variants[v];
      const placementState = createInitialGameState({
        ruleVariant,
        format: '3p',
        players: makeAiPlayers('3p', ['hard', 'normal', 'easy']),
        shuffleOrder: false,
        timerSeconds: 0,
      });

      const playState = buildPlayState({
        ruleVariant,
        format: '3p',
        currentPlayerIndex: 0,
        wallBreaks: [1, 1, 1],
        pieces:
          ruleVariant === 'wallgo1'
            ? [
                { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
                { id: 'p0_1', ownerId: 0, kind: 'standard', row: 1, col: 1 },
                { id: 'p1_0', ownerId: 1, kind: 'standard', row: 1, col: 5 },
                { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 1 },
                { id: 'p2_0', ownerId: 2, kind: 'standard', row: 5, col: 5 },
                { id: 'p2_1', ownerId: 2, kind: 'standard', row: 0, col: 3 },
              ]
            : [
                { id: 'p0_0', ownerId: 0, kind: 'round', row: 3, col: 3 },
                { id: 'p0_1', ownerId: 0, kind: 'square', row: 1, col: 1 },
                { id: 'p1_0', ownerId: 1, kind: 'square', row: 1, col: 5 },
                { id: 'p1_1', ownerId: 1, kind: 'round', row: 5, col: 1 },
                { id: 'p2_0', ownerId: 2, kind: 'round', row: 5, col: 5 },
                { id: 'p2_1', ownerId: 2, kind: 'square', row: 0, col: 3 },
              ],
        walls: [
          { orientation: 'v', row: 3, col: 3, ownerId: 1 },
          { orientation: 'h', row: 3, col: 3, ownerId: 2 },
        ],
      });

      // E27 trapped state
      const trappedState = buildPlayState({
        ruleVariant,
        format: '3p',
        currentPlayerIndex: 0,
        wallBreaks: [1, 1, 1],
        pieces:
          ruleVariant === 'wallgo1'
            ? [
                { id: 'p0_0', ownerId: 0, kind: 'standard', row: 3, col: 3 },
                { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 0 },
                { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 1 },
                { id: 'p1_1', ownerId: 1, kind: 'standard', row: 0, col: 6 },
                { id: 'p2_0', ownerId: 2, kind: 'standard', row: 1, col: 0 },
                { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 6 },
              ]
            : [
                { id: 'p0_0', ownerId: 0, kind: 'square', row: 3, col: 3 },
                { id: 'p0_1', ownerId: 0, kind: 'round', row: 0, col: 0 },
                { id: 'p1_0', ownerId: 1, kind: 'square', row: 0, col: 1 },
                { id: 'p1_1', ownerId: 1, kind: 'round', row: 0, col: 6 },
                { id: 'p2_0', ownerId: 2, kind: 'round', row: 1, col: 0 },
                { id: 'p2_1', ownerId: 2, kind: 'square', row: 6, col: 6 },
              ],
        walls: [
          { orientation: 'h', row: 2, col: 3, ownerId: 1 },
          { orientation: 'h', row: 3, col: 3, ownerId: 1 },
          { orientation: 'v', row: 3, col: 2, ownerId: 2 },
          { orientation: 'v', row: 3, col: 3, ownerId: 2 },
        ],
      });

      for (let d = 0; d < diffs.length; d++) {
        const diff = diffs[d];
        for (let r = 0; r < boundaryRngs.length; r++) {
          const rng = boundaryRngs[r];

          const placement = chooseAiPlacement(placementState, diff, rng);
          expect(placement).toBeDefined();
          expect(
            placeInitialPiece(
              placementState,
              { row: placement.row, col: placement.col },
              placement.kind,
            ),
          ).not.toBe(placementState);

          const turnAction = chooseAiTurn(playState, diff, rng);
          expect(turnAction).toBeDefined();
          expect(applyBotTurnAction(playState, turnAction).turnNumber).toBe(1);

          const escapeAction = chooseAiTurn(trappedState, diff, rng);
          expect(escapeAction).toBeDefined();
          expect(escapeAction.useWallBreak).toBe(true);
          expect(applyBotTurnAction(trappedState, escapeAction).turnNumber).toBe(1);
        }
      }
    }
  });
});
