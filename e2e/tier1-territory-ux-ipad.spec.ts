import { expect, test, type Page } from '@playwright/test';
import {
  CLOCK_T0,
  SCRIPT_A1_PLACEMENTS,
  boardPiecesLocator,
  cellLocator,
  clickRedo,
  clickUndo,
  closeRulesModal,
  completePlacement,
  configureLobby,
  hWall,
  inspectBoardFromResult,
  openLobby,
  openLobbyWithPausedClock,
  openRulesModal,
  placeFirstAvailableEmptyCell,
  placePiece,
  placedWallLocator,
  playFirstLegalHumanTurn,
  playHumanTurn,
  playerCardLocator,
  readGameScreenState,
  reopenResultModal,
  runScriptA1,
  runScriptA2,
  runScriptA3,
  runScriptD,
  runScriptE,
  selectCell,
  startConfiguredGame,
  startGame,
  startPrisonMatchRound2,
  switchRulesTab,
  territoryBadgeLocator,
  toggleTimerPause,
  vWall,
  waitForHumanTurnOrGameOver,
} from './helpers/game.ts';
import {
  IPAD_VIEWPORTS,
  PROJECT_EXPECTED_VIEWPORTS,
  assertGameRegionsNoOverlap,
  assertInteractiveWallHitTargets,
  assertNoDuplicateVisibleTestIds,
  assertZeroOverflow,
} from './helpers/layout.ts';
import { attachRuntimeErrorGuard, type RuntimeErrorGuard } from './helpers/network.ts';

/**
 * Verifies exact Wall Go 3P conservation law across 3 turns starting from 0 walls
 * and full (1,1,1) wall-break charges: `turnNumber === turnBefore + 3`,
 * `placedWalls >= 1`, and `placedWalls + usedWallBreaks === 3`.
 */
async function assertThreeTurnWallBreakConservation(
  page: Page,
  turnBefore: number,
): Promise<void> {
  await expect(page.getByTestId('game-screen')).toHaveAttribute(
    'data-turn-number',
    String(turnBefore + 3),
  );

  const placedWalls = await page.locator('[data-testid^="placed-wall-"]').count();
  let wbTotal = 0;
  for (const id of [0, 1, 2] as const) {
    const remaining = Number(
      await page.getByTestId(`player-wallbreak-${id}`).getAttribute('data-remaining'),
    );
    expect([0, 1], `player-wallbreak-${id} data-remaining must be 0 or 1`).toContain(remaining);
    wbTotal += remaining;
  }

  const usedBreaks = 3 - wbTotal;
  expect(
    placedWalls,
    'At least 1 wall must remain on the board after 3 completed 3P turns',
  ).toBeGreaterThanOrEqual(1);
  expect(
    placedWalls + usedBreaks,
    `Wall Go conservation law violated: placedWalls (${placedWalls}) + usedBreaks (${usedBreaks}) !== 3`,
  ).toBe(3);
}

test.describe(
  'Tier 1 — Territory, Round 2, Undo/Redo, Rules, Timer, AI & iPad Ergonomics',
  { tag: '@tier1' },
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

    test('T1-41: Live 1-cell corner territory seal updates shading, badge and score cards', async ({
      page,
    }) => {
      await runScriptA1(page);

      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', '0');
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-size', '1');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-territory-owner', 'none');
      await expect(cellLocator(page, 1, 0)).toHaveAttribute('data-territory-owner', 'none');

      const badge = territoryBadgeLocator(page, 0, 0);
      await expect(badge).toBeVisible();
      await expect(badge).toHaveAttribute('data-territory-badge', 'true');
      await expect(badge).toHaveAttribute('data-owner', '0');
      await expect(badge).toHaveAttribute('data-count', '1');

      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '1');
      await expect(page.getByTestId('player-score-0')).toContainText('1칸');
      await expect(page.getByTestId('player-largest-0')).toHaveAttribute('data-value', '1');
      await expect(page.getByTestId('player-largest-0')).toContainText('최대 1');
      await expect(page.getByTestId('player-score-1')).toHaveAttribute('data-value', '0');
      await expect(page.getByTestId('player-score-2')).toHaveAttribute('data-value', '0');

      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
    });

    test('T1-42: Multi-cell secured component shades empty cells and anchors single badge on top-left cell', async ({
      page,
    }) => {
      await runScriptA2(page);

      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-owner', '0');
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-territory-size', '2');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-occupied-by', 'none');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-territory-owner', '0');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-territory-size', '2');

      const anchorBadge = territoryBadgeLocator(page, 0, 0);
      await expect(anchorBadge).toBeVisible();
      await expect(anchorBadge).toHaveAttribute('data-owner', '0');
      await expect(anchorBadge).toHaveAttribute('data-count', '2');
      await expect(territoryBadgeLocator(page, 0, 1)).toHaveCount(0);

      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '2');
      await expect(page.getByTestId('player-largest-0')).toHaveAttribute('data-value', '2');
    });

    test('T1-43: Two disjoint secured regions sum totalTerritory while largestSingleTerritory tracks max', async ({
      page,
    }) => {
      await runScriptA3(page);

      const badge1 = territoryBadgeLocator(page, 0, 0);
      await expect(badge1).toBeVisible();
      await expect(badge1).toHaveAttribute('data-owner', '0');
      await expect(badge1).toHaveAttribute('data-count', '1');

      const badge2 = territoryBadgeLocator(page, 6, 5);
      await expect(badge2).toBeVisible();
      await expect(badge2).toHaveAttribute('data-owner', '0');
      await expect(badge2).toHaveAttribute('data-count', '2');

      await expect(cellLocator(page, 6, 6)).toHaveAttribute('data-occupied-by', 'none');
      await expect(cellLocator(page, 6, 6)).toHaveAttribute('data-territory-owner', '0');
      await expect(cellLocator(page, 6, 6)).toHaveAttribute('data-territory-size', '2');

      await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '3');
      await expect(page.getByTestId('player-score-0')).toContainText('3칸');
      await expect(page.getByTestId('player-largest-0')).toHaveAttribute('data-value', '2');
      await expect(page.getByTestId('player-largest-0')).toContainText('최대 2');

      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
    });

    test('T1-44: 3P auto-skip bypasses secured player with 0 wall breaks, marks card and shows toast', async ({
      page,
    }) => {
      await runScriptE(page);

      const game = page.getByTestId('game-screen');
      await expect(game).toHaveAttribute('data-phase', 'select_piece');
      await expect(game).toHaveAttribute('data-current-player', '0');

      const card2 = playerCardLocator(page, 2);
      await expect(card2).toHaveAttribute('data-auto-skipped', 'true');
      await expect(card2).toContainText('영역 확정');
      await expect(page.getByTestId('player-score-2')).toHaveAttribute('data-value', '2');
      await expect(page.getByTestId('player-wallbreak-2')).toHaveAttribute('data-remaining', '0');

      const toast = page.getByTestId('game-toast');
      await expect(toast).toBeVisible();
      await expect(toast).toHaveAttribute('role', 'alert');
      await expect(toast).toContainText(/패스|영역/);
    });

    test('T1-45: Immediate all_separated game end with unused wall breaks renders accurate ResultModal rankings', async ({
      page,
    }) => {
      await runScriptD(page);

      const modal = page.getByTestId('result-modal');
      await expect(modal).toBeVisible();
      await expect(modal).toHaveAttribute('role', 'dialog');
      await expect(modal).toHaveAttribute('aria-modal', 'true');

      // All 3 players still had 1 unused wall break (proves E19) and multi-piece regions counted once (E17)
      for (let id = 0; id < 3; id += 1) {
        await expect(playerCardLocator(page, id)).toHaveAttribute('data-wall-breaks', '1');
      }

      const row0 = page.getByTestId('result-rank-row-0');
      await expect(row0).toHaveAttribute('data-rank', '1');
      await expect(row0).toHaveAttribute('data-total-cells', '43');
      await expect(row0).toHaveAttribute('data-largest-area', '43');
      await expect(row0).toHaveAttribute('data-advancing-round2', 'false');
      await expect(row0).toContainText('생존');

      const row1 = page.getByTestId('result-rank-row-1');
      await expect(row1).toHaveAttribute('data-rank', '2');
      await expect(row1).toHaveAttribute('data-total-cells', '4');
      await expect(row1).toHaveAttribute('data-largest-area', '4');
      await expect(row1).toHaveAttribute('data-advancing-round2', 'true');
      await expect(row1).toContainText('2라운드 진출');

      const row2 = page.getByTestId('result-rank-row-2');
      await expect(row2).toHaveAttribute('data-rank', '3');
      await expect(row2).toHaveAttribute('data-total-cells', '2');
      await expect(row2).toHaveAttribute('data-largest-area', '2');
      await expect(row2).toHaveAttribute('data-advancing-round2', 'true');
      await expect(row2).toContainText('2라운드 진출');
    });

    test('T1-46: ResultModal Round 2 preview and launch transitions bottom 2 players into Prison Match Round 2 (1:1)', async ({
      page,
    }) => {
      await runScriptD(page, {
        seats: [{ name: '민수' }, { name: '지영' }, { name: '현우' }],
      });

      const preview = page.getByTestId('round2-preview');
      await expect(preview).toBeVisible();
      const rawAdvancing = (await preview.getAttribute('data-advancing-ids')) ?? '';
      const advancingSet = rawAdvancing
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
        .sort();
      expect(advancingSet).toEqual(['1', '2']);
      await expect(preview).toHaveAttribute('data-first-player-id', '1');

      const startRound2Btn = page.getByTestId('start-round2-button');
      await expect(startRound2Btn).toBeVisible();
      await expect(startRound2Btn).toContainText('감옥매치 2라운드 (1:1) 시작');

      await startPrisonMatchRound2(page);

      const game = page.getByTestId('game-screen');
      await expect(game).toHaveAttribute('data-variant', 'wallgo1');
      await expect(game).toHaveAttribute('data-format', '2p');
      await expect(game).toHaveAttribute('data-round', '2');
      await expect(game).toHaveAttribute('data-phase', 'placement');
      await expect(game).toHaveAttribute('data-current-player', '0');

      await expect(page.getByTestId('game-topbar')).toContainText('감옥매치 2라운드');
      await expect(playerCardLocator(page, 0)).toContainText('지영');
      await expect(playerCardLocator(page, 1)).toContainText('현우');
      await expect(playerCardLocator(page, 2)).toHaveCount(0);
      await expect(page.getByTestId('wall-break-toggle')).toHaveCount(0);
      await expect(page.getByTestId('player-wallbreak-0')).toHaveCount(0);
      await expect(page.getByTestId('player-wallbreak-1')).toHaveCount(0);

      for (const { row, col, owner } of [
        { row: 1, col: 1, owner: '0' },
        { row: 5, col: 5, owner: '0' },
        { row: 1, col: 5, owner: '1' },
        { row: 5, col: 1, owner: '1' },
      ]) {
        await expect(cellLocator(page, row, col)).toHaveAttribute('data-occupied-by', owner);
      }
    });

    test('T1-47: ResultModal rematch button restarts a fresh 3P Round 1 match', async ({ page }) => {
      await runScriptD(page);

      const rematchBtn = page.getByTestId('rematch-button');
      await expect(rematchBtn).toContainText('다시 하기');
      await rematchBtn.click();

      await expect(page.getByTestId('result-modal')).toHaveCount(0);

      const game = page.getByTestId('game-screen');
      await expect(game).toHaveAttribute('data-format', '3p');
      await expect(game).toHaveAttribute('data-round', '1');
      await expect(game).toHaveAttribute('data-phase', 'placement');
      await expect(game).toHaveAttribute('data-current-player', '0');

      await expect(boardPiecesLocator(page)).toHaveCount(0);
      await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(0);
      for (let id = 0; id < 3; id += 1) {
        await expect(page.getByTestId(`player-wallbreak-${id}`)).toHaveAttribute(
          'data-remaining',
          '1',
        );
      }
    });

    test('T1-48: Undo and symmetric Redo step cleanly through a completed play turn', async ({
      page,
    }) => {
      await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });

      await expect(page.getByTestId('undo-button')).toBeDisabled();
      await expect(page.getByTestId('redo-button')).toBeDisabled();

      await completePlacement(page, SCRIPT_A1_PLACEMENTS);
      const turnBefore = (await readGameScreenState(page)).turnNumber;

      await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
      await expect(placedWallLocator(page, hWall(0, 0))).toBeVisible();
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
      expect((await readGameScreenState(page)).turnNumber).toBe(turnBefore + 1);

      await clickUndo(page);
      await expect(placedWallLocator(page, hWall(0, 0))).toHaveCount(0);
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      expect((await readGameScreenState(page)).turnNumber).toBe(turnBefore);
      await expect(page.getByTestId('redo-button')).toBeEnabled();

      await clickRedo(page);
      await expect(placedWallLocator(page, hWall(0, 0))).toHaveAttribute('data-owner', '0');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
      expect((await readGameScreenState(page)).turnNumber).toBe(turnBefore + 1);
      await expect(page.getByTestId('redo-button')).toBeDisabled();
    });

    test('T1-49: Mid-turn dirty Undo rolls back uncommitted move without popping the previous turn', async ({
      page,
    }) => {
      await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
      await completePlacement(page, SCRIPT_A1_PLACEMENTS);

      await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
      const turnAfterP0 = (await readGameScreenState(page)).turnNumber;

      // Turn 2 (P1): move (0,1) -> (0,2) without placing a wall yet
      await selectCell(page, 0, 1);
      await cellLocator(page, 0, 2).click();
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
      await expect(cellLocator(page, 0, 2)).toHaveAttribute('data-occupied-by', '1');

      await clickUndo(page);

      const afterUndo = await readGameScreenState(page);
      expect(['move_piece', 'select_piece']).toContain(afterUndo.phase);
      expect(afterUndo.currentPlayer).toBe(1);
      expect(afterUndo.turnNumber).toBe(turnAfterP0);

      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-occupied-by', '1');
      await expect(cellLocator(page, 0, 2)).toHaveAttribute('data-occupied-by', 'none');
      await expect(placedWallLocator(page, hWall(0, 0))).toBeVisible();
    });

    test('T1-50: Board inspection, result reopen, Undo/Redo from game_over, and return to lobby', async ({
      page,
    }) => {
      await runScriptD(page);

      await expect(page.getByTestId('reopen-result-button')).toHaveCount(0);
      await inspectBoardFromResult(page);

      await expect(territoryBadgeLocator(page, 0, 2)).toHaveAttribute('data-count', '43');
      await expect(territoryBadgeLocator(page, 5, 0)).toHaveAttribute('data-count', '4');
      await expect(territoryBadgeLocator(page, 0, 0)).toHaveAttribute('data-count', '2');

      await reopenResultModal(page);
      await inspectBoardFromResult(page);

      // Undo out of game_over back to Turn 7
      await clickUndo(page);
      const game = page.getByTestId('game-screen');
      await expect(game).toHaveAttribute('data-phase', 'select_piece');
      await expect(game).toHaveAttribute('data-current-player', '0');
      await expect(placedWallLocator(page, vWall(6, 1))).toHaveCount(0);
      await expect(page.getByTestId('reopen-result-button')).toHaveCount(0);
      await expect(page.getByTestId('result-modal')).toHaveCount(0);

      // Redo back into game_over
      await clickRedo(page);
      await expect(game).toHaveAttribute('data-phase', 'game_over');
      await expect(page.getByTestId('result-modal')).toBeVisible();

      await page.getByTestId('result-lobby-button').click();
      await expect(page.getByTestId('lobby-screen')).toBeVisible();
    });

    test('T1-51: RulesModal opens from lobby and game, auto-selects variant tab, switches tabs and closes via Escape and button', async ({
      page,
    }) => {
      await openLobby(page);
      await configureLobby(page, { variant: 'wallgo2' });

      await openRulesModal(page);
      const modal = page.getByTestId('rules-modal');
      await expect(modal).toHaveAttribute('role', 'dialog');
      await expect(modal).toHaveAttribute('aria-modal', 'true');

      await expect(page.getByTestId('rules-tab-wallgo2')).toHaveAttribute('aria-selected', 'true');
      expect(
        await modal.locator('svg').count(),
        'Wall Go II rules tab must render inline SVG movement diagrams',
      ).toBeGreaterThanOrEqual(1);

      await switchRulesTab(page, 'wallgo1');
      await expect(page.getByTestId('rules-tab-wallgo2')).toHaveAttribute('aria-selected', 'false');

      await switchRulesTab(page, 'scoring');
      await expect(page.getByTestId('rules-tab-wallgo1')).toHaveAttribute('aria-selected', 'false');

      await closeRulesModal(page, 'escape');

      await startGame(page);
      await expect(page.getByTestId('rules-button')).toHaveCount(1);
      await openRulesModal(page);
      await closeRulesModal(page, 'button');
    });

    test('T1-52: Committing a new action after Undo clears the Redo stack', async ({ page }) => {
      await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });

      await placePiece(page, 0, 0);
      await placePiece(page, 0, 1);

      await clickUndo(page);
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-occupied-by', 'none');
      await expect(page.getByTestId('redo-button')).toBeEnabled();

      await placePiece(page, 1, 1);
      await expect(cellLocator(page, 1, 1)).toHaveAttribute('data-occupied-by', '1');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-occupied-by', 'none');
      await expect(page.getByTestId('redo-button')).toBeDisabled();
    });

    test('T1-53: Turn timer counts down MM:SS during active play and resets on turn advance', async ({
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

      const timer = page.getByTestId('turn-timer');
      await expect(timer).toHaveAttribute('role', 'timer');
      await expect(timer).toHaveAttribute('data-seconds', '60');
      await expect(timer).toHaveAttribute('data-paused', 'true');

      await completePlacement(page, SCRIPT_A1_PLACEMENTS);

      await expect(timer).toHaveAttribute('data-seconds', '60');
      await expect(timer).toHaveAttribute('data-paused', 'false');
      await expect(timer).toHaveAttribute('data-urgency', 'normal');
      await expect(timer).toHaveText('01:00');

      await page.clock.runFor(5_000);
      await expect(timer).toHaveAttribute('data-seconds', '55');
      await expect(timer).toHaveText('00:55');
      await expect(timer).toHaveAttribute('data-paused', 'false');
      await expect(timer).toHaveAttribute('data-urgency', 'normal');

      await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
      await expect(timer).toHaveAttribute('data-seconds', '60');
      await expect(timer).toHaveText('01:00');
    });

    test('T1-54: Manual timer pause freezes countdown and blocks board interaction until resumed', async ({
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
      const pauseBtn = page.getByTestId('timer-pause-button');

      await toggleTimerPause(page, true);
      await expect(pauseBtn).toContainText('재개');

      await page.clock.runFor(4_000);
      await expect(timer).toHaveAttribute('data-seconds', '60');

      // Real coordinate tap on own piece while paused must be blocked regardless of
      // whether M4 guards via onClick no-op, HTML disabled, or pointer-events/scrim
      const cell00 = cellLocator(page, 0, 0);
      const pausedBox = await cell00.boundingBox();
      expect(pausedBox, 'cell-0-0 must have a bounding box while paused').not.toBeNull();
      if (pausedBox) {
        await page.mouse.click(
          pausedBox.x + pausedBox.width / 2,
          pausedBox.y + pausedBox.height / 2,
        );
      }
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
      await expect(cell00).toHaveAttribute('data-selected', 'false');

      await toggleTimerPause(page, false);
      await expect(pauseBtn).toContainText('일시정지');

      // Normal Playwright .click() proves cell-0-0 is genuinely enabled & unobstructed once resumed
      await selectCell(page, 0, 0);
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
    });

    test('T1-55: Timer urgency transitions from normal to warning (<=20s) to critical (<=10s)', async ({
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
      await expect(timer).toHaveAttribute('data-seconds', '60');
      await expect(timer).toHaveAttribute('data-urgency', 'normal');

      await page.clock.runFor(41_000);
      await expect(timer).toHaveAttribute('data-seconds', '19');
      await expect(timer).toHaveAttribute('data-urgency', 'warning');

      await page.clock.runFor(10_000);
      await expect(timer).toHaveAttribute('data-seconds', '9');
      await expect(timer).toHaveAttribute('data-urgency', 'critical');
    });

    test('T1-56: Timer reaching 00:00 triggers legal timeout auto-action, turn advance and toast', async ({
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

      const turnBefore = (await readGameScreenState(page)).turnNumber;
      await page.clock.runFor(60_000);
      const after60 = await readGameScreenState(page);
      if (after60.turnNumber === turnBefore) {
        await page.clock.runFor(1_000);
      }

      const game = page.getByTestId('game-screen');
      await expect(game).toHaveAttribute('data-turn-number', String(turnBefore + 1));
      await expect(game).toHaveAttribute('data-current-player', '1');
      await expect(game).toHaveAttribute('data-phase', 'select_piece');
      await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(1);

      const resetSeconds = Number(await page.getByTestId('turn-timer').getAttribute('data-seconds'));
      expect(
        resetSeconds,
        `Turn timer must reset to fresh 60s turn (59..60) after timeout, got ${resetSeconds}`,
      ).toBeGreaterThanOrEqual(59);
      expect(resetSeconds).toBeLessThanOrEqual(60);

      const toast = page.getByTestId('game-toast');
      await expect(toast).toBeVisible();
      await expect(toast).toHaveAttribute('role', 'alert');
      await expect(toast).toContainText(/시간 초과/);
    });

    test('T1-57: Mixed 1-Human + 2-AI (Easy & Normal) auto-completes placements and play turns', async ({
      page,
    }) => {
      await startConfiguredGame(page, {
        variant: 'wallgo1',
        format: '3p',
        shuffleOrder: false,
        seats: [
          { controller: 'human' },
          { controller: 'ai-easy' },
          { controller: 'ai-normal' },
        ],
      });

      await expect(playerCardLocator(page, 0)).toHaveAttribute('data-is-ai', 'false');
      await expect(playerCardLocator(page, 1)).toHaveAttribute('data-is-ai', 'true');
      await expect(playerCardLocator(page, 2)).toHaveAttribute('data-is-ai', 'true');

      // Human 1st placement on empty board
      await placePiece(page, 2, 2);

      // Wait for P1 (AI) and P2 (AI) to complete their 4 snake placements
      const placementOutcome = await waitForHumanTurnOrGameOver(page, {
        expectedPlayer: 0,
        expectedPhase: 'placement',
      });
      expect(placementOutcome).toBe('human_turn');
      await expect(boardPiecesLocator(page)).toHaveCount(5);

      // Dynamic empty-cell selection avoids any collision with AI's opening heuristic
      await placeFirstAvailableEmptyCell(page, [
        { row: 4, col: 4 },
        { row: 0, col: 0 },
        { row: 6, col: 6 },
      ]);
      await expect(boardPiecesLocator(page)).toHaveCount(6);
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');

      // Human plays Turn 1 dynamically, then both AIs respond
      const turnBefore = (await readGameScreenState(page)).turnNumber;
      await playFirstLegalHumanTurn(page, 0);
      const turnOutcome = await waitForHumanTurnOrGameOver(page, { expectedPlayer: 0 });
      expect(turnOutcome).toBe('human_turn');

      await assertThreeTurnWallBreakConservation(page, turnBefore);
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
    });

    test('T1-58: Mixed Human + Hard AI completes legal Wall Go II placements and turns on real clock', async ({
      page,
    }) => {
      // Strictly NO page.clock here so Hard AI's 150ms performance.now() cap runs genuinely
      await startConfiguredGame(page, {
        variant: 'wallgo2',
        format: '3p',
        shuffleOrder: false,
        seats: [
          { controller: 'human' },
          { controller: 'ai-hard' },
          { controller: 'ai-hard' },
        ],
      });

      await placePiece(page, 2, 2, 'square');

      const placementOutcome = await waitForHumanTurnOrGameOver(page, {
        expectedPlayer: 0,
        expectedPhase: 'placement',
        timeout: 25_000,
      });
      expect(placementOutcome).toBe('human_turn');
      await expect(boardPiecesLocator(page)).toHaveCount(5);

      // Verify each Hard AI placed 1 square + 1 round
      for (const owner of [1, 2]) {
        const kinds = await boardPiecesLocator(page, owner).evaluateAll((nodes) =>
          nodes.map((el) => el.getAttribute('data-kind') ?? '').sort(),
        );
        expect(kinds).toEqual(['round', 'square']);
      }

      await placeFirstAvailableEmptyCell(page, [
        { row: 4, col: 4 },
        { row: 0, col: 0 },
        { row: 6, col: 6 },
      ]);
      await expect(boardPiecesLocator(page)).toHaveCount(6);
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');

      const turnBefore = (await readGameScreenState(page)).turnNumber;
      await playFirstLegalHumanTurn(page, 0);
      const turnOutcome = await waitForHumanTurnOrGameOver(page, {
        expectedPlayer: 0,
        timeout: 25_000,
      });
      expect(turnOutcome).toBe('human_turn');

      await assertThreeTurnWallBreakConservation(page, turnBefore);
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
    });

    test('T1-59: Smart Undo across consecutive AI turns restores last human decision point', async ({
      page,
    }) => {
      await startConfiguredGame(page, {
        variant: 'wallgo1',
        format: '3p',
        shuffleOrder: false,
        seats: [
          { controller: 'human' },
          { controller: 'ai-easy' },
          { controller: 'ai-easy' },
        ],
      });

      await placePiece(page, 2, 2);
      const placementOutcome = await waitForHumanTurnOrGameOver(page, {
        expectedPlayer: 0,
        expectedPhase: 'placement',
      });
      expect(placementOutcome).toBe('human_turn');

      await placeFirstAvailableEmptyCell(page, [
        { row: 4, col: 4 },
        { row: 0, col: 0 },
        { row: 6, col: 6 },
      ]);
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');

      const turnBefore = (await readGameScreenState(page)).turnNumber;
      const turn1 = await playFirstLegalHumanTurn(page, 0);
      const turnOutcome = await waitForHumanTurnOrGameOver(page, { expectedPlayer: 0 });
      expect(turnOutcome).toBe('human_turn');
      await assertThreeTurnWallBreakConservation(page, turnBefore);

      // Single Undo must rewind across BOTH AI turns back to Human's Turn 1 start
      await clickUndo(page);

      const game = page.getByTestId('game-screen');
      await expect(game).toHaveAttribute('data-turn-number', String(turnBefore));
      await expect(game).toHaveAttribute('data-current-player', '0');
      await expect(game).toHaveAttribute('data-phase', 'select_piece');
      await expect(game).toHaveAttribute('data-ai-thinking', 'false');
      await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(0);
      for (const id of [0, 1, 2] as const) {
        await expect(page.getByTestId(`player-wallbreak-${id}`)).toHaveAttribute(
          'data-remaining',
          '1',
        );
      }
      await expect(cellLocator(page, turn1.from.row, turn1.from.col)).toHaveAttribute(
        'data-occupied-by',
        '0',
      );
      if (turn1.from.row !== turn1.to.row || turn1.from.col !== turn1.to.col) {
        await expect(cellLocator(page, turn1.to.row, turn1.to.col)).toHaveAttribute(
          'data-occupied-by',
          'none',
        );
      }
    });

    test('T1-60: All-AI 3P demo runs autonomously with AI thinking indicator', async ({ page }) => {
      await startConfiguredGame(page, {
        variant: 'wallgo1',
        format: '3p',
        shuffleOrder: false,
        seats: [
          { controller: 'ai-easy' },
          { controller: 'ai-easy' },
          { controller: 'ai-easy' },
        ],
      });

      for (let id = 0; id < 3; id += 1) {
        await expect(playerCardLocator(page, id)).toHaveAttribute('data-is-ai', 'true');
      }

      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-ai-thinking', 'true');
      await expect(page.getByTestId('turn-banner')).toContainText('생각 중');

      await expect(boardPiecesLocator(page)).toHaveCount(6, { timeout: 15_000 });
      await expect
        .poll(async () => page.locator('[data-testid^="placed-wall-"]').count(), {
          timeout: 15_000,
        })
        .toBeGreaterThanOrEqual(2);
    });

    test('T1-61: Primary iPad viewport guarantees zero-scroll, 1:1 square board, zero landmark overlap and zero duplicate testids', async ({
      page,
    }, testInfo) => {
      const expectedViewport = PROJECT_EXPECTED_VIEWPORTS[testInfo.project.name];
      expect(
        expectedViewport,
        `Unexpected Playwright project name: ${testInfo.project.name}`,
      ).toBeDefined();

      await openLobby(page);
      await assertZeroOverflow(page, expectedViewport);
      await assertNoDuplicateVisibleTestIds(page);

      await startGame(page);
      await assertZeroOverflow(page, expectedViewport);
      await assertGameRegionsNoOverlap(page);
      await assertNoDuplicateVisibleTestIds(page);
    });

    test('T1-62: Secondary iPad viewports (1024x768 & 768x1024) maintain zero-scroll, square board, zero overlap and >=48x48px wall targets', async ({
      page,
    }) => {
      const secondaryViewports = [
        IPAD_VIEWPORTS.gen10Landscape,
        IPAD_VIEWPORTS.gen10Portrait,
      ] as const;

      await openLobby(page);
      for (const vp of secondaryViewports) {
        await page.setViewportSize(vp);
        await assertZeroOverflow(page, vp);
        await assertNoDuplicateVisibleTestIds(page);
      }

      await configureLobby(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
      await startGame(page);
      await completePlacement(page, [
        { row: 3, col: 3 },
        { row: 0, col: 6 },
        { row: 6, col: 0 },
        { row: 6, col: 6 },
        { row: 6, col: 3 },
        { row: 0, col: 0 },
      ]);

      await selectCell(page, 3, 3);
      await cellLocator(page, 3, 4).click();
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');

      for (const vp of secondaryViewports) {
        await page.setViewportSize(vp);
        await assertZeroOverflow(page, vp);
        await assertGameRegionsNoOverlap(page);
        await assertInteractiveWallHitTargets(page);
        await assertNoDuplicateVisibleTestIds(page);
      }
    });

    test('T1-63: iPad touch ergonomics, action dock touch targets, ARIA live banner and reduced motion', async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });

      const reducedMotionMatches = await page.evaluate(
        () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      );
      expect(
        reducedMotionMatches,
        'Emulated prefers-reduced-motion: reduce media query must match',
      ).toBe(true);

      const appleCapable = await page
        .locator('meta[name="apple-mobile-web-app-capable"]')
        .count();
      expect(
        appleCapable,
        'index.html must include <meta name="apple-mobile-web-app-capable">',
      ).toBeGreaterThanOrEqual(1);

      // Complete 3P placement and move P0 (3,3) -> (3,4) into place_wall so interactive
      // wall slots mount and reduced-motion animation suppression is verified non-vacuously.
      await completePlacement(page, [
        { row: 3, col: 3 },
        { row: 0, col: 6 },
        { row: 6, col: 0 },
        { row: 6, col: 6 },
        { row: 6, col: 3 },
        { row: 0, col: 0 },
      ]);
      await selectCell(page, 3, 3);
      await cellLocator(page, 3, 4).click();
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
      await expect(page.locator('[data-wall-interactive="true"]')).toHaveCount(4);

      const reducedMotionAudit = await page.evaluate(() => {
        const targets: Element[] = [
          ...document.querySelectorAll('[data-wall-interactive="true"]'),
        ];
        const cell34 = document.querySelector('[data-testid="cell-3-4"]');
        const card0 = document.querySelector('[data-testid="player-card-0"]');
        if (cell34) {
          targets.push(cell34);
        }
        if (card0) {
          targets.push(card0);
        }

        const parseSeconds = (raw: string): number => {
          const trimmed = raw.trim();
          if (trimmed.endsWith('ms')) {
            return parseFloat(trimmed) / 1000;
          }
          return parseFloat(trimmed);
        };

        const violations: string[] = [];
        for (const el of targets) {
          const label = el.getAttribute('data-testid') ?? el.tagName.toLowerCase();
          for (const pseudo of [null, '::before', '::after'] as const) {
            const style = window.getComputedStyle(el, pseudo);
            const names = style.animationName.split(',').map((s) => s.trim());
            const states = style.animationPlayState.split(',').map((s) => s.trim());
            const durations = style.animationDuration.split(',').map((s) => s.trim());

            for (let i = 0; i < names.length; i += 1) {
              const name = names[i] ?? 'none';
              const playState = states[i % states.length] ?? 'running';
              const durationRaw = durations[i % durations.length] ?? '0s';
              const durationSec = parseSeconds(durationRaw);
              const suppressed =
                name === 'none' ||
                playState === 'paused' ||
                (Number.isFinite(durationSec) && durationSec <= 0.01);
              if (!suppressed) {
                violations.push(
                  `${label}${pseudo ?? ''} (name=${name}, state=${playState}, duration=${durationRaw})`,
                );
              }
            }
          }
        }
        return { inspectedCount: targets.length, violations };
      });
      expect(
        reducedMotionAudit.inspectedCount,
        'Reduced-motion check must inspect all 4 interactive walls + cell-3-4 + player-card-0',
      ).toBe(6);
      expect(
        reducedMotionAudit.violations,
        `Active animations must be suppressed under prefers-reduced-motion: reduce: ${reducedMotionAudit.violations.join('; ')}`,
      ).toEqual([]);

      // touch-action is not CSS-inherited, so accept manipulation on cell-3-4 or any ancestor
      // up to documentElement; user-select IS inherited so assert none directly on cell-3-4.
      const cellErgonomics = await cellLocator(page, 3, 4).evaluate((el) => {
        const directStyle = window.getComputedStyle(el);
        let hasManipulationTouchAction = false;
        for (let node: Element | null = el; node !== null; node = node.parentElement) {
          if (window.getComputedStyle(node).touchAction === 'manipulation') {
            hasManipulationTouchAction = true;
            break;
          }
        }
        return {
          hasManipulationTouchAction,
          userSelect: directStyle.userSelect,
        };
      });
      expect(
        cellErgonomics.hasManipulationTouchAction,
        'cell-3-4 or an ancestor up to documentElement must set touch-action: manipulation',
      ).toBe(true);
      expect(cellErgonomics.userSelect).toBe('none');

      const minDockHeight = testInfo.project.name === 'ipad-portrait' ? 47.95 : 43.95;
      for (const testId of ['undo-button', 'redo-button', 'rules-button', 'lobby-button']) {
        const btn = page.getByTestId(testId);
        await expect(btn).toBeVisible();
        const box = await btn.boundingBox();
        expect(box, `${testId} must have a bounding box`).not.toBeNull();
        if (box) {
          expect(
            box.height,
            `${testId} height (${box.height.toFixed(2)}px) must meet iPad touch target minimum`,
          ).toBeGreaterThanOrEqual(minDockHeight);
        }
      }

      const banner = page.getByTestId('turn-banner');
      await expect(banner).toHaveAttribute('role', 'status');
      await expect(banner).toHaveAttribute('aria-live', 'polite');
    });
  },
);
