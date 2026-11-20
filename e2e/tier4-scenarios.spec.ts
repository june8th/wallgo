import { expect, test } from '@playwright/test';
import {
  CLOCK_T0,
  SCRIPT_C_PLACEMENTS,
  SCRIPT_D_PLACEMENTS,
  SCRIPT_E_PLACEMENTS,
  assertWallBreakConservation,
  boardPiecesLocator,
  cancelTurnMove,
  cellLocator,
  clickRedo,
  clickUndo,
  closeRulesModal,
  completePlacement,
  configureLobby,
  expectTurnTimerReset,
  hWall,
  inspectBoardFromResult,
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
  readUsedWallBreaksCount,
  reopenResultModal,
  returnToLobby,
  selectCell,
  startConfiguredGame,
  startGame,
  startPrisonMatchRound2,
  switchRulesTab,
  territoryBadgeLocator,
  toggleTimerPause,
  toggleWallBreak,
  triggerCurrentTurnTimeout,
  vWall,
  waitForGameOver,
  waitForHumanTurnOrGameOver,
  wallSlotLocator,
} from './helpers/game.ts';
import {
  ALL_IPAD_VIEWPORTS,
  IPAD_VIEWPORTS,
  assertGameRegionsNoOverlap,
  assertInteractiveWallHitTargets,
  assertNoDuplicateVisibleTestIds,
  assertZeroOverflow,
} from './helpers/layout.ts';
import { attachRuntimeErrorGuard, type RuntimeErrorGuard } from './helpers/network.ts';
import {
  complete2PWallGo2Turns1To4,
  complete2PWallGo2Turns5To8,
  completeRound2WallGo1ToGameOver,
  run3PWallGo2CompletionFromStartedGame,
} from './helpers/scripts.ts';

test.describe('Tier 4 — Real-World Tabletop End-User Scenarios', { tag: '@tier4' }, () => {
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

  test('S01: Full Devils Plan Season 2 tabletop night (3 Humans, Wall Go I Round 1 -> Round 2 1:1 Prison Match -> Completion)', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await openLobby(page);
    await assertZeroOverflow(page);

    await configureLobby(page, {
      variant: 'wallgo1',
      format: '3p',
      timerSeconds: 0,
      shuffleOrder: false,
      seats: [{ name: '하석진' }, { name: '궤도' }, { name: '오현민' }],
    });

    // Review Season 2 & Prison Match rules before launching
    await openRulesModal(page);
    await switchRulesTab(page, 'wallgo1');
    await switchRulesTab(page, 'scoring');
    await closeRulesModal(page, 'button');

    await startGame(page);
    await assertZeroOverflow(page);
    await assertGameRegionsNoOverlap(page);
    await assertNoDuplicateVisibleTestIds(page);

    // Round 1 (3P Wall Go I) via Script D with mid-Turn 4 cancel-move-button check
    await completePlacement(page, SCRIPT_D_PLACEMENTS);
    await playHumanTurn(page, { row: 1, col: 0 }, { row: 1, col: 0 }, hWall(0, 0));
    await playHumanTurn(page, { row: 5, col: 0 }, { row: 5, col: 0 }, hWall(4, 0));
    await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, hWall(0, 1));

    // Turn 4 (P0): move (5,2)->(5,3), cancel back to (5,2), then stay & place v(5,1)
    await selectCell(page, 5, 2);
    await moveSelectedTo(page, 5, 3);
    await cancelTurnMove(page);
    await expect(cellLocator(page, 5, 2)).toHaveAttribute('data-occupied-by', '0');
    await moveSelectedTo(page, 5, 2);
    await placeWallAt(page, vWall(5, 1));

    await playHumanTurn(page, { row: 5, col: 1 }, { row: 5, col: 1 }, hWall(4, 1));
    await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, vWall(0, 1));
    await playHumanTurn(page, { row: 5, col: 2 }, { row: 6, col: 2 }, vWall(6, 1));
    await waitForGameOver(page, 10_000);

    // Round 1 ResultModal assertions
    await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-rank', '1');
    await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-total-cells', '43');
    await expect(page.getByTestId('result-rank-row-0')).toContainText('하석진');
    await expect(page.getByTestId('result-rank-row-0')).toContainText('43칸');
    await expect(page.getByTestId('result-rank-row-0')).toContainText('생존');

    await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-rank', '2');
    await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-total-cells', '4');
    await expect(page.getByTestId('result-rank-row-1')).toContainText('궤도');
    await expect(page.getByTestId('result-rank-row-1')).toContainText('4칸');
    await expect(page.getByTestId('result-rank-row-1')).toContainText('2라운드 진출');

    await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-rank', '3');
    await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-total-cells', '2');
    await expect(page.getByTestId('result-rank-row-2')).toContainText('오현민');
    await expect(page.getByTestId('result-rank-row-2')).toContainText('2칸');
    await expect(page.getByTestId('result-rank-row-2')).toContainText('2라운드 진출');

    await expect(page.getByTestId('round2-preview')).toHaveAttribute('data-first-player-id', '1');

    // Inspect Round 1 board, reopen result modal, and transition directly to Round 2 (1:1)
    await inspectBoardFromResult(page);
    await reopenResultModal(page);
    await startPrisonMatchRound2(page);

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-format', '2p');
    await expect(game).toHaveAttribute('data-round', '2');
    await expect(page.getByTestId('game-topbar')).toContainText('감옥매치 2라운드');
    await expect(playerCardLocator(page, 0)).toContainText('궤도');
    await expect(playerCardLocator(page, 1)).toContainText('오현민');
    await expect(page.getByTestId('wall-break-toggle')).toHaveCount(0);
    await expect(boardPiecesLocator(page)).toHaveCount(4);

    await assertZeroOverflow(page);
    await assertGameRegionsNoOverlap(page);
    await assertNoDuplicateVisibleTestIds(page);

    // Complete Round 2 (1:1) all the way to final ResultModal
    await completeRound2WallGo1ToGameOver(page);

    await expect(page.getByTestId('start-round2-button')).toHaveCount(0);
    await expect(page.getByTestId('round2-preview')).toHaveCount(0);
    await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-rank', '1');
    await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-total-cells', '41');
    await expect(page.getByTestId('result-rank-row-0')).toContainText('궤도');
    await expect(page.getByTestId('result-rank-row-0')).toContainText('41칸');
    await expect(page.getByTestId('result-rank-row-0')).toContainText('최대 단일 41칸');

    await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-rank', '2');
    await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-total-cells', '8');
    await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-largest-area', '4');
    await expect(page.getByTestId('result-rank-row-1')).toContainText('오현민');
    await expect(page.getByTestId('result-rank-row-1')).toContainText('8칸');
    await expect(page.getByTestId('result-rank-row-1')).toContainText('최대 단일 4칸');

    await page.getByTestId('result-lobby-button').click();
    await expect(page.getByTestId('lobby-screen')).toBeVisible();
  });

  test('S02: Full Devils Plan Season 3 Wall Go II 3P match with rules SVG, ambiguous diagonal break, Undo/Redo and full completion', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await openLobby(page);
    await configureLobby(page, {
      variant: 'wallgo2',
      format: '3p',
      timerSeconds: 0,
      shuffleOrder: false,
      seats: [{ name: '세븐하이' }, { name: '저스틴' }, { name: '정현규' }],
    });

    // Open RulesModal -> auto-selects Wall Go II tab with inline SVG movement diagrams
    await openRulesModal(page);
    await expect(page.getByTestId('rules-tab-wallgo2')).toHaveAttribute('aria-selected', 'true');
    expect(await page.getByTestId('rules-modal').locator('svg').count()).toBeGreaterThanOrEqual(1);
    await closeRulesModal(page, 'backdrop');

    await startGame(page);
    await assertZeroOverflow(page);
    await assertGameRegionsNoOverlap(page);

    // Execute Script C setup (Turns 1-5)
    await completePlacement(page, SCRIPT_C_PLACEMENTS);
    await playHumanTurn(page, { row: 2, col: 4 }, { row: 3, col: 4 }, vWall(3, 3));
    await playHumanTurn(page, { row: 4, col: 2 }, { row: 4, col: 3 }, hWall(3, 3));
    await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 4 }, hWall(5, 4));
    await playHumanTurn(page, { row: 3, col: 4 }, { row: 3, col: 6 }, hWall(2, 6));
    await playHumanTurn(page, { row: 4, col: 3 }, { row: 4, col: 1 }, vWall(4, 0));

    // Turn 6 (P2 '정현규' round @(3,3)): ambiguous diagonal -> verify >=48px targets -> cancel -> confirm v(3,3) + h(4,4)
    const turnBeforeT6 = (await readGameScreenState(page)).turnNumber;
    await selectCell(page, 3, 3);
    await toggleWallBreak(page, true);
    await cellLocator(page, 4, 4).click();

    await expect(page.getByTestId('game-screen')).toHaveAttribute(
      'data-phase-substate',
      'choose_break_wall',
    );
    await assertInteractiveWallHitTargets(page);
    await cancelTurnMove(page);

    await toggleWallBreak(page, true);
    await cellLocator(page, 4, 4).click();
    await wallSlotLocator(page, vWall(3, 3)).click();
    await expect(placedWallLocator(page, vWall(3, 3))).toHaveCount(0);
    await expect(placedWallLocator(page, hWall(3, 3))).toBeVisible();
    await placeWallAt(page, hWall(4, 4));

    // Exercise Undo + Redo on Turn 6
    await clickUndo(page);
    await expect(page.getByTestId('game-screen')).toHaveAttribute(
      'data-turn-number',
      String(turnBeforeT6),
    );
    await expect(placedWallLocator(page, vWall(3, 3))).toBeVisible();
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '2');

    await clickRedo(page);
    await expect(page.getByTestId('game-screen')).toHaveAttribute(
      'data-turn-number',
      String(turnBeforeT6 + 1),
    );
    await expect(placedWallLocator(page, vWall(3, 3))).toHaveCount(0);
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-occupied-by', '2');

    // Return to Lobby -> verify Wall Go II & custom names preserved -> launch fresh match and complete Script D2
    await returnToLobby(page);
    await expect(page.getByTestId('variant-wallgo2')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('seat-name-0')).toHaveValue('세븐하이');
    await expect(page.getByTestId('seat-name-1')).toHaveValue('저스틴');
    await expect(page.getByTestId('seat-name-2')).toHaveValue('정현규');

    await startGame(page);
    await run3PWallGo2CompletionFromStartedGame(page);

    await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-total-cells', '43');
    await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-total-cells', '4');
    await expect(page.getByTestId('result-rank-row-2')).toHaveAttribute('data-total-cells', '2');
    await expect(page.getByTestId('start-round2-button')).toBeVisible();

    await inspectBoardFromResult(page);
    await expect(page.getByTestId('reopen-result-button')).toBeVisible();
    await expect(page.locator('[data-territory-badge="true"]')).toHaveCount(3);
  });

  test('S03: Standalone 2P Wall Go II duel with Undo/Redo, full completion, Rematch and preserved Lobby return', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await openLobby(page);
    await configureLobby(page, {
      variant: 'wallgo2',
      format: '2p',
      timerSeconds: 0,
      shuffleOrder: false,
      seats: [{ name: '이세돌' }, { name: '홍진호' }],
    });
    await startGame(page);

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-variant', 'wallgo2');
    await expect(game).toHaveAttribute('data-format', '2p');
    await expect(game).toHaveAttribute('data-round', '1');
    await expect(page.getByTestId('piece-kind-picker')).toHaveCount(0);
    await expect(page.getByTestId('wall-break-toggle')).toHaveCount(0);
    await assertZeroOverflow(page);
    await assertGameRegionsNoOverlap(page);

    // Turns 1-4 seal NE 2x2 {(0,5),(0,6),(1,5),(1,6)} = 4 cells for P1 ('홍진호')
    await complete2PWallGo2Turns1To4(page);
    await expect(page.getByTestId('player-score-1')).toHaveAttribute('data-value', '4');
    await expect(territoryBadgeLocator(page, 0, 5)).toHaveAttribute('data-owner', '1');
    await expect(territoryBadgeLocator(page, 0, 5)).toHaveAttribute('data-count', '4');

    // Undo removes Turn 4 wall h(1,5) -> score drops 4 -> 0; Redo restores 0 -> 4
    await clickUndo(page);
    await expect(placedWallLocator(page, hWall(1, 5))).toHaveCount(0);
    await expect(territoryBadgeLocator(page, 0, 5)).toHaveCount(0);
    await expect(page.getByTestId('player-score-1')).toHaveAttribute('data-value', '0');

    await clickRedo(page);
    await expect(placedWallLocator(page, hWall(1, 5))).toBeVisible();
    await expect(territoryBadgeLocator(page, 0, 5)).toHaveAttribute('data-count', '4');
    await expect(page.getByTestId('player-score-1')).toHaveAttribute('data-value', '4');

    // Finish Turns 5-8 to game_over
    await complete2PWallGo2Turns5To8(page);

    await expect(page.getByTestId('start-round2-button')).toHaveCount(0);
    await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-rank', '1');
    await expect(page.getByTestId('result-rank-row-0')).toHaveAttribute('data-total-cells', '41');
    await expect(page.getByTestId('result-rank-row-0')).toContainText('이세돌');
    await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-rank', '2');
    await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-total-cells', '8');
    await expect(page.getByTestId('result-rank-row-1')).toHaveAttribute('data-largest-area', '4');
    await expect(page.getByTestId('result-rank-row-1')).toContainText('홍진호');
    await expect(page.getByTestId('result-rank-row-1')).toContainText('최대 단일 4칸');

    // Rematch resets cleanly to Standalone 2P Round 1 with 4 fixed round pieces
    await page.getByTestId('rematch-button').click();
    await expect(page.getByTestId('result-modal')).toHaveCount(0);
    await expect(game).toHaveAttribute('data-round', '1');
    await expect(game).toHaveAttribute('data-phase', 'placement');
    await expect(boardPiecesLocator(page)).toHaveCount(4);
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(0);
    for (const [r, c] of [
      [1, 1],
      [5, 5],
      [1, 5],
      [5, 1],
    ] as const) {
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-piece-kind', 'round');
    }

    // Return to Lobby preserves wallgo2, 2p and both player names
    await returnToLobby(page);
    await expect(page.getByTestId('variant-wallgo2')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('format-2p')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('seat-name-0')).toHaveValue('이세돌');
    await expect(page.getByTestId('seat-name-1')).toHaveValue('홍진호');
  });

  test('S04: Solo player vs 2 AI bots (Normal + Hard) with Smart Undo across AI turns (real wall-clock time, NO page.clock)', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // STRICTLY NO page.clock so Hard AI runs under genuine performance.now() 150ms deadline cap
    await startConfiguredGame(page, {
      variant: 'wallgo1',
      format: '3p',
      timerSeconds: 0,
      shuffleOrder: false,
      seats: [
        { name: '솔로유저', controller: 'human' },
        { name: '보통봇', controller: 'ai-normal' },
        { name: '어려움봇', controller: 'ai-hard' },
      ],
    });

    await assertZeroOverflow(page);
    await assertGameRegionsNoOverlap(page);

    await expect(playerCardLocator(page, 0)).toContainText('솔로유저');
    await expect(playerCardLocator(page, 0)).toHaveAttribute('data-is-ai', 'false');
    await expect(playerCardLocator(page, 1)).toContainText('보통봇');
    await expect(playerCardLocator(page, 1)).toHaveAttribute('data-is-ai', 'true');
    await expect(playerCardLocator(page, 2)).toContainText('어려움봇');
    await expect(playerCardLocator(page, 2)).toHaveAttribute('data-is-ai', 'true');

    // Placement
    await placePiece(page, 2, 2);
    const step5 = await waitForHumanTurnOrGameOver(page, {
      expectedPlayer: 0,
      expectedPhase: 'placement',
      timeout: 25_000,
    });
    expect(step5).toBe('human_turn');
    await placeFirstAvailableEmptyCell(page, [{ row: 4, col: 4 }, { row: 0, col: 0 }]);

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-phase', 'select_piece');
    await expect(boardPiecesLocator(page)).toHaveCount(6);

    // Round 1: Human + Normal AI + Hard AI -> exact 3-turn conservation
    const turnBeforeR1 = (await readGameScreenState(page)).turnNumber;
    await playFirstLegalHumanTurn(page, 0);
    const afterR1 = await waitForHumanTurnOrGameOver(page, {
      expectedPlayer: 0,
      timeout: 30_000,
    });
    expect(afterR1).toBe('human_turn');

    const r1Stats = await assertWallBreakConservation(page, {
      turnBefore: turnBeforeR1,
      expectedTurnDelta: 3,
      wallsBefore: 0,
      usedBreaksBefore: 0,
    });
    await expect(boardPiecesLocator(page)).toHaveCount(6);

    // Smart Undo across BOTH Normal + Hard AI replies -> returns to Turn 1 start
    await clickUndo(page);
    await expect(game).toHaveAttribute('data-turn-number', String(turnBeforeR1));
    await expect(game).toHaveAttribute('data-current-player', '0');
    await expect(game).toHaveAttribute('data-ai-thinking', 'false');
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(0);

    // Smart Redo restores Round 1 cleanly
    await clickRedo(page);
    const afterRedo = await waitForHumanTurnOrGameOver(page, {
      expectedPlayer: 0,
      timeout: 25_000,
    });
    expect(afterRedo).toBe('human_turn');
    await expect(game).toHaveAttribute('data-turn-number', String(turnBeforeR1 + 3));
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(r1Stats.wallsNow);

    // Play 2 more consecutive Human + 2-AI rounds (3 total rounds; exit gracefully if game_over)
    for (let round = 2; round <= 3; round += 1) {
      const pre = await readGameScreenState(page);
      if (pre.phase === 'game_over') {
        break;
      }
      const wallsBefore = await page.locator('[data-testid^="placed-wall-"]').count();
      const usedBreaksBefore = await readUsedWallBreaksCount(page);

      await playFirstLegalHumanTurn(page, 0);
      const outcome = await waitForHumanTurnOrGameOver(page, {
        expectedPlayer: 0,
        timeout: 30_000,
      });

      const post = await readGameScreenState(page);
      expect(post.turnNumber).toBeGreaterThan(pre.turnNumber);
      await assertWallBreakConservation(page, {
        turnBefore: pre.turnNumber,
        expectedTurnDelta: post.turnNumber - pre.turnNumber,
        wallsBefore,
        usedBreaksBefore,
      });
      await expect(boardPiecesLocator(page)).toHaveCount(6);

      if (outcome === 'game_over') {
        break;
      }
    }

    // Open/close RulesModal and return to Lobby verifying preserved Solo + AI config
    await openRulesModal(page);
    await closeRulesModal(page, 'escape');
    await returnToLobby(page);
    await expect(page.getByTestId('seat-name-0')).toHaveValue('솔로유저');
    await expect(page.getByTestId('seat-controller-1-ai-normal')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('seat-controller-2-ai-hard')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('S05: Competitive timed 3P match (60s) with manual pause, Rules auto-pause, P2 Auto-Skip and Timeout auto-action', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await openLobbyWithPausedClock(page, CLOCK_T0);
    await configureLobby(page, {
      variant: 'wallgo1',
      format: '3p',
      timerSeconds: 60,
      shuffleOrder: false,
      seats: [{ name: '도전자A' }, { name: '도전자B' }, { name: '도전자C' }],
    });
    await startGame(page);

    const timer = page.getByTestId('turn-timer');
    const game = page.getByTestId('game-screen');

    // Placement auto-pauses timer
    await expect(timer).toHaveAttribute('data-paused', 'true');
    await completePlacement(page, SCRIPT_E_PLACEMENTS);
    await expect(timer).toHaveAttribute('data-paused', 'false');

    // Turn 1 (P0): tick 10s -> manual pause 5s (zero drift) -> resume -> play Turn 1
    await page.clock.runFor(10_000);
    await expect(timer).toHaveAttribute('data-seconds', '50');
    await toggleTimerPause(page, true);
    await page.clock.runFor(5_000);
    await expect(timer).toHaveAttribute('data-seconds', '50');
    await toggleTimerPause(page, false);
    await playHumanTurn(page, { row: 1, col: 0 }, { row: 1, col: 0 }, hWall(0, 0));

    // Turn 2 (P1): tick 41s (19s warning) -> RulesModal auto-pause 6s (zero drift) -> close -> play Turn 2
    await page.clock.runFor(41_000);
    await expect(timer).toHaveAttribute('data-seconds', '19');
    await expect(timer).toHaveAttribute('data-urgency', 'warning');
    await openRulesModal(page);
    await expect(timer).toHaveAttribute('data-paused', 'true');
    await page.clock.runFor(6_000);
    await expect(timer).toHaveAttribute('data-seconds', '19');
    await closeRulesModal(page, 'button');
    await expect(timer).toHaveAttribute('data-paused', 'false');
    await playHumanTurn(page, { row: 5, col: 5 }, { row: 5, col: 5 }, hWall(5, 5));

    // Turns 3-8 complete Script E -> triggers P2 Auto-Skip!
    await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, hWall(0, 1));
    await playHumanTurn(page, { row: 1, col: 0 }, { row: 2, col: 0 }, hWall(2, 0));
    await playHumanTurn(page, { row: 3, col: 5 }, { row: 3, col: 5 }, hWall(3, 5));
    await playWallGo1BreakTurn(
      page,
      { row: 0, col: 0 },
      hWall(0, 0),
      { row: 0, col: 0 },
      hWall(0, 0),
    );
    await playHumanTurn(page, { row: 1, col: 2 }, { row: 0, col: 2 }, vWall(0, 1));
    await playHumanTurn(page, { row: 5, col: 5 }, { row: 5, col: 5 }, vWall(5, 5));

    // P2 Auto-Skipped -> turn wraps directly to P0 + skip toast appears & auto-dismisses after 3.5s
    await expect(game).toHaveAttribute('data-current-player', '0');
    await expect(playerCardLocator(page, 2)).toHaveAttribute('data-auto-skipped', 'true');
    await expect(playerCardLocator(page, 2)).toContainText('영역 확정');
    await expect(page.getByTestId('game-toast')).toBeVisible();
    await expect(page.getByTestId('game-toast')).toContainText(/패스|영역/);

    await page.clock.runFor(3_500);
    await expect(page.getByTestId('game-toast')).toHaveCount(0);

    // Turn 9 (P0): let remaining timer expire -> Timeout Auto-Action + timeout toast + auto-dismiss
    const turnBeforeTimeout = (await readGameScreenState(page)).turnNumber;
    const remainingSec = Number(await timer.getAttribute('data-seconds'));
    await triggerCurrentTurnTimeout(page, remainingSec);

    await expect(game).toHaveAttribute('data-turn-number', String(turnBeforeTimeout + 1));
    await expect(game).toHaveAttribute('data-current-player', '1');
    await expectTurnTimerReset(page, 60);
    await expect(page.getByTestId('game-toast')).toBeVisible();
    await expect(page.getByTestId('game-toast')).toContainText(/시간 초과/);

    await page.clock.runFor(3_500);
    await expect(page.getByTestId('game-toast')).toHaveCount(0);

    await assertZeroOverflow(page);
    await assertGameRegionsNoOverlap(page);
  });

  test('S06: All-AI 3P spectator demo (Easy + Normal + Hard) playing autonomously to ResultModal and board inspection (real wall-clock time, NO page.clock)', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // STRICTLY NO page.clock so Hard AI runs under genuine real-time deadline cap
    await startConfiguredGame(page, {
      variant: 'wallgo1',
      format: '3p',
      timerSeconds: 0,
      shuffleOrder: false,
      seats: [
        { name: '이지봇', controller: 'ai-easy' },
        { name: '노멀봇', controller: 'ai-normal' },
        { name: '하드봇', controller: 'ai-hard' },
      ],
    });

    for (const id of [0, 1, 2] as const) {
      await expect(playerCardLocator(page, id)).toHaveAttribute('data-is-ai', 'true');
    }
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-ai-thinking', 'true');
    await expect(page.getByTestId('turn-banner')).toContainText(/생각 중/);
    await assertZeroOverflow(page);
    await assertGameRegionsNoOverlap(page);

    // Wait autonomously for all-AI game completion
    await waitForGameOver(page, 100_000);

    // Non-tautological competition ranking & score sanity invariants
    const rows: { id: number; rank: number; total: number; largest: number }[] = [];
    for (const id of [0, 1, 2] as const) {
      const row = page.getByTestId(`result-rank-row-${id}`);
      await expect(row).toBeVisible();
      const rank = Number(await row.getAttribute('data-rank'));
      const total = Number(await row.getAttribute('data-total-cells'));
      const largest = Number(await row.getAttribute('data-largest-area'));
      expect([1, 2, 3]).toContain(rank);
      expect(largest).toBeGreaterThanOrEqual(0);
      expect(largest).toBeLessThanOrEqual(total);
      rows.push({ id, rank, total, largest });
    }

    const totalSum = rows.reduce((sum, r) => sum + r.total, 0);
    expect(totalSum, 'Total claimed cells across 3 players must lie in [6, 49]').toBeGreaterThanOrEqual(
      6,
    );
    expect(totalSum).toBeLessThanOrEqual(49);

    // Verify exact competition ranking matches descending (total, largest)
    const sorted = [...rows].sort((a, b) =>
      b.total !== a.total ? b.total - a.total : b.largest - a.largest,
    );
    let expectedRank = 1;
    for (let i = 0; i < sorted.length; i += 1) {
      const curr = sorted[i];
      const prev = i > 0 ? sorted[i - 1] : undefined;
      if (curr && prev && (curr.total !== prev.total || curr.largest !== prev.largest)) {
        expectedRank = i + 1;
      }
      if (curr) {
        expect(curr.rank, `Player ${curr.id} rank mismatch`).toBe(expectedRank);
      }
    }

    const preview = page.getByTestId('round2-preview');
    await expect(preview).toBeVisible();
    const advancingIds = ((await preview.getAttribute('data-advancing-ids')) ?? '')
      .split(',')
      .map((s) => Number(s.trim()));
    const firstPlayerId = Number(await preview.getAttribute('data-first-player-id'));
    expect(advancingIds).toHaveLength(2);
    expect(new Set(advancingIds).size).toBe(2);
    for (const id of advancingIds) {
      expect([0, 1, 2]).toContain(id);
    }
    expect(advancingIds).toContain(firstPlayerId);

    // Board inspection & clean return to Lobby
    await inspectBoardFromResult(page);
    await expect(page.getByTestId('reopen-result-button')).toBeVisible();
    await expect(boardPiecesLocator(page)).toHaveCount(6);
    expect(await page.locator('[data-testid^="placed-wall-"]').count()).toBeGreaterThanOrEqual(4);
    await assertZeroOverflow(page);
    await assertGameRegionsNoOverlap(page);
    await assertNoDuplicateVisibleTestIds(page);

    await reopenResultModal(page);
    await page.getByTestId('result-lobby-button').click();
    await expect(page.getByTestId('lobby-screen')).toBeVisible();
  });

  test('S07: Multi-orientation iPad tabletop tour (all 4 iPad viewports) across Lobby, placement, select_piece, place_wall, ResultModal and Round 2', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // 1. Lobby sweep across all 4 official iPad viewports
    await openLobby(page);
    for (const [, vp] of ALL_IPAD_VIEWPORTS) {
      await page.setViewportSize(vp);
      await assertZeroOverflow(page, vp);
      await assertNoDuplicateVisibleTestIds(page);
    }

    await configureLobby(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await startGame(page);

    // 2. Mid-placement sweep (after step 1)
    await placePiece(page, SCRIPT_D_PLACEMENTS[0]!.row, SCRIPT_D_PLACEMENTS[0]!.col);
    for (const [, vp] of ALL_IPAD_VIEWPORTS) {
      await page.setViewportSize(vp);
      await assertZeroOverflow(page, vp);
      await assertGameRegionsNoOverlap(page);
      await assertNoDuplicateVisibleTestIds(page);
    }

    // Complete remaining 5 placements -> select_piece sweep
    for (let i = 1; i < SCRIPT_D_PLACEMENTS.length; i += 1) {
      const step = SCRIPT_D_PLACEMENTS[i]!;
      await placePiece(page, step.row, step.col);
    }
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');

    for (const [, vp] of ALL_IPAD_VIEWPORTS) {
      await page.setViewportSize(vp);
      await assertZeroOverflow(page, vp);
      await assertGameRegionsNoOverlap(page);
      await assertNoDuplicateVisibleTestIds(page);
    }

    // 3. Play Script D Turns 1-6; on Turn 7 enter place_wall and sweep all 4 iPad viewports verifying >=48x48px wall targets!
    await playHumanTurn(page, { row: 1, col: 0 }, { row: 1, col: 0 }, hWall(0, 0));
    await playHumanTurn(page, { row: 5, col: 0 }, { row: 5, col: 0 }, hWall(4, 0));
    await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, hWall(0, 1));
    await playHumanTurn(page, { row: 5, col: 2 }, { row: 5, col: 2 }, vWall(5, 1));
    await playHumanTurn(page, { row: 5, col: 1 }, { row: 5, col: 1 }, hWall(4, 1));
    await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, vWall(0, 1));

    await selectCell(page, 5, 2);
    await moveSelectedTo(page, 6, 2);

    for (const [, vp] of ALL_IPAD_VIEWPORTS) {
      await page.setViewportSize(vp);
      await assertZeroOverflow(page, vp);
      await assertGameRegionsNoOverlap(page);
      await assertInteractiveWallHitTargets(page);
      await assertNoDuplicateVisibleTestIds(page);
    }

    // 4. Place final wall v(6,1) -> ResultModal sweep across all 4 viewports (strictly inside bounds)
    await placeWallAt(page, vWall(6, 1));
    await waitForGameOver(page, 10_000);

    for (const [label, vp] of ALL_IPAD_VIEWPORTS) {
      await page.setViewportSize(vp);
      await assertZeroOverflow(page, vp);
      await assertNoDuplicateVisibleTestIds(page);

      const modalBox = await page.getByTestId('result-modal').boundingBox();
      expect(modalBox, `result-modal boundingBox missing on ${label}`).not.toBeNull();
      if (modalBox) {
        expect(modalBox.x, `result-modal clipped left on ${label}`).toBeGreaterThanOrEqual(-0.5);
        expect(modalBox.y, `result-modal clipped top on ${label}`).toBeGreaterThanOrEqual(-0.5);
        expect(
          modalBox.x + modalBox.width,
          `result-modal clipped right on ${label}`,
        ).toBeLessThanOrEqual(vp.width + 0.5);
        expect(
          modalBox.y + modalBox.height,
          `result-modal clipped bottom on ${label}`,
        ).toBeLessThanOrEqual(vp.height + 0.5);
      }
    }

    // 5. Inspect board -> reopen -> Round 2 layout audit on primary landscape + portrait
    await inspectBoardFromResult(page);
    await reopenResultModal(page);
    await startPrisonMatchRound2(page);

    for (const vp of [IPAD_VIEWPORTS.airLandscape, IPAD_VIEWPORTS.airPortrait] as const) {
      await page.setViewportSize(vp);
      await assertZeroOverflow(page, vp);
      await assertGameRegionsNoOverlap(page);
      await assertNoDuplicateVisibleTestIds(page);
    }
  });
});
