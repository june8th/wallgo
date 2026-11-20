import { expect, test } from '@playwright/test';
import {
  SCRIPT_A1_PLACEMENTS,
  SCRIPT_B_PLACEMENTS,
  cancelTurnMove,
  cellLocator,
  completePlacement,
  hWall,
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
  toggleWallBreak,
  vWall,
  wallSlotLocator,
  type E2EPlacementStep,
} from './helpers/game.ts';
import { assertInteractiveWallHitTargets } from './helpers/layout.ts';
import { attachRuntimeErrorGuard, type RuntimeErrorGuard } from './helpers/network.ts';

const OPEN_CENTER_WG1_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 3, col: 3 },
  { row: 0, col: 6 },
  { row: 6, col: 0 },
  { row: 6, col: 6 },
  { row: 6, col: 3 },
  { row: 0, col: 0 },
];

const OPEN_CENTER_WG2_SQUARE_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 3, col: 3, kind: 'square' },
  { row: 0, col: 6, kind: 'square' },
  { row: 6, col: 0, kind: 'square' },
  { row: 6, col: 6, kind: 'round' },
  { row: 6, col: 3, kind: 'round' },
  { row: 0, col: 0, kind: 'round' },
];

const OPEN_CENTER_WG2_ROUND_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 3, col: 3, kind: 'round' },
  { row: 0, col: 6, kind: 'round' },
  { row: 6, col: 0, kind: 'round' },
  { row: 6, col: 6, kind: 'square' },
  { row: 6, col: 3, kind: 'square' },
  { row: 0, col: 0, kind: 'square' },
];

test.describe('Tier 1 — Movement, Wall Placement, Cancel & 3P Wall Break', { tag: '@tier1' }, () => {
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

  test('T1-21: Wall Go I open center piece highlights exact 13 valid destinations (12 normal + 1 stay)', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, OPEN_CENTER_WG1_PLACEMENTS);

    await selectCell(page, 3, 3);

    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-valid-move', 'true');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-move-type', 'stay');

    const expectedNormals = [
      { row: 1, col: 3 },
      { row: 2, col: 2 },
      { row: 2, col: 3 },
      { row: 2, col: 4 },
      { row: 3, col: 1 },
      { row: 3, col: 2 },
      { row: 3, col: 4 },
      { row: 3, col: 5 },
      { row: 4, col: 2 },
      { row: 4, col: 3 },
      { row: 4, col: 4 },
      { row: 5, col: 3 },
    ];

    expect(await readValidMoveCoords(page, 'normal')).toEqual(expectedNormals);
    expect(await readValidMoveCoords(page, 'stay')).toEqual([{ row: 3, col: 3 }]);
    await expect(page.locator('[data-valid-move="true"]')).toHaveCount(13);

    await expect(cellLocator(page, 0, 3)).toHaveAttribute('data-valid-move', 'false');
    await expect(cellLocator(page, 3, 6)).toHaveAttribute('data-valid-move', 'false');
    await expect(page.getByTestId('turn-banner')).toContainText('제자리 유지 가능');
  });

  test('T1-22: Wall Go I executes 2-step straight and 1-step orthogonal moves', async ({ page }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, OPEN_CENTER_WG1_PLACEMENTS);

    await playHumanTurn(page, { row: 3, col: 3 }, { row: 3, col: 5 }, hWall(3, 5));
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', 'none');
    await expect(cellLocator(page, 3, 5)).toHaveAttribute('data-occupied-by', '0');
    await expect(placedWallLocator(page, hWall(3, 5))).toHaveAttribute('data-owner', '0');

    await playHumanTurn(page, { row: 0, col: 6 }, { row: 1, col: 6 }, vWall(1, 5));
    await expect(cellLocator(page, 0, 6)).toHaveAttribute('data-occupied-by', 'none');
    await expect(cellLocator(page, 1, 6)).toHaveAttribute('data-occupied-by', '1');
    await expect(placedWallLocator(page, vWall(1, 5))).toHaveAttribute('data-owner', '1');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
  });

  test('T1-23: Wall Go I executes 2-step 90-degree L-turn move', async ({ page }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, OPEN_CENTER_WG1_PLACEMENTS);

    await playHumanTurn(page, { row: 3, col: 3 }, { row: 2, col: 4 }, hWall(1, 4));

    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', 'none');
    await expect(cellLocator(page, 2, 4)).toHaveAttribute('data-occupied-by', '0');
    await expect(placedWallLocator(page, hWall(1, 4))).toHaveAttribute('data-owner', '0');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
  });

  test('T1-24: Wall Go I conditional 0-step stay-in-place succeeds when at least 1 adjacent cell is open', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, SCRIPT_A1_PLACEMENTS);

    await selectCell(page, 0, 0);
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-valid-move', 'true');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-move-type', 'stay');

    await cellLocator(page, 0, 0).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
    await expect(cellLocator(page, 0, 0)).toHaveAttribute('data-occupied-by', '0');
    await expect(wallSlotLocator(page, hWall(0, 0))).toBeVisible();
    await expect(wallSlotLocator(page, vWall(0, 0))).toBeVisible();

    await placeWallAt(page, hWall(0, 0));
    await expect(placedWallLocator(page, hWall(0, 0))).toHaveAttribute('data-owner', '0');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
  });

  test('T1-25: Wall Go I switches selection cleanly between own pieces before moving', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, [
      { row: 2, col: 2 },
      { row: 0, col: 6 },
      { row: 6, col: 0 },
      { row: 6, col: 6 },
      { row: 0, col: 5 },
      { row: 4, col: 4 },
    ]);

    const pieceA = await readPieceAtCell(page, 2, 2);
    const pieceB = await readPieceAtCell(page, 4, 4);

    await selectCell(page, 2, 2);
    await expect(page.getByTestId(`piece-${pieceA.id}`)).toHaveAttribute('data-selected', 'true');
    await expect(cellLocator(page, 1, 2)).toHaveAttribute('data-valid-move', 'true');

    await selectCell(page, 4, 4);
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-selected', 'false');
    await expect(page.getByTestId(`piece-${pieceA.id}`)).toHaveAttribute('data-selected', 'false');
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId(`piece-${pieceB.id}`)).toHaveAttribute('data-selected', 'true');
    await expect(cellLocator(page, 4, 5)).toHaveAttribute('data-valid-move', 'true');
    await expect(cellLocator(page, 1, 2)).toHaveAttribute('data-valid-move', 'false');
  });

  test('T1-26: Wall Go II square piece highlights exact 8 straight orthogonal moves (no diagonals, no stay)', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });
    await completePlacement(page, OPEN_CENTER_WG2_SQUARE_PLACEMENTS);

    await selectCell(page, 3, 3);

    const expectedStraight = [
      { row: 1, col: 3 },
      { row: 2, col: 3 },
      { row: 3, col: 1 },
      { row: 3, col: 2 },
      { row: 3, col: 4 },
      { row: 3, col: 5 },
      { row: 4, col: 3 },
      { row: 5, col: 3 },
    ];

    expect(await readValidMoveCoords(page, 'normal')).toEqual(expectedStraight);
    await expect(page.locator('[data-valid-move="true"]')).toHaveCount(8);

    for (const [r, c] of [
      [3, 3],
      [2, 2],
      [2, 4],
      [4, 2],
      [4, 4],
    ] as const) {
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-valid-move', 'false');
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-move-type', 'none');
    }
    await expect(page.getByTestId('turn-banner')).not.toContainText('제자리 유지 가능');
  });

  test('T1-27: Wall Go II square piece executes 2-step and 1-step straight orthogonal moves', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });
    await completePlacement(page, OPEN_CENTER_WG2_SQUARE_PLACEMENTS);

    await playHumanTurn(page, { row: 3, col: 3 }, { row: 3, col: 5 }, hWall(3, 5));
    await expect(cellLocator(page, 3, 5)).toHaveAttribute('data-occupied-by', '0');
    await expect(cellLocator(page, 3, 5)).toHaveAttribute('data-piece-kind', 'square');

    await playHumanTurn(page, { row: 0, col: 6 }, { row: 1, col: 6 }, vWall(1, 5));
    await expect(cellLocator(page, 1, 6)).toHaveAttribute('data-occupied-by', '1');
    await expect(cellLocator(page, 1, 6)).toHaveAttribute('data-piece-kind', 'square');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
  });

  test('T1-28: Wall Go II round piece highlights exact 8 moves (4 ortho-1 + 4 diagonal, no straight-2, no stay)', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });
    await completePlacement(page, OPEN_CENTER_WG2_ROUND_PLACEMENTS);

    await selectCell(page, 3, 3);

    const expectedRound = [
      { row: 2, col: 2 },
      { row: 2, col: 3 },
      { row: 2, col: 4 },
      { row: 3, col: 2 },
      { row: 3, col: 4 },
      { row: 4, col: 2 },
      { row: 4, col: 3 },
      { row: 4, col: 4 },
    ];

    expect(await readValidMoveCoords(page, 'normal')).toEqual(expectedRound);
    await expect(page.locator('[data-valid-move="true"]')).toHaveCount(8);

    for (const [r, c] of [
      [3, 3],
      [1, 3],
      [5, 3],
      [3, 1],
      [3, 5],
    ] as const) {
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-valid-move', 'false');
      await expect(cellLocator(page, r, c)).toHaveAttribute('data-move-type', 'none');
    }
  });

  test('T1-29: Wall Go II round piece executes 90-degree diagonal and 1-step orthogonal moves', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });
    await completePlacement(page, OPEN_CENTER_WG2_ROUND_PLACEMENTS);

    await playHumanTurn(page, { row: 3, col: 3 }, { row: 4, col: 4 }, hWall(4, 4));
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-occupied-by', '0');
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-piece-kind', 'round');
    await expect(placedWallLocator(page, hWall(4, 4))).toBeVisible();

    await playHumanTurn(page, { row: 0, col: 6 }, { row: 0, col: 5 }, hWall(0, 5));
    await expect(cellLocator(page, 0, 5)).toHaveAttribute('data-occupied-by', '1');
    await expect(cellLocator(page, 0, 5)).toHaveAttribute('data-piece-kind', 'round');
    await expect(placedWallLocator(page, hWall(0, 5))).toBeVisible();
  });

  test('T1-30: Wall Go II round piece uses alternate open L-path when one intermediate cell is occupied', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo2', format: '3p', shuffleOrder: false });
    await completePlacement(page, [
      { row: 3, col: 3, kind: 'round' },
      { row: 3, col: 4, kind: 'square' },
      { row: 6, col: 6, kind: 'square' },
      { row: 6, col: 0, kind: 'round' },
      { row: 0, col: 6, kind: 'round' },
      { row: 0, col: 0, kind: 'square' },
    ]);

    await selectCell(page, 3, 3);
    await expect(cellLocator(page, 3, 4)).toHaveAttribute('data-valid-move', 'false');
    await expect(cellLocator(page, 4, 3)).toHaveAttribute('data-valid-move', 'true');
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-valid-move', 'true');
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-move-type', 'normal');

    await cellLocator(page, 4, 4).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-occupied-by', '0');
  });

  test('T1-31: Interior cell mounts exact 4 placeable wall hit targets (>=48x48px, reachable)', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, OPEN_CENTER_WG1_PLACEMENTS);

    await selectCell(page, 3, 3);
    await cellLocator(page, 3, 4).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');

    const edges = await readInteractiveWallEdges(page, 'placeable');
    expect(edges).toEqual([hWall(2, 4), hWall(3, 4), vWall(3, 3), vWall(3, 4)]);
    await expect(page.locator('[data-wall-interactive="true"]')).toHaveCount(4);

    await assertInteractiveWallHitTargets(page);
  });

  test('T1-32: Corner cell (0,0) exposes only 2 internal wall slots (immutable outer perimeter)', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, SCRIPT_A1_PLACEMENTS);

    await selectCell(page, 0, 0);
    await cellLocator(page, 0, 0).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');

    const edges = await readInteractiveWallEdges(page, 'placeable');
    expect(edges).toEqual([hWall(0, 0), vWall(0, 0)]);
    await expect(page.locator('[data-wall-interactive="true"]')).toHaveCount(2);

    await assertInteractiveWallHitTargets(page);
  });

  test('T1-33: Placed walls track owner metadata, single data-last-wall transfer, and relative turn increment', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, [
      { row: 2, col: 2 },
      { row: 4, col: 5 },
      { row: 6, col: 6 },
      { row: 6, col: 4 },
      { row: 0, col: 6 },
      { row: 0, col: 0 },
    ]);

    const turn0 = (await readGameScreenState(page)).turnNumber;

    await playHumanTurn(page, { row: 2, col: 2 }, { row: 2, col: 3 }, vWall(2, 3));
    const wall1 = placedWallLocator(page, vWall(2, 3));
    await expect(wall1).toHaveAttribute('data-owner', '0');
    await expect(wall1).toHaveAttribute('data-last-wall', 'true');
    await expect(page.locator('[data-last-wall="true"]')).toHaveCount(1);
    expect((await readGameScreenState(page)).turnNumber).toBe(turn0 + 1);

    await playHumanTurn(page, { row: 4, col: 5 }, { row: 4, col: 5 }, hWall(4, 5));
    const wall2 = placedWallLocator(page, hWall(4, 5));
    await expect(wall2).toHaveAttribute('data-owner', '1');
    await expect(wall2).toHaveAttribute('data-last-wall', 'true');
    await expect(wall1).toHaveAttribute('data-last-wall', 'false');
    await expect(page.locator('[data-last-wall="true"]')).toHaveCount(1);
    expect((await readGameScreenState(page)).turnNumber).toBe(turn0 + 2);
  });

  test('T1-34: Intra-turn cancel-move-button reverts a normal move cleanly and permits re-moving', async ({
    page,
  }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, [
      { row: 2, col: 2 },
      { row: 0, col: 6 },
      { row: 6, col: 0 },
      { row: 6, col: 6 },
      { row: 4, col: 6 },
      { row: 4, col: 4 },
    ]);

    const turnBefore = (await readGameScreenState(page)).turnNumber;
    const cancelBtn = page.getByTestId('cancel-move-button');

    await selectCell(page, 2, 2);
    await expect(cancelBtn).toBeDisabled();

    await cellLocator(page, 2, 4).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
    await expect(cancelBtn).toBeEnabled();

    await cancelTurnMove(page);

    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
    expect((await readGameScreenState(page)).turnNumber).toBe(turnBefore);
    await expect(cellLocator(page, 2, 4)).toHaveAttribute('data-occupied-by', 'none');
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-occupied-by', '0');
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-selected', 'true');
    await expect(page.locator('[data-wall-interactive="true"]')).toHaveCount(0);
    await expect(cancelBtn).toBeDisabled();

    // Complete a different legal move on the same turn
    await cellLocator(page, 1, 2).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
    await placeWallAt(page, hWall(0, 2));
    await expect(cellLocator(page, 1, 2)).toHaveAttribute('data-occupied-by', '0');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
    expect((await readGameScreenState(page)).turnNumber).toBe(turnBefore + 1);
  });

  test('T1-35: Placed wall universally blocks its own builder on later turns', async ({ page }) => {
    await startConfiguredGame(page, { variant: 'wallgo1', format: '3p', shuffleOrder: false });
    await completePlacement(page, SCRIPT_B_PLACEMENTS);

    // Turn 1 (P0): places v(2,2) between (2,2) and (2,3)
    await playHumanTurn(page, { row: 2, col: 2 }, { row: 2, col: 2 }, vWall(2, 2));
    // Turn 2 (P1): vacates (2,3) by moving East to (2,4)
    await playHumanTurn(page, { row: 2, col: 3 }, { row: 2, col: 4 }, hWall(2, 4));
    // Turn 3 (P2): unrelated turn far away
    await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 6 }, vWall(6, 5));

    // Turn 4 (P0): (2,3) is empty, but P0's own wall v(2,2) blocks P0 from reaching it in <=2 steps
    await expect(placedWallLocator(page, vWall(2, 2))).toHaveAttribute('data-owner', '0');
    await expect(cellLocator(page, 2, 3)).toHaveAttribute('data-occupied-by', 'none');

    await selectCell(page, 2, 2);
    await expect(cellLocator(page, 2, 3)).toHaveAttribute('data-valid-move', 'false');
    await expect(cellLocator(page, 2, 3)).toHaveAttribute('data-move-type', 'none');
  });

  test('T1-36: Wall Go I 3P wall break destroys opponent wall, unlocks cell, moves through and places wall', async ({
    page,
  }) => {
    await runScriptBSetup(page);

    // Turn 5 (P1): (2,2) is empty but unreachable around P0's wall v(2,2)
    await selectCell(page, 2, 3);
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-valid-move', 'false');

    await toggleWallBreak(page, true);
    await expect(page.getByTestId('game-screen')).toHaveAttribute(
      'data-phase-substate',
      'wall_break_select_wall',
    );

    const breakableWall = wallSlotLocator(page, vWall(2, 2));
    await expect(breakableWall).toHaveAttribute('data-wall-state', 'breakable');
    await assertInteractiveWallHitTargets(page);

    await breakableWall.click();
    await expect(placedWallLocator(page, vWall(2, 2))).toHaveCount(0);
    await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '0');
    await expect(page.getByTestId('cancel-move-button')).toBeEnabled();
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-valid-move', 'true');

    await cellLocator(page, 2, 2).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
    await placeWallAt(page, hWall(1, 2));

    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-occupied-by', '1');
    await expect(playerCardLocator(page, 1)).toHaveAttribute('data-wall-breaks', '0');
    await expect(placedWallLocator(page, hWall(1, 2))).toHaveAttribute('data-owner', '1');
    await expect(placedWallLocator(page, hWall(1, 2))).toHaveAttribute('data-last-wall', 'true');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
  });

  test('T1-37: Wall Go I post-break cancel-move-button restores broken wall with original ownerId and charge', async ({
    page,
  }) => {
    await runScriptBSetup(page);

    await selectCell(page, 2, 3);
    await toggleWallBreak(page, true);
    await wallSlotLocator(page, vWall(2, 2)).click();

    await expect(placedWallLocator(page, vWall(2, 2))).toHaveCount(0);
    await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '0');

    await cellLocator(page, 2, 2).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');

    await cancelTurnMove(page);

    await expect(cellLocator(page, 2, 3)).toHaveAttribute('data-occupied-by', '1');
    await expect(cellLocator(page, 2, 3)).toHaveAttribute('data-selected', 'true');
    await expect(cellLocator(page, 2, 2)).toHaveAttribute('data-occupied-by', 'none');

    const restoredWall = placedWallLocator(page, vWall(2, 2));
    await expect(restoredWall).toBeVisible();
    await expect(restoredWall).toHaveAttribute('data-owner', '0');

    await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '1');
    await expect(page.getByTestId('wall-break-toggle')).toBeEnabled();
    await expect(page.getByTestId('wall-break-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  test('T1-38: Wall Go II square piece single-wall 2-step straight path break', async ({ page }) => {
    await runScriptC3Setup(page);

    // Turn 5 (P1 square @(3,1)): v(3,1) blocks both (3,2) and (3,3)
    await selectCell(page, 3, 1);
    await expect(cellLocator(page, 3, 2)).toHaveAttribute('data-valid-move', 'false');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-valid-move', 'false');

    await toggleWallBreak(page, true);
    await expect(page.getByTestId('game-screen')).toHaveAttribute(
      'data-phase-substate',
      'wall_break_move',
    );
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-valid-move', 'true');
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-move-type', 'wall-break');

    await cellLocator(page, 3, 3).click();
    await expect(placedWallLocator(page, vWall(3, 1))).toHaveCount(0);
    await expect(cellLocator(page, 3, 3)).toHaveAttribute('data-occupied-by', '1');
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
    await expect(page.getByTestId('player-wallbreak-1')).toHaveAttribute('data-remaining', '0');

    await placeWallAt(page, hWall(3, 3));
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
  });

  test('T1-39: Wall Go II round piece single-wall path break enters place_wall directly', async ({
    page,
  }) => {
    await runScriptCSetup(page);

    // Turn 6 (P2 round @(3,3)): single wall v(3,3) separates (3,3) -> (3,4)
    await selectCell(page, 3, 3);
    await expect(cellLocator(page, 3, 4)).toHaveAttribute('data-valid-move', 'false');

    await toggleWallBreak(page, true);
    await expect(cellLocator(page, 3, 4)).toHaveAttribute('data-valid-move', 'true');
    await expect(cellLocator(page, 3, 4)).toHaveAttribute('data-move-type', 'wall-break');

    await cellLocator(page, 3, 4).click();
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
    await expect(placedWallLocator(page, vWall(3, 3))).toHaveCount(0);
    await expect(placedWallLocator(page, hWall(3, 3))).toBeVisible();
    await expect(cellLocator(page, 3, 4)).toHaveAttribute('data-occupied-by', '2');
    await expect(page.getByTestId('player-wallbreak-2')).toHaveAttribute('data-remaining', '0');

    await placeWallAt(page, hWall(3, 4));
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
  });

  test('T1-40: Wall Go II 2-wall ambiguous diagonal break enters choose_break_wall and breaks chosen wall only', async ({
    page,
  }) => {
    await runScriptCSetup(page);

    // Turn 6 (P2 round @(3,3)): both L-paths to (4,4) have 1 wall: v(3,3) vs h(3,3)
    await selectCell(page, 3, 3);
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-valid-move', 'false');

    await toggleWallBreak(page, true);
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-valid-move', 'true');
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-move-type', 'wall-break');

    await cellLocator(page, 4, 4).click();

    const game = page.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-phase', 'move_piece');
    await expect(game).toHaveAttribute('data-phase-substate', 'choose_break_wall');
    await expect(page.getByTestId('turn-banner')).toContainText('경로 위 부술 벽 1개를 선택하세요');
    await expect(page.getByTestId('cancel-move-button')).toBeEnabled();

    const choiceEdges = await readInteractiveWallEdges(page, 'breakable-choice');
    expect(choiceEdges).toEqual([hWall(3, 3), vWall(3, 3)]);
    await expect(page.locator('[data-wall-interactive="true"]')).toHaveCount(2);
    await assertInteractiveWallHitTargets(page);

    await wallSlotLocator(page, vWall(3, 3)).click();
    await expect(placedWallLocator(page, vWall(3, 3))).toHaveCount(0);
    await expect(placedWallLocator(page, hWall(3, 3))).toBeVisible();
    await expect(cellLocator(page, 4, 4)).toHaveAttribute('data-occupied-by', '2');
    await expect(game).toHaveAttribute('data-phase', 'place_wall');
    await expect(page.getByTestId('player-wallbreak-2')).toHaveAttribute('data-remaining', '0');

    await placeWallAt(page, hWall(4, 4));
    await expect(game).toHaveAttribute('data-current-player', '0');
  });
});
