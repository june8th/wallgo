import { expect, test } from '@playwright/test';
import {
  DEFAULT_2P_PLACEMENTS,
  SCRIPT_A1_PLACEMENTS,
  boardPiecesLocator,
  cellLocator,
  completePlacement,
  configureLobby,
  coordLabel,
  hWall,
  openLobby,
  placePiece,
  placedWallLocator,
  playHumanTurn,
  playerCardLocator,
  readGameScreenState,
  readPieceAtCell,
  returnToLobby,
  runScriptF2,
  selectCell,
  startConfiguredGame,
  startGame,
  vWall,
} from './helpers/game.ts';
import { attachRuntimeErrorGuard, type RuntimeErrorGuard } from './helpers/network.ts';

test.describe('Tier 1 — Lobby, Match Setup & 2P/3P Initialization', { tag: '@tier1' }, () => {
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

  test('T1-01: Default lobby state and Korean HTML document contract', async ({ page }) => {
    await openLobby(page);

    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
    const viewportContent = await page
      .locator('meta[name="viewport"]')
      .getAttribute('content');
    expect(viewportContent ?? '', 'Viewport meta must include viewport-fit=cover').toContain(
      'viewport-fit=cover',
    );

    const lobby = page.getByTestId('lobby-screen');
    await expect(lobby).toBeVisible();
    await expect(lobby).toHaveRole('main');
    await expect(page.getByTestId('lobby-title')).toHaveText('벽바둑');

    await expect(page.getByTestId('variant-wallgo1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('variant-wallgo2')).toHaveAttribute('aria-pressed', 'false');

    await expect(page.getByTestId('format-3p')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('format-2p')).toHaveAttribute('aria-pressed', 'false');

    await expect(page.getByTestId('timer-0')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('timer-90')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('timer-60')).toHaveAttribute('aria-pressed', 'false');

    const shuffle = page.getByTestId('shuffle-order-toggle');
    await expect(shuffle).toHaveAttribute('role', 'switch');
    await expect(shuffle).toHaveAttribute('aria-checked', 'false');

    for (let i = 0; i < 3; i += 1) {
      await expect(page.getByTestId(`seat-row-${i}`)).toBeVisible();
      await expect(page.getByTestId(`seat-name-${i}`)).toHaveValue(`플레이어 ${i + 1}`);
      await expect(page.getByTestId(`seat-controller-${i}-human`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }

    const rulesBtn = page.getByTestId('rules-button');
    await expect(rulesBtn).toHaveCount(1);
    await expect(rulesBtn).toBeVisible();
    await expect(rulesBtn).toContainText('규칙 보기');

    const startBtn = page.getByTestId('start-game-button');
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toContainText('게임 시작');
    const startBox = await startBtn.boundingBox();
    expect(startBox, 'start-game-button must have a bounding box').not.toBeNull();
    if (startBox) {
      expect(startBox.height).toBeGreaterThanOrEqual(51.95);
    }
  });

  test('T1-02: Rule variant selector toggles Wall Go I and Wall Go II cleanly', async ({
    page,
  }) => {
    await openLobby(page);

    const wg1 = page.getByTestId('variant-wallgo1');
    const wg2 = page.getByTestId('variant-wallgo2');

    await wg2.click();
    await expect(wg2).toHaveAttribute('aria-pressed', 'true');
    await expect(wg1).toHaveAttribute('aria-pressed', 'false');

    await startGame(page);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-variant', 'wallgo2');
    await expect(page.getByTestId('game-topbar')).toContainText('벽바둑 II');

    await returnToLobby(page);

    await wg1.click();
    await expect(wg1).toHaveAttribute('aria-pressed', 'true');
    await expect(wg2).toHaveAttribute('aria-pressed', 'false');

    await startGame(page);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-variant', 'wallgo1');
    await expect(page.getByTestId('game-topbar')).toContainText('벽바둑');
    await expect(page.getByTestId('game-topbar')).not.toContainText('벽바둑 II');
  });

  test('T1-03: Match format selector switches between 3 seat rows and 2 seat rows', async ({
    page,
  }) => {
    await openLobby(page);

    await page.getByTestId('format-2p').click();
    await expect(page.getByTestId('format-2p')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('format-3p')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('seat-row-0')).toBeVisible();
    await expect(page.getByTestId('seat-row-1')).toBeVisible();
    await expect(page.getByTestId('seat-row-2')).toHaveCount(0);

    await page.getByTestId('format-3p').click();
    await expect(page.getByTestId('format-3p')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('format-2p')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('seat-row-0')).toBeVisible();
    await expect(page.getByTestId('seat-row-1')).toBeVisible();
    await expect(page.getByTestId('seat-row-2')).toBeVisible();
  });

  test('T1-04: Per-seat custom names and AI difficulty pills propagate to player cards', async ({
    page,
  }) => {
    await startConfiguredGame(page, {
      format: '3p',
      shuffleOrder: false,
      seats: [
        { name: '오현민', controller: 'human' },
        { name: '세븐하이', controller: 'ai-normal' },
        { name: '저스틴', controller: 'ai-hard' },
      ],
    });

    const card0 = playerCardLocator(page, 0);
    const card1 = playerCardLocator(page, 1);
    const card2 = playerCardLocator(page, 2);

    await expect(card0).toContainText('오현민');
    await expect(card0).toHaveAttribute('data-is-ai', 'false');

    await expect(card1).toContainText('세븐하이');
    await expect(card1).toHaveAttribute('data-is-ai', 'true');
    await expect(card1).toContainText(/AI 보통/);

    await expect(card2).toContainText('저스틴');
    await expect(card2).toHaveAttribute('data-is-ai', 'true');
    await expect(card2).toContainText(/AI 어려움/);
  });

  test('T1-05: Lobby timer options (90s, 60s, unlimited) propagate to game topbar', async ({
    page,
  }) => {
    await startConfiguredGame(page, { timerSeconds: 90 });
    await expect(page.getByTestId('turn-timer')).toBeVisible();
    await expect(page.getByTestId('turn-timer')).toHaveAttribute('data-seconds', '90');
    await expect(page.getByTestId('turn-timer')).toHaveText('01:30');
    await expect(page.getByTestId('timer-pause-button')).toBeVisible();

    await returnToLobby(page);
    await configureLobby(page, { timerSeconds: 60 });
    await startGame(page);
    await expect(page.getByTestId('turn-timer')).toBeVisible();
    await expect(page.getByTestId('turn-timer')).toHaveAttribute('data-seconds', '60');
    await expect(page.getByTestId('turn-timer')).toHaveText('01:00');

    await returnToLobby(page);
    await configureLobby(page, { timerSeconds: 0 });
    await startGame(page);
    await expect(page.getByTestId('turn-timer')).toHaveCount(0);
    await expect(page.getByTestId('timer-pause-button')).toHaveCount(0);
  });

  test('T1-06: Lobby configuration is preserved after returning from a match', async ({ page }) => {
    await startConfiguredGame(page, {
      variant: 'wallgo2',
      timerSeconds: 60,
      shuffleOrder: true,
      seats: [{ name: '김철수' }, undefined, { controller: 'ai-easy' }],
    });

    await returnToLobby(page);

    await expect(page.getByTestId('variant-wallgo2')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('timer-60')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('shuffle-order-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('seat-name-0')).toHaveValue('김철수');
    await expect(page.getByTestId('seat-controller-2-ai-easy')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('T1-07: 7x7 board grid renders brass coordinates (A-G, 1-7) and 49 empty placement cells', async ({
    page,
  }) => {
    await startConfiguredGame(page);

    const frame = page.getByTestId('board-frame');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveRole('region');

    const grid = page.getByTestId('board-grid');
    await expect(grid).toBeVisible();
    await expect(grid).toHaveAttribute('role', 'grid');

    for (const label of ['A', 'B', 'C', 'D', 'E', 'F', 'G', '1', '2', '3', '4', '5', '6', '7']) {
      await expect(frame).toContainText(label);
    }

    await expect(page.locator('[data-testid^="cell-"]')).toHaveCount(49);

    const samples = [
      { row: 0, col: 0 },
      { row: 3, col: 3 },
      { row: 0, col: 6 },
      { row: 6, col: 0 },
      { row: 6, col: 6 },
    ] as const;

    for (const { row, col } of samples) {
      const cell = cellLocator(page, row, col);
      await expect(cell).toHaveAttribute('data-row', String(row));
      await expect(cell).toHaveAttribute('data-col', String(col));
      await expect(cell).toHaveAttribute('data-coord', coordLabel(row, col));
      await expect(cell).toHaveAttribute('data-occupied-by', 'none');
      await expect(cell).toHaveAttribute('data-piece-id', 'none');
      await expect(cell).toHaveAttribute('data-piece-kind', 'none');
      await expect(cell).toHaveAttribute('data-valid-move', 'true');
      await expect(cell).toHaveAttribute('data-move-type', 'placement');
      await expect(cell).toHaveAttribute('data-territory-owner', 'none');
    }
  });

  test('T1-08: 3P Wall Go I snake placement queue [0,1,2,2,1,0] transitions into select_piece', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });

    const game = page.getByTestId('game-screen');
    const expectedOrder = [0, 1, 2, 2, 1, 0] as const;

    for (let i = 0; i < SCRIPT_A1_PLACEMENTS.length; i += 1) {
      const step = SCRIPT_A1_PLACEMENTS[i];
      const expectedPlayer = expectedOrder[i];
      if (!step || expectedPlayer === undefined) {
        continue;
      }

      await expect(game).toHaveAttribute('data-phase', 'placement');
      await expect(game).toHaveAttribute('data-current-player', String(expectedPlayer));
      await expect(playerCardLocator(page, expectedPlayer)).toHaveAttribute('data-active', 'true');

      await placePiece(page, step.row, step.col);

      const cell = cellLocator(page, step.row, step.col);
      await expect(cell).toHaveAttribute('data-occupied-by', String(expectedPlayer));
      await expect(cell).toHaveAttribute('data-piece-kind', 'standard');
    }

    await expect(game).toHaveAttribute('data-phase', 'select_piece');
    await expect(game).toHaveAttribute('data-current-player', '0');
    await expect(boardPiecesLocator(page)).toHaveCount(6);
    await expect(page.getByTestId('turn-banner')).toContainText('이동할 내 말을 선택하세요');
  });

  test('T1-09: 3P Wall Go I initial HUD displays variant, format, scores and 1 wall-break charge per seat', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-variant', 'wallgo1');
    await expect(game).toHaveAttribute('data-format', '3p');
    await expect(game).toHaveAttribute('data-round', '1');

    const topbar = page.getByTestId('game-topbar');
    await expect(topbar).toContainText('벽바둑');
    await expect(topbar).toContainText('3인전');

    for (let id = 0; id < 3; id += 1) {
      await expect(playerCardLocator(page, id)).toHaveAttribute('data-wall-breaks', '1');
      const wb = page.getByTestId(`player-wallbreak-${id}`);
      await expect(wb).toHaveAttribute('data-remaining', '1');
      await expect(wb).toContainText(/벽 부수기 1/);
      await expect(page.getByTestId(`player-score-${id}`)).toHaveAttribute('data-value', '0');
      await expect(page.getByTestId(`player-largest-${id}`)).toHaveAttribute('data-value', '0');
    }

    await expect(page.getByTestId('piece-kind-picker')).toHaveCount(0);

    const wbToggle = page.getByTestId('wall-break-toggle');
    await expect(wbToggle).toBeVisible();
    await expect(wbToggle).toBeDisabled();
  });

  test('T1-10: 3P Wall Go II piece-kind picker defaults to square and allows choosing round on 1st placement', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });

    const picker = page.getByTestId('piece-kind-picker');
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('role', 'group');

    const squareBtn = page.getByTestId('pick-piece-square');
    const roundBtn = page.getByTestId('pick-piece-round');

    await expect(squareBtn).toContainText('사각 말 (직선)');
    await expect(squareBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(squareBtn).toBeEnabled();

    await expect(roundBtn).toContainText('원형 말 (꺾임)');
    await expect(roundBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(roundBtn).toBeEnabled();

    await roundBtn.click();
    await expect(roundBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(squareBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('turn-banner')).toContainText('원형');

    await placePiece(page, 2, 2);
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-occupied-by', '0');
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-piece-kind', 'round');
  });

  test('T1-11: 3P Wall Go II auto-locks remaining piece kind on 2nd placement and hides picker after placement', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });

    const squareBtn = page.getByTestId('pick-piece-square');
    const roundBtn = page.getByTestId('pick-piece-round');

    // Step 0: P0 chooses round at (0,0)
    await placePiece(page, 0, 0, 'round');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-piece-kind', 'round');

    // Step 1: P1 places default square at (0,6)
    await placePiece(page, 0, 6, 'square');
    await expect(cellLocator(page, 0, 6)).toHaveAttribute('data-piece-kind', 'square');

    // Step 2: P2 chooses round at (6,0)
    await placePiece(page, 6, 0, 'round');
    await expect(cellLocator(page, 6, 0)).toHaveAttribute('data-piece-kind', 'round');

    // Step 3: P2's 2nd placement must auto-lock to square
    await expect(roundBtn).toBeDisabled();
    await expect(squareBtn).toBeEnabled();
    await expect(squareBtn).toHaveAttribute('aria-pressed', 'true');
    await placePiece(page, 6, 6);
    await expect(cellLocator(page, 6, 6)).toHaveAttribute('data-piece-kind', 'square');

    // Step 4: P1's 2nd placement must auto-lock to round
    await expect(squareBtn).toBeDisabled();
    await expect(roundBtn).toBeEnabled();
    await expect(roundBtn).toHaveAttribute('aria-pressed', 'true');
    await placePiece(page, 4, 6);
    await expect(cellLocator(page, 4, 6)).toHaveAttribute('data-piece-kind', 'round');

    // Step 5: P0's 2nd placement must auto-lock to square
    await expect(roundBtn).toBeDisabled();
    await expect(squareBtn).toBeEnabled();
    await expect(squareBtn).toHaveAttribute('aria-pressed', 'true');
    await placePiece(page, 4, 4);
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-piece-kind', 'square');

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
    await expect(page.getByTestId('piece-kind-picker')).toHaveCount(0);
    await expect(squareBtn).toHaveCount(0);
    await expect(roundBtn).toHaveCount(0);
  });

  test('T1-12: 3P turn order shuffle preserves all player identities and produces distinct orders', async ({
    page,
  }) => {
    const names = ['알파', '베타', '감마'] as const;

    await openLobby(page);
    await configureLobby(page, {
      variant: 'wallgo1',
      format: '3p',
      shuffleOrder: true,
      seats: [{ name: names[0] }, { name: names[1] }, { name: names[2] }],
    });

    const seenOrders = new Set<string>();

    for (let trial = 0; trial < 20; trial += 1) {
      await startGame(page);
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'placement');
      await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');

      const order: string[] = [];
      for (let id = 0; id < 3; id += 1) {
        const cardText = (await playerCardLocator(page, id).textContent()) ?? '';
        const matched = names.find((name) => cardText.includes(name));
        expect(
          matched,
          `player-card-${id} must display one of ${names.join(', ')} (got "${cardText}")`,
        ).toBeDefined();
        if (matched) {
          order.push(matched);
        }
      }

      expect([...order].sort()).toEqual([...names].sort());
      if (order[0]) {
        await expect(page.getByTestId('turn-banner')).toContainText(order[0]);
      }

      seenOrders.add(order.join(','));
      if (trial >= 1 && seenOrders.size >= 2) {
        break;
      }

      await returnToLobby(page);
      await expect(page.getByTestId('shuffle-order-toggle')).toHaveAttribute(
        'aria-checked',
        'true',
      );
    }

    expect(
      seenOrders.size,
      'Shuffle mode must produce at least 2 distinct seating permutations across trials',
    ).toBeGreaterThanOrEqual(2);
  });

  test('T1-13: Piece token child mirrors parent cell coordinates, owner, kind and selection state', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });

    await placePiece(page, 3, 3);

    const cell = cellLocator(page, 3, 3);
    await expect(cell).toHaveAttribute('data-coord', 'D4');
    await expect(cell).toHaveAttribute('data-occupied-by', '0');
    await expect(cell).not.toHaveAttribute('data-piece-id', 'none');

    const piece = await readPieceAtCell(page, 3, 3);
    expect(piece.owner).toBe(0);
    expect(piece.kind).toBe('standard');
    expect(piece.row).toBe(3);
    expect(piece.col).toBe(3);
    expect(piece.selected).toBe(false);
  });

  test('T1-14: Turn banner updates canonical Korean guidance across the full turn lifecycle', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });

    const banner = page.getByTestId('turn-banner');
    await expect(banner).toHaveAttribute('role', 'status');
    await expect(banner).toHaveAttribute('aria-live', 'polite');
    await expect(banner).toHaveAttribute('data-phase', 'placement');
    await expect(banner).toContainText('플레이어 1');
    await expect(banner).toContainText('말을 배치할 빈 칸을 선택하세요');
    await expect(banner).toHaveText(/\(\d+\/\d+\)/);

    await completePlacement(page, SCRIPT_A1_PLACEMENTS);
    await expect(banner).toHaveAttribute('data-phase', 'select_piece');
    await expect(banner).toContainText('플레이어 1');
    await expect(banner).toContainText('이동할 내 말을 선택하세요');

    await selectCell(page, 4, 4);
    await expect(banner).toHaveAttribute('data-phase', 'move_piece');
    await expect(banner).toContainText('플레이어 1');
    await expect(banner).toContainText('이동할 칸을 선택하세요');

    await cellLocator(page, 4, 3).click();
    await expect(banner).toHaveAttribute('data-phase', 'place_wall');
    await expect(banner).toContainText('플레이어 1');
    await expect(banner).toContainText('이동한 말 주변에 벽을 설치하세요');

    await page.getByTestId('wall-h-4-3').click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    await expect(banner).toHaveAttribute('data-current-player', '1');
    await expect(banner).toContainText('플레이어 2');
    await expect(banner).toContainText('이동할 내 말을 선택하세요');
  });

  test('T1-15: Standalone 2P Wall Go I pre-places 4 symmetric diagonal pieces (B2, F6, F2, B6)', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '2p', shuffleOrder: false });

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-variant', 'wallgo1');
    await expect(game).toHaveAttribute('data-format', '2p');
    await expect(game).toHaveAttribute('data-round', '1');
    await expect(game).toHaveAttribute('data-phase', 'placement');
    await expect(game).toHaveAttribute('data-current-player', '0');
    await expect(page.getByTestId('game-topbar')).toContainText('2인전');

    for (const { row, col, owner, coord } of [
      { row: 1, col: 1, owner: '0', coord: 'B2' },
      { row: 5, col: 5, owner: '0', coord: 'F6' },
      { row: 1, col: 5, owner: '1', coord: 'F2' },
      { row: 5, col: 1, owner: '1', coord: 'B6' },
    ]) {
      const cell = cellLocator(page, row, col);
      await expect(cell).toHaveAttribute('data-coord', coord);
      await expect(cell).toHaveAttribute('data-occupied-by', owner);
      await expect(cell).toHaveAttribute('data-piece-kind', 'standard');
    }

    await expect(boardPiecesLocator(page)).toHaveCount(4);
  });

  test('T1-16: Standalone 2P Wall Go I snake placement queue [0,1,1,0] builds an 8-piece board', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '2p', shuffleOrder: false });

    const game = page.getByTestId('game-screen');
    const expectedOrder = [0, 1, 1, 0] as const;

    for (let i = 0; i < DEFAULT_2P_PLACEMENTS.length; i += 1) {
      const step = DEFAULT_2P_PLACEMENTS[i];
      const expectedPlayer = expectedOrder[i];
      if (!step || expectedPlayer === undefined) {
        continue;
      }
      await expect(game).toHaveAttribute('data-current-player', String(expectedPlayer));
      await placePiece(page, step.row, step.col);
      await expect(cellLocator(page, step.row, step.col)).toHaveAttribute(
        'data-occupied-by',
        String(expectedPlayer),
      );
    }

    await expect(game).toHaveAttribute('data-phase', 'select_piece');
    await expect(game).toHaveAttribute('data-current-player', '0');
    await expect(boardPiecesLocator(page)).toHaveCount(8);
    await expect(boardPiecesLocator(page, 0)).toHaveCount(4);
    await expect(boardPiecesLocator(page, 1)).toHaveCount(4);
  });

  test('T1-17: Standalone 2P omits all 3P-only wall break controls and 3rd player card', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '2p', shuffleOrder: false });
    await completePlacement(page, DEFAULT_2P_PLACEMENTS);
    await selectCell(page, 1, 1);

    await expect(playerCardLocator(page, 0)).toBeVisible();
    await expect(playerCardLocator(page, 1)).toBeVisible();
    await expect(playerCardLocator(page, 2)).toHaveCount(0);
    await expect(page.getByTestId('player-wallbreak-0')).toHaveCount(0);
    await expect(page.getByTestId('player-wallbreak-1')).toHaveCount(0);
    await expect(page.getByTestId('wall-break-toggle')).toHaveCount(0);
  });

  test('T1-18: Standalone 2P Wall Go II uses fixed round pieces and auto-square snake placements', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo2', format: '2p', shuffleOrder: false });

    await expect(page.getByTestId('piece-kind-picker')).toHaveCount(0);

    for (const [row, col] of [
      [1, 1],
      [5, 5],
      [1, 5],
      [5, 1],
    ] as const) {
      await expect(cellLocator(page, row, col)).toHaveAttribute('data-piece-kind', 'round');
    }

    await completePlacement(page, DEFAULT_2P_PLACEMENTS);
    await expect(page.getByTestId('piece-kind-picker')).toHaveCount(0);

    for (const step of DEFAULT_2P_PLACEMENTS) {
      await expect(cellLocator(page, step.row, step.col)).toHaveAttribute(
        'data-piece-kind',
        'square',
      );
    }
  });

  test('T1-19: Standalone 2P Wall Go I executes alternating legal turns (0 -> 1 -> 0)', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '2p', shuffleOrder: false });
    await completePlacement(page, DEFAULT_2P_PLACEMENTS);

    const initialTurn = (await readGameScreenState(page)).turnNumber;

    await playHumanTurn(page, { row: 1, col: 1 }, { row: 0, col: 1 }, vWall(0, 1));
    await expect(cellLocator(page, 0, 1)).toHaveAttribute('data-occupied-by', '0');
    await expect(placedWallLocator(page, vWall(0, 1))).toHaveAttribute('data-owner', '0');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    expect((await readGameScreenState(page)).turnNumber).toBe(initialTurn + 1);

    await playHumanTurn(page, { row: 1, col: 5 }, { row: 1, col: 4 }, hWall(1, 4));
    await expect(cellLocator(page, 1, 4)).toHaveAttribute('data-occupied-by', '1');
    await expect(placedWallLocator(page, hWall(1, 4))).toHaveAttribute('data-owner', '1');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
    expect((await readGameScreenState(page)).turnNumber).toBe(initialTurn + 2);
  });

  test('T1-20: Standalone 2P Wall Go II executes fixed round diagonal and placed square 2-step straight', async ({
    page,
  }) => {
    await runScriptF2(page);

    await expect(cellLocator(page, 0, 2)).toHaveAttribute('data-occupied-by', '0');
    await expect(cellLocator(page, 0, 2)).toHaveAttribute('data-piece-kind', 'round');
    await expect(placedWallLocator(page, hWall(0, 2))).toHaveAttribute('data-owner', '0');

    await expect(cellLocator(page, 0, 4)).toHaveAttribute('data-occupied-by', '1');
    await expect(cellLocator(page, 0, 4)).toHaveAttribute('data-piece-kind', 'square');
    await expect(placedWallLocator(page, vWall(0, 4))).toHaveAttribute('data-owner', '1');

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
  });
});
