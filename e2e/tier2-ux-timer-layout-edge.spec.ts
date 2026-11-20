import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  CLOCK_T0,
  DEFAULT_3P_PLACEMENTS,
  DEFAULT_3P_WG2_PLACEMENTS,
  SCRIPT_A1_PLACEMENTS,
  advancePausedClockUntilHumanTurnOrGameOver,
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
  isWallAdjacentToCell,
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
  playerCardLocator,
  readBoardGeometrySnapshot,
  readGameScreenState,
  returnToLobby,
  runScriptD,
  selectCell,
  startConfiguredGame,
  startGame,
  toggleWallBreak,
  triggerCurrentTurnTimeout,
  vWall,
  waitForHumanTurnOrGameOver,
  wallSlotLocator,
  type E2ECellPos,
} from './helpers/game.ts';
import {
  IPAD_VIEWPORTS,
  assertGameRegionsNoOverlap,
  assertInteractiveWallHitTargets,
  assertNoDuplicateVisibleTestIds,
  assertZeroOverflow,
} from './helpers/layout.ts';
import { attachRuntimeErrorGuard, type RuntimeErrorGuard } from './helpers/network.ts';
import {
  computeWg1NormalMoveCount,
  playCooperatingSurroundTurn,
  playHumanSelfSealCornerTurn,
  runScriptBSetupFromStartedGame,
} from './helpers/scripts.ts';

async function tapLocatorCenter(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, 'Target element must have a bounding box for pointer tap').not.toBeNull();
  if (!box) {
    throw new Error('Target element bounding box is null');
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('Tier 2 — UX, Undo/Redo, Timer, AI & Layout Edge Cases', { tag: '@tier2' }, () => {
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

  // --- FA-09: Smart Undo/Redo & RulesModal Edge Cases (T2-45 - T2-49) ---

  test('T2-45: Undo/Redo boundary states and symmetric placement history (0 <-> 3 steps)', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });

    const game = page.getByTestId('game-screen');
    const undoBtn = page.getByTestId('undo-button');
    const redoBtn = page.getByTestId('redo-button');

    // Step 0 boundary
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();
    await expect(boardPiecesLocator(page)).toHaveCount(0);
    await expect(game).toHaveAttribute('data-current-player', '0');

    // Place 3 snake steps: P0 (0,0), P1 (0,1), P2 (6,6)
    await placePiece(page, 0, 0);
    await placePiece(page, 0, 1);
    await placePiece(page, 6, 6);

    await expect(boardPiecesLocator(page)).toHaveCount(3);
    await expect(game).toHaveAttribute('data-current-player', '2');
    await expect(undoBtn).toBeEnabled();
    await expect(redoBtn).toBeDisabled();

    // Undo 3 times back to step 0
    await clickUndo(page);
    await expect(boardPiecesLocator(page)).toHaveCount(2);
    await expect(cellLocator(page, 6, 6)).toHaveAttribute('data-occupied-by', 'none');
    await expect(game).toHaveAttribute('data-current-player', '2');

    await clickUndo(page);
    await expect(boardPiecesLocator(page)).toHaveCount(1);
    await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-occupied-by', 'none');
    await expect(game).toHaveAttribute('data-current-player', '1');

    await clickUndo(page);
    await expect(boardPiecesLocator(page)).toHaveCount(0);
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-occupied-by', 'none');
    await expect(game).toHaveAttribute('data-current-player', '0');
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeEnabled();

    // Redo 3 times forward back to step 3
    await clickRedo(page);
    await expect(boardPiecesLocator(page)).toHaveCount(1);
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-occupied-by', '0');
    await expect(game).toHaveAttribute('data-current-player', '1');

    await clickRedo(page);
    await expect(boardPiecesLocator(page)).toHaveCount(2);
    await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-occupied-by', '1');
    await expect(game).toHaveAttribute('data-current-player', '2');

    await clickRedo(page);
    await expect(boardPiecesLocator(page)).toHaveCount(3);
    await expect(cellLocator(page, 6, 6)).toHaveAttribute('data-occupied-by', '2');
    await expect(game).toHaveAttribute('data-current-player', '2');
    await expect(redoBtn).toBeDisabled();
    await expect(undoBtn).toBeEnabled();
  });

  test('T2-46 (E26): Mixed 2P Human+AI with AI going first keeps Undo disabled before first human action', async ({
    page,
  }) => {
    await startConfiguredGame(page, {
      variant: 'wallgo1',
      format: '2p',
      shuffleOrder: false,
      seats: [{ controller: 'ai-easy' }, { controller: 'human' }],
    });

    const outcome = await waitForHumanTurnOrGameOver(page, {
      expectedPlayer: 1,
      expectedPhase: 'placement',
      timeout: 20_000,
    });
    expect(outcome).toBe('human_turn');

    // After AI P0 step 0: 4 fixed + 1 AI piece = 5; Undo MUST stay disabled!
    await expect(boardPiecesLocator(page)).toHaveCount(5);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-ai-thinking', 'false');
    await expect(page.getByTestId('undo-button')).toBeDisabled();
    await expect(page.getByTestId('redo-button')).toBeDisabled();

    // Human P1 places step 1 (snake queue [0,1,1,0] keeps P1 active for step 2)
    const chosen = await placeFirstAvailableEmptyCell(page, [{ row: 2, col: 2 }, { row: 2, col: 4 }]);
    await expect(boardPiecesLocator(page)).toHaveCount(6);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    await expect(page.getByTestId('undo-button')).toBeEnabled();

    // Undo reverts ONLY Human P1's placement while preserving AI P0's opening piece
    await clickUndo(page);
    await expect(cellLocator(page, chosen.row, chosen.col)).toHaveAttribute(
      'data-occupied-by',
      'none',
    );
    await expect(boardPiecesLocator(page)).toHaveCount(5);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-ai-thinking', 'false');
    await expect(page.getByTestId('undo-button')).toBeDisabled();
    await expect(page.getByTestId('redo-button')).toBeEnabled();

    // Redo restores Human P1's placement cleanly
    await clickRedo(page);
    await expect(cellLocator(page, chosen.row, chosen.col)).toHaveAttribute(
      'data-occupied-by',
      '1',
    );
    await expect(boardPiecesLocator(page)).toHaveCount(6);
  });

  test('T2-47 (E26b): Clicking Undo mid-AI-think cancels 450ms AI timer immediately and never fires retroactively', async ({
    page,
  }) => {
    await openLobbyWithPausedClock(page, CLOCK_T0);
    await configureLobby(page, {
      variant: 'wallgo1',
      format: '3p',
      timerSeconds: 0,
      shuffleOrder: false,
      seats: [
        { controller: 'human' },
        { controller: 'ai-easy' },
        { controller: 'ai-easy' },
      ],
    });
    await startGame(page);

    await placePiece(page, 2, 2);
    const placedOutcome = await advancePausedClockUntilHumanTurnOrGameOver(page, {
      expectedPlayer: 0,
      expectedPhase: 'placement',
    });
    expect(placedOutcome).toBe('human_turn');
    await placeFirstAvailableEmptyCell(page, [{ row: 4, col: 4 }, { row: 0, col: 0 }]);

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-phase', 'select_piece');
    await expect(game).toHaveAttribute('data-current-player', '0');

    const turnBefore = (await readGameScreenState(page)).turnNumber;
    const turn1 = await playFirstLegalHumanTurn(page, 0);

    // P1 (ai-easy) is now frozen mid-think on paused clock!
    await expect(game).toHaveAttribute('data-current-player', '1');
    await expect(game).toHaveAttribute('data-ai-thinking', 'true');
    await expect(game).toHaveAttribute('data-turn-number', String(turnBefore + 1));
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(1);
    await expect(page.getByTestId('turn-banner')).toContainText('생각 중');
    await expect(page.getByTestId('undo-button')).toBeEnabled();

    // Click Undo WHILE data-ai-thinking="true"
    await clickUndo(page);

    await expect(game).toHaveAttribute('data-ai-thinking', 'false');
    await expect(game).toHaveAttribute('data-current-player', '0');
    await expect(game).toHaveAttribute('data-phase', 'select_piece');
    await expect(game).toHaveAttribute('data-turn-number', String(turnBefore));
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(0);
    await expect(cellLocator(page, turn1.from.row, turn1.from.col)).toHaveAttribute(
      'data-occupied-by',
      '0',
    );
    await expect(page.getByTestId('redo-button')).toBeEnabled();

    // Advance 4x AI delay (2000ms) -> cancelled AI timer must NEVER fire retroactively
    await page.clock.runFor(2_000);
    await expect(game).toHaveAttribute('data-ai-thinking', 'false');
    await expect(game).toHaveAttribute('data-current-player', '0');
    await expect(game).toHaveAttribute('data-phase', 'select_piece');
    await expect(game).toHaveAttribute('data-turn-number', String(turnBefore));
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(0);
  });

  test('T2-48 (E26c): Smart Undo from AI-triggered game_over restores last human decision point and Redo returns to result-modal', async ({
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
        { controller: 'human' },
        { controller: 'ai-easy' },
        { controller: 'ai-easy' },
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

    let lastHumanTurnNumber = -1;
    let lastHumanWallCount = -1;

    for (let round = 0; round < 60; round += 1) {
      const outcome = await advancePausedClockUntilHumanTurnOrGameOver(page, {
        expectedPlayer: 0,
        maxSteps: 160,
      });
      if (outcome === 'game_over') {
        break;
      }
      const preState = await readGameScreenState(page);
      lastHumanTurnNumber = preState.turnNumber;
      lastHumanWallCount = await page.locator('[data-testid^="placed-wall-"]').count();
      await playHumanSelfSealCornerTurn(page, 0);
    }

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-phase', 'game_over');
    await expect(page.getByTestId('result-modal')).toBeVisible();

    const finalTurnNumber = (await readGameScreenState(page)).turnNumber;
    expect(lastHumanTurnNumber).toBeGreaterThanOrEqual(0);
    expect(
      finalTurnNumber,
      'game_over must be triggered by an AI move after the last human turn',
    ).toBeGreaterThan(lastHumanTurnNumber + 1);

    // Dismiss result-modal via inspect-board-button, then click Smart Undo
    await inspectBoardFromResult(page);
    await clickUndo(page);

    await expect(game).toHaveAttribute('data-phase', 'select_piece');
    await expect(game).toHaveAttribute('data-current-player', '0');
    await expect(game).toHaveAttribute('data-ai-thinking', 'false');
    await expect(game).toHaveAttribute('data-turn-number', String(lastHumanTurnNumber));
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(lastHumanWallCount);
    await expect(page.getByTestId('result-modal')).toHaveCount(0);
    await expect(page.getByTestId('reopen-result-button')).toHaveCount(0);
    await expect(page.getByTestId('redo-button')).toBeEnabled();

    // Advance 1500ms -> stays cleanly on human turn without phantom AI execution
    await page.clock.runFor(1_500);
    await expect(game).toHaveAttribute('data-phase', 'select_piece');
    await expect(game).toHaveAttribute('data-current-player', '0');
    await expect(game).toHaveAttribute('data-ai-thinking', 'false');

    // Redo returns directly to game_over and reopens result-modal
    await clickRedo(page);
    await expect(game).toHaveAttribute('data-phase', 'game_over');
    await expect(game).toHaveAttribute('data-turn-number', String(finalTurnNumber));
    await expect(page.getByTestId('result-modal')).toBeVisible();
  });

  test('T2-49: RulesModal backdrop click closes cleanly on both Lobby and Game screens and restores interaction', async ({
    page,
  }) => {
    await openLobby(page);
    await openRulesModal(page);
    await closeRulesModal(page, 'backdrop');

    // Lobby controls immediately interactive
    await page.getByTestId('variant-wallgo2').click();
    await expect(page.getByTestId('variant-wallgo2')).toHaveAttribute('aria-pressed', 'true');
    await startGame(page);

    // Game screen backdrop close restores board interaction
    await openRulesModal(page);
    await closeRulesModal(page, 'backdrop');

    await placePiece(page, 3, 3);
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '0');
  });

  // --- FA-10: Optional Turn Timer & Timeout Edge Cases (T2-50 - T2-54) ---

  test('T2-50 (E25b/c): Timeout at 00:00 during select_piece in Wall Go II executes legal non-stay move and adjacent open wall', async ({
    page,
  }) => {
    await openLobbyWithPausedClock(page, CLOCK_T0);
    await configureLobby(page, {
      variant: 'wallgo2',
      format: '3p',
      timerSeconds: 60,
      shuffleOrder: false,
    });
    await startGame(page);
    await completePlacement(page, DEFAULT_3P_WG2_PLACEMENTS);

    const turnBefore = (await readGameScreenState(page)).turnNumber;
    await triggerCurrentTurnTimeout(page, 60);

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-turn-number', String(turnBefore + 1));
    await expect(game).toHaveAttribute('data-current-player', '1');
    await expect(game).toHaveAttribute('data-phase', 'select_piece');

    const snapshot = await readBoardGeometrySnapshot(page);
    const p0Pieces = snapshot.pieces.filter((p) => p.owner === 0);
    expect(p0Pieces).toHaveLength(2);

    const p0Square = p0Pieces.find((p) => p.kind === 'square');
    const p0Round = p0Pieces.find((p) => p.kind === 'round');
    expect(p0Square).toBeDefined();
    expect(p0Round).toBeDefined();
    if (!p0Square || !p0Round) {
      throw new Error('Expected P0 to own one square and one round piece');
    }

    const squareMoved = p0Square.row !== 1 || p0Square.col !== 1;
    const roundMoved = p0Round.row !== 3 || p0Round.col !== 1;
    expect(
      Number(squareMoved) + Number(roundMoved),
      'Wall Go II timeout MUST relocate exactly 1 piece (non-stay E25c)',
    ).toBe(1);

    let movedDest: E2ECellPos;
    if (squareMoved) {
      const dr = Math.abs(p0Square.row - 1);
      const dc = Math.abs(p0Square.col - 1);
      const legalSquare = (dr === 0 && dc >= 1 && dc <= 2) || (dc === 0 && dr >= 1 && dr <= 2);
      expect(legalSquare, `Square moved to illegal cell (${p0Square.row},${p0Square.col})`).toBe(
        true,
      );
      movedDest = { row: p0Square.row, col: p0Square.col };
    } else {
      const dr = Math.abs(p0Round.row - 3);
      const dc = Math.abs(p0Round.col - 1);
      const legalRound = dr + dc === 1 || (dr === 1 && dc === 1);
      expect(legalRound, `Round moved to illegal cell (${p0Round.row},${p0Round.col})`).toBe(true);
      movedDest = { row: p0Round.row, col: p0Round.col };
    }

    expect(snapshot.walls).toHaveLength(1);
    const placed = snapshot.walls[0];
    expect(placed).toBeDefined();
    if (placed) {
      expect(placed.owner).toBe(0);
      expect(placed.lastWall).toBe(true);
      expect(
        isWallAdjacentToCell(placed, movedDest),
        `Placed wall ${placed.orientation}(${placed.row},${placed.col}) must be adjacent to moved destination (${movedDest.row},${movedDest.col})`,
      ).toBe(true);
    }

    await expectTurnTimerReset(page, 60);
    await expect(page.getByTestId('game-toast')).toBeVisible();
    await expect(page.getByTestId('game-toast')).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('game-toast')).toContainText(/시간 초과/);
  });

  test('T2-51 (E25d/E10): Timeout during Wall Go I post-break move_piece moves locked piece and places wall without restoring original owner wall', async ({
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
    await runScriptBSetupFromStartedGame(page);

    const turnBefore = (await readGameScreenState(page)).turnNumber;

    // P1 breaks P0's v(2,2) from (2,3)
    await selectCell(page, 2, 3);
    await toggleWallBreak(page, true);
    await wallSlotLocator(page, vWall(2, 2)).click();

    await expect(placedWallLocator(page, vWall(2, 2))).toHaveCount(0);
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(3);
    await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '0');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');

    const remainingSeconds = Number(
      await page.getByTestId('turn-timer').getAttribute('data-seconds'),
    );
    await triggerCurrentTurnTimeout(page, remainingSeconds);

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-turn-number', String(turnBefore + 1));
    await expect(game).toHaveAttribute('data-current-player', '2');
    await expect(game).toHaveAttribute('data-phase', 'select_piece');

    // Wall break charge stays spent and P1's other piece (4,6) stayed untouched (piece lock honored)
    await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '0');
    await expect(cellLocator(page, 4, 6)).toHaveAttribute('data-occupied-by', '1');

    // Total walls = 3 post-break + 1 newly placed = 4
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(4);
    const snapshot = await readBoardGeometrySnapshot(page);
    const p1LockedPiece = snapshot.pieces.find(
      (p) => p.owner === 1 && !(p.row === 4 && p.col === 6),
    );
    expect(p1LockedPiece, 'P1 locked piece must remain on the board').toBeDefined();
    if (!p1LockedPiece) {
      throw new Error('P1 locked piece missing after timeout');
    }
    expect(Math.abs(p1LockedPiece.row - 2) + Math.abs(p1LockedPiece.col - 3)).toBeLessThanOrEqual(
      2,
    );

    const lastWalls = snapshot.walls.filter((w) => w.lastWall);
    expect(lastWalls).toHaveLength(1);
    const newest = lastWalls[0];
    expect(newest).toBeDefined();
    if (newest) {
      expect(newest.owner).toBe(1);
      expect(isWallAdjacentToCell(newest, p1LockedPiece)).toBe(true);
    }

    // E10 reseal-safe check: if v(2,2) was legally resealed by timeout, it MUST be owned by P1 (lastWall=true), NOT restored P0!
    const v22 = placedWallLocator(page, vWall(2, 2));
    if ((await v22.count()) === 1) {
      await expect(v22).toHaveAttribute('data-owner', '1');
      await expect(v22).toHaveAttribute('data-last-wall', 'true');
    }

    await expectTurnTimerReset(page, 60);
    await expect(page.getByTestId('game-toast')).toBeVisible();
    await expect(page.getByTestId('game-toast')).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('game-toast')).toContainText(/시간 초과/);
  });

  test('T2-52 (E25e): Timeout during place_wall keeps moved piece at destination and places random adjacent open wall', async ({
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
    await completePlacement(page, DEFAULT_3P_PLACEMENTS);

    const turnBefore = (await readGameScreenState(page)).turnNumber;
    await page.clock.runFor(10_000);
    await expect(page.getByTestId('turn-timer')).toHaveAttribute('data-seconds', '50');

    await selectCell(page, 1, 1);
    await moveSelectedTo(page, 1, 3);
    await triggerCurrentTurnTimeout(page, 50);

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-turn-number', String(turnBefore + 1));
    await expect(game).toHaveAttribute('data-current-player', '1');
    await expect(game).toHaveAttribute('data-phase', 'select_piece');

    await expect(cellLocator(page, 1, 3)).toHaveAttribute('data-occupied-by', '0');
    await expect(cellLocator(page, 1, 1)).toHaveAttribute('data-occupied-by', 'none');

    const snapshot = await readBoardGeometrySnapshot(page);
    expect(snapshot.walls).toHaveLength(1);
    const placed = snapshot.walls[0];
    expect(placed).toBeDefined();
    if (placed) {
      expect(placed.owner).toBe(0);
      expect(placed.lastWall).toBe(true);
      expect(isWallAdjacentToCell(placed, { row: 1, col: 3 })).toBe(true);
    }

    await expectTurnTimerReset(page, 60);
    await expect(page.getByTestId('game-toast')).toBeVisible();
    await expect(page.getByTestId('game-toast')).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('game-toast')).toContainText(/시간 초과/);
  });

  test('T2-53 (E16): Clicking cancel-move-button during place_wall does NOT reset running countdown timer', async ({
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
    await completePlacement(page, DEFAULT_3P_PLACEMENTS);

    await page.clock.runFor(15_000);
    const timer = page.getByTestId('turn-timer');
    await expect(timer).toHaveAttribute('data-seconds', '45');
    await expect(timer).toContainText('00:45');

    await selectCell(page, 1, 1);
    await moveSelectedTo(page, 1, 3);
    await expect(timer).toHaveAttribute('data-seconds', '45');

    await cancelTurnMove(page);
    await expect(cellLocator(page, 1, 1)).toHaveAttribute('data-occupied-by', '0');
    await expect(cellLocator(page, 1, 3)).toHaveAttribute('data-occupied-by', 'none');
    await expect(timer).toHaveAttribute('data-seconds', '45');
    await expect(timer).toHaveAttribute('data-paused', 'false');

    await page.clock.runFor(5_000);
    await expect(timer).toHaveAttribute('data-seconds', '40');
    await expect(timer).toContainText('00:40');
  });

  test('T2-54: Opening RulesModal auto-pauses timer, closing auto-resumes, and timeout game-toast auto-dismisses', async ({
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
    await completePlacement(page, DEFAULT_3P_PLACEMENTS);

    const timer = page.getByTestId('turn-timer');
    await page.clock.runFor(12_000);
    await expect(timer).toHaveAttribute('data-seconds', '48');

    // RulesModal auto-pauses timer with zero drift across 10s
    await openRulesModal(page);
    await expect(timer).toHaveAttribute('data-paused', 'true');
    await page.clock.runFor(10_000);
    await expect(timer).toHaveAttribute('data-seconds', '48');

    // Closing RulesModal auto-resumes timer cleanly
    await closeRulesModal(page, 'button');
    await expect(timer).toHaveAttribute('data-paused', 'false');
    await expect(timer).toHaveAttribute('data-seconds', '48');

    await page.clock.runFor(3_000);
    await expect(timer).toHaveAttribute('data-seconds', '45');

    // Trigger timeout -> toast visible -> auto-dismisses after 3.5s
    await triggerCurrentTurnTimeout(page, 45);
    await expect(page.getByTestId('game-toast')).toBeVisible();
    await expect(page.getByTestId('game-toast')).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('game-toast')).toContainText(/시간 초과/);

    await page.clock.runFor(3_500);
    await expect(page.getByTestId('game-toast')).toHaveCount(0);
  });

  // --- FA-11: AI Input Guard, Surrounded Escape & Peak-Branching Hard AI (T2-55 - T2-57) ---

  test('T2-55: Board clicks are strictly ignored while data-ai-thinking="true" in both placement and select_piece', async ({
    page,
  }) => {
    await openLobbyWithPausedClock(page, CLOCK_T0);
    await configureLobby(page, {
      variant: 'wallgo1',
      format: '3p',
      timerSeconds: 0,
      shuffleOrder: false,
      seats: [
        { controller: 'human' },
        { controller: 'ai-easy' },
        { controller: 'ai-easy' },
      ],
    });
    await startGame(page);

    const game = page.getByTestId('game-screen');

    // Placement: P0 places (2,2) -> AI P1 freezes with data-ai-thinking="true"
    await placePiece(page, 2, 2);
    await expect(game).toHaveAttribute('data-phase', 'placement');
    await expect(game).toHaveAttribute('data-current-player', '1');
    await expect(game).toHaveAttribute('data-ai-thinking', 'true');

    await tapLocatorCenter(page, cellLocator(page, 0, 0));
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-occupied-by', 'none');
    await expect(boardPiecesLocator(page)).toHaveCount(1);
    await expect(game).toHaveAttribute('data-current-player', '1');
    await expect(game).toHaveAttribute('data-ai-thinking', 'true');

    // Finish placement and play Human Turn 1
    const step5 = await advancePausedClockUntilHumanTurnOrGameOver(page, {
      expectedPlayer: 0,
      expectedPhase: 'placement',
    });
    expect(step5).toBe('human_turn');
    await placeFirstAvailableEmptyCell(page, [{ row: 4, col: 4 }, { row: 0, col: 0 }]);

    await expect(game).toHaveAttribute('data-phase', 'select_piece');
    await playFirstLegalHumanTurn(page, 0);

    // Play phase: AI P1 freezes with data-ai-thinking="true"
    await expect(game).toHaveAttribute('data-phase', 'select_piece');
    await expect(game).toHaveAttribute('data-current-player', '1');
    await expect(game).toHaveAttribute('data-ai-thinking', 'true');

    const turnFrozen = (await readGameScreenState(page)).turnNumber;
    const snap = await readBoardGeometrySnapshot(page);
    const p0Cell = snap.pieces.find((p) => p.owner === 0);
    const p1Cell = snap.pieces.find((p) => p.owner === 1);
    expect(p0Cell).toBeDefined();
    expect(p1Cell).toBeDefined();
    if (!p0Cell || !p1Cell) {
      throw new Error('Missing pieces for P0/P1 in T2-55');
    }

    const occupiedSet = new Set(snap.pieces.map((p) => `${p.row},${p.col}`));
    let emptyCell: E2ECellPos = { row: 0, col: 0 };
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        if (!occupiedSet.has(`${r},${c}`)) {
          emptyCell = { row: r, col: c };
          break;
        }
      }
    }

    // Tap P0 piece, P1 piece, and empty cell via real pointer coordinates -> all ignored!
    await tapLocatorCenter(page, cellLocator(page, p0Cell.row, p0Cell.col));
    await tapLocatorCenter(page, cellLocator(page, p1Cell.row, p1Cell.col));
    await tapLocatorCenter(page, cellLocator(page, emptyCell.row, emptyCell.col));

    await expect(game).toHaveAttribute('data-phase', 'select_piece');
    await expect(game).toHaveAttribute('data-current-player', '1');
    await expect(game).toHaveAttribute('data-ai-thinking', 'true');
    await expect(game).toHaveAttribute('data-turn-number', String(turnFrozen));
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(1);
    await expect(cellLocator(page, p0Cell.row, p0Cell.col)).toHaveAttribute(
      'data-selected',
      'false',
    );
    await expect(cellLocator(page, p1Cell.row, p1Cell.col)).toHaveAttribute(
      'data-selected',
      'false',
    );
    await expect(cellLocator(page, emptyCell.row, emptyCell.col)).toHaveAttribute(
      'data-occupied-by',
      'none',
    );

    // Stepping clock lets AI execute cleanly
    await page.clock.runFor(1_000);
    const afterStep = await readGameScreenState(page);
    expect(afterStep.turnNumber).toBeGreaterThanOrEqual(turnFrozen + 1);
  });

  test('T2-56 (E27): Surrounded AI with 0 normal moves and wb=1 executes legal Wall-Break escape without crashing or skipping', async ({
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
        { controller: 'human' },
        { controller: 'human' },
        { controller: 'ai-easy' },
      ],
    });
    await startGame(page);

    // Placement: P0 (6,5), P1 (6,6), AI P2 places twice, P1 & P0 place adjacent to P2
    await placePiece(page, 6, 5);
    await placePiece(page, 6, 6);
    const step4 = await advancePausedClockUntilHumanTurnOrGameOver(page, {
      expectedPlayer: 1,
      expectedPhase: 'placement',
    });
    expect(step4).toBe('human_turn');

    const postP2Snap = await readBoardGeometrySnapshot(page);
    const p2StartPieces = postP2Snap.pieces.filter((p) => p.owner === 2);
    expect(p2StartPieces).toHaveLength(2);

    const preferredAdjacent: E2ECellPos[] = [];
    for (const p2 of p2StartPieces) {
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const nr = p2.row + dr;
        const nc = p2.col + dc;
        if (nr >= 0 && nr <= 6 && nc >= 0 && nc <= 6) {
          preferredAdjacent.push({ row: nr, col: nc });
        }
      }
    }

    await placeFirstAvailableEmptyCell(page, preferredAdjacent);
    await placeFirstAvailableEmptyCell(page, preferredAdjacent);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');

    let aiTurnsObserved = 0;
    let verifiedZeroNormalEscape = false;
    let verifiedProactiveBreak = false;

    for (let iter = 0; iter < 85; iter += 1) {
      const state = await readGameScreenState(page);
      if (state.phase === 'game_over') {
        break;
      }

      if (state.currentPlayer === 0 || state.currentPlayer === 1) {
        await playCooperatingSurroundTurn(page, state.currentPlayer);
        continue;
      }

      // AI P2 turn: inspect normal move count & Wall Break charge before stepping clock
      const snapshotBefore = await readBoardGeometrySnapshot(page);
      const p2NormalBefore = computeWg1NormalMoveCount(snapshotBefore, 2);
      const p2WbBefore = Number(
        await page.getByTestId('player-wallbreak-2').getAttribute('data-remaining'),
      );
      const turnBefore = state.turnNumber;
      const wallsBefore = snapshotBefore.walls.length;

      await page.clock.runFor(600);
      if ((await readGameScreenState(page)).aiThinking) {
        await page.clock.runFor(600);
      }

      const after = await readGameScreenState(page);
      expect(after.aiThinking, 'AI P2 must not remain hung in thinking state').toBe(false);

      const p2WbAfter = Number(
        await page.getByTestId('player-wallbreak-2').getAttribute('data-remaining'),
      );
      const wallsAfter = await page.locator('[data-testid^="placed-wall-"]').count();
      const p2AutoSkipped =
        (await playerCardLocator(page, 2).getAttribute('data-auto-skipped')) === 'true';
      aiTurnsObserved += 1;

      if (p2NormalBefore === 0 && p2WbBefore === 1) {
        expect(p2AutoSkipped, 'Surrounded AI with wb=1 must NOT be auto-skipped').toBe(false);
        expect(p2WbAfter, 'Surrounded AI with 0 normal moves must spend its Wall Break').toBe(0);
        expect(after.turnNumber).toBe(turnBefore + 1);
        expect(wallsAfter, '1 wall broken + 1 wall placed = net 0 walls').toBe(wallsBefore);
        verifiedZeroNormalEscape = true;
        break;
      }

      if (p2WbBefore === 1 && p2WbAfter === 0) {
        expect(after.turnNumber).toBe(turnBefore + 1);
        expect(wallsAfter, '1 wall broken + 1 wall placed = net 0 walls').toBe(wallsBefore);
        verifiedProactiveBreak = true;
      }

      if (verifiedProactiveBreak && (after.phase === 'game_over' || p2AutoSkipped)) {
        break;
      }
    }

    expect(aiTurnsObserved).toBeGreaterThanOrEqual(1);
    expect(
      verifiedZeroNormalEscape || verifiedProactiveBreak,
      'AI P2 must legally execute Wall Break under containment without crashing or skipping',
    ).toBe(true);
  });

  test('T2-57 (E27): Hard AI on peak-branching 2P Wall Go I (8 pieces, real wall-clock time, NO page.clock)', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // STRICTLY NO page.clock so real performance.now() exercises Hard AI's 150ms deadline cap
    await startConfiguredGame(page, {
      variant: 'wallgo1',
      format: '2p',
      timerSeconds: 0,
      shuffleOrder: false,
      seats: [{ controller: 'human' }, { controller: 'ai-hard' }],
    });

    await expect(boardPiecesLocator(page)).toHaveCount(4);
    await placePiece(page, 2, 2);

    const step3 = await waitForHumanTurnOrGameOver(page, {
      expectedPlayer: 0,
      expectedPhase: 'placement',
      timeout: 20_000,
    });
    expect(step3).toBe('human_turn');
    await expect(boardPiecesLocator(page)).toHaveCount(7);

    await placeFirstAvailableEmptyCell(page, [{ row: 4, col: 4 }, { row: 2, col: 4 }]);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
    await expect(boardPiecesLocator(page)).toHaveCount(8);
    await expect(boardPiecesLocator(page, 0)).toHaveCount(4);
    await expect(boardPiecesLocator(page, 1)).toHaveCount(4);

    // Play 3 consecutive Human + Hard-AI rounds verifying real-time latency & exact 2P conservation
    for (let round = 0; round < 3; round += 1) {
      const turnBefore = (await readGameScreenState(page)).turnNumber;
      const wallsBefore = await page.locator('[data-testid^="placed-wall-"]').count();

      await playFirstLegalHumanTurn(page, 0);
      const t0 = Date.now();
      const outcome = await waitForHumanTurnOrGameOver(page, {
        expectedPlayer: 0,
        timeout: 15_000,
      });
      const elapsedMs = Date.now() - t0;

      expect(elapsedMs, `Hard AI round ${round + 1} must respond well under 10s`).toBeLessThan(
        10_000,
      );
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-ai-thinking', 'false');
      await expect(boardPiecesLocator(page)).toHaveCount(8);

      if (outcome === 'game_over') {
        break;
      }

      await expect(page.getByTestId('game-screen')).toHaveAttribute(
        'data-turn-number',
        String(turnBefore + 2),
      );
      await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(wallsBefore + 2);
    }
  });

  // --- FA-12: Shuffle, Split View, Rotation, Idempotence, SPA Fallback & A11y (T2-58 - T2-62) ---

  test('T2-58: Pure opaque-box 20-trial turn-order shuffle proof (zero Math.random patching)', async ({
    page,
  }) => {
    const names = ['알파', '베타', '감마'] as const;
    const sortedExpected = [...names].sort();

    const readSeatOrder = async (): Promise<string[]> => {
      const order: string[] = [];
      for (const id of [0, 1, 2] as const) {
        const cardText = await playerCardLocator(page, id).innerText();
        const matched = names.filter((n) => cardText.includes(n));
        expect(matched, `player-card-${id} must match exactly one player name`).toHaveLength(1);
        order.push(matched[0] ?? '');
      }
      return order;
    };

    await openLobby(page);
    await configureLobby(page, {
      format: '3p',
      shuffleOrder: false,
      seats: [{ name: '알파' }, { name: '베타' }, { name: '감마' }],
    });

    // Control phase: 3 trials with shuffle OFF -> deterministic exact order
    for (let i = 0; i < 3; i += 1) {
      await startGame(page);
      expect(await readSeatOrder()).toEqual(['알파', '베타', '감마']);
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
      await expect(page.getByTestId('turn-banner')).toContainText('알파');
      await returnToLobby(page);
    }

    // Shuffle phase: 20 trials with shuffle ON -> bijection every trial & >= 2 distinct permutations
    await configureLobby(page, { shuffleOrder: true });
    const seenOrders = new Set<string>();

    for (let trial = 0; trial < 20; trial += 1) {
      await startGame(page);
      const order = await readSeatOrder();
      expect([...order].sort()).toEqual(sortedExpected);
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
      await expect(page.getByTestId('turn-banner')).toContainText(order[0] ?? '');
      seenOrders.add(order.join('|'));

      await returnToLobby(page);
      await expect(page.getByTestId('shuffle-order-toggle')).toHaveAttribute(
        'aria-checked',
        'true',
      );
    }

    expect(
      seenOrders.size,
      '20 shuffle trials must yield at least 2 distinct player orders',
    ).toBeGreaterThanOrEqual(2);
  });

  test('T2-59: Square iPad Split View (820x820) zero overflow, 1:1 board, zero overlap, >=48px walls and Single-DOM', async ({
    page,
  }) => {
    const splitVp = { width: 820, height: 820 };
    await page.setViewportSize(splitVp);

    await openLobby(page);
    await assertZeroOverflow(page, splitVp);
    await assertNoDuplicateVisibleTestIds(page);

    await configureLobby(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await startGame(page);

    await assertZeroOverflow(page, splitVp);
    await assertGameRegionsNoOverlap(page);
    await assertNoDuplicateVisibleTestIds(page);

    await completePlacement(page, DEFAULT_3P_PLACEMENTS);
    await selectCell(page, 1, 1);
    await moveSelectedTo(page, 1, 2);

    await assertZeroOverflow(page, splitVp);
    await assertGameRegionsNoOverlap(page);
    await assertNoDuplicateVisibleTestIds(page);
    await assertInteractiveWallHitTargets(page);
  });

  test('T2-60: Dynamic mid-game orientation rotation (1180x820 -> 820x1180 -> 1180x820) during place_wall preserves state and geometry', async ({
    page,
  }) => {
    await page.setViewportSize(IPAD_VIEWPORTS.airLandscape);
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, SCRIPT_A1_PLACEMENTS);

    await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
    const turnBefore = (await readGameScreenState(page)).turnNumber;

    // Turn 2 (P1): select (0,1), move to (0,2) entering active place_wall
    await selectCell(page, 0, 1);
    await moveSelectedTo(page, 0, 2);

    const sequence = [
      IPAD_VIEWPORTS.airLandscape,
      IPAD_VIEWPORTS.airPortrait,
      IPAD_VIEWPORTS.airLandscape,
    ] as const;

    for (const vp of sequence) {
      await page.setViewportSize(vp);
      await assertZeroOverflow(page, vp);
      await assertGameRegionsNoOverlap(page);
      await assertInteractiveWallHitTargets(page);
      await assertNoDuplicateVisibleTestIds(page);

      const game = page.getByTestId('game-screen');
      await expect(game).toHaveAttribute('data-phase', 'place_wall');
      await expect(game).toHaveAttribute('data-current-player', '1');
      await expect(game).toHaveAttribute('data-turn-number', String(turnBefore));
      await expect(cellLocator(page, 0, 2)).toHaveAttribute('data-occupied-by', '1');
      await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-occupied-by', 'none');
      await expect(placedWallLocator(page, hWall(0, 0))).toBeVisible();
      await expect(boardPiecesLocator(page)).toHaveCount(6);
    }

    await placeWallAt(page, vWall(0, 1));
    await expect(placedWallLocator(page, vWall(0, 1))).toBeVisible();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
  });

  test('T2-61: SPA unknown route fallback (/unknown/wallgo-route) and rapid double-click idempotence', async ({
    page,
  }) => {
    const response = await page.goto('/unknown/wallgo-route', { waitUntil: 'load' });
    expect(response?.ok(), 'SPA fallback must serve index.html with HTTP 2xx').toBe(true);
    await expect(page.getByTestId('lobby-screen')).toBeVisible();
    await expect(page.getByTestId('lobby-title')).toContainText('벽바둑');

    // Same-tick double DOM click on start-game-button (avoids coordinate click-through onto game board)
    await page.getByTestId('start-game-button').evaluate((el) => {
      const btn = el as HTMLButtonElement;
      btn.click();
      btn.click();
    });

    const game = page.getByTestId('game-screen');
    await expect(game).toBeVisible();
    await expect(game).toHaveAttribute('data-phase', 'placement');
    await expect(boardPiecesLocator(page)).toHaveCount(0);
    await assertNoDuplicateVisibleTestIds(page);

    // Real double-click on placement cell (2,2) -> exactly 1 piece placed
    await cellLocator(page, 2, 2).dblclick();
    await expect(boardPiecesLocator(page)).toHaveCount(1);
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-occupied-by', '0');
    await expect(game).toHaveAttribute('data-current-player', '1');

    // Real double-click on undo-button -> cleanly returns to 0 pieces
    await page.getByTestId('undo-button').dblclick();
    await expect(boardPiecesLocator(page)).toHaveCount(0);
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-occupied-by', 'none');
    await expect(game).toHaveAttribute('data-current-player', '0');
    await expect(page.getByTestId('undo-button')).toBeDisabled();
    await expect(page.getByTestId('redo-button')).toBeEnabled();

    // Real double-click on redo-button -> cleanly restores 1 piece
    await page.getByTestId('redo-button').dblclick();
    await expect(boardPiecesLocator(page)).toHaveCount(1);
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-occupied-by', '0');
    await expect(page.getByTestId('redo-button')).toBeDisabled();
  });

  test('T2-62: Keyboard accessibility (Tab/Enter/Escape) and full ARIA role/landmark audit across Lobby, Game and Modals', async ({
    page,
  }) => {
    await openLobby(page);
    await expect(page.getByTestId('lobby-screen')).toHaveRole('main');

    // Keyboard Tab traversal moves focus off variant-wallgo1 to another interactive element
    await page.getByTestId('variant-wallgo1').focus();
    await page.keyboard.press('Tab');
    const focusedAfterTab = await page.evaluate(() => ({
      tag: document.activeElement?.tagName.toLowerCase() ?? 'none',
      testId: document.activeElement?.getAttribute('data-testid') ?? 'none',
    }));
    expect(focusedAfterTab.tag).not.toBe('body');
    expect(focusedAfterTab.testId).not.toBe('variant-wallgo1');

    // Keyboard Enter toggles variant-wallgo2 and timer-60
    await page.getByTestId('variant-wallgo2').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('variant-wallgo2')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('timer-60').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('timer-60')).toHaveAttribute('aria-pressed', 'true');

    // Keyboard Enter opens RulesModal with dialog/tab ARIA, Escape closes
    await page.getByTestId('rules-button').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('rules-modal')).toBeVisible();
    await expect(page.getByTestId('rules-modal')).toHaveRole('dialog');
    await expect(page.getByTestId('rules-modal')).toHaveAttribute('aria-modal', 'true');
    for (const tab of ['wallgo1', 'wallgo2', 'scoring'] as const) {
      await expect(page.getByTestId(`rules-tab-${tab}`)).toHaveRole('tab');
    }
    await expect(page.getByTestId('rules-tab-wallgo2')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rules-modal')).toHaveCount(0);

    // Keyboard Enter on start-game-button launches Wall Go II game
    await page.getByTestId('start-game-button').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('game-screen')).toBeVisible();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-variant', 'wallgo2');

    // Game Screen ARIA landmark & live-region audit
    await expect(page.getByTestId('board-frame')).toHaveRole('region');
    await expect(page.getByTestId('board-grid')).toHaveRole('grid');
    await expect(page.getByTestId('turn-banner')).toHaveRole('status');
    await expect(page.getByTestId('turn-banner')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('turn-timer')).toHaveRole('timer');
    await expect(page.getByTestId('score-board')).toHaveRole('region');
    await expect(page.getByTestId('piece-kind-picker')).toHaveRole('group');

    // Open & Escape-close RulesModal in game
    await openRulesModal(page);
    await closeRulesModal(page, 'escape');

    // Audit ResultModal ARIA via Script D
    await returnToLobby(page);
    await runScriptD(page);
    await expect(page.getByTestId('result-modal')).toHaveRole('dialog');
    await expect(page.getByTestId('result-modal')).toHaveAttribute('aria-modal', 'true');
  });
});
