import { describe, expect, it } from 'vitest';
import {
  analyzeTerritory,
  applyAtomicTurnAction,
  createInitialGameState,
  createPrisonMatchRound2State,
  placeInitialPiece,
  resolveTurnTimeout,
  setPlayerControllerInGame,
  wallKey,
} from '../../engine/index.js';
import type { GameState, PlacedWall, PlayerConfig, RngFn, WallEdge } from '../../engine/index.js';
import { chooseAiPlacement, chooseAiTurn } from '../../ai/index.js';
import {
  ReplayValidationError,
  actionEventToReplayStep,
  buildMatchPlayerSummaries,
  buildReplayFrames,
  computePlayerAggregateStats,
  createInitialStateFromReplayConfig,
  createReplayInitialConfig,
  extractMatchFinalBoard,
  extractReplayFromHistory,
  formatWallEdgeLabel,
  toMatchSummary,
} from '../index.js';
import type {
  MatchPlayerSummary,
  MatchRecord,
  MatchSummary,
  ReplayData,
  ReplayStep,
} from '../index.js';

function createSeededRng(seed: number): RngFn {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playBotMatchToCompletion(
  initialState: GameState,
  seed: number,
  maxSteps = 220,
): { finalState: GameState; replay: ReplayData } {
  const rng = createSeededRng(seed);
  const initialConfig = createReplayInitialConfig(initialState);
  const steps: ReplayStep[] = [];
  let state = initialState;

  while (state.phase !== 'game_over' && steps.length < maxSteps) {
    if (state.phase === 'placement') {
      const pick = chooseAiPlacement(state, 'normal', rng);
      state = placeInitialPiece(state, { row: pick.row, col: pick.col }, pick.kind);
    } else {
      const turn = chooseAiTurn(state, 'normal', rng);
      state = applyAtomicTurnAction(state, turn);
    }
    expect(state.lastActionEvent).not.toBeNull();
    steps.push(actionEventToReplayStep(state.lastActionEvent!, steps.length + 1));
  }

  expect(state.phase).toBe('game_over');
  return {
    finalState: state,
    replay: extractReplayFromHistory(initialConfig, steps),
  };
}

function makePlayers3P(): PlayerConfig[] {
  return [
    { name: 'Alice', colorToken: 'p1', isAI: true, aiDifficulty: 'normal' },
    { name: 'Bob', colorToken: 'p2', isAI: true, aiDifficulty: 'normal' },
    { name: 'Cara', colorToken: 'p3', isAI: true, aiDifficulty: 'normal' },
  ];
}

function makePlayers2P(): PlayerConfig[] {
  return [
    { name: 'Alice', colorToken: 'p1', isAI: true, aiDifficulty: 'normal' },
    { name: 'Bob', colorToken: 'p2', isAI: true, aiDifficulty: 'normal' },
  ];
}

describe('src/shared/replay (ENG-03)', () => {
  describe('formatWallEdgeLabel', () => {
    it('matches Board.tsx coordinate labels for horizontal and vertical edges', () => {
      expect(formatWallEdgeLabel({ orientation: 'h', row: 0, col: 0 })).toBe('A1-A2');
      expect(formatWallEdgeLabel({ orientation: 'h', row: 2, col: 2 })).toBe('C3-C4');
      expect(formatWallEdgeLabel({ orientation: 'h', row: 5, col: 6 })).toBe('G6-G7');

      expect(formatWallEdgeLabel({ orientation: 'v', row: 0, col: 0 })).toBe('A1-B1');
      expect(formatWallEdgeLabel({ orientation: 'v', row: 2, col: 2 })).toBe('C3-D3');
      expect(formatWallEdgeLabel({ orientation: 'v', row: 6, col: 5 })).toBe('F7-G7');
    });

    it('throws RangeError on invalid wall edges', () => {
      expect(() => formatWallEdgeLabel({ orientation: 'h', row: 6, col: 0 })).toThrow(RangeError);
      expect(() => formatWallEdgeLabel({ orientation: 'v', row: 0, col: 6 })).toThrow(RangeError);
      expect(() => formatWallEdgeLabel({ orientation: 'h', row: -1, col: 0 })).toThrow(RangeError);
      expect(() => formatWallEdgeLabel({ orientation: 'v', row: 0, col: -1 })).toThrow(RangeError);
      expect(() => formatWallEdgeLabel({ orientation: 'h', row: 1.5, col: 0 })).toThrow(RangeError);
      expect(() =>
        formatWallEdgeLabel({ orientation: 'x' as unknown as 'h', row: 0, col: 0 }),
      ).toThrow(RangeError);
      expect(() => formatWallEdgeLabel(null as unknown as WallEdge)).toThrow(RangeError);
    });
  });

  describe('full-game deterministic bot-vs-bot replay parity', () => {
    it('replays Wall Go I 3P (with shuffleOrder: true) identically to live play', () => {
      const init = createInitialGameState(
        {
          ruleVariant: 'wallgo1',
          format: '3p',
          players: makePlayers3P(),
          shuffleOrder: true,
          timerSeconds: 90,
        },
        createSeededRng(777),
      );
      const { finalState, replay } = playBotMatchToCompletion(init, 778);
      const frames = buildReplayFrames(replay);

      expect(frames.length).toBe(replay.steps.length + 1);
      expect(frames[0].step).toBeNull();
      expect(frames[0].state.players.map((p) => p.name)).toEqual(init.players.map((p) => p.name));

      const last = frames[frames.length - 1].state;
      expect(last.phase).toBe('game_over');
      expect(last.pieces).toEqual(finalState.pieces);
      expect(last.walls).toEqual(finalState.walls);
      expect(last.lastPlacedWall).toEqual(finalState.lastPlacedWall);
      expect(last.territory.scores).toEqual(finalState.territory.scores);
      expect(last.territory.endReason).toEqual(finalState.territory.endReason);
    });

    it('replays Wall Go II 3P (square/round placements + wall breaks) identically to live play', () => {
      const init = createInitialGameState(
        {
          ruleVariant: 'wallgo2',
          format: '3p',
          players: makePlayers3P(),
          shuffleOrder: true,
          timerSeconds: 60,
        },
        createSeededRng(888),
      );
      const { finalState, replay } = playBotMatchToCompletion(init, 889);
      const frames = buildReplayFrames(replay);

      expect(frames.length).toBe(replay.steps.length + 1);
      const last = frames[frames.length - 1].state;
      expect(last.phase).toBe('game_over');
      expect(last.pieces).toEqual(finalState.pieces);
      expect(last.walls).toEqual(finalState.walls);
      expect(last.lastPlacedWall).toEqual(finalState.lastPlacedWall);
      expect(last.territory.scores).toEqual(finalState.territory.scores);
    });

    it('replays Standalone 2P (Wall Go I & Wall Go II) with 4 fixed diagonal pieces and 0 breaks', () => {
      for (const variant of ['wallgo1', 'wallgo2'] as const) {
        const init = createInitialGameState({
          ruleVariant: variant,
          format: '2p',
          players: makePlayers2P(),
          shuffleOrder: false,
          timerSeconds: 0,
        });
        const { finalState, replay } = playBotMatchToCompletion(
          init,
          variant === 'wallgo1' ? 910 : 920,
        );
        const frames = buildReplayFrames(replay);

        expect(frames[0].state.isPrisonMatchRound2).toBe(false);
        expect(frames[0].state.pieces).toHaveLength(4);
        expect(frames[0].state.players.every((p) => p.wallBreaksRemaining === 0)).toBe(true);

        const last = frames[frames.length - 1].state;
        expect(last.phase).toBe('game_over');
        expect(last.pieces).toEqual(finalState.pieces);
        expect(last.walls).toEqual(finalState.walls);
        expect(last.territory.scores).toEqual(finalState.territory.scores);
      }
    });
  });

  describe('Prison Match Round 2 (isPrisonMatchRound2: true) replay fidelity', () => {
    it('faithfully preserves isPrisonMatchRound2, advancing colorTokens, 4 fixed pieces, and final board for WG1 & WG2', () => {
      for (const variant of ['wallgo1', 'wallgo2'] as const) {
        // Construct finished 3P state where p1 (id=0) clearly wins 1st so p2 & p3 advance
        const base3p = createInitialGameState({
          ruleVariant: variant,
          format: '3p',
          players: makePlayers3P(),
          shuffleOrder: false,
          timerSeconds: 90,
        });
        const walls: Record<`${'h' | 'v'}:${number}:${number}`, PlacedWall> = {};
        for (let col = 0; col < 7; col++) {
          walls[`h:2:${col}`] = { orientation: 'h', row: 2, col, ownerId: 0 };
        }
        for (let row = 3; row < 7; row++) {
          walls[`v:${row}:3`] = { orientation: 'v', row, col: 3, ownerId: 1 };
        }
        const pieces =
          variant === 'wallgo1'
            ? [
                { id: 'p0_0', ownerId: 0, kind: 'standard' as const, row: 0, col: 0 },
                { id: 'p0_1', ownerId: 0, kind: 'standard' as const, row: 1, col: 1 },
                { id: 'p1_0', ownerId: 1, kind: 'standard' as const, row: 4, col: 0 },
                { id: 'p1_1', ownerId: 1, kind: 'standard' as const, row: 5, col: 1 },
                { id: 'p2_0', ownerId: 2, kind: 'standard' as const, row: 4, col: 5 },
                { id: 'p2_1', ownerId: 2, kind: 'standard' as const, row: 5, col: 6 },
              ]
            : [
                { id: 'p0_0', ownerId: 0, kind: 'square' as const, row: 0, col: 0 },
                { id: 'p0_1', ownerId: 0, kind: 'round' as const, row: 1, col: 1 },
                { id: 'p1_0', ownerId: 1, kind: 'square' as const, row: 4, col: 0 },
                { id: 'p1_1', ownerId: 1, kind: 'round' as const, row: 5, col: 1 },
                { id: 'p2_0', ownerId: 2, kind: 'square' as const, row: 4, col: 5 },
                { id: 'p2_1', ownerId: 2, kind: 'round' as const, row: 5, col: 6 },
              ];
        const draftFinished: GameState = {
          ...base3p,
          pieces,
          walls,
          phase: 'game_over',
          placementStep: base3p.placementQueue.length,
        };
        const finished3p: GameState = {
          ...draftFinished,
          territory: analyzeTerritory(draftFinished),
        };

        const r2Init = createPrisonMatchRound2State(finished3p);
        const { finalState, replay } = playBotMatchToCompletion(
          r2Init,
          variant === 'wallgo1' ? 1201 : 1202,
        );
        const frames = buildReplayFrames(replay);

        expect(frames[0].state.isPrisonMatchRound2).toBe(true);
        expect(frames[0].state.players.map((p) => p.colorToken)).toEqual(['p2', 'p3']);
        expect(frames[0].state.players.every((p) => p.wallBreaksRemaining === 0)).toBe(true);
        expect(frames[0].state.pieces).toEqual([
          { id: 'p0_0', ownerId: 0, kind: variant === 'wallgo2' ? 'round' : 'standard', row: 1, col: 1 },
          { id: 'p0_1', ownerId: 0, kind: variant === 'wallgo2' ? 'round' : 'standard', row: 5, col: 5 },
          { id: 'p1_0', ownerId: 1, kind: variant === 'wallgo2' ? 'round' : 'standard', row: 1, col: 5 },
          { id: 'p1_1', ownerId: 1, kind: variant === 'wallgo2' ? 'round' : 'standard', row: 5, col: 1 },
        ]);
        // Placed piece IDs in steps 1..4 are p0_2, p1_2, p1_3, p0_3
        const placedIds = frames.slice(1, 5).map((f) => f.step?.kind === 'placement' ? f.step.pieceId : null);
        expect(placedIds).toEqual(['p0_2', 'p1_2', 'p1_3', 'p0_3']);

        const last = frames[frames.length - 1].state;
        expect(last.isPrisonMatchRound2).toBe(true);
        expect(last.phase).toBe('game_over');
        expect(last.pieces).toEqual(finalState.pieces);
        expect(last.walls).toEqual(finalState.walls);
        expect(last.territory.scores).toEqual(finalState.territory.scores);
      }
    });

    it('rejects isPrisonMatchRound2: true with format: "3p" at stepIndex 0', () => {
      try {
        createInitialStateFromReplayConfig({
          ruleVariant: 'wallgo1',
          format: '3p',
          isPrisonMatchRound2: true,
          timerSeconds: 0,
          players: makePlayers3P(),
        });
        expect.unreachable('should have thrown ReplayValidationError');
      } catch (err) {
        expect(err).toBeInstanceOf(ReplayValidationError);
        expect((err as ReplayValidationError).stepIndex).toBe(0);
      }
    });
  });

  describe('complex rule edge-case replay fidelity (V2-E27)', () => {
    it('replays WG1 0-step stay, WG1 wall break + E10 reseal, twin-piece stay timeout, and mid-game AI substitution', () => {
      const init = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '3p',
        players: [
          { name: 'Alice', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
          { name: 'Bob', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
          { name: 'Cara', colorToken: 'p3', isAI: false, aiDifficulty: 'normal' },
        ],
        shuffleOrder: false,
        timerSeconds: 90,
      });
      const initialConfig = createReplayInitialConfig(init);
      const steps: ReplayStep[] = [];
      let s = init;

      const record = (next: GameState) => {
        s = next;
        expect(s.lastActionEvent).not.toBeNull();
        steps.push(actionEventToReplayStep(s.lastActionEvent!, steps.length + 1));
      };

      // Placements [0, 1, 2, 2, 1, 0]: put P0 twins adjacent at (2,2) and (2,3)
      record(placeInitialPiece(s, { row: 2, col: 2 })); // p0_0
      record(placeInitialPiece(s, { row: 2, col: 4 })); // p1_0
      record(placeInitialPiece(s, { row: 5, col: 5 })); // p2_0
      record(placeInitialPiece(s, { row: 5, col: 6 })); // p2_1
      record(placeInitialPiece(s, { row: 4, col: 4 })); // p1_1
      record(placeInitialPiece(s, { row: 2, col: 3 })); // p0_1

      // Turn 1 (P0): WG1 0-step stay on p0_0 + place h:2:2
      record(
        applyAtomicTurnAction(s, {
          pieceId: 'p0_0',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 2, col: 2 },
          placeWall: { orientation: 'h', row: 2, col: 2 },
        }),
      );

      // Turn 2 (P1): Mid-game AI substitution -> P1 moves p1_0 to (2,4) stay + places v:2:3 (adjacent to p0_1!)
      s = setPlayerControllerInGame(s, 1, true, 'hard');
      record(
        applyAtomicTurnAction(s, {
          pieceId: 'p1_0',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 2, col: 4 },
          placeWall: { orientation: 'v', row: 2, col: 3 },
        }),
      );

      // Turn 3 (P2): Normal move
      record(
        applyAtomicTurnAction(s, {
          pieceId: 'p2_0',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 5, col: 4 },
          placeWall: { orientation: 'h', row: 5, col: 4 },
        }),
      );

      // Turn 4 (P0): WG1 wall break on opponent wall v:2:3 (ownerId=1) + E10 same-edge resealing!
      record(
        applyAtomicTurnAction(s, {
          pieceId: 'p0_1',
          useWallBreak: true,
          breakWall: { orientation: 'v', row: 2, col: 3 },
          destination: { row: 2, col: 3 },
          placeWall: { orientation: 'v', row: 2, col: 3 },
        }),
      );
      expect(s.walls['v:2:3'].ownerId).toBe(0);
      expect(s.players[0].wallBreaksRemaining).toBe(0);

      // Turn 5 (P1): Normal move
      record(
        applyAtomicTurnAction(s, {
          pieceId: 'p1_1',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 4, col: 3 },
          placeWall: { orientation: 'h', row: 4, col: 3 },
        }),
      );

      // Turn 6 (P2): Normal move
      record(
        applyAtomicTurnAction(s, {
          pieceId: 'p2_1',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 4, col: 6 },
          placeWall: { orientation: 'v', row: 4, col: 5 },
        }),
      );

      // Turn 7 (P0): Twin-piece 0-step stay timeout disambiguation!
      const timeoutRes = resolveTurnTimeout(s, () => 0.99); // selects p0_1
      expect(timeoutRes.event?.kind).toBe('turn');
      record(timeoutRes.state);

      const replay = extractReplayFromHistory(initialConfig, steps);
      const frames = buildReplayFrames(replay);
      expect(frames.length).toBe(steps.length + 1);

      // Verify mid-game AI substitution metadata preserved on Turn 2 (stepIndex 8)
      expect(frames[8].step?.actorIsAI).toBe(true);
      expect(frames[8].state.lastActionEvent?.actorIsAI).toBe(true);

      // Verify E10 resealing reconstructed on Turn 4 (stepIndex 10)
      expect(frames[10].state.walls['v:2:3'].ownerId).toBe(0);
      expect(frames[10].state.players[0].wallBreaksRemaining).toBe(0);

      // Verify twin-piece stay timeout disambiguation on Turn 7 (stepIndex 13)
      const lastFrame = frames[frames.length - 1];
      expect(lastFrame.step?.timedOut).toBe(true);
      expect(lastFrame.state.lastActionEvent?.timedOut).toBe(true);
      expect(lastFrame.step?.kind === 'turn' && lastFrame.step.pieceId).toBe('p0_1');
      expect(lastFrame.state.walls).toEqual(s.walls);
      expect(lastFrame.state.pieces).toEqual(s.pieces);
    });

    it('replays WG2 E10 resealing and E13 ambiguous diagonal (Choice A vs Choice B) faithfully', () => {
      const init = createInitialGameState({
        ruleVariant: 'wallgo2',
        format: '3p',
        players: makePlayers3P(),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      const initialConfig = createReplayInitialConfig(init);
      const baseSteps: ReplayStep[] = [];
      let s = init;
      const rec = (next: GameState, targetSteps: ReplayStep[]) => {
        expect(next.lastActionEvent).not.toBeNull();
        targetSteps.push(actionEventToReplayStep(next.lastActionEvent!, targetSteps.length + 1));
        return next;
      };

      // Place pieces so P0 round piece is at (2,2) and P1/P2 place h:2:2 and v:2:2
      s = rec(placeInitialPiece(s, { row: 2, col: 2 }, 'round'), baseSteps); // p0_0
      s = rec(placeInitialPiece(s, { row: 2, col: 4 }, 'round'), baseSteps); // p1_0
      s = rec(placeInitialPiece(s, { row: 4, col: 2 }, 'round'), baseSteps); // p2_0
      s = rec(placeInitialPiece(s, { row: 6, col: 6 }, 'square'), baseSteps); // p2_1
      s = rec(placeInitialPiece(s, { row: 6, col: 0 }, 'square'), baseSteps); // p1_1
      s = rec(placeInitialPiece(s, { row: 0, col: 0 }, 'square'), baseSteps); // p0_1

      // P0 moves p0_1 (0,0)->(0,1), places h:0:1
      s = rec(
        applyAtomicTurnAction(s, {
          pieceId: 'p0_1',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 0, col: 1 },
          placeWall: { orientation: 'h', row: 0, col: 1 },
        }),
        baseSteps,
      );
      // P1 moves p1_0 (2,4)->(2,3), places v:2:2 (right side of p0_0 at (2,2))
      s = rec(
        applyAtomicTurnAction(s, {
          pieceId: 'p1_0',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 2, col: 3 },
          placeWall: { orientation: 'v', row: 2, col: 2 },
        }),
        baseSteps,
      );
      // P2 moves p2_0 (4,2)->(3,2), places h:2:2 (bottom side of p0_0 at (2,2))
      s = rec(
        applyAtomicTurnAction(s, {
          pieceId: 'p2_0',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 3, col: 2 },
          placeWall: { orientation: 'h', row: 2, col: 2 },
        }),
        baseSteps,
      );

      // Now p0_0 at (2,2) moving diagonally to (3,3) is blocked on BOTH L-paths:
      // Path 1: (2,2)->(3,2)->(3,3) blocked by p2_0? Wait: (3,2) is occupied by p2_0!
      // Let's check: move P1/P2 away so both (2,3) and (3,2) are EMPTY!
      // P0 moves p0_1 (0,1)->(0,2)
      s = rec(
        applyAtomicTurnAction(s, {
          pieceId: 'p0_1',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 0, col: 2 },
          placeWall: { orientation: 'h', row: 0, col: 2 },
        }),
        baseSteps,
      );
      // P1 moves p1_0 (2,3)->(2,4) leaving (2,3) empty
      s = rec(
        applyAtomicTurnAction(s, {
          pieceId: 'p1_0',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 2, col: 4 },
          placeWall: { orientation: 'h', row: 2, col: 4 },
        }),
        baseSteps,
      );
      // P2 moves p2_0 (3,2)->(4,2) leaving (3,2) empty
      s = rec(
        applyAtomicTurnAction(s, {
          pieceId: 'p2_0',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 4, col: 2 },
          placeWall: { orientation: 'h', row: 4, col: 2 },
        }),
        baseSteps,
      );

      // Choice A: break h:2:2 (leave v:2:2 intact)
      const stepsA = baseSteps.slice();
      const afterA = rec(
        applyAtomicTurnAction(s, {
          pieceId: 'p0_0',
          useWallBreak: true,
          breakWall: { orientation: 'h', row: 2, col: 2 },
          destination: { row: 3, col: 3 },
          placeWall: { orientation: 'h', row: 3, col: 3 },
        }),
        stepsA,
      );
      const framesA = buildReplayFrames(extractReplayFromHistory(initialConfig, stepsA));
      const lastA = framesA[framesA.length - 1].state;
      expect(lastA.walls['h:2:2']).toBeUndefined();
      expect(lastA.walls['v:2:2']?.ownerId).toBe(1);
      expect(lastA.walls).toEqual(afterA.walls);

      // Choice B: break v:2:2 (leave h:2:2 intact)
      const stepsB = baseSteps.slice();
      const afterB = rec(
        applyAtomicTurnAction(s, {
          pieceId: 'p0_0',
          useWallBreak: true,
          breakWall: { orientation: 'v', row: 2, col: 2 },
          destination: { row: 3, col: 3 },
          placeWall: { orientation: 'h', row: 3, col: 3 },
        }),
        stepsB,
      );
      const framesB = buildReplayFrames(extractReplayFromHistory(initialConfig, stepsB));
      const lastB = framesB[framesB.length - 1].state;
      expect(lastB.walls['v:2:2']).toBeUndefined();
      expect(lastB.walls['h:2:2']?.ownerId).toBe(2);
      expect(lastB.walls).toEqual(afterB.walls);

      // WG2 E10 same-edge resealing: p0_0 breaks v:2:2 moving (2,2)->(2,3) and reseals v:2:2!
      const stepsE10 = baseSteps.slice();
      const afterE10 = rec(
        applyAtomicTurnAction(s, {
          pieceId: 'p0_0',
          useWallBreak: true,
          breakWall: { orientation: 'v', row: 2, col: 2 },
          destination: { row: 2, col: 3 },
          placeWall: { orientation: 'v', row: 2, col: 2 },
        }),
        stepsE10,
      );
      const framesE10 = buildReplayFrames(extractReplayFromHistory(initialConfig, stepsE10));
      const lastE10 = framesE10[framesE10.length - 1].state;
      expect(lastE10.walls['v:2:2']?.ownerId).toBe(0);
      expect(lastE10.walls).toEqual(afterE10.walls);
    });

    it('replays Turn 0 auto-skip faithfully with lastSkippedPlayerIds = [0]', () => {
      const init = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '3p',
        players: makePlayers3P(),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      const initialConfig = createReplayInitialConfig(init);
      const steps: ReplayStep[] = [];
      let s = init;
      for (const pos of [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 1, col: 0 },
        { row: 0, col: 5 },
        { row: 1, col: 6 },
        { row: 0, col: 6 },
      ]) {
        s = placeInitialPiece(s, pos);
        steps.push(actionEventToReplayStep(s.lastActionEvent!, steps.length + 1));
      }
      const frames = buildReplayFrames(extractReplayFromHistory(initialConfig, steps));
      expect(frames[6].state.lastSkippedPlayerIds).toEqual([0]);
      expect(frames[6].state.currentPlayerIndex).toBe(1);
    });
  });

  describe('corrupt / malicious replay rejection', () => {
    function makeValidBaseReplay(): ReplayData {
      const init = createInitialGameState({
        ruleVariant: 'wallgo2',
        format: '2p',
        players: makePlayers2P(),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      const { replay } = playBotMatchToCompletion(init, 303);
      return replay;
    }

    function expectReplayErrorAt(fn: () => unknown, expectedStep: number): void {
      try {
        fn();
        expect.unreachable(`Expected ReplayValidationError at step ${expectedStep}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ReplayValidationError);
        expect((err as ReplayValidationError).stepIndex).toBe(expectedStep);
      }
    }

    it('rejects bad schemaVersion, null players, and malformed root payload at stepIndex 0', () => {
      const valid = makeValidBaseReplay();
      expectReplayErrorAt(() => buildReplayFrames(null as unknown as ReplayData), 0);
      expectReplayErrorAt(
        () => buildReplayFrames({ ...valid, schemaVersion: 2 as unknown as 1 }),
        0,
      );
      expectReplayErrorAt(
        () =>
          buildReplayFrames({
            ...valid,
            initialConfig: {
              ...valid.initialConfig,
              players: [null as unknown as PlayerConfig, valid.initialConfig.players[1]],
            },
          }),
        0,
      );
      expectReplayErrorAt(
        () => buildReplayFrames({ ...valid, steps: 'bad' as unknown as ReplayStep[] }),
        0,
      );
    });

    it('rejects step index gaps, illegal placements, illegal turns, and steps after game_over with exact stepIndex', () => {
      const valid = makeValidBaseReplay();

      // Gap in stepIndex (step 2 labeled 3)
      const withGap: ReplayData = {
        ...valid,
        steps: valid.steps.map((s, idx) => (idx === 1 ? { ...s, stepIndex: 3 } : s)),
      };
      expectReplayErrorAt(() => buildReplayFrames(withGap), 2);

      // Illegal placement: occupied fixed diagonal cell (1,1)
      const occupiedPlacement: ReplayData = {
        ...valid,
        steps: [
          {
            ...(valid.steps[0] as Extract<ReplayStep, { kind: 'placement' }>),
            pos: { row: 1, col: 1 },
          },
        ],
      };
      expectReplayErrorAt(() => buildReplayFrames(occupiedPlacement), 1);

      // Illegal placement: wrong playerId
      const wrongPlacementPlayer: ReplayData = {
        ...valid,
        steps: [
          {
            ...(valid.steps[0] as Extract<ReplayStep, { kind: 'placement' }>),
            playerId: 1,
          },
        ],
      };
      expectReplayErrorAt(() => buildReplayFrames(wrongPlacementPlayer), 1);

      // Illegal turn: first turn is at index 4 (stepIndex 5) in 2P
      const firstTurn = valid.steps[4] as Extract<ReplayStep, { kind: 'turn' }>;
      expect(firstTurn.kind).toBe('turn');

      // Wrong from coordinate
      expectReplayErrorAt(
        () =>
          buildReplayFrames({
            ...valid,
            steps: [
              ...valid.steps.slice(0, 4),
              { ...firstTurn, from: { row: 6, col: 6 } },
            ],
          }),
        5,
      );

      // Inconsistent isStay flag
      expectReplayErrorAt(
        () =>
          buildReplayFrames({
            ...valid,
            steps: [
              ...valid.steps.slice(0, 4),
              { ...firstTurn, isStay: !firstTurn.isStay },
            ],
          }),
        5,
      );

      // usedWallBreak: true with brokenWall: null
      expectReplayErrorAt(
        () =>
          buildReplayFrames({
            ...valid,
            steps: [
              ...valid.steps.slice(0, 4),
              { ...firstTurn, usedWallBreak: true, brokenWall: null },
            ],
          }),
        5,
      );

      // WG2 0-step stay (illegal in WG2)
      expectReplayErrorAt(
        () =>
          buildReplayFrames({
            ...valid,
            steps: [
              ...valid.steps.slice(0, 4),
              { ...firstTurn, to: { ...firstTurn.from }, isStay: true },
            ],
          }),
        5,
      );

      // Non-adjacent wall placement
      expectReplayErrorAt(
        () =>
          buildReplayFrames({
            ...valid,
            steps: [
              ...valid.steps.slice(0, 4),
              {
                ...firstTurn,
                placedWall: {
                  orientation: 'h',
                  row: firstTurn.to.row === 5 ? 0 : 5,
                  col: firstTurn.to.col === 6 ? 0 : 6,
                },
              },
            ],
          }),
        5,
      );

      // Extra step appended after game_over
      const extraStepIndex = valid.steps.length + 1;
      expectReplayErrorAt(
        () =>
          buildReplayFrames({
            ...valid,
            steps: [...valid.steps, { ...firstTurn, stepIndex: extraStepIndex }],
          }),
        extraStepIndex,
      );

      // Tampered skippedPlayerIds on a normal turn where engine lastSkippedPlayerIds is []
      expectReplayErrorAt(
        () =>
          buildReplayFrames({
            ...valid,
            steps: [
              ...valid.steps.slice(0, 4),
              { ...firstTurn, skippedPlayerIds: [999] },
            ],
          }),
        5,
      );

      // Tampered skippedPlayerIds on an intermediate placement where engine lastSkippedPlayerIds is []
      expectReplayErrorAt(
        () =>
          buildReplayFrames({
            ...valid,
            steps: [
              {
                ...(valid.steps[0] as Extract<ReplayStep, { kind: 'placement' }>),
                skippedPlayerIds: [0],
              },
            ],
          }),
        1,
      );
    });

    it('rejects tampered skippedPlayerIds on Turn 0 auto-skip placement and mid-game auto-skip turns', () => {
      // 1) Turn 0 auto-skip placement (step 6 genuinely skips Player 0)
      const initTurn0 = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '3p',
        players: makePlayers3P(),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      const initialConfig0 = createReplayInitialConfig(initTurn0);
      const turn0Steps: ReplayStep[] = [];
      let s0 = initTurn0;
      for (const pos of [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 1, col: 0 },
        { row: 0, col: 5 },
        { row: 1, col: 6 },
        { row: 0, col: 6 },
      ]) {
        s0 = placeInitialPiece(s0, pos);
        turn0Steps.push(actionEventToReplayStep(s0.lastActionEvent!, turn0Steps.length + 1));
      }
      expect(turn0Steps[5].skippedPlayerIds).toEqual([0]);

      // Wiping [0] -> [] must throw ReplayValidationError at stepIndex 6
      const wipedPlacementReplay = extractReplayFromHistory(initialConfig0, [
        ...turn0Steps.slice(0, 5),
        { ...turn0Steps[5], skippedPlayerIds: [] },
      ]);
      expectReplayErrorAt(() => buildReplayFrames(wipedPlacementReplay), 6);

      // Wrong skipped player [1] instead of [0] must throw ReplayValidationError at stepIndex 6
      const wrongPlacementReplay = extractReplayFromHistory(initialConfig0, [
        ...turn0Steps.slice(0, 5),
        { ...turn0Steps[5], skippedPlayerIds: [1] },
      ]);
      expectReplayErrorAt(() => buildReplayFrames(wrongPlacementReplay), 6);

      // 2) Mid-game auto-skip turn (P1 pieces at (0,0)-(0,1) are boxed by pieces on (1,0), (1,1), (0,2))
      const initMid = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '3p',
        players: makePlayers3P(),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      const initialConfigMid = createReplayInitialConfig(initMid);
      const midSteps: ReplayStep[] = [];
      let sm = initMid;
      const pushStep = (next: GameState) => {
        sm = next;
        midSteps.push(actionEventToReplayStep(sm.lastActionEvent!, midSteps.length + 1));
      };
      // Placement queue [0, 1, 2, 2, 1, 0]
      pushStep(placeInitialPiece(sm, { row: 1, col: 0 })); // P0
      pushStep(placeInitialPiece(sm, { row: 0, col: 0 })); // P1
      pushStep(placeInitialPiece(sm, { row: 1, col: 1 })); // P2
      pushStep(placeInitialPiece(sm, { row: 0, col: 2 })); // P2
      pushStep(placeInitialPiece(sm, { row: 0, col: 1 })); // P1
      pushStep(placeInitialPiece(sm, { row: 5, col: 5 })); // P0

      // Turn 1 (P0): move p0_1 (5,5)->(5,6), place h:5:6 -> next is P1 (boxed with 0 legal moves) -> AUTO-SKIPPED!
      pushStep(
        applyAtomicTurnAction(sm, {
          pieceId: 'p0_1',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 5, col: 6 },
          placeWall: { orientation: 'h', row: 5, col: 6 },
        }),
      );
      const skipStepIdx = midSteps.length;
      expect(skipStepIdx).toBe(7);
      expect(midSteps[skipStepIdx - 1].skippedPlayerIds).toEqual([1]);

      // Valid replay passes cleanly
      const validMidFrames = buildReplayFrames(
        extractReplayFromHistory(initialConfigMid, midSteps),
      );
      expect(validMidFrames[skipStepIdx].state.lastSkippedPlayerIds).toEqual([1]);

      // Wiping skippedPlayerIds to [] on the auto-skip turn throws at skipStepIdx
      const tamperedMidEmpty = extractReplayFromHistory(initialConfigMid, [
        ...midSteps.slice(0, skipStepIdx - 1),
        { ...midSteps[skipStepIdx - 1], skippedPlayerIds: [] },
      ]);
      expectReplayErrorAt(() => buildReplayFrames(tamperedMidEmpty), skipStepIdx);

      // Tampering skippedPlayerIds to [2] on the auto-skip turn throws at skipStepIdx
      const tamperedMidWrong = extractReplayFromHistory(initialConfigMid, [
        ...midSteps.slice(0, skipStepIdx - 1),
        { ...midSteps[skipStepIdx - 1], skippedPlayerIds: [2] },
      ]);
      expectReplayErrorAt(() => buildReplayFrames(tamperedMidWrong), skipStepIdx);
    });
  });

  describe('immutability, match summary extraction, and computePlayerAggregateStats', () => {
    it('returns [Frame 0] for empty steps and keeps extractReplayFromHistory immutable', () => {
      const init = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '2p',
        players: makePlayers2P(),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      const cfg = createReplayInitialConfig(init);
      const replay = extractReplayFromHistory(cfg, []);
      cfg.players[0].name = 'MUTATED';
      expect(replay.initialConfig.players[0].name).toBe('Alice');

      const frames = buildReplayFrames(replay);
      expect(frames).toHaveLength(1);
      expect(frames[0].stepIndex).toBe(0);
      expect(frames[0].step).toBeNull();
    });

    it('builds accurate MatchPlayerSummary for unique winners, rank-1 draws, AI substitution, and Round 2 qualification', () => {
      // Tie for 1st in 2P: both have 21 cells, P0 at (0,0) P1 at (6,6) separated by horizontal wall row 2? Wait: 7x7 = 49.
      // Let's give P0 rows 0..2 (21 cells), P1 rows 4..6 (21 cells), row 3 empty neutral (7 cells).
      const base2p = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '2p',
        players: makePlayers2P(),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      const tieWalls: Record<`${'h' | 'v'}:${number}:${number}`, PlacedWall> = {};
      for (let col = 0; col < 7; col++) {
        tieWalls[wallKey({ orientation: 'h', row: 2, col })] = {
          orientation: 'h',
          row: 2,
          col,
          ownerId: 0,
        };
        tieWalls[wallKey({ orientation: 'h', row: 3, col })] = {
          orientation: 'h',
          row: 3,
          col,
          ownerId: 1,
        };
      }
      const tieDraft: GameState = {
        ...base2p,
        pieces: [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 1, col: 1 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
          { id: 'p1_1', ownerId: 1, kind: 'standard', row: 6, col: 6 },
        ],
        walls: tieWalls,
        phase: 'game_over',
        placementStep: 4,
      };
      const tieState: GameState = { ...tieDraft, territory: analyzeTerritory(tieDraft) };
      const tieSummaries = buildMatchPlayerSummaries(tieState, {
        substitutedPlayerIds: new Set([1]),
      });
      expect(tieSummaries).toHaveLength(2);
      expect(tieSummaries[0]).toMatchObject({ rank: 1, isWinner: false, isDraw: true, totalTerritory: 21 });
      expect(tieSummaries[1]).toMatchObject({
        rank: 1,
        isWinner: false,
        isDraw: true,
        wasSubstitutedToAI: true,
        totalTerritory: 21,
      });

      const finalBoard = extractMatchFinalBoard(tieState);
      const record: MatchRecord = {
        id: 'local_test_1',
        schemaVersion: 1,
        mode: 'local',
        playedAt: '2026-11-20T12:00:00.000Z',
        ruleVariant: 'wallgo1',
        format: '2p',
        isPrisonMatchRound2: false,
        timerSeconds: 0,
        endReason: 'all_separated',
        totalTurns: 10,
        totalSteps: 14,
        players: tieSummaries,
        finalBoard,
        hasReplay: true,
        replay: extractReplayFromHistory(createReplayInitialConfig(base2p), []),
      };
      const stripped = toMatchSummary(record);
      expect('replay' in stripped).toBe(false);
      expect(stripped.id).toBe('local_test_1');
      expect(stripped.hasReplay).toBe(true);
    });

    it('aggregates player stats case-insensitively with latest displayName casing, AI-only flag, and deterministic sorting', () => {
      expect(computePlayerAggregateStats([])).toEqual([]);

      const makePlayer = (overrides: Partial<MatchPlayerSummary>): MatchPlayerSummary => ({
        playerId: 0,
        name: 'Alice',
        colorToken: 'p1',
        isAI: false,
        aiDifficulty: 'normal',
        totalTerritory: 15,
        largestSingleTerritory: 15,
        securedRegions: [15],
        deadlockPieceCount: 0,
        rank: 1,
        isWinner: true,
        isDraw: false,
        ...overrides,
      });

      const makeSummary = (
        id: string,
        playedAt: string,
        players: MatchPlayerSummary[],
      ): MatchSummary => ({
        id,
        schemaVersion: 1,
        mode: 'online',
        playedAt,
        ruleVariant: 'wallgo1',
        format: '2p',
        isPrisonMatchRound2: false,
        timerSeconds: 0,
        endReason: 'all_separated',
        totalTurns: 12,
        totalSteps: 16,
        players,
        finalBoard: { pieces: [], walls: {}, lastPlacedWall: null },
        hasReplay: true,
      });

      // Intentionally pass oldest-first so we verify latest playedAt casing wins!
      const matches: MatchSummary[] = [
        makeSummary('m1', '2026-11-20T10:00:00.000Z', [
          makePlayer({ playerId: 0, name: ' alice ', totalTerritory: 20, rank: 1, isWinner: true, isDraw: false }),
          makePlayer({ playerId: 1, name: 'BotAlpha', isAI: true, totalTerritory: 10, rank: 2, isWinner: false, isDraw: false }),
        ]),
        makeSummary('m2', '2026-11-20T12:00:00.000Z', [
          makePlayer({ playerId: 0, name: 'ALICE', totalTerritory: 15, rank: 1, isWinner: false, isDraw: true }),
          makePlayer({ playerId: 1, name: 'bob', isAI: true, wasSubstitutedToAI: true, totalTerritory: 15, rank: 1, isWinner: false, isDraw: true }),
        ]),
        makeSummary('m3', '2026-11-20T14:00:00.000Z', [
          makePlayer({ playerId: 0, name: 'Alice', totalTerritory: 0, rank: 2, isWinner: false, isDraw: false }),
          makePlayer({ playerId: 1, name: 'BotAlpha', isAI: true, totalTerritory: 25, rank: 1, isWinner: true, isDraw: false }),
          makePlayer({ playerId: 2, name: '   ', totalTerritory: 5, rank: 3, isWinner: false, isDraw: false }),
        ]),
      ];

      const stats = computePlayerAggregateStats(matches);
      expect(stats.map((s) => s.key)).toEqual(['botalpha', 'alice', 'bob']);

      // BotAlpha: 2 games (1W, 0D, 1L), winRate=50%, avg=17.5, best=25, isAIOnly=true
      expect(stats[0]).toEqual({
        key: 'botalpha',
        displayName: 'BotAlpha',
        isAIOnly: true,
        gamesPlayed: 2,
        wins: 1,
        draws: 0,
        losses: 1,
        winRate: 50,
        avgTerritory: 17.5,
        bestTerritory: 25,
      });

      // Alice: 3 games (1W, 1D, 1L), winRate=33%, avg=11.7, best=20, latest casing 'Alice', isAIOnly=false
      expect(stats[1]).toEqual({
        key: 'alice',
        displayName: 'Alice',
        isAIOnly: false,
        gamesPlayed: 3,
        wins: 1,
        draws: 1,
        losses: 1,
        winRate: 33,
        avgTerritory: 11.7,
        bestTerritory: 20,
      });

      // bob: 1 game (0W, 1D, 0L), wasSubstitutedToAI -> isAIOnly=false!
      expect(stats[2]).toEqual({
        key: 'bob',
        displayName: 'bob',
        isAIOnly: false,
        gamesPlayed: 1,
        wins: 0,
        draws: 1,
        losses: 0,
        winRate: 0,
        avgTerritory: 15,
        bestTerritory: 15,
      });
    });
  });
});
