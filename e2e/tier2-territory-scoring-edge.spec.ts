import { expect, test } from '@playwright/test';
import {
  DEFAULT_2P_PLACEMENTS,
  DEFAULT_3P_PLACEMENTS,
  boardPiecesLocator,
  cancelTurnMove,
  cellLocator,
  completePlacement,
  configureLobby,
  ensureWallBreakActive,
  hWall,
  inspectBoardFromResult,
  moveSelectedTo,
  openLobbyWithPausedClock,
  placeWallAt,
  placedWallLocator,
  playHumanTurn,
  playWallGo1BreakTurn,
  playerCardLocator,
  readGameScreenState,
  readValidMoveCoords,
  reopenResultModal,
  runScriptA2,
  runScriptBSetup,
  runScriptD,
  selectCell,
  startConfiguredGame,
  startGame,
  startPrisonMatchRound2,
  territoryBadgeLocator,
  toggleWallBreak,
  vWall,
  waitForGameOver,
  wallSlotLocator,
  type E2EPlacementStep,
} from './helpers/game.ts';
import {
  complete2PWallGo1Fast,
  run3PDeadlockBaseTurns1To6,
  run3PTieScenario,
  run3PWallGo2CompletionFromStartedGame,
} from './helpers/scripts.ts';
import { attachRuntimeErrorGuard, type RuntimeErrorGuard } from './helpers/network.ts';

test.describe(
  'Tier 2 — Wall Break Edge Cases, Territory, Deadlock, Auto-Skip, Scoring & Round 2',
  { tag: '@tier2' },
  () => {
    let guard: RuntimeErrorGuard;

    test.beforeEach(({ page }) => {
      guard = attachRuntimeErrorGuard(page);
    });

    test.afterEach(() => {
      try {
        guard.assertClean();
      } finally {
        guard.detach();
      }
    });

    // --- FA-06 Part 2: Wall Break Advanced Edge Cases (T2-23 - T2-29) ---

    test('T2-23 (E09): Wall Go I wall break into occupied cell permitted when other side open, while occupied cell remains unenterable', async ({
      page,
    }) => {
      const placements: readonly E2EPlacementStep[] = [
        { row: 0, col: 0 },
        { row: 2, col: 0 },
        { row: 6, col: 6 },
        { row: 6, col: 4 },
        { row: 4, col: 6 },
        { row: 4, col: 4 },
      ];

      await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
      await completePlacement(page, placements);

      await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
      await playHumanTurn(page, { row: 2, col: 0 }, { row: 1, col: 0 }, vWall(1, 0));
      await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 6 }, vWall(6, 5));

      await selectCell(page, 0, 0);
      await ensureWallBreakActive(page, true);
      await expect(wallSlotLocator(page, hWall(0, 0))).toHaveAttribute(
        'data-wall-state',
        'breakable',
      );
      await wallSlotLocator(page, hWall(0, 0)).click();

      await expect(placedWallLocator(page, hWall(0, 0))).toHaveCount(0);
      await expect(page.getByTestId('player-wallbreak-0')).toHaveAttribute('data-remaining', '0');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
      await expect(cellLocator(page, 1, 0)).toHaveAttribute('data-occupied-by', '1');
      await expect(cellLocator(page, 1, 0)).toHaveAttribute('data-valid-move', 'false');

      expect(await readValidMoveCoords(page, 'stay')).toEqual([{ row: 0, col: 0 }]);
      expect(await readValidMoveCoords(page, 'normal')).toEqual([
        { row: 0, col: 1 },
        { row: 0, col: 2 },
        { row: 1, col: 1 },
      ]);

      // Clicking occupied (1,0) is rejected
      await cellLocator(page, 1, 0).click();
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-selected', 'true');
      await expect(cellLocator(page, 1, 0)).toHaveAttribute('data-occupied-by', '1');

      await moveSelectedTo(page, 0, 1);
      await placeWallAt(page, vWall(0, 1));
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    });

    test('T2-24 (E10): Breaking own previously placed wall and resealing exact same edge in same turn is allowed (WG1 & WG2)', async ({
      page,
    }) => {
      // Part A: Wall Go I
      const wg1Placements: readonly E2EPlacementStep[] = [
        { row: 2, col: 2 },
        { row: 5, col: 5 },
        { row: 6, col: 6 },
        { row: 6, col: 4 },
        { row: 4, col: 6 },
        { row: 4, col: 2 },
      ];
      await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
      await completePlacement(page, wg1Placements);

      await playHumanTurn(page, { row: 2, col: 2 }, { row: 2, col: 2 }, vWall(2, 2));
      await playHumanTurn(page, { row: 5, col: 5 }, { row: 5, col: 5 }, hWall(5, 5));
      await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 6 }, vWall(6, 5));

      await expect(placedWallLocator(page, vWall(2, 2))).toHaveAttribute('data-owner', '0');
      await selectCell(page, 2, 2);
      await ensureWallBreakActive(page, true);
      await expect(wallSlotLocator(page, vWall(2, 2))).toHaveAttribute(
        'data-wall-state',
        'breakable',
      );
      await wallSlotLocator(page, vWall(2, 2)).click();
      await expect(placedWallLocator(page, vWall(2, 2))).toHaveCount(0);
      await expect(cellLocator(page, 2, 3)).toHaveAttribute('data-valid-move', 'true');

      await moveSelectedTo(page, 2, 3);
      await expect(wallSlotLocator(page, vWall(2, 2))).toHaveAttribute(
        'data-wall-state',
        'placeable',
      );
      await placeWallAt(page, vWall(2, 2));

      await expect(placedWallLocator(page, vWall(2, 2))).toHaveAttribute('data-owner', '0');
      await expect(placedWallLocator(page, vWall(2, 2))).toHaveAttribute('data-last-wall', 'true');
      await expect(page.getByTestId('player-wallbreak-0')).toHaveAttribute('data-remaining', '0');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');

      // Part B: Wall Go II
      const wg2Placements: readonly E2EPlacementStep[] = [
        { row: 2, col: 2, kind: 'square' },
        { row: 5, col: 5, kind: 'square' },
        { row: 6, col: 6, kind: 'square' },
        { row: 6, col: 4, kind: 'round' },
        { row: 4, col: 6, kind: 'round' },
        { row: 4, col: 2, kind: 'round' },
      ];
      await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });
      await completePlacement(page, wg2Placements);

      await playHumanTurn(page, { row: 2, col: 2 }, { row: 2, col: 3 }, vWall(2, 2));
      await playHumanTurn(page, { row: 5, col: 5 }, { row: 5, col: 4 }, hWall(5, 4));
      await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 5 }, hWall(5, 5));

      await expect(placedWallLocator(page, vWall(2, 2))).toHaveAttribute('data-owner', '0');
      await selectCell(page, 2, 3);
      await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-valid-move', 'false');
      await ensureWallBreakActive(page, true);
      await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-move-type', 'wall-break');
      await cellLocator(page, 2, 2).click();

      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
      await expect(placedWallLocator(page, vWall(2, 2))).toHaveCount(0);
      await expect(wallSlotLocator(page, vWall(2, 2))).toHaveAttribute(
        'data-wall-state',
        'placeable',
      );
      await placeWallAt(page, vWall(2, 2));

      await expect(placedWallLocator(page, vWall(2, 2))).toHaveAttribute('data-owner', '0');
      await expect(placedWallLocator(page, vWall(2, 2))).toHaveAttribute('data-last-wall', 'true');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    });

    test('T2-25 (E11): Wall Go I piece lock after wall break rejects switching pieces or deselecting until cancel', async ({
      page,
    }) => {
      await runScriptBSetup(page);
      await selectCell(page, 2, 3);
      await toggleWallBreak(page, true);
      await wallSlotLocator(page, vWall(2, 2)).click();

      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
      await expect(cellLocator(page, 2, 3)).toHaveAttribute('data-selected', 'true');
      await expect(placedWallLocator(page, vWall(2, 2))).toHaveCount(0);
      await expect(page.getByTestId('wall-break-toggle')).toBeDisabled();

      // Clicking P1's other piece (4,6) is rejected
      await cellLocator(page, 4, 6).click();
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
      await expect(cellLocator(page, 2, 3)).toHaveAttribute('data-selected', 'true');
      await expect(cellLocator(page, 4, 6)).toHaveAttribute('data-selected', 'false');
      await expect(placedWallLocator(page, vWall(2, 2))).toHaveCount(0);

      // Clicking empty (0,0) cannot deselect while brokenWallBeforeMove !== null
      await cellLocator(page, 0, 0).click();
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
      await expect(cellLocator(page, 2, 3)).toHaveAttribute('data-selected', 'true');

      // Cancelling restores v(2,2) & unlocks piece switch
      await cancelTurnMove(page);
      await expect(placedWallLocator(page, vWall(2, 2))).toHaveAttribute('data-owner', '0');
      await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '1');

      await cellLocator(page, 4, 6).click();
      await expect(cellLocator(page, 4, 6)).toHaveAttribute('data-selected', 'true');
      await expect(cellLocator(page, 2, 3)).toHaveAttribute('data-selected', 'false');
    });

    test('T2-26 (E14): Wall Go II round diagonal with 1 open & 1 walled L-path uses open path normally and smashes walled path in Wall Break mode', async ({
      page,
    }) => {
      const placements: readonly E2EPlacementStep[] = [
        { row: 4, col: 2, kind: 'square' },
        { row: 3, col: 3, kind: 'round' },
        { row: 6, col: 6, kind: 'square' },
        { row: 6, col: 4, kind: 'round' },
        { row: 0, col: 6, kind: 'square' },
        { row: 0, col: 0, kind: 'round' },
      ];

      await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });
      await completePlacement(page, placements);

      await playHumanTurn(page, { row: 4, col: 2 }, { row: 4, col: 3 }, hWall(3, 3));
      await playHumanTurn(page, { row: 0, col: 6 }, { row: 0, col: 5 }, hWall(0, 5));
      await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 5 }, hWall(5, 5));
      await playHumanTurn(page, { row: 4, col: 3 }, { row: 4, col: 1 }, vWall(4, 0));

      // Check 1: Normal mode moves diagonally via open L-path leaving h(3,3) intact
      await selectCell(page, 3, 3);
      await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-valid-move', 'true');
      await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-move-type', 'normal');
      await moveSelectedTo(page, 4, 4);
      await expect(placedWallLocator(page, hWall(3, 3))).toHaveAttribute('data-owner', '0');
      await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '1');
      await cancelTurnMove(page);

      // Check 2: Wall Break mode deliberately smashes h(3,3) directly (no choose_break_wall)
      await ensureWallBreakActive(page, true);
      await expect(page.getByTestId('game-screen')).toHaveAttribute(
        'data-phase-substate',
        'wall_break_move',
      );
      expect(await readValidMoveCoords(page, 'wall-break')).toEqual([
        { row: 4, col: 2 },
        { row: 4, col: 3 },
        { row: 4, col: 4 },
      ]);
      await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-move-type', 'wall-break');
      await cellLocator(page, 4, 4).click();

      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
      await expect(placedWallLocator(page, hWall(3, 3))).toHaveCount(0);
      await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-occupied-by', '1');
      await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '0');

      await placeWallAt(page, hWall(4, 4));
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
    });

    test('T2-27 (E15): Wall Go II two walls on one straight path cannot be broken (only 1-wall step reachable)', async ({
      page,
    }) => {
      const placements: readonly E2EPlacementStep[] = [
        { row: 2, col: 4, kind: 'square' },
        { row: 2, col: 5, kind: 'square' },
        { row: 3, col: 3, kind: 'square' },
        { row: 6, col: 6, kind: 'round' },
        { row: 0, col: 6, kind: 'round' },
        { row: 0, col: 0, kind: 'round' },
      ];

      await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });
      await completePlacement(page, placements);

      await playHumanTurn(page, { row: 2, col: 4 }, { row: 3, col: 4 }, vWall(3, 3));
      await playHumanTurn(page, { row: 2, col: 5 }, { row: 3, col: 5 }, vWall(3, 4));
      await playHumanTurn(page, { row: 6, col: 6 }, { row: 5, col: 5 }, hWall(5, 5));
      await playHumanTurn(page, { row: 3, col: 4 }, { row: 5, col: 4 }, hWall(5, 4));
      await playHumanTurn(page, { row: 3, col: 5 }, { row: 1, col: 5 }, hWall(0, 5));

      await selectCell(page, 3, 3);
      await expect(cellLocator(page, 3, 4)).toHaveAttribute('data-valid-move', 'false');
      await expect(cellLocator(page, 3, 5)).toHaveAttribute('data-valid-move', 'false');

      await ensureWallBreakActive(page, true);
      await expect(page.getByTestId('game-screen')).toHaveAttribute(
        'data-phase-substate',
        'wall_break_move',
      );
      expect(await readValidMoveCoords(page, 'wall-break')).toEqual([{ row: 3, col: 4 }]);
      await expect(cellLocator(page, 3, 4)).toHaveAttribute('data-move-type', 'wall-break');
      await expect(cellLocator(page, 3, 5)).toHaveAttribute('data-valid-move', 'false');
      await expect(cellLocator(page, 3, 5)).toHaveAttribute('data-move-type', 'none');

      // Clicking 2-wall target (3,5) is rejected leaving both walls intact
      await cellLocator(page, 3, 5).click();
      await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '2');
      await expect(cellLocator(page, 3, 5)).toHaveAttribute('data-occupied-by', 'none');
      await expect(placedWallLocator(page, vWall(3, 3))).toBeVisible();
      await expect(placedWallLocator(page, vWall(3, 4))).toBeVisible();

      // Re-ensure selection & Wall Break ON, then break 1-wall target (3,4)
      if ((await readGameScreenState(page)).phase === 'select_piece') {
        await selectCell(page, 3, 3);
      }
      await ensureWallBreakActive(page, true);
      await cellLocator(page, 3, 4).click();

      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
      await expect(placedWallLocator(page, vWall(3, 3))).toHaveCount(0);
      await expect(placedWallLocator(page, vWall(3, 4))).toBeVisible();
      await expect(cellLocator(page, 3, 4)).toHaveAttribute('data-occupied-by', '2');

      await placeWallAt(page, hWall(2, 4));
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
    });

    test('T2-28: wall-break-toggle permanently disabled at 0 charges even when touching breakable wall', async ({
      page,
    }) => {
      await runScriptBSetup(page);

      // Turn 5 (P1): spend P1's Wall Break charge and place h(2,2) adjacent to (2,2)
      await playWallGo1BreakTurn(
        page,
        { row: 2, col: 3 },
        vWall(2, 2),
        { row: 2, col: 2 },
        hWall(2, 2),
      );
      // Turn 6 (P2): stay (6,6) + h(5,6); Turn 7 (P0): stay (4,2) + v(4,2)
      await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 6 }, hWall(5, 6));
      await playHumanTurn(page, { row: 4, col: 2 }, { row: 4, col: 2 }, vWall(4, 2));

      // Turn 8 (P1): 0 charges remaining
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
      await expect(playerCardLocator(page, 1)).toHaveAttribute('data-wall-breaks', '0');
      await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '0');
      await expect(page.getByTestId('player-wallbreak-1')).toContainText(/사용 완료/);

      await selectCell(page, 2, 2);
      await expect(page.getByTestId('wall-break-toggle')).toBeVisible();
      await expect(page.getByTestId('wall-break-toggle')).toBeDisabled();
      await expect(page.getByTestId('wall-break-toggle')).toHaveAttribute('aria-pressed', 'false');

      await selectCell(page, 4, 6);
      await expect(page.getByTestId('wall-break-toggle')).toBeDisabled();

      // Finish Turn 8 so P2 (charge=1) serves as enabled contrast
      await playHumanTurn(page, { row: 2, col: 2 }, { row: 2, col: 3 }, vWall(2, 3));

      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
      await cellLocator(page, 6, 6).click();
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
      await expect(page.getByTestId('wall-break-toggle')).toBeEnabled();
    });

    test('T2-29: wall-break-toggle disabled when charge is 1 but selected piece has 0 legal breakable walls (WG1 & WG2)', async ({
      page,
    }) => {
      // Part A: Wall Go I
      await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
      await completePlacement(page, DEFAULT_3P_PLACEMENTS);

      await expect(page.getByTestId('wall-break-toggle')).toBeDisabled();
      await selectCell(page, 1, 1);
      await expect(page.getByTestId('wall-break-toggle')).toBeDisabled();

      await moveSelectedTo(page, 1, 1);
      await placeWallAt(page, hWall(1, 1));
      await playHumanTurn(page, { row: 1, col: 5 }, { row: 1, col: 5 }, hWall(1, 5));
      await playHumanTurn(page, { row: 5, col: 3 }, { row: 5, col: 3 }, hWall(5, 3));

      // Turn 4 (P0): remote (3,1) has 0 adjacent walls -> disabled; (1,1) touches h(1,1) -> enabled
      await selectCell(page, 3, 1);
      await expect(page.getByTestId('wall-break-toggle')).toBeDisabled();
      await selectCell(page, 1, 1);
      await expect(page.getByTestId('wall-break-toggle')).toBeEnabled();

      // Part B: Wall Go II — touching wall into occupied cell yields 0 path-break targets
      const wg2Placements: readonly E2EPlacementStep[] = [
        { row: 2, col: 1, kind: 'square' },
        { row: 1, col: 2, kind: 'square' },
        { row: 6, col: 6, kind: 'square' },
        { row: 6, col: 4, kind: 'round' },
        { row: 5, col: 5, kind: 'round' },
        { row: 0, col: 6, kind: 'round' },
      ];
      await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });
      await completePlacement(page, wg2Placements);

      await selectCell(page, 2, 1);
      await expect(page.getByTestId('wall-break-toggle')).toBeDisabled();
      await moveSelectedTo(page, 1, 1);
      await placeWallAt(page, vWall(1, 1));

      // Turn 2 (P1, charge 1): square (1,2) touches v(1,1) but (1,1) is occupied by P0 -> 0 targets
      await selectCell(page, 1, 2);
      await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '1');
      await expect(page.getByTestId('wall-break-toggle')).toBeDisabled();

      await selectCell(page, 5, 5);
      await expect(page.getByTestId('wall-break-toggle')).toBeDisabled();
    });

    // --- FA-07: Territory, End Detection, Auto-Skip & Scoring Edge Cases (T2-30 - T2-38) ---

    test('T2-30 (E17): Neutral empty enclosed pocket awards 0 points and mounts no badge', async ({
      page,
    }) => {
      const placements: readonly E2EPlacementStep[] = [
        { row: 1, col: 0 },
        { row: 0, col: 1 },
        { row: 6, col: 6 },
        { row: 6, col: 4 },
        { row: 4, col: 6 },
        { row: 4, col: 4 },
      ];

      await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
      await completePlacement(page, placements);

      await playHumanTurn(page, { row: 1, col: 0 }, { row: 1, col: 0 }, hWall(0, 0));
      await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, vWall(0, 0));

      await expect(placedWallLocator(page, hWall(0, 0))).toBeVisible();
      await expect(placedWallLocator(page, vWall(0, 0))).toBeVisible();
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-occupied-by', 'none');
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', 'none');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveCount(0);
      await expect(page.locator('[data-territory-badge="true"]')).toHaveCount(0);

      for (const id of [0, 1, 2] as const) {
        await expect(page.getByTestId(`player-score-${id}`)).toHaveAttribute('data-value', '0');
        await expect(page.getByTestId(`player-score-${id}`)).toContainText('0칸');
        await expect(page.getByTestId(`player-largest-${id}`)).toHaveAttribute('data-value', '0');
        await expect(page.getByTestId(`player-largest-${id}`)).toContainText('최대 0');
      }

      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
    });

    test('T2-31 (E17): Multi-piece single-owner 3-cell secured region counted ONCE (3칸, single anchor badge)', async ({
      page,
    }) => {
      const placements: readonly E2EPlacementStep[] = [
        { row: 0, col: 0 },
        { row: 1, col: 1 },
        { row: 0, col: 3 },
        { row: 6, col: 6 },
        { row: 4, col: 6 },
        { row: 0, col: 2 },
      ];

      await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
      await completePlacement(page, placements);

      await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
      await playHumanTurn(page, { row: 1, col: 1 }, { row: 1, col: 1 }, hWall(0, 1));
      await playHumanTurn(page, { row: 0, col: 3 }, { row: 0, col: 3 }, vWall(0, 2));
      await playHumanTurn(page, { row: 0, col: 2 }, { row: 0, col: 2 }, hWall(0, 2));

      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-occupied-by', '0');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-occupied-by', 'none');
      await expect(cellLocator(page, 0, 2)).toHaveAttribute('data-occupied-by', '0');

      for (const c of [0, 1, 2] as const) {
        await expect(cellLocator(page, 0, c)).toHaveAttribute('data-territory-owner', '0');
        await expect(cellLocator(page, 0, c)).toHaveAttribute('data-territory-size', '3');
      }
      await expect(cellLocator(page, 0, 3)).toHaveAttribute('data-territory-owner', 'none');
      await expect(cellLocator(page, 1, 0)).toHaveAttribute('data-territory-owner', 'none');

      await expect(page.locator('[data-territory-badge="true"]')).toHaveCount(1);
      await expect(territoryBadgeLocator(page, 0, 0)).toBeVisible();
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-owner', '0');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-count', '3');
      await expect(territoryBadgeLocator(page, 0, 1)).toHaveCount(0);
      await expect(territoryBadgeLocator(page, 0, 2)).toHaveCount(0);

      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '3');
      await expect(page.getByTestId('player-score-0')).toContainText('3칸');
      await expect(page.getByTestId('player-largest-0')).toHaveAttribute('data-value', '3');
      await expect(page.getByTestId('player-largest-0')).toContainText('최대 3');
      await expect(page.getByTestId('player-score-1')).toHaveAttribute('data-value', '0');
      await expect(page.getByTestId('player-score-2')).toHaveAttribute('data-value', '0');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    });

    test('T2-32 (E18): Pieces do NOT split contested components (doorway check and enclosed 3-cell contested pocket)', async ({
      page,
    }) => {
      const placements: readonly E2EPlacementStep[] = [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 0, col: 3 },
        { row: 6, col: 6 },
        { row: 4, col: 4 },
        { row: 1, col: 2 },
      ];

      await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
      await completePlacement(page, placements);

      // T1: P0 places h(0,0); P1's piece sits in doorway (0,1) with no v(0,0) -> still contested!
      await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', 'none');
      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '0');
      await expect(page.locator('[data-territory-badge="true"]')).toHaveCount(0);

      // T2-T4: enclose 3-cell pocket {(0,0),(0,1),(0,2)} holding P0 + P1 + empty (0,2)
      await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, hWall(0, 1));
      await playHumanTurn(page, { row: 0, col: 3 }, { row: 0, col: 3 }, vWall(0, 2));
      await playHumanTurn(page, { row: 1, col: 2 }, { row: 1, col: 2 }, hWall(0, 2));

      await expect(placedWallLocator(page, vWall(0, 0))).toHaveCount(0);
      await expect(placedWallLocator(page, vWall(0, 1))).toHaveCount(0);
      for (const edge of [hWall(0, 0), hWall(0, 1), hWall(0, 2), vWall(0, 2)] as const) {
        await expect(placedWallLocator(page, edge)).toBeVisible();
      }

      for (const c of [0, 1, 2] as const) {
        await expect(cellLocator(page, 0, c)).toHaveAttribute('data-territory-owner', 'none');
      }
      await expect(page.locator('[data-territory-badge="true"]')).toHaveCount(0);
      for (const id of [0, 1, 2] as const) {
        await expect(page.getByTestId(`player-score-${id}`)).toHaveAttribute('data-value', '0');
      }
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    });

    test('T2-33 (E19/F14/F15): Breaking sealed wall removes live territory wash, badge and score; cancel restores from move_piece and place_wall', async ({
      page,
    }) => {
      await runScriptA2(page);

      // Baseline: {(0,0),(0,1)} secured for P0 (2 cells)
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', '0');
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-size', '2');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-territory-owner', '0');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-territory-size', '2');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-owner', '0');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-count', '2');
      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '2');
      await expect(page.getByTestId('player-largest-0')).toHaveAttribute('data-value', '2');
      await expect(page.getByTestId('player-wallbreak-0')).toHaveAttribute('data-remaining', '1');

      // Step 1: Break h(0,0) in move_piece -> wash/badge/score immediately drop to 0
      await selectCell(page, 0, 0);
      await ensureWallBreakActive(page, true);
      await wallSlotLocator(page, hWall(0, 0)).click();

      await expect(placedWallLocator(page, hWall(0, 0))).toHaveCount(0);
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', 'none');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-territory-owner', 'none');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveCount(0);
      await expect(page.locator('[data-territory-badge="true"]')).toHaveCount(0);
      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '0');
      await expect(page.getByTestId('player-largest-0')).toHaveAttribute('data-value', '0');
      await expect(page.getByTestId('player-wallbreak-0')).toHaveAttribute('data-remaining', '0');

      // Step 2: Cancel from move_piece -> restores wall, owner, wash, badge, score & charge
      await cancelTurnMove(page);
      await expect(placedWallLocator(page, hWall(0, 0))).toHaveAttribute('data-owner', '0');
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', '0');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-territory-owner', '0');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-count', '2');
      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '2');
      await expect(page.getByTestId('player-largest-0')).toHaveAttribute('data-value', '2');
      await expect(page.getByTestId('player-wallbreak-0')).toHaveAttribute('data-remaining', '1');

      // Step 3: Break again, move (0,0)->(1,0) into place_wall, cancel from place_wall -> full restore
      await ensureWallBreakActive(page, true);
      await wallSlotLocator(page, hWall(0, 0)).click();
      await moveSelectedTo(page, 1, 0);
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', 'none');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-territory-owner', 'none');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveCount(0);
      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '0');

      await cancelTurnMove(page);
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-occupied-by', '0');
      await expect(cellLocator(page, 1, 0)).toHaveAttribute('data-occupied-by', 'none');
      await expect(placedWallLocator(page, hWall(0, 0))).toHaveAttribute('data-owner', '0');
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', '0');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-territory-owner', '0');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-count', '2');
      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '2');
      await expect(page.getByTestId('player-largest-0')).toHaveAttribute('data-value', '2');
      await expect(page.getByTestId('player-wallbreak-0')).toHaveAttribute('data-remaining', '1');
    });

    test('T2-34 (E20): Contested deadlock ends game with +1pt/piece deadlock credits (P2=44, P0=3 max 2, P1=2 max 1)', async ({
      page,
    }) => {
      await run3PDeadlockBaseTurns1To6(page);

      // T7 (P0): spend P0's Wall Break via break-stay-reseal on h(0,0) -> P0 wb=0
      await playWallGo1BreakTurn(
        page,
        { row: 0, col: 0 },
        hWall(0, 0),
        { row: 0, col: 0 },
        hWall(0, 0),
      );
      // T8 (P1): seal P1 {(6,0)} = 1
      await playHumanTurn(page, { row: 6, col: 0 }, { row: 6, col: 0 }, vWall(6, 0));
      // T9 (P2): seal contested deadlock box {(0,0),(0,1)} (P0 wb=0, P1 wb=0)
      await playHumanTurn(page, { row: 1, col: 1 }, { row: 0, col: 2 }, vWall(0, 1));

      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '0');
      await expect(page.getByTestId('player-score-1')).toHaveAttribute('data-value', '1');
      await expect(page.getByTestId('player-score-2')).toHaveAttribute('data-value', '0');

      // T10 (P0): seal P0 {(6,5),(6,6)} = 2 -> immediate deadlock game_over!
      await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 5 }, hWall(5, 5));
      await waitForGameOver(page, 10_000);

      await expect(page.getByTestId('result-modal')).toHaveAttribute('role', 'dialog');
      await expect(page.getByTestId('result-modal')).toHaveAttribute('aria-modal', 'true');

      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-rank', '1');
      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-total-cells', '44');
      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-largest-area', '44');
      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute(
        'data-advancing-round2',
        'false',
      );

      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-rank', '2');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-total-cells', '3');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-largest-area', '2');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute(
        'data-advancing-round2',
        'true',
      );

      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-rank', '3');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-total-cells', '2');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-largest-area', '1');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute(
        'data-advancing-round2',
        'true',
      );

      await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-advancing-ids', '0,1');
      await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-first-player-id', '0');

      await inspectBoardFromResult(page);
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', 'none');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-territory-owner', 'none');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveCount(0);
      await expect(territoryBadgeLocator(page, 6, 5)).toHaveAttribute('data-owner', '0');
      await expect(territoryBadgeLocator(page, 6, 5)).toHaveAttribute('data-count', '2');
      await expect(territoryBadgeLocator(page, 6, 0)).toHaveAttribute('data-owner', '1');
      await expect(territoryBadgeLocator(page, 6, 0)).toHaveAttribute('data-count', '1');
      await expect(territoryBadgeLocator(page, 0, 2)).toHaveAttribute('data-owner', '2');
      await expect(territoryBadgeLocator(page, 0, 2)).toHaveAttribute('data-count', '44');
      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '3');
      await expect(page.getByTestId('player-score-1')).toHaveAttribute('data-value', '2');
      await expect(page.getByTestId('player-score-2')).toHaveAttribute('data-value', '44');
    });

    test('T2-35 (E21): Contested box rescued by remaining Wall Break does NOT end game and permits Turn 10 escape', async ({
      page,
    }) => {
      await run3PDeadlockBaseTurns1To6(page);

      // T7 (P0): seals {(6,5),(6,6)} while KEEPING P0 wallBreaksRemaining === 1!
      await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 5 }, hWall(5, 5));
      // T8 (P1): seals {(6,0)}
      await playHumanTurn(page, { row: 6, col: 0 }, { row: 6, col: 0 }, vWall(6, 0));
      // T9 (P2): seals contested box {(0,0),(0,1)} while all other components are single-owner
      await playHumanTurn(page, { row: 1, col: 1 }, { row: 0, col: 2 }, vWall(0, 1));

      // Rescued by P0's wb=1 -> NOT game_over!
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
      await expect(page.getByTestId('result-modal')).toHaveCount(0);
      await expect(page.getByTestId('player-wallbreak-0')).toHaveAttribute('data-remaining', '1');
      await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '0');
      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '2');
      await expect(page.getByTestId('player-score-1')).toHaveAttribute('data-value', '1');
      await expect(page.getByTestId('player-score-2')).toHaveAttribute('data-value', '44');

      // Turn 10 Escape Proof (P0 breaks h(0,0) into empty (1,0))
      await cellLocator(page, 0, 0).click();
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
      await ensureWallBreakActive(page, true);
      await expect(page.getByTestId('game-screen')).toHaveAttribute(
        'data-phase-substate',
        'wall_break_select_wall',
      );
      await expect(wallSlotLocator(page, hWall(0, 0))).toHaveAttribute(
        'data-wall-state',
        'breakable',
      );

      await wallSlotLocator(page, hWall(0, 0)).click();
      await expect(placedWallLocator(page, hWall(0, 0))).toHaveCount(0);
      await expect(cellLocator(page, 1, 0)).toHaveAttribute('data-valid-move', 'true');

      await moveSelectedTo(page, 1, 0);
      await placeWallAt(page, vWall(1, 0));

      await expect(cellLocator(page, 1, 0)).toHaveAttribute('data-occupied-by', '0');
      await expect(placedWallLocator(page, vWall(1, 0))).toBeVisible();
      await expect(page.getByTestId('player-wallbreak-0')).toHaveAttribute('data-remaining', '0');
      await expect(page.getByTestId('player-score-2')).toHaveAttribute('data-value', '0');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    });

    test('T2-36 (E22): 3P secured player WITH remaining Wall Break (wb=1) is NOT auto-skipped and can break out', async ({
      page,
    }) => {
      const placements: readonly E2EPlacementStep[] = [
        { row: 1, col: 0 },
        { row: 1, col: 1 },
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 4, col: 6 },
        { row: 1, col: 2 },
      ];

      await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
      await completePlacement(page, placements);

      await playHumanTurn(page, { row: 1, col: 0 }, { row: 1, col: 0 }, hWall(0, 0));
      await playHumanTurn(page, { row: 1, col: 1 }, { row: 1, col: 1 }, hWall(0, 1));
      await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, vWall(0, 1));
      await playHumanTurn(page, { row: 1, col: 0 }, { row: 2, col: 0 }, hWall(2, 0));
      await playHumanTurn(page, { row: 4, col: 6 }, { row: 4, col: 6 }, hWall(4, 6));

      // Turn 6 MUST land on P2 (not auto-skipped because P2 holds wb=1!)
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
      await expect(playerCardLocator(page, 2)).toHaveAttribute('data-active', 'true');
      await expect(playerCardLocator(page, 2)).toHaveAttribute('data-auto-skipped', 'false');
      await expect(playerCardLocator(page, 2)).toHaveAttribute('data-wall-breaks', '1');
      await expect(page.getByTestId('player-score-2')).toHaveAttribute('data-value', '2');
      await expect(page.getByTestId('player-wallbreak-2')).toHaveAttribute('data-remaining', '1');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-owner', '2');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-count', '2');

      // Breakout: P2 breaks v(0,1), moves to (0,2), places h(0,2)
      await cellLocator(page, 0, 1).click();
      await ensureWallBreakActive(page, true);
      await expect(wallSlotLocator(page, vWall(0, 1))).toHaveAttribute(
        'data-wall-state',
        'breakable',
      );
      await wallSlotLocator(page, vWall(0, 1)).click();
      await moveSelectedTo(page, 0, 2);
      await placeWallAt(page, hWall(0, 2));

      await expect(cellLocator(page, 0, 2)).toHaveAttribute('data-occupied-by', '2');
      await expect(page.getByTestId('player-wallbreak-2')).toHaveAttribute('data-remaining', '0');
      await expect(page.getByTestId('player-score-2')).toHaveAttribute('data-value', '0');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
    });

    test('T2-37 (E23): 2P partial-block auto-skips immobilized P0 inside contested component so P1 plays consecutively', async ({
      page,
    }) => {
      const placements: readonly E2EPlacementStep[] = [
        { row: 0, col: 0 }, // P0
        { row: 0, col: 2 }, // P1
        { row: 6, col: 4 }, // P1
        { row: 6, col: 6 }, // P0
      ];

      await startConfiguredGame(page, { variant: 'wallgo1', format: '2p', shuffleOrder: false });
      await completePlacement(page, placements);

      await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
      await playHumanTurn(page, { row: 1, col: 5 }, { row: 1, col: 5 }, hWall(1, 5));
      await playHumanTurn(page, { row: 1, col: 1 }, { row: 0, col: 1 }, hWall(0, 1));
      await playHumanTurn(page, { row: 5, col: 1 }, { row: 5, col: 1 }, hWall(5, 1));
      await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 6 }, hWall(5, 6));
      await playHumanTurn(page, { row: 1, col: 5 }, { row: 0, col: 5 }, hWall(0, 5));
      await playHumanTurn(page, { row: 5, col: 5 }, { row: 6, col: 5 }, hWall(5, 5));

      // Record turnNumber before T8 (P1): on completion, all 4 P0 pieces have 0 legal moves -> P0 auto-skipped!
      const turnBeforeT8 = (await readGameScreenState(page)).turnNumber;
      await playHumanTurn(page, { row: 5, col: 1 }, { row: 4, col: 1 }, vWall(4, 1));

      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
      await expect(page.getByTestId('game-screen')).toHaveAttribute(
        'data-turn-number',
        String(turnBeforeT8 + 1),
      );
      await expect(playerCardLocator(page, 0)).toHaveAttribute('data-auto-skipped', 'true');
      await expect(playerCardLocator(page, 1)).toHaveAttribute('data-active', 'true');
      await expect(playerCardLocator(page, 1)).toHaveAttribute('data-auto-skipped', 'false');
      await expect(page.getByTestId('game-toast')).toBeVisible();
      await expect(page.getByTestId('game-toast')).toHaveAttribute('role', 'alert');

      // Consecutive Turn 9 by P1 succeeds immediately
      await playHumanTurn(page, { row: 4, col: 1 }, { row: 3, col: 1 }, vWall(3, 1));
      await expect(cellLocator(page, 3, 1)).toHaveAttribute('data-occupied-by', '1');
      await expect(placedWallLocator(page, vWall(3, 1))).toBeVisible();
      await expect(page.getByTestId('game-screen')).toHaveAttribute(
        'data-turn-number',
        String(turnBeforeT8 + 2),
      );
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    });

    test('T2-38 (E18/F18): 0-point live HUD display (0칸 & 최대 0) and multi-region final scoring breakdown', async ({
      page,
    }) => {
      const placements: readonly E2EPlacementStep[] = [
        { row: 0, col: 0 },
        { row: 0, col: 4 },
        { row: 0, col: 5 },
        { row: 0, col: 6 },
        { row: 5, col: 6 },
        { row: 6, col: 5 },
      ];

      await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
      await completePlacement(page, placements);

      await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
      await playHumanTurn(page, { row: 5, col: 6 }, { row: 5, col: 6 }, hWall(5, 6));
      await playHumanTurn(page, { row: 0, col: 5 }, { row: 0, col: 5 }, hWall(0, 5));
      await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, vWall(0, 0));
      await playHumanTurn(page, { row: 5, col: 6 }, { row: 5, col: 5 }, hWall(5, 5));
      await playHumanTurn(page, { row: 0, col: 6 }, { row: 0, col: 6 }, hWall(0, 6));
      await playHumanTurn(page, { row: 6, col: 5 }, { row: 6, col: 5 }, vWall(6, 4));

      // Live Mid-Check after T7: P0 = 3 (2 disjoint: 1+2, largest 2); P1 & P2 = 0칸 / 최대 0
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '3');
      await expect(page.getByTestId('player-score-0')).toContainText('3칸');
      await expect(page.getByTestId('player-largest-0')).toHaveAttribute('data-value', '2');
      await expect(page.getByTestId('player-largest-0')).toContainText('최대 2');

      for (const id of [1, 2] as const) {
        await expect(page.getByTestId(`player-score-${id}`)).toHaveAttribute('data-value', '0');
        await expect(page.getByTestId(`player-score-${id}`)).toContainText('0칸');
        await expect(page.getByTestId(`player-largest-${id}`)).toHaveAttribute('data-value', '0');
        await expect(page.getByTestId(`player-largest-${id}`)).toContainText('최대 0');
      }
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-count', '1');
      await expect(territoryBadgeLocator(page, 6, 5)).toHaveAttribute('data-count', '2');

      // T8 (P1): seals P2 {(0,5),(0,6)} = 2 -> immediate game_over
      await playHumanTurn(page, { row: 0, col: 4 }, { row: 0, col: 4 }, vWall(0, 4));
      await waitForGameOver(page, 10_000);

      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-rank', '1');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-total-cells', '44');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-largest-area', '44');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute(
        'data-advancing-round2',
        'false',
      );

      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-rank', '2');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-total-cells', '3');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-largest-area', '2');
      await expect(page.getByTestId('result-rank-row-0')).toContainText('3칸');
      await expect(page.getByTestId('result-rank-row-0')).toContainText('최대 단일 2칸');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute(
        'data-advancing-round2',
        'true',
      );

      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-rank', '3');
      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-total-cells', '2');
      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-largest-area', '2');
      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute(
        'data-advancing-round2',
        'true',
      );

      await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-advancing-ids', '0,2');
      await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-first-player-id', '0');
    });

    // --- FA-08: Prison Match Round 2 & Standalone 2P Edge Cases (T2-39 - T2-44) ---

    test('T2-39 (E24a): 3P tiebreaker by largestSingleTerritory assigns higher-ID P2 as Round 2 first player', async ({
      page,
    }) => {
      const placements: readonly E2EPlacementStep[] = [
        { row: 0, col: 4 },
        { row: 0, col: 0 },
        { row: 0, col: 5 },
        { row: 0, col: 6 },
        { row: 6, col: 0 },
        { row: 5, col: 0 },
      ];

      await startConfiguredGame(page, {
        variant: 'wallgo1',
        format: '3p',
        shuffleOrder: false,
        seats: [{ name: '우승자' }, { name: '분할이' }, { name: '단일이' }],
      });
      await completePlacement(page, placements);

      await playHumanTurn(page, { row: 0, col: 4 }, { row: 0, col: 4 }, vWall(0, 4));
      await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
      await playHumanTurn(page, { row: 0, col: 5 }, { row: 0, col: 5 }, hWall(0, 5));
      await playHumanTurn(page, { row: 5, col: 0 }, { row: 5, col: 0 }, hWall(5, 0));
      await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, vWall(0, 0));
      await playHumanTurn(page, { row: 0, col: 6 }, { row: 0, col: 6 }, hWall(0, 6));
      await playHumanTurn(page, { row: 5, col: 0 }, { row: 6, col: 1 }, vWall(6, 0));
      await waitForGameOver(page, 10_000);

      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-rank', '1');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-total-cells', '45');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute(
        'data-advancing-round2',
        'false',
      );

      // P2 (id=2): 2 cells (max 2) -> Rank 2 beats P1 (id=1): 2 cells (max 1) -> Rank 3!
      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-rank', '2');
      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-total-cells', '2');
      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-largest-area', '2');
      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute(
        'data-advancing-round2',
        'true',
      );

      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-rank', '3');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-total-cells', '2');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-largest-area', '1');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute(
        'data-advancing-round2',
        'true',
      );

      const preview = page.getByTestId('round2-preview');
      await expect(preview).toHaveAttribute('data-first-player-id', '2');
      await expect(preview).toHaveAttribute('data-advancing-ids', /^(2,1|1,2)$/);

      await startPrisonMatchRound2(page);
      await expect(playerCardLocator(page, 0)).toContainText('단일이');
      await expect(playerCardLocator(page, 1)).toContainText('분할이');
    });

    test('T2-40 (E24b): Exact 2nd/3rd tie yields shared rank 2 (공동 2위) and deterministic lower R1 ID as Round 2 first player', async ({
      page,
    }) => {
      const placements: readonly E2EPlacementStep[] = [
        { row: 0, col: 2 },
        { row: 6, col: 0 },
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 6, col: 1 },
        { row: 6, col: 2 },
      ];

      await startConfiguredGame(page, {
        variant: 'wallgo1',
        format: '3p',
        shuffleOrder: false,
        seats: [{ name: '일등' }, { name: '동점A' }, { name: '동점B' }],
      });
      await completePlacement(page, placements);

      await playHumanTurn(page, { row: 0, col: 2 }, { row: 0, col: 2 }, vWall(0, 1));
      await playHumanTurn(page, { row: 6, col: 0 }, { row: 6, col: 0 }, hWall(5, 0));
      await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
      await playHumanTurn(page, { row: 6, col: 2 }, { row: 6, col: 2 }, vWall(6, 1));
      await playHumanTurn(page, { row: 6, col: 1 }, { row: 6, col: 1 }, hWall(5, 1));
      await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, hWall(0, 1));
      await waitForGameOver(page, 10_000);

      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-rank', '1');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-total-cells', '45');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute(
        'data-advancing-round2',
        'false',
      );

      for (const id of [1, 2] as const) {
        const row = page.getByTestId(`result-rank-row-${id}`);
        await expect(row).toHaveAttribute('data-rank', '2');
        await expect(row).toHaveAttribute('data-total-cells', '2');
        await expect(row).toHaveAttribute('data-largest-area', '2');
        await expect(row).toHaveAttribute('data-advancing-round2', 'true');
        await expect(row).toContainText(/공동\s*2위/);
      }

      await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-advancing-ids', '1,2');
      await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-first-player-id', '1');

      await startPrisonMatchRound2(page);
      await expect(playerCardLocator(page, 0)).toContainText('동점A');
      await expect(playerCardLocator(page, 1)).toContainText('동점B');
    });

    test('T2-41 (E24c): tied_for_first ([1, 1, 3]) displays 공동 1위 for P0 & P1, 3위 for P2, and neutral outer board', async ({
      page,
    }) => {
      await run3PTieScenario(page, 'tied_for_first');

      for (const id of [0, 1] as const) {
        const row = page.getByTestId(`result-rank-row-${id}`);
        await expect(row).toHaveAttribute('data-rank', '1');
        await expect(row).toHaveAttribute('data-total-cells', '3');
        await expect(row).toHaveAttribute('data-largest-area', '3');
        await expect(row).toContainText(/공동\s*1위/);
      }

      const row2 = page.getByTestId('result-rank-row-2');
      await expect(row2).toHaveAttribute('data-rank', '3');
      await expect(row2).toHaveAttribute('data-total-cells', '2');
      await expect(row2).toHaveAttribute('data-largest-area', '2');
      await expect(row2).toContainText(/3위/);
      await expect(row2).not.toContainText(/공동/);

      await expect(page.getByTestId('round2-preview')).toBeVisible();
      await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-advancing-ids', '1,2');
      await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-first-player-id', '1');

      await inspectBoardFromResult(page);
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-owner', '0');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-count', '3');
      await expect(territoryBadgeLocator(page, 0, 1)).toHaveAttribute('data-owner', '1');
      await expect(territoryBadgeLocator(page, 0, 1)).toHaveAttribute('data-count', '3');
      await expect(territoryBadgeLocator(page, 1, 2)).toHaveAttribute('data-owner', '2');
      await expect(territoryBadgeLocator(page, 1, 2)).toHaveAttribute('data-count', '2');
      await expect(cellLocator(page, 0, 2)).toHaveAttribute('data-territory-owner', 'none');
      await expect(cellLocator(page, 6, 6)).toHaveAttribute('data-territory-owner', 'none');
    });

    test('T2-42 (E24d): three_way_tie ([1, 1, 1]) displays 공동 1위 for all 3 players and rematch resets cleanly', async ({
      page,
    }) => {
      await run3PTieScenario(page, 'three_way_tie');

      for (const id of [0, 1, 2] as const) {
        const row = page.getByTestId(`result-rank-row-${id}`);
        await expect(row).toHaveAttribute('data-rank', '1');
        await expect(row).toHaveAttribute('data-total-cells', '3');
        await expect(row).toHaveAttribute('data-largest-area', '3');
        await expect(row).toContainText(/공동\s*1위/);
      }

      await expect(page.getByTestId('round2-preview')).toBeVisible();
      await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-advancing-ids', '1,2');
      await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-first-player-id', '1');
      await expect(page.getByTestId('rematch-button')).toBeVisible();

      await inspectBoardFromResult(page);
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-owner', '0');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-count', '3');
      await expect(territoryBadgeLocator(page, 0, 1)).toHaveAttribute('data-owner', '1');
      await expect(territoryBadgeLocator(page, 0, 1)).toHaveAttribute('data-count', '3');
      await expect(territoryBadgeLocator(page, 0, 2)).toHaveAttribute('data-owner', '2');
      await expect(territoryBadgeLocator(page, 0, 2)).toHaveAttribute('data-count', '3');
      await expect(cellLocator(page, 0, 3)).toHaveAttribute('data-territory-owner', 'none');
      await expect(cellLocator(page, 6, 6)).toHaveAttribute('data-territory-owner', 'none');

      await reopenResultModal(page);
      await page.getByTestId('rematch-button').click();
      await expect(page.getByTestId('result-modal')).toHaveCount(0);
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-format', '3p');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-round', '1');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'placement');
      await expect(boardPiecesLocator(page)).toHaveCount(0);
      await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(0);
    });

    test('T2-43: Prison Match Round 2 inherits Wall Go II rules, custom names and live 60s timer', async ({
      page,
    }) => {
      await openLobbyWithPausedClock(page);
      await configureLobby(page, {
        variant: 'wallgo2',
        format: '3p',
        timerSeconds: 60,
        shuffleOrder: false,
        seats: [{ name: '태현' }, { name: '소희' }, { name: '준호' }],
      });
      await startGame(page);
      await run3PWallGo2CompletionFromStartedGame(page);

      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-rank', '1');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-total-cells', '43');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-rank', '2');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-total-cells', '4');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute(
        'data-advancing-round2',
        'true',
      );
      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-rank', '3');
      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-total-cells', '2');
      await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute(
        'data-advancing-round2',
        'true',
      );
      await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-advancing-ids', '1,2');
      await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-first-player-id', '1');

      await startPrisonMatchRound2(page);
      const game = page.getByTestId('game-screen');
      await expect(game).toHaveAttribute('data-variant', 'wallgo2');
      await expect(game).toHaveAttribute('data-format', '2p');
      await expect(game).toHaveAttribute('data-round', '2');
      await expect(game).toHaveAttribute('data-phase', 'placement');
      await expect(game).toHaveAttribute('data-current-player', '0');

      await expect(page.getByTestId('game-topbar')).toContainText('벽바둑 II');
      await expect(page.getByTestId('game-topbar')).toContainText('감옥매치 2라운드');
      await expect(playerCardLocator(page, 0)).toContainText('소희');
      await expect(playerCardLocator(page, 1)).toContainText('준호');
      await expect(playerCardLocator(page, 2)).toHaveCount(0);
      await expect(page.getByTestId('piece-kind-picker')).toHaveCount(0);
      await expect(page.getByTestId('wall-break-toggle')).toHaveCount(0);
      await expect(page.getByTestId('player-wallbreak-0')).toHaveCount(0);
      await expect(page.getByTestId('player-wallbreak-1')).toHaveCount(0);

      for (const [r, c, owner] of [
        [1, 1, '0'],
        [5, 5, '0'],
        [1, 5, '1'],
        [5, 1, '1'],
      ] as const) {
        await expect(cellLocator(page, r, c)).toHaveAttribute('data-occupied-by', owner);
        await expect(cellLocator(page, r, c)).toHaveAttribute('data-piece-kind', 'round');
      }

      await expect(page.getByTestId('turn-timer')).toBeVisible();
      await expect(page.getByTestId('turn-timer')).toHaveAttribute('data-seconds', '60');
      await expect(page.getByTestId('turn-timer')).toContainText('01:00');

      await completePlacement(page, DEFAULT_2P_PLACEMENTS);
      for (const step of DEFAULT_2P_PLACEMENTS) {
        await expect(cellLocator(page, step.row, step.col)).toHaveAttribute(
          'data-piece-kind',
          'square',
        );
      }

      await page.clock.runFor(3_000);
      await expect(page.getByTestId('turn-timer')).toHaveAttribute('data-seconds', '57');
      await expect(page.getByTestId('turn-timer')).toContainText('00:57');

      // Execute 2 Wall Go II moves in Round 2 (round 90-deg diagonal + square 2-step straight)
      await playHumanTurn(page, { row: 1, col: 1 }, { row: 0, col: 2 }, hWall(0, 2));
      await playHumanTurn(page, { row: 2, col: 4 }, { row: 0, col: 4 }, vWall(0, 4));

      await expect(cellLocator(page, 0, 2)).toHaveAttribute('data-occupied-by', '0');
      await expect(cellLocator(page, 0, 2)).toHaveAttribute('data-piece-kind', 'round');
      await expect(cellLocator(page, 0, 4)).toHaveAttribute('data-occupied-by', '1');
      await expect(cellLocator(page, 0, 4)).toHaveAttribute('data-piece-kind', 'square');
      await expect(placedWallLocator(page, hWall(0, 2))).toBeVisible();
      await expect(placedWallLocator(page, vWall(0, 4))).toBeVisible();
      await expect(game).toHaveAttribute('data-current-player', '0');
    });

    test('T2-44: Standalone 2P and Round 2 completion ResultModal omits Round 2 CTA and rematch restarts cleanly', async ({
      page,
    }) => {
      // Part A: Standalone 2P completion
      await startConfiguredGame(page, { variant: 'wallgo1', format: '2p', shuffleOrder: false });
      await complete2PWallGo1Fast(page);

      await expect(page.getByTestId('result-modal')).toBeVisible();
      await expect(page.getByTestId('start-round2-button')).toHaveCount(0);
      await expect(page.getByTestId('round2-preview')).toHaveCount(0);
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-rank', '1');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-total-cells', '45');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-largest-area', '45');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute(
        'data-advancing-round2',
        'false',
      );
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-rank', '2');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-total-cells', '4');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-largest-area', '2');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute(
        'data-advancing-round2',
        'false',
      );

      await page.getByTestId('rematch-button').click();
      await expect(page.getByTestId('result-modal')).toHaveCount(0);
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-format', '2p');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-round', '1');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'placement');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
      await expect(boardPiecesLocator(page)).toHaveCount(4);
      await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(0);
      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '0');
      await expect(page.getByTestId('player-score-1')).toHaveAttribute('data-value', '0');

      // Part B: Prison Match Round 2 completion
      await runScriptD(page);
      await startPrisonMatchRound2(page);
      await complete2PWallGo1Fast(page);

      await expect(page.getByTestId('result-modal')).toBeVisible();
      await expect(page.getByTestId('start-round2-button')).toHaveCount(0);
      await expect(page.getByTestId('round2-preview')).toHaveCount(0);
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-total-cells', '45');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-largest-area', '45');
      await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute(
        'data-advancing-round2',
        'false',
      );
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-total-cells', '4');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-largest-area', '2');
      await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute(
        'data-advancing-round2',
        'false',
      );

      await page.getByTestId('rematch-button').click();
      await expect(page.getByTestId('result-modal')).toHaveCount(0);
      const afterRematch = await readGameScreenState(page);
      expect(afterRematch.phase).toBe('placement');
      expect(afterRematch.currentPlayer).toBe(0);
      await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(0);
      await expect(boardPiecesLocator(page)).toHaveCount(afterRematch.format === '2p' ? 4 : 0);
    });
  },
);
