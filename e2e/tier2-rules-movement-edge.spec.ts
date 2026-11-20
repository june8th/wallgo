import { expect, test } from '@playwright/test';
import {
  DEFAULT_2P_PLACEMENTS,
  DEFAULT_3P_PLACEMENTS,
  SCRIPT_A1_PLACEMENTS,
  assertAllEdgesInternal,
  assertSinglePressed,
  boardPiecesLocator,
  cancelTurnMove,
  cellLocator,
  completePlacement,
  configureLobby,
  ensureWallBreakActive,
  hWall,
  moveSelectedTo,
  openLobby,
  placePiece,
  placeWallAt,
  placedWallLocator,
  playHumanTurn,
  playerCardLocator,
  readGameScreenState,
  readInteractiveWallEdges,
  readPieceAtCell,
  readValidMoveCoords,
  runScriptBSetup,
  runScriptC3Setup,
  runScriptCSetup,
  selectCell,
  startConfiguredGame,
  startGame,
  territoryBadgeLocator,
  toggleWallBreak,
  vWall,
  wallSlotLocator,
  type E2EPlacementStep,
} from './helpers/game.ts';
import { assertInteractiveWallHitTargets, assertZeroOverflow } from './helpers/layout.ts';
import { attachRuntimeErrorGuard, type RuntimeErrorGuard } from './helpers/network.ts';

test.describe('Tier 2 — Lobby, Setup, Movement, Walls & Wall-Break Core Edge Cases', { tag: '@tier2' }, () => {
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

  // --- FA-01: Lobby Boundaries & Negative Inputs (T2-01 - T2-04) ---

  test('T2-01: Blank and whitespace-only seat names fall back cleanly to 플레이어 1..3', async ({
    page,
  }) => {
    await openLobby(page);
    await page.getByTestId('seat-name-0').fill('');
    await page.getByTestId('seat-name-1').fill('   ');
    await page.getByTestId('seat-name-2').fill('  \t  ');

    await startGame(page);

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-phase', 'placement');
    await expect(game).toHaveAttribute('data-current-player', '0');

    await expect(playerCardLocator(page, 0)).toContainText('플레이어 1');
    await expect(playerCardLocator(page, 1)).toContainText('플레이어 2');
    await expect(playerCardLocator(page, 2)).toContainText('플레이어 3');
    await expect(page.getByTestId('turn-banner')).toContainText('플레이어 1');
  });

  test('T2-02: maxLength=12 on seat-name inputs truncates >12 chars and displays cleanly without overflow', async ({
    page,
  }) => {
    await openLobby(page);

    for (const i of [0, 1, 2] as const) {
      await expect(page.getByTestId(`seat-name-${i}`)).toHaveAttribute('maxlength', '12');
    }

    const name0 = page.getByTestId('seat-name-0');
    await name0.fill('');
    await name0.pressSequentially('가나다라마바사아자차카타파하거너');

    const name1 = page.getByTestId('seat-name-1');
    await name1.fill('');
    await name1.pressSequentially('벽바둑마스터123456');

    await expect(name0).toHaveValue('가나다라마바사아자차카타');
    expect((await name0.inputValue()).length).toBe(12);
    await expect(name1).toHaveValue('벽바둑마스터123456');
    expect((await name1.inputValue()).length).toBe(12);

    await startGame(page);

    await expect(playerCardLocator(page, 0)).toContainText('가나다라마바사아자차카타');
    await expect(playerCardLocator(page, 0)).not.toContainText('파하거너');
    await expect(playerCardLocator(page, 1)).toContainText('벽바둑마스터123456');
    await assertZeroOverflow(page);
  });

  test('T2-03: Switching 3p -> 2p -> 3p preserves seat 0-1 custom names & AI controllers without corrupting seat 2', async ({
    page,
  }) => {
    await openLobby(page);
    await configureLobby(page, {
      format: '3p',
      seats: [
        { name: '민준', controller: 'ai-normal' },
        { name: '서연', controller: 'ai-hard' },
        { name: '도윤', controller: 'ai-easy' },
      ],
    });

    await page.getByTestId('format-2p').click();
    await expect(page.getByTestId('format-2p')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('seat-row-2')).toHaveCount(0);
    await expect(page.getByTestId('seat-name-0')).toHaveValue('민준');
    await expect(page.getByTestId('seat-controller-0-ai-normal')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('seat-name-1')).toHaveValue('서연');
    await expect(page.getByTestId('seat-controller-1-ai-hard')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByTestId('format-3p').click();
    await expect(page.getByTestId('format-3p')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('seat-row-2')).toBeVisible();
    await expect(page.getByTestId('seat-name-0')).toHaveValue('민준');
    await expect(page.getByTestId('seat-controller-0-ai-normal')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('seat-name-1')).toHaveValue('서연');
    await expect(page.getByTestId('seat-controller-1-ai-hard')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const seat2Name = (await page.getByTestId('seat-name-2').inputValue()).trim();
    expect(['도윤', '플레이어 3']).toContain(seat2Name);

    const seat2ControllerIds = [
      'seat-controller-2-human',
      'seat-controller-2-ai-easy',
      'seat-controller-2-ai-normal',
      'seat-controller-2-ai-hard',
    ] as const;
    let pressedCount = 0;
    for (const id of seat2ControllerIds) {
      if ((await page.getByTestId(id).getAttribute('aria-pressed')) === 'true') {
        pressedCount += 1;
      }
    }
    expect(pressedCount, 'Exactly one controller pill must be active on seat 2').toBe(1);

    await startGame(page);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-format', '3p');
    await expect(playerCardLocator(page, 0)).toContainText('민준');
    await expect(playerCardLocator(page, 0)).toHaveAttribute('data-is-ai', 'true');
    await expect(playerCardLocator(page, 0)).toContainText(/AI 보통/);
    await expect(playerCardLocator(page, 1)).toContainText('서연');
    await expect(playerCardLocator(page, 1)).toHaveAttribute('data-is-ai', 'true');
    await expect(playerCardLocator(page, 1)).toContainText(/AI 어려움/);
    await expect(playerCardLocator(page, 2)).toBeVisible();
    await expect(playerCardLocator(page, 2)).toContainText(seat2Name);
  });

  test('T2-04: Repeatedly toggling variant, format, timer, shuffle and seat controller maintains strict single-active ARIA state', async ({
    page,
  }) => {
    await openLobby(page);

    const variants = ['variant-wallgo1', 'variant-wallgo2'] as const;
    for (const id of ['variant-wallgo2', 'variant-wallgo1', 'variant-wallgo2', 'variant-wallgo2'] as const) {
      await page.getByTestId(id).click();
      await assertSinglePressed(page, variants, id);
    }

    const formats = ['format-3p', 'format-2p'] as const;
    for (const id of ['format-2p', 'format-3p', 'format-2p', 'format-3p'] as const) {
      await page.getByTestId(id).click();
      await assertSinglePressed(page, formats, id);
    }

    const timers = ['timer-0', 'timer-90', 'timer-60'] as const;
    for (const id of ['timer-90', 'timer-60', 'timer-0', 'timer-60', 'timer-90'] as const) {
      await page.getByTestId(id).click();
      await assertSinglePressed(page, timers, id);
    }

    const shuffle = page.getByTestId('shuffle-order-toggle');
    for (const expected of ['true', 'false', 'true', 'false'] as const) {
      await shuffle.click();
      await expect(shuffle).toHaveAttribute('aria-checked', expected);
    }

    const controllers = [
      'seat-controller-0-human',
      'seat-controller-0-ai-easy',
      'seat-controller-0-ai-normal',
      'seat-controller-0-ai-hard',
    ] as const;
    for (const id of [
      'seat-controller-0-ai-easy',
      'seat-controller-0-ai-normal',
      'seat-controller-0-ai-hard',
      'seat-controller-0-human',
    ] as const) {
      await page.getByTestId(id).click();
      await assertSinglePressed(page, controllers, id);
    }

    await startGame(page);
    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-variant', 'wallgo2');
    await expect(game).toHaveAttribute('data-format', '3p');
    await expect(page.getByTestId('turn-timer')).toHaveAttribute('data-seconds', '90');
    await expect(playerCardLocator(page, 0)).toHaveAttribute('data-is-ai', 'false');
  });

  // --- FA-02: Initial Placement Boundaries & Negative Rejections (T2-05 - T2-08) ---

  test('T2-05 (E02): Clicking already-occupied cell during 3P placement is rejected without mutating state', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });

    await placePiece(page, 2, 2);
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-occupied-by', '0');
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-valid-move', 'false');
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-move-type', 'none');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    await expect(boardPiecesLocator(page)).toHaveCount(1);

    // P1 clicks P0's occupied cell (2,2) -> rejected
    await cellLocator(page, 2, 2).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'placement');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-occupied-by', '0');
    await expect(boardPiecesLocator(page)).toHaveCount(1);

    // P1 places legally at (2,4)
    await placePiece(page, 2, 4);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
    await expect(boardPiecesLocator(page)).toHaveCount(2);

    // P2 clicks occupied (2,4) and (2,2) -> both rejected
    await cellLocator(page, 2, 4).click();
    await cellLocator(page, 2, 2).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'placement');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
    await expect(boardPiecesLocator(page)).toHaveCount(2);
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-occupied-by', '0');
    await expect(cellLocator(page, 2, 4)).toHaveAttribute('data-occupied-by', '1');

    // P2 places legally at (4,4) -> snake order keeps P2 active for step 3
    await placePiece(page, 4, 4);
    await expect(boardPiecesLocator(page)).toHaveCount(3);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
  });

  test('T2-06 (E04): Clicking any of the 4 pre-placed fixed diagonal cells during 2P placement is rejected', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '2p', shuffleOrder: false });

    const fixedCells: readonly (readonly [number, number, string])[] = [
      [1, 1, '0'],
      [5, 5, '0'],
      [1, 5, '1'],
      [5, 1, '1'],
    ];

    for (const [r, c, owner] of fixedCells) {
      const cell = cellLocator(page, r, c);
      await expect(cell).toHaveAttribute('data-occupied-by', owner);
      await expect(cell).toHaveAttribute('data-valid-move', 'false');
      await expect(cell).toHaveAttribute('data-move-type', 'none');
    }
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-valid-move', 'true');
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-move-type', 'placement');

    for (const [r, c, owner] of fixedCells) {
      await cellLocator(page, r, c).click();
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'placement');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
      await expect(boardPiecesLocator(page)).toHaveCount(4);
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-occupied-by', owner);
    }

    await placePiece(page, 2, 2);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    await expect(boardPiecesLocator(page)).toHaveCount(5);

    await cellLocator(page, 1, 5).click();
    await cellLocator(page, 2, 2).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    await expect(boardPiecesLocator(page)).toHaveCount(5);
  });

  test('T2-07 (E03): 3P Wall Go II 2nd placement disables already-used piece-kind button and auto-assigns remaining kind', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });

    // Steps 0..2: P0=square, P1=round, P2=square
    await placePiece(page, 1, 1, 'square');
    await placePiece(page, 1, 5, 'round');
    await placePiece(page, 5, 5, 'square');

    // Step 3 (P2 2nd): square disabled, round auto-selected
    await expect(page.getByTestId('pick-piece-square')).toBeDisabled();
    await expect(page.getByTestId('pick-piece-square')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('pick-piece-round')).toBeEnabled();
    await expect(page.getByTestId('pick-piece-round')).toHaveAttribute('aria-pressed', 'true');
    await cellLocator(page, 5, 3).click();
    await expect(cellLocator(page, 5, 3)).toHaveAttribute('data-piece-kind', 'round');

    // Step 4 (P1 2nd): round disabled, square auto-selected
    await expect(page.getByTestId('pick-piece-round')).toBeDisabled();
    await expect(page.getByTestId('pick-piece-round')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('pick-piece-square')).toBeEnabled();
    await expect(page.getByTestId('pick-piece-square')).toHaveAttribute('aria-pressed', 'true');
    await cellLocator(page, 3, 5).click();
    await expect(cellLocator(page, 3, 5)).toHaveAttribute('data-piece-kind', 'square');

    // Step 5 (P0 2nd): square disabled, round auto-selected
    await expect(page.getByTestId('pick-piece-square')).toBeDisabled();
    await expect(page.getByTestId('pick-piece-square')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('pick-piece-round')).toBeEnabled();
    await expect(page.getByTestId('pick-piece-round')).toHaveAttribute('aria-pressed', 'true');
    await cellLocator(page, 3, 1).click();
    await expect(cellLocator(page, 3, 1)).toHaveAttribute('data-piece-kind', 'round');

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
    await expect(page.getByTestId('piece-kind-picker')).toHaveCount(0);
    await expect(boardPiecesLocator(page)).toHaveCount(6);

    for (const ownerId of [0, 1, 2] as const) {
      await expect(
        page
          .getByTestId('board-grid')
          .locator(`[data-testid^="piece-"][data-owner="${ownerId}"][data-kind="square"]`),
      ).toHaveCount(1);
      await expect(
        page
          .getByTestId('board-grid')
          .locator(`[data-testid^="piece-"][data-owner="${ownerId}"][data-kind="round"]`),
      ).toHaveCount(1);
    }
  });

  test('T2-08 (E04): 2P Wall Go II never mounts piece-kind-picker, fixed pieces stay round, all 4 snake placements are square', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo2', format: '2p', shuffleOrder: false });

    const fixedCoords: readonly (readonly [number, number])[] = [
      [1, 1],
      [5, 5],
      [1, 5],
      [5, 1],
    ];

    const assertPickerAbsentAndFixedRound = async (): Promise<void> => {
      await expect(page.getByTestId('piece-kind-picker')).toHaveCount(0);
      await expect(page.getByTestId('pick-piece-square')).toHaveCount(0);
      await expect(page.getByTestId('pick-piece-round')).toHaveCount(0);
      for (const [r, c] of fixedCoords) {
        await expect(cellLocator(page, r, c)).toHaveAttribute('data-piece-kind', 'round');
      }
    };

    await assertPickerAbsentAndFixedRound();

    for (const step of DEFAULT_2P_PLACEMENTS) {
      await placePiece(page, step.row, step.col);
      await expect(cellLocator(page, step.row, step.col)).toHaveAttribute('data-piece-kind', 'square');
      const token = await readPieceAtCell(page, step.row, step.col);
      expect(token.kind).toBe('square');
      await assertPickerAbsentAndFixedRound();
    }

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
    await expect(boardPiecesLocator(page)).toHaveCount(8);
    await expect(page.getByTestId('wall-break-toggle')).toHaveCount(0);

    for (const ownerId of [0, 1] as const) {
      await expect(
        page
          .getByTestId('board-grid')
          .locator(`[data-testid^="piece-"][data-owner="${ownerId}"][data-kind="round"]`),
      ).toHaveCount(2);
      await expect(
        page
          .getByTestId('board-grid')
          .locator(`[data-testid^="piece-"][data-owner="${ownerId}"][data-kind="square"]`),
      ).toHaveCount(2);
    }
  });

  // --- FA-03: Wall Go I Movement & Conditional Stay Edge Cases (T2-09 - T2-12) ---

  test('T2-09 (E05): Wall Go I 0-step stay forbidden when |D_1| === 0 while open piece allows stay', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, SCRIPT_A1_PLACEMENTS);

    // Turns 1-3: P0 seals h(0,0), P1 stays at (4,6), P2 stays at (6,6). P1 still occupies (0,1)!
    await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
    await playHumanTurn(page, { row: 4, col: 6 }, { row: 4, col: 6 }, hWall(4, 6));
    await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 6 }, vWall(6, 5));

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-phase', 'select_piece');
    await expect(game).toHaveAttribute('data-current-player', '0');

    await cellLocator(page, 0, 0).click();
    await expect(game).toHaveAttribute('data-phase', 'move_piece');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-selected', 'true');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-valid-move', 'false');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-move-type', 'none');
    await expect(page.locator('[data-valid-move="true"]')).toHaveCount(0);
    await expect(page.getByTestId('turn-banner')).not.toContainText('제자리 유지 가능');

    // C08-safe check: if UI auto-activated wall break on 0-normal-move piece, deactivate and re-verify normal mode
    const wbToggle = page.getByTestId('wall-break-toggle');
    if ((await wbToggle.getAttribute('aria-pressed')) === 'true') {
      await ensureWallBreakActive(page, false);
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-valid-move', 'false');
      await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-move-type', 'none');
      await expect(page.locator('[data-valid-move="true"]')).toHaveCount(0);
      await expect(page.getByTestId('turn-banner')).not.toContainText('제자리 유지 가능');
    }

    // Tapping (0,0) again must NOT enter place_wall
    await cellLocator(page, 0, 0).click();
    await expect(game).not.toHaveAttribute('data-phase', 'place_wall');
    await expect(page.locator('[data-wall-state="placeable"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(3);

    // Contrast: open piece (4,4) allows 0-step stay
    await selectCell(page, 4, 4);
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-valid-move', 'true');
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-move-type', 'stay');
    await expect(page.getByTestId('turn-banner')).toContainText(/제자리 유지 가능/);
  });

  test('T2-10 (E06): Wall Go I cannot jump over own or opponent piece (exact 9-cell BFS)', async ({
    page,
  }) => {
    const placements: readonly E2EPlacementStep[] = [
      { row: 3, col: 3 }, // P0 center
      { row: 3, col: 4 }, // P1 opp East
      { row: 6, col: 6 }, // P2
      { row: 6, col: 4 }, // P2
      { row: 0, col: 6 }, // P1
      { row: 3, col: 2 }, // P0 own West
    ];

    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, placements);
    await selectCell(page, 3, 3);

    expect(await readValidMoveCoords(page, 'stay')).toEqual([{ row: 3, col: 3 }]);
    expect(await readValidMoveCoords(page, 'normal')).toEqual([
      { row: 1, col: 3 },
      { row: 2, col: 2 },
      { row: 2, col: 3 },
      { row: 2, col: 4 },
      { row: 4, col: 2 },
      { row: 4, col: 3 },
      { row: 4, col: 4 },
      { row: 5, col: 3 },
    ]);
    await expect(page.locator('[data-valid-move="true"]')).toHaveCount(9);

    for (const [r, c] of [
      [3, 4],
      [3, 2],
      [3, 5],
      [3, 1],
    ] as const) {
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-valid-move', 'false');
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-move-type', 'none');
    }

    // Clicking empty cell behind opponent (3,5) and behind own piece (3,1) must not move P0
    await cellLocator(page, 3, 5).click();
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '0');
    await expect(cellLocator(page, 3, 5)).toHaveAttribute('data-occupied-by', 'none');
    await expect(page.getByTestId('game-screen')).not.toHaveAttribute('data-phase', 'place_wall');

    if ((await readGameScreenState(page)).phase === 'select_piece') {
      await selectCell(page, 3, 3);
    }
    await cellLocator(page, 3, 1).click();
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '0');
    await expect(cellLocator(page, 3, 1)).toHaveAttribute('data-occupied-by', 'none');
    await expect(page.getByTestId('game-screen')).not.toHaveAttribute('data-phase', 'place_wall');
  });

  test('T2-11: Clicking opponent piece or empty cell during select_piece is a strict no-op', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, DEFAULT_3P_PLACEMENTS);
    const turnBefore = (await readGameScreenState(page)).turnNumber;

    for (const [r, c, expectedOwner] of [
      [1, 5, '1'],
      [5, 3, '2'],
      [3, 3, 'none'],
    ] as const) {
      await cellLocator(page, r, c).click();
      const state = await readGameScreenState(page);
      expect(state.phase).toBe('select_piece');
      expect(state.currentPlayer).toBe(0);
      expect(state.turnNumber).toBe(turnBefore);
      await expect(page.locator('[data-selected="true"]')).toHaveCount(0);
      await expect(page.locator('[data-valid-move="true"]')).toHaveCount(0);
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-occupied-by', expectedOwner);
    }

    await selectCell(page, 1, 1);
    await expect(cellLocator(page, 1, 1)).toHaveAttribute('data-selected', 'true');
  });

  test('T2-12: Clicking out-of-range empty or opponent cell during move_piece leaves board unmutated and recovers cleanly', async ({
    page,
  }) => {
    const placements: readonly E2EPlacementStep[] = [
      { row: 3, col: 3 }, // P0
      { row: 0, col: 6 }, // P1
      { row: 6, col: 0 }, // P2
      { row: 6, col: 6 }, // P2
      { row: 6, col: 3 }, // P1
      { row: 0, col: 1 }, // P0 (keeps (0,0) strictly empty!)
    ];

    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, placements);
    const turnBefore = (await readGameScreenState(page)).turnNumber;

    await selectCell(page, 3, 3);
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-occupied-by', 'none');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-valid-move', 'false');
    await expect(cellLocator(page, 0, 6)).toHaveAttribute('data-occupied-by', '1');
    await expect(cellLocator(page, 0, 6)).toHaveAttribute('data-valid-move', 'false');

    // Click invalid out-of-range empty cell (0,0)
    await cellLocator(page, 0, 0).click();
    const afterEmpty = await readGameScreenState(page);
    expect(['select_piece', 'move_piece']).toContain(afterEmpty.phase);
    expect(afterEmpty.currentPlayer).toBe(0);
    expect(afterEmpty.turnNumber).toBe(turnBefore);
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '0');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-occupied-by', 'none');
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(0);

    if (afterEmpty.phase === 'select_piece') {
      await expect(page.locator('[data-selected="true"]')).toHaveCount(0);
      await expect(page.locator('[data-valid-move="true"]')).toHaveCount(0);
      await selectCell(page, 3, 3);
    }

    // Click invalid out-of-range opponent cell (0,6)
    await cellLocator(page, 0, 6).click();
    const afterOpp = await readGameScreenState(page);
    expect(['select_piece', 'move_piece']).toContain(afterOpp.phase);
    expect(afterOpp.currentPlayer).toBe(0);
    expect(afterOpp.turnNumber).toBe(turnBefore);
    await expect(cellLocator(page, 0, 6)).toHaveAttribute('data-occupied-by', '1');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '0');
    await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(0);

    // Recovery move succeeds
    if (afterOpp.phase === 'select_piece') {
      await selectCell(page, 3, 3);
    }
    await moveSelectedTo(page, 3, 4);
    await placeWallAt(page, hWall(3, 4));

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    await expect(page.getByTestId('game-screen')).toHaveAttribute(
      'data-turn-number',
      String(turnBefore + 1),
    );
  });

  // --- FA-04: Wall Go II Square & Round Movement Edge Cases (T2-13 - T2-16) ---

  test('T2-13 (E12): Wall Go II square rejects diagonal, stay (self-tap deselects) and jumping pieces on straight 2-step', async ({
    page,
  }) => {
    const placements: readonly E2EPlacementStep[] = [
      { row: 3, col: 3, kind: 'square' }, // P0 square
      { row: 3, col: 4, kind: 'square' }, // P1 opp East
      { row: 6, col: 6, kind: 'square' }, // P2
      { row: 6, col: 4, kind: 'round' }, // P2
      { row: 0, col: 6, kind: 'round' }, // P1
      { row: 2, col: 3, kind: 'round' }, // P0 own North
    ];

    await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });
    await completePlacement(page, placements);
    await selectCell(page, 3, 3);

    expect(await readValidMoveCoords(page, 'normal')).toEqual([
      { row: 3, col: 1 },
      { row: 3, col: 2 },
      { row: 4, col: 3 },
      { row: 5, col: 3 },
    ]);
    await expect(page.locator('[data-valid-move="true"]')).toHaveCount(4);

    for (const [r, c] of [
      [1, 3],
      [3, 5],
      [2, 2],
      [2, 4],
      [4, 2],
      [4, 4],
      [3, 3],
    ] as const) {
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-valid-move', 'false');
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-move-type', 'none');
    }

    // Reject diagonal (4,4), jump over opp (3,5), jump over own (1,3)
    for (const [r, c] of [
      [4, 4],
      [3, 5],
      [1, 3],
    ] as const) {
      if ((await readGameScreenState(page)).phase === 'select_piece') {
        await selectCell(page, 3, 3);
      }
      await cellLocator(page, r, c).click();
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-occupied-by', 'none');
      await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '0');
      await expect(page.getByTestId('game-screen')).not.toHaveAttribute('data-phase', 'place_wall');
    }

    // Self-tap on selected square piece deselects (never enters place_wall)
    if ((await readGameScreenState(page)).phase === 'select_piece') {
      await selectCell(page, 3, 3);
    }
    await cellLocator(page, 3, 3).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-selected', 'false');
    await expect(page.locator('[data-valid-move="true"]')).toHaveCount(0);
  });

  test('T2-14 (E12): Wall Go II round rejects straight 2-step and origin stay; self-tap deselects', async ({
    page,
  }) => {
    const placements: readonly E2EPlacementStep[] = [
      { row: 3, col: 3, kind: 'round' }, // P0 round
      { row: 0, col: 6, kind: 'square' }, // P1
      { row: 6, col: 0, kind: 'square' }, // P2
      { row: 6, col: 6, kind: 'round' }, // P2
      { row: 6, col: 3, kind: 'round' }, // P1
      { row: 0, col: 0, kind: 'square' }, // P0
    ];

    await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });
    await completePlacement(page, placements);
    await selectCell(page, 3, 3);

    expect(await readValidMoveCoords(page, 'normal')).toEqual([
      { row: 2, col: 2 },
      { row: 2, col: 3 },
      { row: 2, col: 4 },
      { row: 3, col: 2 },
      { row: 3, col: 4 },
      { row: 4, col: 2 },
      { row: 4, col: 3 },
      { row: 4, col: 4 },
    ]);
    await expect(page.getByTestId('turn-banner')).not.toContainText('제자리 유지 가능');

    for (const [r, c] of [
      [1, 3],
      [5, 3],
      [3, 1],
      [3, 5],
      [3, 3],
    ] as const) {
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-valid-move', 'false');
    }

    await cellLocator(page, 3, 5).click();
    await expect(cellLocator(page, 3, 5)).toHaveAttribute('data-occupied-by', 'none');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '0');
    await expect(page.getByTestId('game-screen')).not.toHaveAttribute('data-phase', 'place_wall');

    if ((await readGameScreenState(page)).phase === 'select_piece') {
      await selectCell(page, 3, 3);
    }
    await cellLocator(page, 3, 3).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-selected', 'false');
    await expect(page.locator('[data-valid-move="true"]')).toHaveCount(0);
  });

  test('T2-15: Wall Go II round diagonal (3,3)->(4,4) blocked when BOTH intermediates blocked (pieces and walls)', async ({
    page,
  }) => {
    // Part A: Two pieces occupying intermediates (3,4) and (4,3)
    const placementsPartA: readonly E2EPlacementStep[] = [
      { row: 3, col: 3, kind: 'round' },
      { row: 3, col: 4, kind: 'square' },
      { row: 4, col: 3, kind: 'square' },
      { row: 6, col: 6, kind: 'round' },
      { row: 0, col: 6, kind: 'round' },
      { row: 0, col: 0, kind: 'square' },
    ];
    await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });
    await completePlacement(page, placementsPartA);
    await selectCell(page, 3, 3);

    expect(await readValidMoveCoords(page, 'normal')).toEqual([
      { row: 2, col: 2 },
      { row: 2, col: 3 },
      { row: 2, col: 4 },
      { row: 3, col: 2 },
      { row: 4, col: 2 },
    ]);
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-occupied-by', 'none');
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-valid-move', 'false');
    await cellLocator(page, 4, 4).click();
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-occupied-by', 'none');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '0');

    // Part B: Two walls v(3,3) and h(3,3) blocking both L-paths in normal mode
    await runScriptCSetup(page);
    await selectCell(page, 3, 3);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-wall-break-active', 'false');
    expect(await readValidMoveCoords(page, 'normal')).toEqual([
      { row: 2, col: 2 },
      { row: 2, col: 3 },
      { row: 2, col: 4 },
      { row: 3, col: 2 },
      { row: 4, col: 2 },
    ]);
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-valid-move', 'false');
    await cellLocator(page, 4, 4).click();
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-occupied-by', 'none');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '2');
    await expect(placedWallLocator(page, vWall(3, 3))).toBeVisible();
    await expect(placedWallLocator(page, hWall(3, 3))).toBeVisible();
  });

  test('T2-16: Wall Go II square 2-step straight blocked by single step-1 wall without Wall Break', async ({
    page,
  }) => {
    await runScriptC3Setup(page);
    await selectCell(page, 3, 1);

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-wall-break-active', 'false');
    await expect(placedWallLocator(page, vWall(3, 1))).toBeVisible();
    await expect(cellLocator(page, 3, 2)).toHaveAttribute('data-occupied-by', 'none');
    await expect(cellLocator(page, 3, 2)).toHaveAttribute('data-valid-move', 'false');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', 'none');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-valid-move', 'false');

    expect(await readValidMoveCoords(page, 'normal')).toEqual([
      { row: 1, col: 1 },
      { row: 2, col: 1 },
      { row: 3, col: 0 },
      { row: 4, col: 1 },
    ]);

    await cellLocator(page, 3, 3).click();
    await expect(cellLocator(page, 3, 1)).toHaveAttribute('data-occupied-by', '1');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', 'none');
    await expect(placedWallLocator(page, vWall(3, 1))).toBeVisible();
    await expect(page.getByTestId('game-screen')).not.toHaveAttribute('data-phase', 'place_wall');
  });

  // --- FA-05: Wall Placement, Perimeter & Cancel Edge Cases (T2-17 - T2-20) ---

  test('T2-17 (E01): All 4 corners mount exact 2 internal wall slots and all 4 outer edges mount exact 3 (zero perimeter walls)', async ({
    page,
  }) => {
    const placements: readonly E2EPlacementStep[] = [
      { row: 0, col: 0 }, // P0 NW
      { row: 0, col: 6 }, // P1 NE
      { row: 6, col: 0 }, // P2 SW
      { row: 6, col: 6 }, // P2 SE
      { row: 0, col: 3 }, // P1 Top edge
      { row: 3, col: 0 }, // P0 Left edge
    ];

    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, placements);

    // Turn 1 (P0): NW corner (0,0) -> exact 2 slots
    await selectCell(page, 0, 0);
    await moveSelectedTo(page, 0, 0);
    const nwEdges = await readInteractiveWallEdges(page, 'placeable');
    expect(nwEdges).toEqual([hWall(0, 0), vWall(0, 0)]);
    assertAllEdgesInternal(nwEdges);
    await assertInteractiveWallHitTargets(page);
    await placeWallAt(page, hWall(0, 0));

    // Turn 2 (P1): NE corner (0,6) -> exact 2 slots
    await selectCell(page, 0, 6);
    await moveSelectedTo(page, 0, 6);
    const neEdges = await readInteractiveWallEdges(page, 'placeable');
    expect(neEdges).toEqual([hWall(0, 6), vWall(0, 5)]);
    assertAllEdgesInternal(neEdges);
    await assertInteractiveWallHitTargets(page);
    await placeWallAt(page, hWall(0, 6));

    // Turn 3 (P2): SW corner (6,0) -> exact 2 slots
    await selectCell(page, 6, 0);
    await moveSelectedTo(page, 6, 0);
    const swEdges = await readInteractiveWallEdges(page, 'placeable');
    expect(swEdges).toEqual([hWall(5, 0), vWall(6, 0)]);
    assertAllEdgesInternal(swEdges);
    await assertInteractiveWallHitTargets(page);
    await placeWallAt(page, hWall(5, 0));

    // Turn 4 (P0): Left outer edge (3,0) -> exact 3 slots
    await selectCell(page, 3, 0);
    await moveSelectedTo(page, 3, 0);
    const leftEdges = await readInteractiveWallEdges(page, 'placeable');
    expect(leftEdges).toEqual([hWall(2, 0), hWall(3, 0), vWall(3, 0)]);
    assertAllEdgesInternal(leftEdges);
    await placeWallAt(page, vWall(3, 0));

    // Turn 5 (P1): Top outer edge (0,3) -> exact 3 slots
    await selectCell(page, 0, 3);
    await moveSelectedTo(page, 0, 3);
    const topEdges = await readInteractiveWallEdges(page, 'placeable');
    expect(topEdges).toEqual([hWall(0, 3), vWall(0, 2), vWall(0, 3)]);
    assertAllEdgesInternal(topEdges);
    await placeWallAt(page, hWall(0, 3));

    // Turn 6 (P2): Bottom edge (6,5) -> cancel -> Right edge (5,6) -> cancel -> SE corner (6,6)
    await selectCell(page, 6, 6);
    await moveSelectedTo(page, 6, 5);
    const bottomEdges = await readInteractiveWallEdges(page, 'placeable');
    expect(bottomEdges).toEqual([hWall(5, 5), vWall(6, 4), vWall(6, 5)]);
    assertAllEdgesInternal(bottomEdges);
    await cancelTurnMove(page);

    await moveSelectedTo(page, 5, 6);
    const rightEdges = await readInteractiveWallEdges(page, 'placeable');
    expect(rightEdges).toEqual([hWall(4, 6), hWall(5, 6), vWall(5, 5)]);
    assertAllEdgesInternal(rightEdges);
    await cancelTurnMove(page);

    await moveSelectedTo(page, 6, 6);
    const seEdges = await readInteractiveWallEdges(page, 'placeable');
    expect(seEdges).toEqual([hWall(5, 6), vWall(6, 5)]);
    assertAllEdgesInternal(seEdges);
    await assertInteractiveWallHitTargets(page);
    await placeWallAt(page, hWall(5, 6));
  });

  test('T2-18: Already-occupied internal wall edges never mount as placeable during place_wall', async ({
    page,
  }) => {
    const placements: readonly E2EPlacementStep[] = [
      { row: 3, col: 3 },
      { row: 3, col: 4 },
      { row: 4, col: 3 },
      { row: 6, col: 6 },
      { row: 0, col: 6 },
      { row: 0, col: 0 },
    ];

    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, placements);

    // Turn 1 (P0): stay (3,3) -> exact 4 slots -> place v(3,3)
    await selectCell(page, 3, 3);
    await moveSelectedTo(page, 3, 3);
    expect(await readInteractiveWallEdges(page, 'placeable')).toEqual([
      hWall(2, 3),
      hWall(3, 3),
      vWall(3, 2),
      vWall(3, 3),
    ]);
    await placeWallAt(page, vWall(3, 3));

    // Turn 2 (P1): stay (3,4) -> v(3,3) excluded -> exact 3 slots -> place v(3,4)
    await selectCell(page, 3, 4);
    await moveSelectedTo(page, 3, 4);
    await expect(wallSlotLocator(page, vWall(3, 3))).toHaveCount(0);
    expect(await readInteractiveWallEdges(page, 'placeable')).toEqual([
      hWall(2, 4),
      hWall(3, 4),
      vWall(3, 4),
    ]);
    await placeWallAt(page, vWall(3, 4));

    // Turn 3 (P2): stay (4,3) -> place h(3,3)
    await playHumanTurn(page, { row: 4, col: 3 }, { row: 4, col: 3 }, hWall(3, 3));

    // Turn 4 (P0): stay (3,3) -> BOTH v(3,3) and h(3,3) excluded -> exact 2 remaining slots
    await selectCell(page, 3, 3);
    await moveSelectedTo(page, 3, 3);
    await expect(wallSlotLocator(page, vWall(3, 3))).toHaveCount(0);
    await expect(wallSlotLocator(page, hWall(3, 3))).toHaveCount(0);
    await expect(placedWallLocator(page, vWall(3, 3))).toHaveAttribute('data-owner', '0');
    await expect(placedWallLocator(page, hWall(3, 3))).toHaveAttribute('data-owner', '2');
    expect(await readInteractiveWallEdges(page, 'placeable')).toEqual([hWall(2, 3), vWall(3, 2)]);

    await placeWallAt(page, hWall(2, 3));
    await expect(placedWallLocator(page, hWall(2, 3))).toHaveAttribute('data-last-wall', 'true');
  });

  test('T2-19: Clicking non-interactive board cells during place_wall does not move piece again or advance turn', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, DEFAULT_3P_PLACEMENTS);
    const turnBefore = (await readGameScreenState(page)).turnNumber;

    await selectCell(page, 1, 1);
    await moveSelectedTo(page, 1, 2);
    expect(await readInteractiveWallEdges(page, 'placeable')).toEqual([
      hWall(0, 2),
      hWall(1, 2),
      vWall(1, 1),
      vWall(1, 2),
    ]);

    for (const [r, c] of [
      [4, 4],
      [1, 1],
      [1, 2],
      [3, 1],
      [1, 5],
    ] as const) {
      await cellLocator(page, r, c).click();
      const state = await readGameScreenState(page);
      expect(state.phase).toBe('place_wall');
      expect(state.currentPlayer).toBe(0);
      expect(state.turnNumber).toBe(turnBefore);
      await expect(cellLocator(page, 1, 2)).toHaveAttribute('data-occupied-by', '0');
      await expect(cellLocator(page, 1, 1)).toHaveAttribute('data-occupied-by', 'none');
      await expect(page.locator('[data-testid^="placed-wall-"]')).toHaveCount(0);
      await expect(page.locator('[data-wall-state="placeable"]')).toHaveCount(4);
    }

    await placeWallAt(page, hWall(1, 2));
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    await expect(page.getByTestId('game-screen')).toHaveAttribute(
      'data-turn-number',
      String(turnBefore + 1),
    );
  });

  test('T2-20 (E16): cancel-move-button reverts BOTH Wall Go I pre-move post-break and Wall Go II choose_break_wall', async ({
    page,
  }) => {
    // Part A: Wall Go I pre-move post-break cancel
    await runScriptBSetup(page);
    await selectCell(page, 2, 3);
    await toggleWallBreak(page, true);
    await wallSlotLocator(page, vWall(2, 2)).click();

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
    await expect(placedWallLocator(page, vWall(2, 2))).toHaveCount(0);
    await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '0');
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-valid-move', 'true');
    await expect(page.getByTestId('cancel-move-button')).toBeEnabled();

    await cancelTurnMove(page);
    await expect(cellLocator(page, 2, 3)).toHaveAttribute('data-selected', 'true');
    await expect(placedWallLocator(page, vWall(2, 2))).toHaveAttribute('data-owner', '0');
    await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '1');
    await expect(playerCardLocator(page, 1)).toHaveAttribute('data-wall-breaks', '1');
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-valid-move', 'false');
    await expect(page.getByTestId('cancel-move-button')).toBeDisabled();

    // Piece lock is released -> switching to P1's other piece (4,6) succeeds
    await cellLocator(page, 4, 6).click();
    await expect(cellLocator(page, 4, 6)).toHaveAttribute('data-selected', 'true');

    // Part B: Wall Go II choose_break_wall cancel
    await runScriptCSetup(page);
    await selectCell(page, 3, 3);
    await toggleWallBreak(page, true);
    await cellLocator(page, 4, 4).click();

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
    await expect(page.getByTestId('game-screen')).toHaveAttribute(
      'data-phase-substate',
      'choose_break_wall',
    );
    expect(await readInteractiveWallEdges(page, 'breakable-choice')).toEqual([
      hWall(3, 3),
      vWall(3, 3),
    ]);
    await expect(page.getByTestId('cancel-move-button')).toBeEnabled();

    await cancelTurnMove(page);
    await expect(page.getByTestId('game-screen')).not.toHaveAttribute(
      'data-phase-substate',
      'choose_break_wall',
    );
    await expect(page.locator('[data-wall-state="breakable-choice"]')).toHaveCount(0);
    await expect(placedWallLocator(page, vWall(3, 3))).toHaveAttribute('data-owner', '0');
    await expect(placedWallLocator(page, hWall(3, 3))).toHaveAttribute('data-owner', '1');
    await expect(page.getByTestId('player-wallbreak-2')).toHaveAttribute('data-remaining', '1');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '2');
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-occupied-by', 'none');
    await expect(page.getByTestId('cancel-move-button')).toBeDisabled();

    // Ensure normal mode and execute a legal move to prove recovery
    const wbToggle = page.getByTestId('wall-break-toggle');
    if ((await wbToggle.getAttribute('aria-pressed')) === 'true') {
      await toggleWallBreak(page, false);
    }
    await moveSelectedTo(page, 2, 3);
    await placeWallAt(page, hWall(1, 3));
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
  });

  // --- FA-06 Part 1: Wall Break Core Edge Cases (T2-21 - T2-22) ---

  test('T2-21 (E07): Wall Go I 4-wall surrounded piece selectable for Wall Break, unsealing live score and unlocking 0-step stay', async ({
    page,
  }) => {
    const placements: readonly E2EPlacementStep[] = [
      { row: 3, col: 3 },
      { row: 2, col: 3 },
      { row: 4, col: 3 },
      { row: 6, col: 6 },
      { row: 5, col: 5 },
      { row: 6, col: 0 },
    ];

    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, placements);

    // Turns 1-6: seal (3,3) on all 4 sides and vacate (3,4) and (4,3)
    await playHumanTurn(page, { row: 3, col: 3 }, { row: 3, col: 3 }, vWall(3, 2));
    await playHumanTurn(page, { row: 2, col: 3 }, { row: 3, col: 4 }, vWall(3, 3));
    await playHumanTurn(page, { row: 4, col: 3 }, { row: 4, col: 3 }, hWall(3, 3));
    await playHumanTurn(page, { row: 3, col: 3 }, { row: 3, col: 3 }, hWall(2, 3));
    await playHumanTurn(page, { row: 3, col: 4 }, { row: 3, col: 5 }, hWall(3, 5));
    await playHumanTurn(page, { row: 4, col: 3 }, { row: 5, col: 3 }, hWall(5, 3));

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
    await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '1');
    await expect(territoryBadgeLocator(page, 3, 3)).toHaveAttribute('data-owner', '0');
    await expect(territoryBadgeLocator(page, 3, 3)).toHaveAttribute('data-count', '1');

    await cellLocator(page, 3, 3).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-selected', 'true');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-valid-move', 'false');
    await expect(page.locator('[data-valid-move="true"]')).toHaveCount(0);

    await ensureWallBreakActive(page, true);
    await expect(page.getByTestId('game-screen')).toHaveAttribute(
      'data-phase-substate',
      'wall_break_select_wall',
    );
    expect(await readInteractiveWallEdges(page, 'breakable')).toEqual([
      hWall(2, 3),
      hWall(3, 3),
      vWall(3, 2),
      vWall(3, 3),
    ]);
    await assertInteractiveWallHitTargets(page);

    // Break East wall v(3,3) -> immediately unseals live score & unlocks 0-step stay + 3 normals
    await wallSlotLocator(page, vWall(3, 3)).click();
    await expect(placedWallLocator(page, vWall(3, 3))).toHaveCount(0);
    await expect(page.getByTestId('player-wallbreak-0')).toHaveAttribute('data-remaining', '0');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-territory-owner', 'none');
    await expect(territoryBadgeLocator(page, 3, 3)).toHaveCount(0);
    await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '0');

    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-valid-move', 'true');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-move-type', 'stay');
    expect(await readValidMoveCoords(page, 'normal')).toEqual([
      { row: 2, col: 4 },
      { row: 3, col: 4 },
      { row: 4, col: 4 },
    ]);
    await expect(page.locator('[data-valid-move="true"]')).toHaveCount(4);

    // Stay in place (0 steps) and reseal v(3,3)
    await moveSelectedTo(page, 3, 3);
    expect(await readInteractiveWallEdges(page, 'placeable')).toEqual([vWall(3, 3)]);
    await placeWallAt(page, vWall(3, 3));
    await expect(page.getByTestId('player-score-0')).toHaveAttribute('data-value', '1');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
  });

  test('T2-22 (E08): Wall Go I soft-lock guard rejects 0-target breakable piece and excludes occupied-side break wall', async ({
    page,
  }) => {
    const placements: readonly E2EPlacementStep[] = [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 2, col: 0 },
      { row: 6, col: 6 },
      { row: 4, col: 6 },
      { row: 4, col: 4 },
    ];

    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, placements);

    // Turns 1-3: box (0,0) behind h(0,0) [occupied (1,0)] and v(0,0) [occupied (0,1)]
    await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
    await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, vWall(0, 0));
    await playHumanTurn(page, { row: 2, col: 0 }, { row: 1, col: 0 }, vWall(1, 0));

    // Checkpoint 1 (Turn 4, P0): both sides occupied -> clicking (0,0) MUST be rejected
    await cellLocator(page, 0, 0).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-selected', 'false');
    await expect(page.locator('[data-wall-interactive="true"]')).toHaveCount(0);

    // Turns 4-6: P1 vacates (0,1) while P2 stays at (1,0)
    await playHumanTurn(page, { row: 4, col: 4 }, { row: 4, col: 4 }, hWall(4, 4));
    await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 2 }, hWall(0, 2));
    await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 6 }, vWall(6, 5));

    // Checkpoint 2 (Turn 7, P0): v(0,0) opens to empty (0,1) while h(0,0) still faces occupied (1,0)
    await cellLocator(page, 0, 0).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
    await ensureWallBreakActive(page, true);

    await expect(placedWallLocator(page, hWall(0, 0))).toBeVisible();
    await expect(wallSlotLocator(page, hWall(0, 0))).toHaveCount(0);
    expect(await readInteractiveWallEdges(page, 'breakable')).toEqual([vWall(0, 0)]);

    await wallSlotLocator(page, vWall(0, 0)).click();
    await moveSelectedTo(page, 0, 1);
    await placeWallAt(page, hWall(0, 1));
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
  });
});
