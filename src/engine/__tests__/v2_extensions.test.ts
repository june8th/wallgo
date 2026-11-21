import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_NAMES,
  DEFAULT_PLAYER_NAMES_BY_LOCALE,
  analyzeTerritory,
  applyAtomicTurnAction,
  breakWallAt,
  confirmWallGo2BreakWall,
  createFreshTurnSubState,
  createInitialGameState,
  createPrisonMatchRound2State,
  handleTurnTimeout,
  movePiece,
  normalizeTurnForTakeover,
  placeInitialPiece,
  placeWall,
  resolveTurnTimeout,
  selectPiece,
  selectWallGo2BreakDestination,
  setPlayerControllerInGame,
  toggleWallBreak,
  wallKey,
} from '../index.js';
import type {
  AtomicTurnAction,
  GameState,
  PlacedWall,
  PlayerConfig,
  RngFn,
  WallKey,
} from '../index.js';
import {
  applyBotTurnAction,
  chooseAiPlacement,
  chooseAiTurn,
} from '../../ai/index.js';

function createSeededRng(seed: number): RngFn {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    deepFreeze((obj as Record<string, unknown>)[key]);
  }
  return obj;
}

function makePlayers3P(aiFlags: [boolean, boolean, boolean] = [false, false, false]): PlayerConfig[] {
  return [
    { name: 'Alice', colorToken: 'p1', isAI: aiFlags[0], aiDifficulty: 'normal' },
    { name: 'Bob', colorToken: 'p2', isAI: aiFlags[1], aiDifficulty: 'normal' },
    { name: 'Cara', colorToken: 'p3', isAI: aiFlags[2], aiDifficulty: 'normal' },
  ];
}

function makeWallRecord(walls: PlacedWall[]): Record<WallKey, PlacedWall> {
  const map: Record<WallKey, PlacedWall> = {};
  for (const w of walls) {
    map[wallKey(w)] = w;
  }
  return map;
}

function withTerritory(state: GameState): GameState {
  return {
    ...state,
    territory: analyzeTerritory(state),
  };
}

function makePlayingState3P(
  ruleVariant: 'wallgo1' | 'wallgo2',
  pieces: GameState['pieces'],
  walls: PlacedWall[] = [],
  currentPlayerIndex = 0,
  wallBreaks: [number, number, number] = [1, 1, 1],
  aiFlags: [boolean, boolean, boolean] = [false, false, false],
): GameState {
  const base = createInitialGameState({
    ruleVariant,
    format: '3p',
    players: makePlayers3P(aiFlags),
    shuffleOrder: false,
    timerSeconds: 90,
  });
  const players = base.players.map((p, idx) => ({
    ...p,
    wallBreaksRemaining: wallBreaks[idx],
  }));
  return withTerritory({
    ...base,
    players,
    pieces,
    walls: makeWallRecord(walls),
    phase: 'select_piece',
    currentPlayerIndex,
    placementStep: base.placementQueue.length,
    turnNumber: 0,
    turnSubState: createFreshTurnSubState('square'),
  });
}

describe('v2 Engine Extensions (ENG-01, ENG-02, ENG-04, ENG-05)', () => {
  describe('DEFAULT_PLAYER_NAMES_BY_LOCALE and initial lastActionEvent', () => {
    it('preserves v1 DEFAULT_PLAYER_NAMES and exports KO/EN defaults', () => {
      expect(DEFAULT_PLAYER_NAMES).toEqual(['플레이어 1', '플레이어 2', '플레이어 3']);
      expect(DEFAULT_PLAYER_NAMES_BY_LOCALE.ko).toEqual(['플레이어 1', '플레이어 2', '플레이어 3']);
      expect(DEFAULT_PLAYER_NAMES_BY_LOCALE.en).toEqual(['Player 1', 'Player 2', 'Player 3']);
    });

    it('initializes lastActionEvent to null for initial 3P, 2P, and Prison Match Round 2 states', () => {
      const s3p = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '3p',
        players: makePlayers3P(),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      expect(s3p.lastActionEvent).toBeNull();

      // Finish a synthetic 3P game to test createPrisonMatchRound2State
      const finished3p = withTerritory({
        ...makePlayingState3P(
          'wallgo1',
          [
            { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
            { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 1 },
            { id: 'p1_0', ownerId: 1, kind: 'standard', row: 6, col: 0 },
            { id: 'p1_1', ownerId: 1, kind: 'standard', row: 6, col: 1 },
            { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 6 },
            { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 5 },
          ],
          [
            // Separate rows 0..1 (P0=14 cells) from rows 2..6, then split P1 vs P2
            ...Array.from({ length: 7 }, (_, col) => ({
              orientation: 'h' as const,
              row: 1,
              col,
              ownerId: 0,
            })),
            ...Array.from({ length: 5 }, (_, idx) => ({
              orientation: 'v' as const,
              row: idx + 2,
              col: 3,
              ownerId: 1,
            })),
          ],
        ),
        phase: 'game_over',
      });
      const r2 = createPrisonMatchRound2State(finished3p);
      expect(r2.isPrisonMatchRound2).toBe(true);
      expect(r2.lastActionEvent).toBeNull();
    });
  });

  describe('ENG-01: lastActionEvent on placeInitialPiece', () => {
    it('populates PlacementActionEvent with normalized -0 coords and WG1/WG2 pieceKind', () => {
      const wg1 = deepFreeze(
        createInitialGameState({
          ruleVariant: 'wallgo1',
          format: '3p',
          players: makePlayers3P([true, false, false]),
          shuffleOrder: false,
          timerSeconds: 0,
        }),
      );
      const after1 = placeInitialPiece(wg1, { row: -0, col: -0 });
      expect(after1.lastActionEvent).toEqual({
        kind: 'placement',
        playerId: 0,
        actorIsAI: true,
        pieceId: 'p0_0',
        pieceKind: 'standard',
        pos: { row: 0, col: 0 },
        timedOut: false,
        skippedPlayerIds: [],
      });
      expect(Object.is(after1.lastActionEvent?.kind === 'placement' ? after1.lastActionEvent.pos.row : -1, 0)).toBe(true);
      expect(Object.is(after1.lastActionEvent?.kind === 'placement' ? after1.lastActionEvent.pos.col : -1, 0)).toBe(true);

      const wg2 = createInitialGameState({
        ruleVariant: 'wallgo2',
        format: '3p',
        players: makePlayers3P([false, true, false]),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      const afterWg2P0 = placeInitialPiece(wg2, { row: 2, col: 2 }, 'round');
      expect(afterWg2P0.lastActionEvent).toMatchObject({
        kind: 'placement',
        playerId: 0,
        actorIsAI: false,
        pieceId: 'p0_0',
        pieceKind: 'round',
        pos: { row: 2, col: 2 },
        timedOut: false,
        skippedPlayerIds: [],
      });
      const afterWg2P1 = placeInitialPiece(afterWg2P0, { row: 4, col: 4 }, 'square');
      expect(afterWg2P1.lastActionEvent).toMatchObject({
        kind: 'placement',
        playerId: 1,
        actorIsAI: true,
        pieceId: 'p1_0',
        pieceKind: 'square',
        pos: { row: 4, col: 4 },
        timedOut: false,
        skippedPlayerIds: [],
      });
    });

    it('records Turn 0 skippedPlayerIds on final placement when P0 is boxed in corners', () => {
      // Placement queue for 3P is [0, 1, 2, 2, 1, 0]
      let state = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '3p',
        players: makePlayers3P(),
        shuffleOrder: false,
        timerSeconds: 0,
      });
      // P0 at (0,0), P1 at (0,1), P2 at (1,0), P2 at (0,5), P1 at (1,6), P0 at (0,6)
      state = placeInitialPiece(state, { row: 0, col: 0 });
      state = placeInitialPiece(state, { row: 0, col: 1 });
      state = placeInitialPiece(state, { row: 1, col: 0 });
      state = placeInitialPiece(state, { row: 0, col: 5 });
      state = placeInitialPiece(state, { row: 1, col: 6 });
      const finalPlacement = placeInitialPiece(state, { row: 0, col: 6 });

      expect(finalPlacement.phase).toBe('select_piece');
      expect(finalPlacement.currentPlayerIndex).toBe(1);
      expect(finalPlacement.lastSkippedPlayerIds).toEqual([0]);
      expect(finalPlacement.lastActionEvent).toEqual({
        kind: 'placement',
        playerId: 0,
        actorIsAI: false,
        pieceId: 'p0_1',
        pieceKind: 'standard',
        pos: { row: 0, col: 6 },
        timedOut: false,
        skippedPlayerIds: [0],
      });
    });
  });

  describe('ENG-01: lastActionEvent on placeWall', () => {
    it('captures normal move, 0-step stay, and -0 normalization cleanly', () => {
      const s = deepFreeze(
        makePlayingState3P('wallgo1', [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 2, col: 2 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
          { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 4 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 1 },
          { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 2 },
        ]),
      );

      // Normal move
      let cur = selectPiece(s, 'p0_0');
      cur = movePiece(cur, { row: 2, col: 3 });
      const afterNormal = placeWall(cur, { orientation: 'v', row: 2, col: 3 });
      expect(afterNormal.lastActionEvent).toEqual({
        kind: 'turn',
        turnNumber: 1,
        playerId: 0,
        actorIsAI: false,
        pieceId: 'p0_0',
        pieceKind: 'standard',
        from: { row: 2, col: 2 },
        to: { row: 2, col: 3 },
        isStay: false,
        usedWallBreak: false,
        brokenWall: null,
        placedWall: { orientation: 'v', row: 2, col: 3 },
        timedOut: false,
        skippedPlayerIds: [],
      });

      // WG1 0-step stay with -0 coordinates
      let stayCur = selectPiece(s, 'p0_1');
      stayCur = movePiece(stayCur, { row: -0, col: -0 });
      const afterStay = placeWall(stayCur, { orientation: 'h', row: -0, col: -0 });
      expect(afterStay.lastActionEvent).toEqual({
        kind: 'turn',
        turnNumber: 1,
        playerId: 0,
        actorIsAI: false,
        pieceId: 'p0_1',
        pieceKind: 'standard',
        from: { row: 0, col: 0 },
        to: { row: 0, col: 0 },
        isStay: true,
        usedWallBreak: false,
        brokenWall: null,
        placedWall: { orientation: 'h', row: 0, col: 0 },
        timedOut: false,
        skippedPlayerIds: [],
      });
      if (afterStay.lastActionEvent?.kind === 'turn') {
        expect(Object.is(afterStay.lastActionEvent.placedWall.row, 0)).toBe(true);
        expect(Object.is(afterStay.lastActionEvent.placedWall.col, 0)).toBe(true);
      }
    });

    it('captures WG1 wall break + E10 same-edge resealing with original brokenWall ownerId', () => {
      const targetWall: PlacedWall = { orientation: 'v', row: 2, col: 2, ownerId: 1 };
      const s = deepFreeze(
        makePlayingState3P(
          'wallgo1',
          [
            { id: 'p0_0', ownerId: 0, kind: 'standard', row: 2, col: 2 },
            { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 0 },
            { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
            { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 4 },
            { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 1 },
            { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 2 },
          ],
          [targetWall],
        ),
      );

      let cur = selectPiece(s, 'p0_0');
      cur = toggleWallBreak(cur);
      cur = breakWallAt(cur, { orientation: 'v', row: 2, col: 2 });
      cur = movePiece(cur, { row: 2, col: 3 });
      const after = placeWall(cur, { orientation: 'v', row: 2, col: 2 });

      expect(after.walls['v:2:2'].ownerId).toBe(0);
      expect(after.lastActionEvent).toEqual({
        kind: 'turn',
        turnNumber: 1,
        playerId: 0,
        actorIsAI: false,
        pieceId: 'p0_0',
        pieceKind: 'standard',
        from: { row: 2, col: 2 },
        to: { row: 2, col: 3 },
        isStay: false,
        usedWallBreak: true,
        brokenWall: { orientation: 'v', row: 2, col: 2, ownerId: 1 },
        placedWall: { orientation: 'v', row: 2, col: 2 },
        timedOut: false,
        skippedPlayerIds: [],
      });
    });

    it('captures WG2 1-wall break and 2-wall E13 ambiguous diagonal break', () => {
      const wH: PlacedWall = { orientation: 'h', row: 2, col: 2, ownerId: 1 };
      const wV: PlacedWall = { orientation: 'v', row: 2, col: 2, ownerId: 2 };
      const s = deepFreeze(
        makePlayingState3P(
          'wallgo2',
          [
            { id: 'p0_0', ownerId: 0, kind: 'round', row: 2, col: 2 },
            { id: 'p0_1', ownerId: 0, kind: 'square', row: 0, col: 0 },
            { id: 'p1_0', ownerId: 1, kind: 'round', row: 5, col: 5 },
            { id: 'p1_1', ownerId: 1, kind: 'square', row: 5, col: 4 },
            { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 1 },
            { id: 'p2_1', ownerId: 2, kind: 'square', row: 6, col: 2 },
          ],
          [wH, wV],
        ),
      );

      // 1-wall break: round piece from (2,2) -> (2,3) breaks wV
      let c1 = selectPiece(s, 'p0_0');
      c1 = toggleWallBreak(c1);
      c1 = selectWallGo2BreakDestination(c1, { row: 2, col: 3 });
      const after1 = placeWall(c1, { orientation: 'v', row: 2, col: 3 });
      expect(after1.lastActionEvent).toMatchObject({
        kind: 'turn',
        usedWallBreak: true,
        brokenWall: wV,
        from: { row: 2, col: 2 },
        to: { row: 2, col: 3 },
        placedWall: { orientation: 'v', row: 2, col: 3 },
      });

      // 2-wall E13 ambiguous diagonal: (2,2) -> (3,3) choosing wH
      let c2 = selectPiece(s, 'p0_0');
      c2 = toggleWallBreak(c2);
      c2 = selectWallGo2BreakDestination(c2, { row: 3, col: 3 });
      expect(c2.turnSubState.pendingBreakChoice).not.toBeNull();
      c2 = confirmWallGo2BreakWall(c2, { orientation: 'h', row: 2, col: 2 });
      const after2 = placeWall(c2, { orientation: 'h', row: 3, col: 3 });
      expect(after2.walls['v:2:2']).toEqual(wV);
      expect(after2.walls['h:2:2']).toBeUndefined();
      expect(after2.lastActionEvent).toMatchObject({
        kind: 'turn',
        usedWallBreak: true,
        brokenWall: wH,
        from: { row: 2, col: 2 },
        to: { row: 3, col: 3 },
        placedWall: { orientation: 'h', row: 3, col: 3 },
      });
    });

    it('captures auto-skip [1] and game_over skippedPlayerIds=[] on placeWall', () => {
      // P1 is secured inside (0,0)-(0,1) with 0 wall breaks; P0 and P2 share the rest.
      const sSkip = makePlayingState3P(
        'wallgo1',
        [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 4, col: 4 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 4, col: 5 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 0, col: 0 },
          { id: 'p1_1', ownerId: 1, kind: 'standard', row: 0, col: 1 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 5 },
          { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        [
          { orientation: 'h', row: 0, col: 0, ownerId: 1 },
          { orientation: 'h', row: 0, col: 1, ownerId: 1 },
          { orientation: 'v', row: 0, col: 1, ownerId: 1 },
        ],
        0,
        [0, 0, 0],
      );
      let cur = selectPiece(sSkip, 'p0_0');
      cur = movePiece(cur, { row: 4, col: 3 });
      const afterSkip = placeWall(cur, { orientation: 'h', row: 4, col: 3 });
      expect(afterSkip.currentPlayerIndex).toBe(2);
      expect(afterSkip.lastSkippedPlayerIds).toEqual([1]);
      expect(afterSkip.lastActionEvent?.skippedPlayerIds).toEqual([1]);

      // Final wall completing all_separated game over
      const almostSeparatedWalls: PlacedWall[] = [
        // Row 0 separated from row 1 except col 6
        ...Array.from({ length: 6 }, (_, col) => ({
          orientation: 'h' as const,
          row: 0,
          col,
          ownerId: 0,
        })),
        // Separate P1 (row 6, cols 0..2) from P2 (row 6, cols 4..6) across rows 1..6
        ...Array.from({ length: 6 }, (_, idx) => ({
          orientation: 'v' as const,
          row: idx + 1,
          col: 3,
          ownerId: 1,
        })),
      ];
      const sEnd = makePlayingState3P(
        'wallgo1',
        [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 6 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 6, col: 0 },
          { id: 'p1_1', ownerId: 1, kind: 'standard', row: 6, col: 1 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 5 },
          { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 6 },
        ],
        almostSeparatedWalls,
        0,
        [0, 0, 0],
      );
      let endCur = selectPiece(sEnd, 'p0_0');
      endCur = movePiece(endCur, { row: 0, col: 6 }); // 0-step stay
      const gameOverState = placeWall(endCur, { orientation: 'h', row: 0, col: 6 });
      expect(gameOverState.phase).toBe('game_over');
      expect(gameOverState.lastActionEvent).toMatchObject({
        kind: 'turn',
        isStay: true,
        placedWall: { orientation: 'h', row: 0, col: 6 },
        skippedPlayerIds: [],
      });
    });
  });

  describe('ENG-02: resolveTurnTimeout & handleTurnTimeout parity across all 7 branches', () => {
    it('maintains 100% RNG and state parity with handleTurnTimeout across full WG1 and WG2 games', () => {
      for (const ruleVariant of ['wallgo1', 'wallgo2'] as const) {
        let sResolve = createInitialGameState({
          ruleVariant,
          format: '3p',
          players: makePlayers3P(),
          shuffleOrder: false,
          timerSeconds: 90,
        });
        let sHandle = createInitialGameState({
          ruleVariant,
          format: '3p',
          players: makePlayers3P(),
          shuffleOrder: false,
          timerSeconds: 90,
        });
        const rngA = createSeededRng(ruleVariant === 'wallgo1' ? 101 : 202);
        const rngB = createSeededRng(ruleVariant === 'wallgo1' ? 101 : 202);

        let steps = 0;
        while (sResolve.phase !== 'game_over' && steps < 180) {
          const res = resolveTurnTimeout(sResolve, rngA);
          const handled = handleTurnTimeout(sHandle, rngB);
          expect(res.state).toEqual(handled);
          expect(res.event).not.toBeNull();
          expect(res.event).toBe(res.state.lastActionEvent);
          expect(res.event?.timedOut).toBe(true);
          sResolve = res.state;
          sHandle = handled;
          steps += 1;
        }
        expect(sResolve.phase).toBe('game_over');

        // Branch 0: game_over no-op
        const afterOver = resolveTurnTimeout(sResolve, rngA);
        expect(afterOver.state).toBe(sResolve);
        expect(afterOver.event).toBeNull();
      }
    });

    it('covers placement Turn-0 skip, dirty place_wall, dirty WG1 post-break move_piece, twin-piece stay disambiguation, and WG1/WG2 break fallbacks', () => {
      // 1. Placement timeout triggering Turn 0 skip
      let pState = createInitialGameState({
        ruleVariant: 'wallgo1',
        format: '3p',
        players: makePlayers3P(),
        shuffleOrder: false,
        timerSeconds: 90,
      });
      pState = placeInitialPiece(pState, { row: 0, col: 0 });
      pState = placeInitialPiece(pState, { row: 0, col: 1 });
      pState = placeInitialPiece(pState, { row: 1, col: 0 });
      pState = placeInitialPiece(pState, { row: 0, col: 5 });
      pState = placeInitialPiece(pState, { row: 1, col: 6 });
      // Empty cells list: (0,2), (0,3), (0,4), (0,6) -> index 3 out of 44 empty cells -> rng = 3/44
      const resPlacement = resolveTurnTimeout(pState, () => 3.5 / 44);
      expect(resPlacement.event?.kind).toBe('placement');
      expect(resPlacement.event?.timedOut).toBe(true);
      expect(resPlacement.event?.skippedPlayerIds).toEqual([0]);
      expect(resPlacement.state.lastActionSummary).toContain('시간 초과');

      // 2. Dirty place_wall timeout after WG1 wall break
      const wBreak: PlacedWall = { orientation: 'v', row: 2, col: 2, ownerId: 1 };
      const sBase = makePlayingState3P(
        'wallgo1',
        [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 2, col: 2 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 2, col: 3 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
          { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 4 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 1 },
          { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 2 },
        ],
        [wBreak],
      );
      let dirtyPlaceWall = selectPiece(sBase, 'p0_0');
      dirtyPlaceWall = toggleWallBreak(dirtyPlaceWall);
      dirtyPlaceWall = breakWallAt(dirtyPlaceWall, { orientation: 'v', row: 2, col: 2 });
      const dirtyPostBreakMove = dirtyPlaceWall;
      dirtyPlaceWall = movePiece(dirtyPlaceWall, { row: 2, col: 1 });

      const resDirtyPW = resolveTurnTimeout(dirtyPlaceWall, () => 0);
      expect(resDirtyPW.event?.kind).toBe('turn');
      if (resDirtyPW.event?.kind === 'turn') {
        expect(resDirtyPW.event.timedOut).toBe(true);
        expect(resDirtyPW.event.usedWallBreak).toBe(true);
        expect(resDirtyPW.event.brokenWall).toEqual(wBreak);
        expect(resDirtyPW.event.from).toEqual({ row: 2, col: 2 });
        expect(resDirtyPW.event.to).toEqual({ row: 2, col: 1 });
      }

      // 3. Dirty WG1 post-break move_piece timeout
      const resDirtyMove = resolveTurnTimeout(dirtyPostBreakMove, () => 0);
      expect(resDirtyMove.event?.kind).toBe('turn');
      if (resDirtyMove.event?.kind === 'turn') {
        expect(resDirtyMove.event.timedOut).toBe(true);
        expect(resDirtyMove.event.usedWallBreak).toBe(true);
        expect(resDirtyMove.event.brokenWall).toEqual(wBreak);
        expect(resDirtyMove.event.isStay).toBe(true);
        expect(resDirtyMove.event.pieceId).toBe('p0_0');
      }

      // 4a. Twin adjacent pieces 0-step stay disambiguation
      const sTwins = makePlayingState3P('wallgo1', [
        { id: 'p0_0', ownerId: 0, kind: 'standard', row: 2, col: 2 },
        { id: 'p0_1', ownerId: 0, kind: 'standard', row: 2, col: 3 },
        { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
        { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 4 },
        { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 1 },
        { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 2 },
      ]);
      const resTwin0 = resolveTurnTimeout(sTwins, () => 0.0); // chooses p0_0
      const resTwin1 = resolveTurnTimeout(sTwins, () => 0.99); // chooses p0_1
      expect(resTwin0.event?.kind === 'turn' && resTwin0.event.pieceId).toBe('p0_0');
      expect(resTwin0.event?.kind === 'turn' && resTwin0.event.isStay).toBe(true);
      expect(resTwin1.event?.kind === 'turn' && resTwin1.event.pieceId).toBe('p0_1');
      expect(resTwin1.event?.kind === 'turn' && resTwin1.event.isStay).toBe(true);

      // 4b. Clean WG1 wall-break fallback (both P0 pieces completely walled in)
      const sWg1Trapped = makePlayingState3P(
        'wallgo1',
        [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 6 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
          { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 4 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 1 },
          { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 2 },
        ],
        [
          { orientation: 'h', row: 0, col: 0, ownerId: 1 },
          { orientation: 'v', row: 0, col: 0, ownerId: 1 },
          { orientation: 'h', row: 0, col: 6, ownerId: 2 },
          { orientation: 'v', row: 0, col: 5, ownerId: 2 },
        ],
      );
      const resWg1Break = resolveTurnTimeout(sWg1Trapped, () => 0);
      expect(resWg1Break.event?.kind).toBe('turn');
      if (resWg1Break.event?.kind === 'turn') {
        expect(resWg1Break.event.timedOut).toBe(true);
        expect(resWg1Break.event.usedWallBreak).toBe(true);
        expect(resWg1Break.event.brokenWall).not.toBeNull();
        expect(resWg1Break.state.players[0].wallBreaksRemaining).toBe(0);
      }

      // 5a. Clean WG2 choose_break_wall does NOT waste wall break when normal move exists
      const sWg2Choice = makePlayingState3P(
        'wallgo2',
        [
          { id: 'p0_0', ownerId: 0, kind: 'round', row: 2, col: 2 },
          { id: 'p0_1', ownerId: 0, kind: 'square', row: 0, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'round', row: 5, col: 5 },
          { id: 'p1_1', ownerId: 1, kind: 'square', row: 5, col: 4 },
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 1 },
          { id: 'p2_1', ownerId: 2, kind: 'square', row: 6, col: 2 },
        ],
        [
          { orientation: 'h', row: 2, col: 2, ownerId: 1 },
          { orientation: 'v', row: 2, col: 2, ownerId: 2 },
        ],
      );
      let pendingDiag = selectPiece(sWg2Choice, 'p0_0');
      pendingDiag = toggleWallBreak(pendingDiag);
      pendingDiag = selectWallGo2BreakDestination(pendingDiag, { row: 3, col: 3 });
      expect(pendingDiag.turnSubState.pendingBreakChoice).not.toBeNull();
      const resWg2Normal = resolveTurnTimeout(pendingDiag, () => 0);
      expect(resWg2Normal.event?.kind).toBe('turn');
      if (resWg2Normal.event?.kind === 'turn') {
        expect(resWg2Normal.event.usedWallBreak).toBe(false);
        expect(resWg2Normal.event.brokenWall).toBeNull();
        expect(resWg2Normal.state.players[0].wallBreaksRemaining).toBe(1);
      }

      // 5b. Clean WG2 wall-break fallback including 2-wall E13 diagonal
      const sWg2Trapped = makePlayingState3P(
        'wallgo2',
        [
          { id: 'p0_0', ownerId: 0, kind: 'round', row: 0, col: 0 },
          { id: 'p0_1', ownerId: 0, kind: 'square', row: 0, col: 6 },
          { id: 'p1_0', ownerId: 1, kind: 'round', row: 5, col: 5 },
          { id: 'p1_1', ownerId: 1, kind: 'square', row: 5, col: 4 },
          { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 1 },
          { id: 'p2_1', ownerId: 2, kind: 'square', row: 6, col: 2 },
        ],
        [
          { orientation: 'h', row: 0, col: 0, ownerId: 1 },
          { orientation: 'v', row: 0, col: 0, ownerId: 2 },
          { orientation: 'h', row: 0, col: 6, ownerId: 1 },
          { orientation: 'v', row: 0, col: 5, ownerId: 2 },
        ],
      );
      const resWg2Break = resolveTurnTimeout(sWg2Trapped, () => 0.4);
      expect(resWg2Break.event?.kind).toBe('turn');
      if (resWg2Break.event?.kind === 'turn') {
        expect(resWg2Break.event.timedOut).toBe(true);
        expect(resWg2Break.event.usedWallBreak).toBe(true);
        expect(resWg2Break.event.brokenWall).not.toBeNull();
        expect(resWg2Break.state.players[0].wallBreaksRemaining).toBe(0);
      }
    });
  });

  describe('ENG-02 & ENG-05: applyAtomicTurnAction and applyBotTurnAction delegation', () => {
    it('executes normal, stay, WG1 break + E10 reseal, and WG2 E13 ambiguous diagonal choices', () => {
      const wBreak: PlacedWall = { orientation: 'v', row: 2, col: 2, ownerId: 1 };
      const sWg1 = deepFreeze(
        makePlayingState3P(
          'wallgo1',
          [
            { id: 'p0_0', ownerId: 0, kind: 'standard', row: 2, col: 2 },
            { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 0 },
            { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
            { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 4 },
            { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 1 },
            { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 2 },
          ],
          [wBreak],
        ),
      );

      // WG1 break + E10 reseal
      const actionReseal: AtomicTurnAction = {
        pieceId: 'p0_0',
        useWallBreak: true,
        breakWall: { orientation: 'v', row: 2, col: 2 },
        destination: { row: 2, col: 2 },
        placeWall: { orientation: 'v', row: 2, col: 2 },
      };
      const afterReseal = applyAtomicTurnAction(sWg1, actionReseal);
      expect(afterReseal.walls['v:2:2'].ownerId).toBe(0);
      expect(afterReseal.players[0].wallBreaksRemaining).toBe(0);
      expect(afterReseal.lastActionEvent).toMatchObject({
        kind: 'turn',
        isStay: true,
        usedWallBreak: true,
        brokenWall: wBreak,
        placedWall: { orientation: 'v', row: 2, col: 2 },
      });
      // applyBotTurnAction produces identical result
      expect(applyBotTurnAction(sWg1, actionReseal)).toEqual(afterReseal);

      // WG2 E13 ambiguous diagonal: both choices work independently
      const wH: PlacedWall = { orientation: 'h', row: 2, col: 2, ownerId: 1 };
      const wV: PlacedWall = { orientation: 'v', row: 2, col: 2, ownerId: 2 };
      const sWg2 = deepFreeze(
        makePlayingState3P(
          'wallgo2',
          [
            { id: 'p0_0', ownerId: 0, kind: 'round', row: 2, col: 2 },
            { id: 'p0_1', ownerId: 0, kind: 'square', row: 0, col: 0 },
            { id: 'p1_0', ownerId: 1, kind: 'round', row: 5, col: 5 },
            { id: 'p1_1', ownerId: 1, kind: 'square', row: 5, col: 4 },
            { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 1 },
            { id: 'p2_1', ownerId: 2, kind: 'square', row: 6, col: 2 },
          ],
          [wH, wV],
        ),
      );

      const choiceA = applyAtomicTurnAction(sWg2, {
        pieceId: 'p0_0',
        useWallBreak: true,
        breakWall: { orientation: 'h', row: 2, col: 2 },
        destination: { row: 3, col: 3 },
        placeWall: { orientation: 'h', row: 3, col: 3 },
      });
      expect(choiceA.walls['h:2:2']).toBeUndefined();
      expect(choiceA.walls['v:2:2']).toEqual(wV);

      const choiceB = applyAtomicTurnAction(sWg2, {
        pieceId: 'p0_0',
        useWallBreak: true,
        breakWall: { orientation: 'v', row: 2, col: 2 },
        destination: { row: 3, col: 3 },
        placeWall: { orientation: 'h', row: 3, col: 3 },
      });
      expect(choiceB.walls['v:2:2']).toBeUndefined();
      expect(choiceB.walls['h:2:2']).toEqual(wH);
    });

    it('rejects malformed or illegal payloads with Error without mutating frozen state', () => {
      const sWg2 = deepFreeze(
        makePlayingState3P(
          'wallgo2',
          [
            { id: 'p0_0', ownerId: 0, kind: 'round', row: 2, col: 2 },
            { id: 'p0_1', ownerId: 0, kind: 'square', row: 0, col: 0 },
            { id: 'p1_0', ownerId: 1, kind: 'round', row: 5, col: 5 },
            { id: 'p1_1', ownerId: 1, kind: 'square', row: 5, col: 4 },
            { id: 'p2_0', ownerId: 2, kind: 'round', row: 6, col: 1 },
            { id: 'p2_1', ownerId: 2, kind: 'square', row: 6, col: 2 },
          ],
          [{ orientation: 'v', row: 2, col: 2, ownerId: 1 }],
        ),
      );

      // Wrong phase
      expect(() =>
        applyAtomicTurnAction(selectPiece(sWg2, 'p0_0'), {
          pieceId: 'p0_0',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 2, col: 1 },
          placeWall: { orientation: 'v', row: 2, col: 1 },
        }),
      ).toThrow(Error);

      // Malformed / missing fields
      expect(() => applyAtomicTurnAction(sWg2, null as unknown as AtomicTurnAction)).toThrow(Error);
      expect(() =>
        applyAtomicTurnAction(sWg2, {
          pieceId: '',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 2, col: 1 },
          placeWall: { orientation: 'v', row: 2, col: 1 },
        }),
      ).toThrow(Error);
      expect(() =>
        applyAtomicTurnAction(sWg2, {
          pieceId: 'p0_0',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 99, col: 0 },
          placeWall: { orientation: 'v', row: 2, col: 1 },
        }),
      ).toThrow(Error);
      expect(() =>
        applyAtomicTurnAction(sWg2, {
          pieceId: 'p0_0',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 2, col: 1 },
          placeWall: { orientation: 'h', row: 6, col: 0 },
        }),
      ).toThrow(Error);
      // useWallBreak / breakWall mismatch
      expect(() =>
        applyAtomicTurnAction(sWg2, {
          pieceId: 'p0_0',
          useWallBreak: true,
          breakWall: null,
          destination: { row: 2, col: 3 },
          placeWall: { orientation: 'v', row: 2, col: 3 },
        }),
      ).toThrow(Error);
      expect(() =>
        applyAtomicTurnAction(sWg2, {
          pieceId: 'p0_0',
          useWallBreak: false,
          breakWall: { orientation: 'v', row: 2, col: 2 },
          destination: { row: 2, col: 1 },
          placeWall: { orientation: 'v', row: 2, col: 1 },
        }),
      ).toThrow(Error);
      // Wrong owner piece
      expect(() =>
        applyAtomicTurnAction(sWg2, {
          pieceId: 'p1_0',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 5, col: 6 },
          placeWall: { orientation: 'v', row: 5, col: 5 },
        }),
      ).toThrow(Error);
      // WG2 1-wall breakWall mismatch
      expect(() =>
        applyAtomicTurnAction(sWg2, {
          pieceId: 'p0_0',
          useWallBreak: true,
          breakWall: { orientation: 'h', row: 2, col: 2 },
          destination: { row: 2, col: 3 },
          placeWall: { orientation: 'v', row: 2, col: 3 },
        }),
      ).toThrow(Error);
    });
  });

  describe('ENG-02: normalizeTurnForTakeover & setPlayerControllerInGame', () => {
    it('normalizes dirty place_wall, post-break move_piece, and choose_break_wall cleanly to select_piece', () => {
      const opponentWall: PlacedWall = { orientation: 'v', row: 2, col: 2, ownerId: 1 };
      const sWg1 = deepFreeze(
        makePlayingState3P(
          'wallgo1',
          [
            { id: 'p0_0', ownerId: 0, kind: 'standard', row: 2, col: 2 },
            { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 0 },
            { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
            { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 4 },
            { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 1 },
            { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 2 },
          ],
          [opponentWall],
        ),
      );

      // No-op on select_piece
      expect(normalizeTurnForTakeover(sWg1)).toBe(sWg1);

      // Rollback post-break move_piece
      let cur = selectPiece(sWg1, 'p0_0');
      cur = toggleWallBreak(cur);
      const preBreakToggle = cur;
      expect(normalizeTurnForTakeover(preBreakToggle).phase).toBe('select_piece');

      cur = breakWallAt(cur, { orientation: 'v', row: 2, col: 2 });
      const normFromPostBreak = normalizeTurnForTakeover(cur);
      expect(normFromPostBreak.phase).toBe('select_piece');
      expect(normFromPostBreak.walls['v:2:2']).toEqual(opponentWall);
      expect(normFromPostBreak.players[0].wallBreaksRemaining).toBe(1);

      // Rollback place_wall after break + move
      const moved = movePiece(cur, { row: 2, col: 3 });
      expect(moved.phase).toBe('place_wall');
      const normFromPlaceWall = normalizeTurnForTakeover(moved);
      expect(normFromPlaceWall.phase).toBe('select_piece');
      expect(normFromPlaceWall.pieces.find((p) => p.id === 'p0_0')).toMatchObject({ row: 2, col: 2 });
      expect(normFromPlaceWall.walls['v:2:2']).toEqual(opponentWall);
      expect(normFromPlaceWall.players[0].wallBreaksRemaining).toBe(1);
    });

    it('switches active mid-turn player to AI cleanly while preserving non-active turn state and immutability', () => {
      const opponentWall: PlacedWall = { orientation: 'v', row: 2, col: 2, ownerId: 1 };
      const sWg1 = makePlayingState3P(
        'wallgo1',
        [
          { id: 'p0_0', ownerId: 0, kind: 'standard', row: 2, col: 2 },
          { id: 'p0_1', ownerId: 0, kind: 'standard', row: 0, col: 0 },
          { id: 'p1_0', ownerId: 1, kind: 'standard', row: 5, col: 5 },
          { id: 'p1_1', ownerId: 1, kind: 'standard', row: 5, col: 4 },
          { id: 'p2_0', ownerId: 2, kind: 'standard', row: 6, col: 1 },
          { id: 'p2_1', ownerId: 2, kind: 'standard', row: 6, col: 2 },
        ],
        [opponentWall],
      );

      // P0 mid-turn in place_wall after breaking opponent wall
      let dirty = selectPiece(sWg1, 'p0_0');
      dirty = toggleWallBreak(dirty);
      dirty = breakWallAt(dirty, { orientation: 'v', row: 2, col: 2 });
      dirty = movePiece(dirty, { row: 2, col: 3 });
      deepFreeze(dirty);

      // 1. Switching NON-active player (P1) does NOT cancel P0's place_wall!
      const nonActiveSwitched = setPlayerControllerInGame(dirty, 1, true, 'hard');
      expect(nonActiveSwitched.phase).toBe('place_wall');
      expect(nonActiveSwitched.players[0]).toBe(dirty.players[0]);
      expect(nonActiveSwitched.players[2]).toBe(dirty.players[2]);
      expect(nonActiveSwitched.players[1]).toMatchObject({ isAI: true, aiDifficulty: 'hard' });

      // 2. Switching ACTIVE player (P0) rolls back dirty turn and lets chooseAiTurn run immediately
      const activeSwitched = setPlayerControllerInGame(dirty, 0, true, 'normal');
      expect(activeSwitched.phase).toBe('select_piece');
      expect(activeSwitched.walls['v:2:2']).toEqual(opponentWall);
      expect(activeSwitched.players[0]).toMatchObject({
        isAI: true,
        aiDifficulty: 'normal',
        wallBreaksRemaining: 1,
      });
      const aiMove = chooseAiTurn(activeSwitched, 'normal', createSeededRng(42));
      const afterAi = applyAtomicTurnAction(activeSwitched, aiMove);
      expect(afterAi.turnNumber).toBe(1);
      expect(afterAi.lastActionEvent?.actorIsAI).toBe(true);

      // 3. Active player during placement keeps placement phase and AI can place immediately
      const placementState = deepFreeze(
        createInitialGameState({
          ruleVariant: 'wallgo2',
          format: '3p',
          players: makePlayers3P(),
          shuffleOrder: false,
          timerSeconds: 0,
        }),
      );
      const placementSwitched = setPlayerControllerInGame(placementState, 0, true, 'hard');
      expect(placementSwitched.phase).toBe('placement');
      const aiPlace = chooseAiPlacement(placementSwitched, 'hard', createSeededRng(7));
      const afterPlace = placeInitialPiece(
        placementSwitched,
        { row: aiPlace.row, col: aiPlace.col },
        aiPlace.kind,
      );
      expect(afterPlace.lastActionEvent?.kind).toBe('placement');
      expect(afterPlace.lastActionEvent?.actorIsAI).toBe(true);

      // 4. Guards: unknown playerId, invalid difficulty (including explicit null), idempotent call, game_over -> === state
      expect(setPlayerControllerInGame(sWg1, 99, true, 'hard')).toBe(sWg1);
      expect(
        setPlayerControllerInGame(sWg1, 0, true, 'impossible' as unknown as 'hard'),
      ).toBe(sWg1);
      expect(
        setPlayerControllerInGame(dirty, 0, true, null as unknown as 'normal'),
      ).toBe(dirty);
      expect(dirty.phase).toBe('place_wall');
      expect(setPlayerControllerInGame(sWg1, 0, false, 'normal')).toBe(sWg1);

      // 5. No-op call on active player during dirty move_piece / place_wall MUST preserve turn intact!
      const dirtyNoopExplicit = setPlayerControllerInGame(dirty, 0, false, 'normal');
      expect(dirtyNoopExplicit).toBe(dirty);
      expect(dirtyNoopExplicit.phase).toBe('place_wall');
      expect(dirtyNoopExplicit.walls['v:2:2']).toBeUndefined();
      expect(dirtyNoopExplicit.pieces.find((p) => p.id === 'p0_0')).toMatchObject({
        row: 2,
        col: 3,
      });

      const dirtyNoopOmitted = setPlayerControllerInGame(dirty, 0, false);
      expect(dirtyNoopOmitted).toBe(dirty);
      expect(dirtyNoopOmitted.phase).toBe('place_wall');

      const overState: GameState = { ...sWg1, phase: 'game_over' };
      expect(setPlayerControllerInGame(overState, 0, true, 'hard')).toBe(overState);
    });
  });
});
