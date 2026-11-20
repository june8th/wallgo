import { expect, test } from '@playwright/test';
import {
  CLOCK_T0,
  DEFAULT_2P_PLACEMENTS,
  DEFAULT_3P_PLACEMENTS,
  SCRIPT_A1_PLACEMENTS,
  SCRIPT_C_PLACEMENTS,
  advancePausedClockUntilHumanTurnOrGameOver,
  boardPiecesLocator,
  cancelTurnMove,
  cellLocator,
  clickRedo,
  clickUndo,
  closeRulesModal,
  completePlacement,
  configureLobby,
  ensureWallBreakActive,
  expectTurnTimerReset,
  hWall,
  moveSelectedTo,
  openLobby,
  openLobbyWithPausedClock,
  openRulesModal,
  placeFirstAvailableEmptyCell,
  placePiece,
  placeWallAt,
  placedWallLocator,
  playFirstLegalHumanTurn,
  playHumanTurn,
  playWallGo1BreakTurn,
  playerCardLocator,
  readGameScreenState,
  returnToLobby,
  runScriptA1,
  runScriptA2,
  runScriptBSetup,
  runScriptCSetup,
  selectCell,
  startConfiguredGame,
  startGame,
  startPrisonMatchRound2,
  switchRulesTab,
  territoryBadgeLocator,
  toggleWallBreak,
  triggerCurrentTurnTimeout,
  vWall,
  wallSlotLocator,
  type E2EPlacementStep,
} from './helpers/game.ts';
import {
  IPAD_VIEWPORTS,
  assertGameRegionsNoOverlap,
  assertNoDuplicateVisibleTestIds,
  assertZeroOverflow,
} from './helpers/layout.ts';
import { attachRuntimeErrorGuard, type RuntimeErrorGuard } from './helpers/network.ts';
import { playHumanSelfSealCornerTurn, runScriptD2 } from './helpers/scripts.ts';

test.describe('Tier 3 — Cross-Feature Pairwise Combinations', { tag: '@tier3' }, () => {
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

  test('C01: Wall Go II x Turn Order Shuffle preserves shuffled names, auto-locks 2nd kind and enforces square/round moves', async ({
    page,
  }) => {
    const names = ['사각왕', '원형왕', '벽왕'] as const;

    await startConfiguredGame(page, {
      variant: 'wallgo2',
      format: '3p',
      shuffleOrder: true,
      seats: [{ name: '사각왕' }, { name: '원형왕' }, { name: '벽왕' }],
    });

    const seatNames: string[] = [];
    for (const id of [0, 1, 2] as const) {
      const text = await playerCardLocator(page, id).innerText();
      const matched = names.filter((n) => text.includes(n));
      expect(matched).toHaveLength(1);
      seatNames.push(matched[0] ?? '');
    }
    expect([...seatNames].sort()).toEqual([...names].sort());

    const banner = page.getByTestId('turn-banner');
    await expect(banner).toContainText(seatNames[0] ?? '');
    await placePiece(page, 2, 2, 'round');

    await expect(banner).toContainText(seatNames[1] ?? '');
    await placePiece(page, 2, 4, 'square');

    await expect(banner).toContainText(seatNames[2] ?? '');
    await placePiece(page, 4, 2, 'round');

    // Step 3 (P2 2nd): round disabled -> square auto-selected
    await expect(page.getByTestId('pick-piece-round')).toBeDisabled();
    await expect(page.getByTestId('pick-piece-square')).toHaveAttribute('aria-pressed', 'true');
    await placePiece(page, 4, 4);
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-piece-kind', 'square');

    // Step 4 (P1 2nd): square disabled -> round auto-selected
    await expect(banner).toContainText(seatNames[1] ?? '');
    await expect(page.getByTestId('pick-piece-square')).toBeDisabled();
    await expect(page.getByTestId('pick-piece-round')).toHaveAttribute('aria-pressed', 'true');
    await placePiece(page, 0, 6);
    await expect(cellLocator(page, 0, 6)).toHaveAttribute('data-piece-kind', 'round');

    // Step 5 (P0 2nd): round disabled -> square auto-selected
    await expect(banner).toContainText(seatNames[0] ?? '');
    await expect(page.getByTestId('pick-piece-round')).toBeDisabled();
    await expect(page.getByTestId('pick-piece-square')).toHaveAttribute('aria-pressed', 'true');
    await placePiece(page, 6, 0);
    await expect(cellLocator(page, 6, 0)).toHaveAttribute('data-piece-kind', 'square');

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
    await expect(page.getByTestId('piece-kind-picker')).toHaveCount(0);

    // Turn 1 (P0 round at (2,2)): rejects straight-2 (0,2) & stay (2,2); executes diagonal (3,3) + h(3,3)
    await expect(banner).toContainText(seatNames[0] ?? '');
    await selectCell(page, 2, 2);
    await expect(cellLocator(page, 0, 2)).toHaveAttribute('data-valid-move', 'false');
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-valid-move', 'false');
    await moveSelectedTo(page, 3, 3);
    await placeWallAt(page, hWall(3, 3));

    // Turn 2 (P1 square at (2,4)): rejects diagonal (1,3) & stay (2,4); executes straight-2 (0,4) + v(0,4)
    await expect(banner).toContainText(seatNames[1] ?? '');
    await selectCell(page, 2, 4);
    await expect(cellLocator(page, 1, 3)).toHaveAttribute('data-valid-move', 'false');
    await expect(cellLocator(page, 2, 4)).toHaveAttribute('data-valid-move', 'false');
    await moveSelectedTo(page, 0, 4);
    await placeWallAt(page, vWall(0, 4));

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');

    // Lobby preserves variant-wallgo2 and shuffle-order-toggle=true
    await returnToLobby(page);
    await expect(page.getByTestId('variant-wallgo2')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('shuffle-order-toggle')).toHaveAttribute('aria-checked', 'true');
  });

  test('C02: Wall Go II x Standalone 2P fixed round + auto-square placement, cancel recovery and 3-turn corner seal', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo2', format: '2p', shuffleOrder: false });

    await expect(page.getByTestId('piece-kind-picker')).toHaveCount(0);
    await expect(page.getByTestId('wall-break-toggle')).toHaveCount(0);
    await expect(page.getByTestId('player-wallbreak-0')).toHaveCount(0);
    await expect(page.getByTestId('player-wallbreak-1')).toHaveCount(0);
    await expect(playerCardLocator(page, 2)).toHaveCount(0);

    for (const [r, c] of [
      [1, 1],
      [5, 5],
      [1, 5],
      [5, 1],
    ] as const) {
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-piece-kind', 'round');
    }

    const placements: readonly E2EPlacementStep[] = [
      { row: 0, col: 1 },
      { row: 2, col: 4 },
      { row: 4, col: 2 },
      { row: 4, col: 4 },
    ];
    await completePlacement(page, placements);
    for (const step of placements) {
      await expect(cellLocator(page, step.row, step.col)).toHaveAttribute(
        'data-piece-kind',
        'square',
      );
    }

    const turnBefore = (await readGameScreenState(page)).turnNumber;

    // Turn 1 (P0): move square (0,1)->(0,0), test cancel-move-button, then commit (0,0) + h(0,0)
    await selectCell(page, 0, 1);
    await moveSelectedTo(page, 0, 0);
    await cancelTurnMove(page);
    await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-occupied-by', '0');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-occupied-by', 'none');
    await expect(page.getByTestId('game-screen')).toHaveAttribute(
      'data-turn-number',
      String(turnBefore),
    );

    await moveSelectedTo(page, 0, 0);
    await placeWallAt(page, hWall(0, 0));

    // Turn 2 (P1): square (2,4)->(0,4) + v(0,4)
    await playHumanTurn(page, { row: 2, col: 4 }, { row: 0, col: 4 }, vWall(0, 4));

    // Turn 3 (P0): round (1,1)->(0,1) + v(0,0) -> seals {(0,0)} for P0!
    await playHumanTurn(page, { row: 1, col: 1 }, { row: 0, col: 1 }, vWall(0, 0));

    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', '0');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-size', '1');
    await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-owner', '0');
    await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-count', '1');
    await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '1');
    await expect(page.getByTestId('player-largest-0')).toHaveAttribute('data-value', '1');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
  });

  test('C03: Wall Go I Wall Break x Cancel Move x Live Territory Re-Shading', async ({ page }) => {
    await runScriptA1(page);

    // Turn 3 (P2): stays at (6,6) + h(5,6)
    await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 6 }, hWall(5, 6));

    // Pre-break baseline: {(0,0)} sealed for P0 (score=1, badge visible)
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', '0');
    await expect(territoryBadgeLocator(page, 0, 0)).toHaveCount(1);
    await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '1');

    // Turn 4 (P0): select (0,0), activate Wall Break (C08-safe), verify E08 excludes v(0,0)
    await cellLocator(page, 0, 0).click();
    await ensureWallBreakActive(page, true);
    await expect(wallSlotLocator(page, vWall(0, 0))).toHaveCount(0);
    await expect(wallSlotLocator(page, hWall(0, 0))).toHaveAttribute(
      'data-wall-state',
      'breakable',
    );

    // Break h(0,0) -> territory immediately un-shades
    await wallSlotLocator(page, hWall(0, 0)).click();
    await expect(placedWallLocator(page, hWall(0, 0))).toHaveCount(0);
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', 'none');
    await expect(territoryBadgeLocator(page, 0, 0)).toHaveCount(0);
    await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '0');
    await expect(page.getByTestId('player-wallbreak-0')).toHaveAttribute('data-remaining', '0');

    // Cancel -> territory & wall immediately restored
    await cancelTurnMove(page);
    await expect(placedWallLocator(page, hWall(0, 0))).toHaveAttribute('data-owner', '0');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', '0');
    await expect(territoryBadgeLocator(page, 0, 0)).toHaveCount(1);
    await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '1');
    await expect(page.getByTestId('player-wallbreak-0')).toHaveAttribute('data-remaining', '1');

    // Re-break h(0,0), move (0,0)->(1,0), place h(1,0)
    await ensureWallBreakActive(page, true);
    await wallSlotLocator(page, hWall(0, 0)).click();
    await moveSelectedTo(page, 1, 0);
    await placeWallAt(page, hWall(1, 0));

    await expect(cellLocator(page, 1, 0)).toHaveAttribute('data-occupied-by', '0');
    await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '0');
    await expect(page.getByTestId('player-wallbreak-0')).toHaveAttribute('data-remaining', '0');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
  });

  test('C04: Wall Go I Conditional Stay x Corner Wall Placement x Live Territory Seal -> Neutral Split & Forbidden Stay', async ({
    page,
  }) => {
    await runScriptA2(page);

    // Baseline: {(0,0),(0,1)} secured for P0 (2 cells)
    await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '2');
    await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-count', '2');

    // Turn 4 (P0): stay at (0,0) (since (0,1) open) and build interior divider v(0,0)
    await selectCell(page, 0, 0);
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-move-type', 'stay');
    await moveSelectedTo(page, 0, 0);
    await placeWallAt(page, vWall(0, 0));

    // {(0,0)} stays P0 (1 cell), empty {(0,1)} becomes neutral (0 pts, no badge), P0 score drops 2 -> 1!
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', '0');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-size', '1');
    await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-count', '1');
    await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-territory-owner', 'none');
    await expect(territoryBadgeLocator(page, 0, 1)).toHaveCount(0);
    await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '1');

    // Turns 5-6 (P1, P2)
    await playHumanTurn(page, { row: 4, col: 6 }, { row: 4, col: 6 }, hWall(4, 6));
    await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 6 }, vWall(6, 5));

    // Turn 7 (P0): (0,0) now has |D_1|=0 -> conditional stay forbidden (C08-safe!)
    await cellLocator(page, 0, 0).click();
    const wbToggle = page.getByTestId('wall-break-toggle');
    if ((await wbToggle.getAttribute('aria-pressed')) === 'true') {
      await ensureWallBreakActive(page, false);
    }
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-valid-move', 'false');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-move-type', 'none');

    // P0's open piece (4,4) remains freely movable with stay allowed
    await selectCell(page, 4, 4);
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-valid-move', 'true');
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-move-type', 'stay');
  });

  test('C05: Wall Go II Ambiguous Diagonal Break x Cancel Move x Alternate Wall Confirmation', async ({
    page,
  }) => {
    await runScriptCSetup(page);

    await selectCell(page, 3, 3);
    await toggleWallBreak(page, true);
    await cellLocator(page, 4, 4).click();

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-phase-substate', 'choose_break_wall');
    await expect(wallSlotLocator(page, vWall(3, 3))).toHaveAttribute(
      'data-wall-state',
      'breakable-choice',
    );
    await expect(wallSlotLocator(page, hWall(3, 3))).toHaveAttribute(
      'data-wall-state',
      'breakable-choice',
    );

    // Cancel choice -> both walls intact, charge=1, interactive slots unmounted
    await cancelTurnMove(page);
    await expect(game).toHaveAttribute('data-phase', 'move_piece');
    await expect(game).toHaveAttribute('data-phase-substate', 'idle');
    await expect(page.getByTestId('wall-break-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-wall-interactive="true"]')).toHaveCount(0);
    await expect(placedWallLocator(page, vWall(3, 3))).toHaveAttribute('data-owner', '0');
    await expect(placedWallLocator(page, hWall(3, 3))).toHaveAttribute('data-owner', '1');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '2');
    await expect(page.getByTestId('player-wallbreak-2')).toHaveAttribute('data-remaining', '1');

    // Re-enter Wall Break and confirm the ALTERNATE wall h(3,3)
    await toggleWallBreak(page, true);
    await cellLocator(page, 4, 4).click();
    await expect(game).toHaveAttribute('data-phase-substate', 'choose_break_wall');
    await wallSlotLocator(page, hWall(3, 3)).click();

    await expect(game).toHaveAttribute('data-phase', 'place_wall');
    await expect(placedWallLocator(page, hWall(3, 3))).toHaveCount(0);
    await expect(placedWallLocator(page, vWall(3, 3))).toHaveAttribute('data-owner', '0');
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-occupied-by', '2');
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-piece-kind', 'round');
    await expect(page.getByTestId('player-wallbreak-2')).toHaveAttribute('data-remaining', '0');

    await placeWallAt(page, vWall(4, 4));
    await expect(game).toHaveAttribute('data-current-player', '0');
    await expect(placedWallLocator(page, vWall(4, 4))).toHaveAttribute('data-owner', '2');
    await expect(placedWallLocator(page, vWall(4, 4))).toHaveAttribute('data-last-wall', 'true');
  });

  test('C06: Wall Go I Wall Break x Smart Undo (dirty post-break & committed) and Redo', async ({
    page,
  }) => {
    await runScriptBSetup(page);

    const game = page.getByTestId('game-screen');
    const turnBefore = (await readGameScreenState(page)).turnNumber;

    // Part A: Dirty post-break Undo BEFORE moving
    await selectCell(page, 2, 3);
    await toggleWallBreak(page, true);
    await wallSlotLocator(page, vWall(2, 2)).click();
    await expect(placedWallLocator(page, vWall(2, 2))).toHaveCount(0);

    await clickUndo(page);
    await expect(placedWallLocator(page, vWall(2, 2))).toHaveAttribute('data-owner', '0');
    await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '1');
    await expect(game).toHaveAttribute('data-current-player', '1');
    await expect(game).toHaveAttribute('data-turn-number', String(turnBefore));
    const afterDirtyUndo = await readGameScreenState(page);
    expect(['move_piece', 'select_piece']).toContain(afterDirtyUndo.phase);
    await expect(placedWallLocator(page, hWall(2, 1))).toBeVisible();

    // Part B: Committed Wall Break Turn -> Undo -> Redo
    await playWallGo1BreakTurn(
      page,
      { row: 2, col: 3 },
      vWall(2, 2),
      { row: 2, col: 2 },
      hWall(1, 2),
    );
    await expect(game).toHaveAttribute('data-turn-number', String(turnBefore + 1));
    await expect(game).toHaveAttribute('data-current-player', '2');

    await clickUndo(page);
    await expect(game).toHaveAttribute('data-turn-number', String(turnBefore));
    await expect(game).toHaveAttribute('data-current-player', '1');
    await expect(game).toHaveAttribute('data-phase', 'select_piece');
    await expect(cellLocator(page, 2, 3)).toHaveAttribute('data-occupied-by', '1');
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-occupied-by', 'none');
    await expect(placedWallLocator(page, vWall(2, 2))).toHaveAttribute('data-owner', '0');
    await expect(placedWallLocator(page, hWall(1, 2))).toHaveCount(0);
    await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '1');
    await expect(page.getByTestId('redo-button')).toBeEnabled();

    await clickRedo(page);
    await expect(game).toHaveAttribute('data-turn-number', String(turnBefore + 1));
    await expect(game).toHaveAttribute('data-current-player', '2');
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-occupied-by', '1');
    await expect(placedWallLocator(page, vWall(2, 2))).toHaveCount(0);
    await expect(placedWallLocator(page, hWall(1, 2))).toHaveAttribute('data-owner', '1');
    await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '0');
    await expect(page.getByTestId('redo-button')).toBeDisabled();
  });

  test('C07: 3P Wall Go II Game End x Prison Match Round 2 Continuation', async ({ page }) => {
    await runScriptD2(page, {
      seats: [{ name: '일등' }, { name: '이등' }, { name: '삼등' }],
    });

    await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-rank', '1');
    await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-total-cells', '43');
    await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute(
      'data-advancing-round2',
      'false',
    );
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
    await expect(page.getByTestId('round2-preview')).toHaveAttribute(
      'data-advancing-ids',
      /^(1,2|2,1)$/,
    );
    await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-first-player-id', '1');

    await startPrisonMatchRound2(page);
    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-variant', 'wallgo2');
    await expect(game).toHaveAttribute('data-format', '2p');
    await expect(game).toHaveAttribute('data-round', '2');
    await expect(page.getByTestId('game-topbar')).toContainText('벽바둑 II');
    await expect(page.getByTestId('game-topbar')).toContainText('감옥매치 2라운드');
    await expect(playerCardLocator(page, 0)).toContainText('이등');
    await expect(playerCardLocator(page, 1)).toContainText('삼등');
    await expect(page.getByTestId('piece-kind-picker')).toHaveCount(0);
    await expect(page.getByTestId('wall-break-toggle')).toHaveCount(0);

    for (const [r, c] of [
      [1, 1],
      [5, 5],
      [1, 5],
      [5, 1],
    ] as const) {
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-piece-kind', 'round');
    }

    await completePlacement(page, DEFAULT_2P_PLACEMENTS);
    for (const step of DEFAULT_2P_PLACEMENTS) {
      await expect(cellLocator(page, step.row, step.col)).toHaveAttribute(
        'data-piece-kind',
        'square',
      );
    }

    await playHumanTurn(page, { row: 1, col: 1 }, { row: 0, col: 2 }, hWall(0, 2));
    await playHumanTurn(page, { row: 2, col: 4 }, { row: 0, col: 4 }, vWall(0, 4));
    await expect(placedWallLocator(page, hWall(0, 2))).toBeVisible();
    await expect(placedWallLocator(page, vWall(0, 4))).toBeVisible();
    await expect(game).toHaveAttribute('data-current-player', '0');
  });

  test('C08: Custom Names + Mixed Human/AI x Prison Match Round 2 carries over names, AI flags and executes Round 2 bot turn', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const seatMeta = [
      { name: '민수', isAI: false },
      { name: '알파봇', isAI: true },
      { name: '베타봇', isAI: true },
    ] as const;

    await openLobbyWithPausedClock(page, CLOCK_T0);
    await configureLobby(page, {
      variant: 'wallgo1',
      format: '3p',
      timerSeconds: 0,
      shuffleOrder: false,
      seats: [
        { name: '민수', controller: 'human' },
        { name: '알파봇', controller: 'ai-easy' },
        { name: '베타봇', controller: 'ai-easy' },
      ],
    });
    await startGame(page);

    await placePiece(page, 0, 0);
    const step5 = await advancePausedClockUntilHumanTurnOrGameOver(page, {
      expectedPlayer: 0,
      expectedPhase: 'placement',
    });
    expect(step5).toBe('human_turn');
    await placeFirstAvailableEmptyCell(page, [
      { row: 0, col: 1 },
      { row: 1, col: 0 },
    ]);

    for (let round = 0; round < 60; round += 1) {
      const outcome = await advancePausedClockUntilHumanTurnOrGameOver(page, {
        expectedPlayer: 0,
        maxSteps: 160,
      });
      if (outcome === 'game_over') {
        break;
      }
      await playHumanSelfSealCornerTurn(page, 0);
    }

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'game_over');
    await expect(page.getByTestId('result-modal')).toBeVisible();

    const preview = page.getByTestId('round2-preview');
    const advancingRaw = (await preview.getAttribute('data-advancing-ids')) ?? '';
    const firstId = Number(await preview.getAttribute('data-first-player-id'));
    const advancingIds = advancingRaw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
    expect(advancingIds).toHaveLength(2);
    expect(advancingIds).toContain(firstId);
    const secondId = advancingIds.find((id) => id !== firstId);
    expect(secondId).toBeDefined();
    if (secondId === undefined) {
      throw new Error(`Invalid data-advancing-ids "${advancingRaw}"`);
    }

    const firstSeat = seatMeta[firstId];
    const secondSeat = seatMeta[secondId];
    expect(firstSeat).toBeDefined();
    expect(secondSeat).toBeDefined();
    if (!firstSeat || !secondSeat) {
      throw new Error(`Unexpected advancing IDs: ${firstId}, ${secondId}`);
    }

    // By pigeonhole principle (2 AIs out of 3 players), at least 1 advancing Round 2 seat MUST be AI
    expect(firstSeat.isAI || secondSeat.isAI).toBe(true);

    await startPrisonMatchRound2(page);
    await expect(playerCardLocator(page, 0)).toContainText(firstSeat.name);
    await expect(playerCardLocator(page, 0)).toHaveAttribute('data-is-ai', String(firstSeat.isAI));
    await expect(playerCardLocator(page, 1)).toContainText(secondSeat.name);
    await expect(playerCardLocator(page, 1)).toHaveAttribute('data-is-ai', String(secondSeat.isAI));
    await expect(playerCardLocator(page, 2)).toHaveCount(0);
    await expect(page.getByTestId('wall-break-toggle')).toHaveCount(0);

    // Complete Round 2 placement and at least 2 play turns so carried-over AI acts cleanly
    for (let step = 0; step < 50; step += 1) {
      const state = await readGameScreenState(page);
      const wallsCount = await page.locator('[data-testid^="placed-wall-"]').count();
      if (state.phase === 'game_over' || wallsCount >= 2) {
        break;
      }
      const actorIsAi =
        (await playerCardLocator(page, state.currentPlayer).getAttribute('data-is-ai')) === 'true';
      if (actorIsAi) {
        await page.clock.runFor(600);
      } else if (state.phase === 'placement') {
        await placeFirstAvailableEmptyCell(page);
      } else {
        await playFirstLegalHumanTurn(page, state.currentPlayer);
      }
    }

    await expect(boardPiecesLocator(page)).toHaveCount(8);
    expect(await page.locator('[data-testid^="placed-wall-"]').count()).toBeGreaterThanOrEqual(1);
  });

  test('C09: Turn Timer Active x Undo/Redo resets timer cleanly on normal Undo/Redo and timeout Undo', async ({
    page,
  }) => {
    await openLobbyWithPausedClock(page, CLOCK_T0);
    await configureLobby(page, {
      variant: 'wallgo1',
      format: '3p',
      timerSeconds: 60,
      shuffleOrder: false,
    });
    await startGame(page);
    await completePlacement(page, SCRIPT_A1_PLACEMENTS);

    const timer = page.getByTestId('turn-timer');
    const game = page.getByTestId('game-screen');

    // P0 waits 15s (45s), plays Turn 1 -> P1 waits 42s (18s warning)
    await page.clock.runFor(15_000);
    await expect(timer).toHaveAttribute('data-seconds', '45');
    await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));

    await page.clock.runFor(42_000);
    await expect(timer).toHaveAttribute('data-seconds', '18');
    await expect(timer).toHaveAttribute('data-urgency', 'warning');

    // Undo Turn 1 -> resets P0 timer to 60s normal and ticks down to 56s
    await clickUndo(page);
    await expect(game).toHaveAttribute('data-current-player', '0');
    await expect(placedWallLocator(page, hWall(0, 0))).toHaveCount(0);
    await expect(timer).toHaveAttribute('data-seconds', '60');
    await expect(timer).toHaveAttribute('data-urgency', 'normal');
    await expect(timer).toHaveAttribute('data-paused', 'false');

    await page.clock.runFor(4_000);
    await expect(timer).toHaveAttribute('data-seconds', '56');

    // Redo Turn 1 -> restores h(0,0), resets P1 timer to 60s normal and ticks down to 54s
    await clickRedo(page);
    await expect(game).toHaveAttribute('data-current-player', '1');
    await expect(placedWallLocator(page, hWall(0, 0))).toBeVisible();
    await expect(timer).toHaveAttribute('data-seconds', '60');
    await expect(timer).toHaveAttribute('data-urgency', 'normal');

    await page.clock.runFor(6_000);
    await expect(timer).toHaveAttribute('data-seconds', '54');

    // Timeout P1 -> 2 walls on board + timeout toast -> Undo timeout restores P1 & resets timer to 60s
    await triggerCurrentTurnTimeout(page, 54);
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(2);
    await expect(page.getByTestId('game-toast')).toContainText(/시간 초과/);

    await clickUndo(page);
    await expect(game).toHaveAttribute('data-current-player', '1');
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(1);
    await expect(timer).toHaveAttribute('data-seconds', '60');
    await expect(timer).toHaveAttribute('data-urgency', 'normal');
    await expect(timer).toHaveAttribute('data-paused', 'false');
  });

  test('C10: Auto-Skip x Mixed Human + AI auto-skips sealed Human P0 while 2 AIs play autonomously to game_over', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await openLobbyWithPausedClock(page, CLOCK_T0);
    await configureLobby(page, {
      variant: 'wallgo1',
      format: '3p',
      timerSeconds: 0,
      shuffleOrder: false,
      seats: [
        { name: '인간유저', controller: 'human' },
        { name: '봇A', controller: 'ai-easy' },
        { name: '봇B', controller: 'ai-easy' },
      ],
    });
    await startGame(page);

    await placePiece(page, 0, 0);
    const step5 = await advancePausedClockUntilHumanTurnOrGameOver(page, {
      expectedPlayer: 0,
      expectedPhase: 'placement',
    });
    expect(step5).toBe('human_turn');
    await placeFirstAvailableEmptyCell(page, [
      { row: 0, col: 1 },
      { row: 1, col: 0 },
    ]);

    let observedAutoSkip = false;
    let observedSkipToast = false;
    let aiTurnsAfterSkip = 0;

    for (let step = 0; step < 200; step += 1) {
      const state = await readGameScreenState(page);
      const p0Skipped =
        (await playerCardLocator(page, 0).getAttribute('data-auto-skipped')) === 'true';

      if (p0Skipped) {
        if (!observedAutoSkip) {
          observedAutoSkip = true;
          await expect(playerCardLocator(page, 0)).toContainText('영역 확정');
          await expect(page.getByTestId('player-wallbreak-0')).toHaveAttribute(
            'data-remaining',
            '0',
          );
        }
        if (!observedSkipToast && (await page.getByTestId('game-toast').count()) > 0) {
          await expect(page.getByTestId('game-toast')).toHaveAttribute('role', 'alert');
          await expect(page.getByTestId('game-toast')).toContainText(/패스|영역/);
          observedSkipToast = true;
        }
      }

      if (state.phase === 'game_over') {
        break;
      }

      if (!state.aiThinking && state.currentPlayer === 0) {
        await playHumanSelfSealCornerTurn(page, 0);
      } else {
        const turnBefore = state.turnNumber;
        await page.clock.runFor(600);
        const after = await readGameScreenState(page);
        if (observedAutoSkip && after.turnNumber > turnBefore) {
          aiTurnsAfterSkip += 1;
        }
      }
    }

    expect(observedAutoSkip, 'Sealed Human P0 with wb=0 must enter auto-skipped state').toBe(true);
    expect(observedSkipToast, 'Auto-skip toast notice must appear').toBe(true);
    expect(aiTurnsAfterSkip, 'AIs must continue playing past auto-skipped Human').toBeGreaterThanOrEqual(
      1,
    );
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'game_over');
    await expect(page.getByTestId('result-modal')).toBeVisible();
  });

  test('C11: Turn Timer Active x Mixed Human + AI auto-pauses during placement and AI turns, resets on return to Human', async ({
    page,
  }) => {
    await openLobbyWithPausedClock(page, CLOCK_T0);
    await configureLobby(page, {
      variant: 'wallgo1',
      format: '3p',
      timerSeconds: 60,
      shuffleOrder: false,
      seats: [
        { controller: 'human' },
        { controller: 'ai-easy' },
        { controller: 'ai-easy' },
      ],
    });
    await startGame(page);

    const timer = page.getByTestId('turn-timer');
    await expect(timer).toHaveAttribute('data-paused', 'true');

    await placePiece(page, 2, 2);
    const step5 = await advancePausedClockUntilHumanTurnOrGameOver(page, {
      expectedPlayer: 0,
      expectedPhase: 'placement',
    });
    expect(step5).toBe('human_turn');
    await placeFirstAvailableEmptyCell(page, [{ row: 4, col: 4 }, { row: 0, col: 0 }]);

    // Human Turn 1: timer active and ticks 60 -> 46
    await expect(timer).toHaveAttribute('data-paused', 'false');
    await page.clock.runFor(14_000);
    await expect(timer).toHaveAttribute('data-seconds', '46');

    await playFirstLegalHumanTurn(page, 0);

    // AI P1 thinking: timer auto-paused!
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-ai-thinking', 'true');
    await expect(timer).toHaveAttribute('data-paused', 'true');

    // Advance paused clock until Human P0 Turn 2
    const turn2 = await advancePausedClockUntilHumanTurnOrGameOver(page, {
      expectedPlayer: 0,
      expectedPhase: 'select_piece',
    });
    expect(turn2).toBe('human_turn');

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-ai-thinking', 'false');
    await expect(timer).toHaveAttribute('data-paused', 'false');
    await expectTurnTimerReset(page, 60);

    const secBefore = Number(await timer.getAttribute('data-seconds'));
    await page.clock.runFor(5_000);
    await expect(timer).toHaveAttribute('data-seconds', String(secBefore - 5));
  });

  test('C12: Turn Timer Active x RulesModal Auto-Pause x Dynamic iPad Orientation Rotation', async ({
    page,
  }) => {
    const initialVp = page.viewportSize() ?? IPAD_VIEWPORTS.airLandscape;
    const rotatedVp =
      initialVp.width >= initialVp.height
        ? IPAD_VIEWPORTS.airPortrait
        : IPAD_VIEWPORTS.airLandscape;

    await openLobbyWithPausedClock(page, CLOCK_T0);
    await configureLobby(page, {
      variant: 'wallgo1',
      format: '3p',
      timerSeconds: 60,
      shuffleOrder: false,
    });
    await startGame(page);
    await completePlacement(page, DEFAULT_3P_PLACEMENTS);

    const timer = page.getByTestId('turn-timer');
    await page.clock.runFor(18_000);
    await expect(timer).toHaveAttribute('data-seconds', '42');

    // Open RulesModal -> auto-paused, zero overflow
    await openRulesModal(page);
    await expect(timer).toHaveAttribute('data-paused', 'true');
    await assertZeroOverflow(page, initialVp);
    await assertNoDuplicateVisibleTestIds(page);

    // Rotate viewport while RulesModal is open, switch tabs, advance 8s -> zero drift!
    await page.setViewportSize(rotatedVp);
    await switchRulesTab(page, 'wallgo2');
    await switchRulesTab(page, 'scoring');
    await page.clock.runFor(8_000);

    await assertZeroOverflow(page, rotatedVp);
    await assertNoDuplicateVisibleTestIds(page);
    await expect(timer).toHaveAttribute('data-seconds', '42');
    await expect(timer).toHaveAttribute('data-paused', 'true');

    // Escape closes RulesModal -> resumes timer & layout passes in rotated viewport
    await closeRulesModal(page, 'escape');
    await expect(timer).toHaveAttribute('data-paused', 'false');
    await expect(timer).toHaveAttribute('data-seconds', '42');
    await assertZeroOverflow(page, rotatedVp);
    await assertGameRegionsNoOverlap(page);

    await page.clock.runFor(5_000);
    await expect(timer).toHaveAttribute('data-seconds', '37');
  });

  test('C13: Lobby Preserved Config (all 6 non-default settings) x Dynamic Mid-Game Orientation Switch', async ({
    page,
  }) => {
    const initialVp = page.viewportSize() ?? IPAD_VIEWPORTS.airLandscape;
    const rotatedVp =
      initialVp.width >= initialVp.height
        ? IPAD_VIEWPORTS.airPortrait
        : IPAD_VIEWPORTS.airLandscape;

    await openLobby(page);
    await configureLobby(page, {
      variant: 'wallgo2',
      format: '2p',
      timerSeconds: 90,
      shuffleOrder: true,
      seats: [
        { name: '강지영', controller: 'human' },
        { name: '이세돌', controller: 'ai-normal' },
      ],
    });
    await startGame(page);

    // Rotate to opposite iPad orientation in-game
    await page.setViewportSize(rotatedVp);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-variant', 'wallgo2');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-format', '2p');
    await expect(page.getByTestId('turn-timer')).toHaveAttribute('data-seconds', '90');
    await assertZeroOverflow(page, rotatedVp);
    await assertGameRegionsNoOverlap(page);
    await assertNoDuplicateVisibleTestIds(page);

    // Return to Lobby in opposite orientation -> all 6 non-default settings preserved!
    await returnToLobby(page);
    await assertZeroOverflow(page, rotatedVp);
    await assertNoDuplicateVisibleTestIds(page);
    await expect(page.getByTestId('variant-wallgo2')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('format-2p')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('timer-90')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('shuffle-order-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('seat-row-2')).toHaveCount(0);
    await expect(page.getByTestId('seat-name-0')).toHaveValue('강지영');
    await expect(page.getByTestId('seat-name-1')).toHaveValue('이세돌');
    await expect(page.getByTestId('seat-controller-0-human')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('seat-controller-1-ai-normal')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('C14: Wall Go II 3P Piece-Kind Picker x iPad Portrait Single-DOM display:contents Geometry', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });

    const portraitViewports = [
      IPAD_VIEWPORTS.airPortrait,
      IPAD_VIEWPORTS.gen10Portrait,
      { width: 820, height: 820 },
    ] as const;

    for (const vp of portraitViewports) {
      await page.setViewportSize(vp);
      await assertZeroOverflow(page, vp);
      await assertGameRegionsNoOverlap(page);
      await assertNoDuplicateVisibleTestIds(page);

      const picker = page.getByTestId('piece-kind-picker');
      await expect(picker).toBeVisible();
      const pickerBox = await picker.boundingBox();
      const boardBox = await page.getByTestId('board-frame').boundingBox();
      expect(pickerBox, `piece-kind-picker boundingBox missing at ${vp.width}x${vp.height}`).not.toBeNull();
      expect(boardBox, `board-frame boundingBox missing at ${vp.width}x${vp.height}`).not.toBeNull();

      if (pickerBox && boardBox) {
        expect(pickerBox.width).toBeGreaterThan(0);
        expect(pickerBox.height).toBeGreaterThan(0);
        expect(pickerBox.x).toBeGreaterThanOrEqual(-0.5);
        expect(pickerBox.y).toBeGreaterThanOrEqual(-0.5);
        expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(vp.width + 0.5);
        expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(vp.height + 0.5);

        const overlapX = Math.max(
          0,
          Math.min(pickerBox.x + pickerBox.width, boardBox.x + boardBox.width) -
            Math.max(pickerBox.x, boardBox.x),
        );
        const overlapY = Math.max(
          0,
          Math.min(pickerBox.y + pickerBox.height, boardBox.y + boardBox.height) -
            Math.max(pickerBox.y, boardBox.y),
        );
        expect(
          overlapX > 0.5 && overlapY > 0.5,
          `piece-kind-picker overlaps board-frame at ${vp.width}x${vp.height} by ${overlapX.toFixed(1)}x${overlapY.toFixed(1)}px`,
        ).toBe(false);
      }
    }

    // Complete all 6 Wall Go II placements on iPad Air Portrait (820x1180)
    await page.setViewportSize(IPAD_VIEWPORTS.airPortrait);
    await completePlacement(page, SCRIPT_C_PLACEMENTS);
    await expect(page.getByTestId('piece-kind-picker')).toHaveCount(0);
    await assertZeroOverflow(page, IPAD_VIEWPORTS.airPortrait);
    await assertGameRegionsNoOverlap(page);
    await assertNoDuplicateVisibleTestIds(page);
  });
});
