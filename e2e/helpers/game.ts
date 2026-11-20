import { expect, type Locator, type Page } from '@playwright/test';

export type E2ERuleVariant = 'wallgo1' | 'wallgo2';
export type E2EGameFormat = '3p' | '2p';
export type E2ETimerSeconds = 0 | 90 | 60;
export type E2ESeatController = 'human' | 'ai-easy' | 'ai-normal' | 'ai-hard';
export type E2EPieceKind = 'standard' | 'square' | 'round';
export type E2EPlacementKind = 'square' | 'round';
export type E2EWallOrientation = 'h' | 'v';
export type E2EGamePhase = 'placement' | 'select_piece' | 'move_piece' | 'place_wall' | 'game_over';
export type E2EPhaseSubstate =
  | 'idle'
  | 'wall_break_select_wall'
  | 'wall_break_move'
  | 'choose_break_wall';
export type E2EMoveType = 'none' | 'normal' | 'stay' | 'wall-break' | 'placement';
export type E2EWallState = 'placeable' | 'breakable' | 'breakable-choice';
export type E2ERulesTab = 'wallgo1' | 'wallgo2' | 'scoring';

export interface E2ECellPos {
  readonly row: number;
  readonly col: number;
}

export interface E2EWallEdge {
  readonly orientation: E2EWallOrientation;
  readonly row: number;
  readonly col: number;
}

export interface E2ESeatConfig {
  readonly name?: string;
  readonly controller?: E2ESeatController;
}

export interface E2ELobbyOptions {
  readonly variant?: E2ERuleVariant;
  readonly format?: E2EGameFormat;
  readonly timerSeconds?: E2ETimerSeconds;
  readonly shuffleOrder?: boolean;
  readonly seats?: readonly (E2ESeatConfig | undefined)[];
}

export interface E2EPlacementStep extends E2ECellPos {
  readonly kind?: E2EPlacementKind;
}

export interface GameScreenState {
  readonly variant: E2ERuleVariant;
  readonly format: E2EGameFormat;
  readonly round: number;
  readonly phase: E2EGamePhase;
  readonly phaseSubstate: E2EPhaseSubstate;
  readonly currentPlayer: number;
  readonly turnNumber: number;
  readonly aiThinking: boolean;
  readonly wallBreakActive: boolean;
}

export interface CellState {
  readonly row: number;
  readonly col: number;
  readonly coord: string;
  readonly occupiedBy: number | null;
  readonly pieceId: string | null;
  readonly pieceKind: E2EPieceKind | null;
  readonly validMove: boolean;
  readonly moveType: E2EMoveType;
  readonly selected: boolean;
  readonly territoryOwner: number | null;
  readonly territorySize: number;
}

export interface PieceTokenState {
  readonly id: string;
  readonly owner: number;
  readonly kind: E2EPieceKind;
  readonly row: number;
  readonly col: number;
  readonly selected: boolean;
}

export interface PlayerCardState {
  readonly playerId: number;
  readonly active: boolean;
  readonly autoSkipped: boolean;
  readonly isAI: boolean;
  readonly wallBreaks: number;
  readonly score: number;
  readonly largest: number;
  readonly wallBreakPillRemaining: number | null;
}

export interface HumanTurnResult {
  readonly from: E2ECellPos;
  readonly to: E2ECellPos;
  readonly wall: E2EWallEdge;
  readonly usedWallBreak?: boolean;
  readonly brokenWall?: E2EWallEdge;
}

export const CLOCK_T0 = new Date('2026-11-20T12:00:00.000Z').getTime();

const COL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

export function coordLabel(row: number, col: number): string {
  const colChar = COL_LABELS[col];
  if (!colChar || row < 0 || row > 6) {
    throw new Error(`Out-of-bounds board coordinate (${row}, ${col})`);
  }
  return `${colChar}${row + 1}`;
}

export function hWall(row: number, col: number): E2EWallEdge {
  return { orientation: 'h', row, col };
}

export function vWall(row: number, col: number): E2EWallEdge {
  return { orientation: 'v', row, col };
}

// --- Deterministic Standard Placement Presets ---

export const DEFAULT_3P_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 1, col: 1 },
  { row: 1, col: 5 },
  { row: 5, col: 3 },
  { row: 3, col: 5 },
  { row: 5, col: 1 },
  { row: 3, col: 1 },
];

export const DEFAULT_3P_WG2_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 1, col: 1, kind: 'square' },
  { row: 1, col: 5, kind: 'square' },
  { row: 5, col: 3, kind: 'square' },
  { row: 3, col: 5, kind: 'round' },
  { row: 5, col: 1, kind: 'round' },
  { row: 3, col: 1, kind: 'round' },
];

export const DEFAULT_2P_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 2, col: 2 },
  { row: 2, col: 4 },
  { row: 4, col: 2 },
  { row: 4, col: 4 },
];

// --- Oracle-Verified Script Placement Sequences ---

export const SCRIPT_A1_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 0, col: 0 },
  { row: 0, col: 1 },
  { row: 6, col: 6 },
  { row: 6, col: 4 },
  { row: 4, col: 6 },
  { row: 4, col: 4 },
];

export const SCRIPT_A2_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 0, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: 2 },
  { row: 6, col: 6 },
  { row: 4, col: 6 },
  { row: 4, col: 4 },
];

export const SCRIPT_A3_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 0, col: 0 },
  { row: 0, col: 1 },
  { row: 4, col: 6 },
  { row: 6, col: 4 },
  { row: 5, col: 5 },
  { row: 6, col: 6 },
];

export const SCRIPT_B_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 2, col: 2 },
  { row: 2, col: 3 },
  { row: 6, col: 6 },
  { row: 6, col: 4 },
  { row: 4, col: 6 },
  { row: 4, col: 2 },
];

export const SCRIPT_C_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 2, col: 4, kind: 'square' },
  { row: 4, col: 2, kind: 'square' },
  { row: 3, col: 3, kind: 'round' },
  { row: 6, col: 6, kind: 'square' },
  { row: 6, col: 0, kind: 'round' },
  { row: 0, col: 6, kind: 'round' },
];

export const SCRIPT_C3_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 2, col: 2, kind: 'square' },
  { row: 3, col: 1, kind: 'square' },
  { row: 6, col: 6, kind: 'round' },
  { row: 6, col: 4, kind: 'square' },
  { row: 6, col: 0, kind: 'round' },
  { row: 0, col: 6, kind: 'round' },
];

export const SCRIPT_D_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 1, col: 0 },
  { row: 5, col: 0 },
  { row: 0, col: 0 },
  { row: 0, col: 1 },
  { row: 5, col: 1 },
  { row: 5, col: 2 },
];

export const SCRIPT_E_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 1, col: 0 },
  { row: 5, col: 5 },
  { row: 0, col: 0 },
  { row: 0, col: 1 },
  { row: 3, col: 5 },
  { row: 1, col: 2 },
];

// --- Contract Locators ---

export function cellLocator(page: Page, row: number, col: number): Locator {
  return page.getByTestId(`cell-${row}-${col}`);
}

export function wallSlotLocator(page: Page, edge: E2EWallEdge): Locator {
  return page.getByTestId(`wall-${edge.orientation}-${edge.row}-${edge.col}`);
}

export function placedWallLocator(page: Page, edge: E2EWallEdge): Locator {
  return page.getByTestId(`placed-wall-${edge.orientation}-${edge.row}-${edge.col}`);
}

export function territoryBadgeLocator(page: Page, row: number, col: number): Locator {
  return page.getByTestId(`territory-badge-${row}-${col}`);
}

export function boardPiecesLocator(page: Page, ownerId?: number): Locator {
  const selector =
    ownerId === undefined
      ? '[data-testid^="piece-"][data-owner]'
      : `[data-testid^="piece-"][data-owner="${ownerId}"]`;
  return page.getByTestId('board-grid').locator(selector);
}

export function playerCardLocator(page: Page, playerId: number): Locator {
  return page.getByTestId(`player-card-${playerId}`);
}

// --- Lobby Configuration & Launch ---

export async function openLobby(page: Page): Promise<void> {
  const response = await page.goto('/', { waitUntil: 'load' });
  expect(response?.ok(), 'Initial navigation to / must succeed with HTTP 2xx').toBe(true);
  await expect(page.getByTestId('lobby-screen')).toBeVisible();
}

/**
 * Installs Playwright fake clock before navigating to Lobby, then pauses the clock
 * strictly in the future (`Date.now() + 10_000`) so slow VM page loads can never
 * trigger `Error("Cannot fast-forward to the past")` while zero game timers run on Lobby.
 */
export async function openLobbyWithPausedClock(
  page: Page,
  initialTimeMs: number = CLOCK_T0,
): Promise<void> {
  await page.clock.install({ time: initialTimeMs });
  await openLobby(page);
  const nowMs = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(nowMs + 10_000);
}

export async function configureLobby(page: Page, options: E2ELobbyOptions = {}): Promise<void> {
  if (options.variant) {
    const btn = page.getByTestId(`variant-${options.variant}`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }

  if (options.format) {
    const btn = page.getByTestId(`format-${options.format}`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }

  if (options.timerSeconds !== undefined) {
    const btn = page.getByTestId(`timer-${options.timerSeconds}`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }

  if (options.shuffleOrder !== undefined) {
    const toggle = page.getByTestId('shuffle-order-toggle');
    const current = await toggle.getAttribute('aria-checked');
    const desired = String(options.shuffleOrder);
    if (current !== desired) {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-checked', desired);
  }

  if (options.seats) {
    for (let i = 0; i < options.seats.length; i += 1) {
      const seat = options.seats[i];
      if (!seat) {
        continue;
      }
      if (seat.name !== undefined) {
        const input = page.getByTestId(`seat-name-${i}`);
        await input.fill(seat.name);
      }
      if (seat.controller !== undefined) {
        const ctrl = page.getByTestId(`seat-controller-${i}-${seat.controller}`);
        await ctrl.click();
        await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
      }
    }
  }
}

export async function startGame(page: Page): Promise<void> {
  await page.getByTestId('start-game-button').click();
  await expect(page.getByTestId('game-screen')).toBeVisible();
}

export async function startConfiguredGame(
  page: Page,
  options: E2ELobbyOptions = {},
): Promise<void> {
  await openLobby(page);
  await configureLobby(page, options);
  await startGame(page);
}

// --- Placement Helpers ---

export async function selectPlacementKind(page: Page, kind: E2EPlacementKind): Promise<void> {
  const btn = page.getByTestId(`pick-piece-${kind}`);
  await expect(btn).toBeVisible();
  const pressed = await btn.getAttribute('aria-pressed');
  if (pressed !== 'true') {
    await btn.click();
  }
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
}

export async function placePiece(
  page: Page,
  row: number,
  col: number,
  kind?: E2EPlacementKind,
): Promise<void> {
  if (kind) {
    await selectPlacementKind(page, kind);
  }
  const cell = cellLocator(page, row, col);
  await cell.click();
  await expect(cell).not.toHaveAttribute('data-occupied-by', 'none');
}

export async function completePlacement(
  page: Page,
  steps: readonly E2EPlacementStep[],
): Promise<void> {
  for (const step of steps) {
    await placePiece(page, step.row, step.col, step.kind);
  }
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece');
}

/**
 * Dynamically picks the first unoccupied legal placement cell (preferring `preferredCells`
 * in order before scanning all 49 cells). Safe in Mixed Human + AI games where AI's
 * strategic opening placement may occupy arbitrary center cells.
 */
export async function placeFirstAvailableEmptyCell(
  page: Page,
  preferredCells: readonly E2ECellPos[] = [],
  kind?: E2EPlacementKind,
): Promise<E2ECellPos> {
  if (kind) {
    const picker = page.getByTestId('piece-kind-picker');
    if ((await picker.count()) > 0) {
      const btn = page.getByTestId(`pick-piece-${kind}`);
      if (await btn.isEnabled()) {
        await selectPlacementKind(page, kind);
      }
    }
  }

  for (const pos of preferredCells) {
    const cell = cellLocator(page, pos.row, pos.col);
    const occ = await cell.getAttribute('data-occupied-by');
    const valid = await cell.getAttribute('data-valid-move');
    if (occ === 'none' && valid === 'true') {
      await cell.click();
      await expect(cell).not.toHaveAttribute('data-occupied-by', 'none');
      return pos;
    }
  }

  const validPlacementCoords = await readValidMoveCoords(page, 'placement');
  expect(
    validPlacementCoords.length,
    'Expected at least one legal empty cell for placement',
  ).toBeGreaterThan(0);

  const chosen = validPlacementCoords[0];
  if (!chosen) {
    throw new Error('No available empty placement cell found');
  }

  const cell = cellLocator(page, chosen.row, chosen.col);
  await cell.click();
  await expect(cell).not.toHaveAttribute('data-occupied-by', 'none');
  return chosen;
}

// --- Movement, Wall Placement, Wall Break & Cancel Helpers ---

export async function selectCell(page: Page, row: number, col: number): Promise<void> {
  const cell = cellLocator(page, row, col);
  await cell.click();
  await expect(cell).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
}

export async function moveSelectedTo(page: Page, row: number, col: number): Promise<void> {
  await cellLocator(page, row, col).click();
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
}

export async function placeWallAt(page: Page, edge: E2EWallEdge): Promise<void> {
  await wallSlotLocator(page, edge).click();
  await expect(placedWallLocator(page, edge)).toBeVisible();
}

export async function playHumanTurn(
  page: Page,
  from: E2ECellPos,
  to: E2ECellPos,
  wall: E2EWallEdge,
): Promise<void> {
  await selectCell(page, from.row, from.col);
  await moveSelectedTo(page, to.row, to.col);
  await placeWallAt(page, wall);
}

/**
 * Dynamically executes a legal human turn (preferring a non-stay `normal` move
 * so piece relocation is clearly observable, falling back to `stay`, and in 3P
 * falling back to a legal Wall Break if all pieces are trapped with 0 normal/stay moves).
 * Ideal for Mixed Human + AI tests where AI placements/walls are non-deterministic.
 */
export async function playFirstLegalHumanTurn(
  page: Page,
  humanPlayerId: number,
): Promise<HumanTurnResult> {
  const ownCells = page.locator(
    `[data-testid^="cell-"][data-occupied-by="${humanPlayerId}"]`,
  );
  const pieceCount = await ownCells.count();
  expect(pieceCount, `Expected human player ${humanPlayerId} to own at least 1 piece`).toBeGreaterThan(0);

  const ownPositions: E2ECellPos[] = [];
  for (let i = 0; i < pieceCount; i += 1) {
    const cell = ownCells.nth(i);
    const row = Number(await cell.getAttribute('data-row'));
    const col = Number(await cell.getAttribute('data-col'));
    ownPositions.push({ row, col });
  }

  for (const from of ownPositions) {
    const fromCell = cellLocator(page, from.row, from.col);
    await fromCell.click();
    const state = await readGameScreenState(page);
    if (
      state.phase !== 'move_piece' ||
      (await fromCell.getAttribute('data-selected')) !== 'true'
    ) {
      continue;
    }

    const normalMoves = await readValidMoveCoords(page, 'normal');
    const stayMoves = normalMoves.length > 0 ? [] : await readValidMoveCoords(page, 'stay');
    const dest = normalMoves[0] ?? stayMoves[0];
    if (!dest) {
      continue;
    }

    await moveSelectedTo(page, dest.row, dest.col);
    const placeableWalls = await readInteractiveWallEdges(page, 'placeable');
    expect(
      placeableWalls.length,
      `Expected at least 1 placeable wall after moving to (${dest.row}, ${dest.col})`,
    ).toBeGreaterThan(0);

    const wall = placeableWalls[0];
    if (!wall) {
      throw new Error('No placeable wall available');
    }

    await placeWallAt(page, wall);
    return { from, to: dest, wall, usedWallBreak: false };
  }

  // Fallback for 3P trapped turns: execute a legal Wall Break if wall-break-toggle is enabled.
  const preBreakState = await readGameScreenState(page);
  if (preBreakState.format === '3p') {
    const wbToggle = page.getByTestId('wall-break-toggle');
    if ((await wbToggle.count()) > 0) {
      for (const from of ownPositions) {
        const fromCell = cellLocator(page, from.row, from.col);
        if ((await fromCell.getAttribute('data-selected')) !== 'true') {
          await fromCell.click();
        }
        const selState = await readGameScreenState(page);
        if (
          selState.phase !== 'move_piece' ||
          (await fromCell.getAttribute('data-selected')) !== 'true'
        ) {
          continue;
        }
        if (!(await wbToggle.isEnabled())) {
          continue;
        }

        if ((await wbToggle.getAttribute('aria-pressed')) !== 'true') {
          await toggleWallBreak(page, true);
        }

        const afterToggle = await readGameScreenState(page);
        if (afterToggle.phaseSubstate === 'wall_break_select_wall') {
          // Wall Go I: break an adjacent wall, then pick first legal move and place wall.
          const breakableWalls = await readInteractiveWallEdges(page, 'breakable');
          const breakEdge = breakableWalls[0];
          if (!breakEdge) {
            await toggleWallBreak(page, false);
            continue;
          }

          await wallSlotLocator(page, breakEdge).click();
          await expect(placedWallLocator(page, breakEdge)).toHaveCount(0);
          await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');

          const postBreakNormal = await readValidMoveCoords(page, 'normal');
          const postBreakStay =
            postBreakNormal.length > 0 ? [] : await readValidMoveCoords(page, 'stay');
          const dest = postBreakNormal[0] ?? postBreakStay[0];
          expect(dest, 'Expected at least 1 legal move after Wall Go I wall break').toBeDefined();
          if (!dest) {
            throw new Error('No legal move found after Wall Go I wall break');
          }

          await moveSelectedTo(page, dest.row, dest.col);
          const placeableWalls = await readInteractiveWallEdges(page, 'placeable');
          expect(
            placeableWalls.length,
            `Expected at least 1 placeable wall after Wall Go I break move to (${dest.row}, ${dest.col})`,
          ).toBeGreaterThan(0);
          const wall = placeableWalls[0];
          if (!wall) {
            throw new Error('No placeable wall available after Wall Go I break move');
          }

          await placeWallAt(page, wall);
          return { from, to: dest, wall, usedWallBreak: true, brokenWall: breakEdge };
        }

        if (afterToggle.phaseSubstate === 'wall_break_move') {
          // Wall Go II: select a wall-break destination, resolving ambiguous 2-wall diagonal if prompted.
          const breakTargets = await readValidMoveCoords(page, 'wall-break');
          const dest = breakTargets[0];
          if (!dest) {
            await toggleWallBreak(page, false);
            continue;
          }

          await cellLocator(page, dest.row, dest.col).click();
          let postDestState = await readGameScreenState(page);
          await expect
            .poll(async () => {
              postDestState = await readGameScreenState(page);
              return (
                postDestState.phase === 'place_wall' ||
                postDestState.phaseSubstate === 'choose_break_wall'
              );
            })
            .toBe(true);

          let brokenWall: E2EWallEdge | undefined;
          if (postDestState.phaseSubstate === 'choose_break_wall') {
            const choices = await readInteractiveWallEdges(page, 'breakable-choice');
            expect(
              choices.length,
              'Expected breakable-choice walls during Wall Go II ambiguous diagonal break',
            ).toBeGreaterThan(0);
            const chosenWall = choices[0];
            if (!chosenWall) {
              throw new Error('No breakable-choice wall available');
            }
            await wallSlotLocator(page, chosenWall).click();
            await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
            brokenWall = chosenWall;
          }

          const placeableWalls = await readInteractiveWallEdges(page, 'placeable');
          expect(
            placeableWalls.length,
            `Expected at least 1 placeable wall after Wall Go II break move to (${dest.row}, ${dest.col})`,
          ).toBeGreaterThan(0);
          const wall = placeableWalls[0];
          if (!wall) {
            throw new Error('No placeable wall available after Wall Go II break move');
          }

          await placeWallAt(page, wall);
          return brokenWall
            ? { from, to: dest, wall, usedWallBreak: true, brokenWall }
            : { from, to: dest, wall, usedWallBreak: true };
        }
      }
    }
  }

  throw new Error(`No legal turn (normal, stay, or wall break) found for human player ${humanPlayerId}`);
}

export async function toggleWallBreak(page: Page, expectedActive?: boolean): Promise<void> {
  const toggle = page.getByTestId('wall-break-toggle');
  await expect(toggle).toBeEnabled();
  await toggle.click();
  if (expectedActive !== undefined) {
    const expectedStr = String(expectedActive);
    await expect(toggle).toHaveAttribute('aria-pressed', expectedStr);
    await expect(page.getByTestId('game-screen')).toHaveAttribute(
      'data-wall-break-active',
      expectedStr,
    );
  }
}

export async function playWallGo1BreakTurn(
  page: Page,
  from: E2ECellPos,
  breakEdge: E2EWallEdge,
  to: E2ECellPos,
  placeEdge: E2EWallEdge,
): Promise<void> {
  const fromCell = cellLocator(page, from.row, from.col);
  if ((await fromCell.getAttribute('data-selected')) !== 'true') {
    await selectCell(page, from.row, from.col);
  } else {
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
  }

  const toggle = page.getByTestId('wall-break-toggle');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggleWallBreak(page, true);
  }
  await expect(page.getByTestId('game-screen')).toHaveAttribute(
    'data-phase-substate',
    'wall_break_select_wall',
  );

  const breakSlot = wallSlotLocator(page, breakEdge);
  await expect(breakSlot).toHaveAttribute('data-wall-state', 'breakable');
  await breakSlot.click();

  await expect(placedWallLocator(page, breakEdge)).toHaveCount(0);
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');

  await moveSelectedTo(page, to.row, to.col);
  await placeWallAt(page, placeEdge);
}

export async function playWallGo2SingleBreakTurn(
  page: Page,
  from: E2ECellPos,
  to: E2ECellPos,
  brokenEdge: E2EWallEdge,
  placeEdge: E2EWallEdge,
): Promise<void> {
  await selectCell(page, from.row, from.col);

  const toggle = page.getByTestId('wall-break-toggle');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggleWallBreak(page, true);
  }
  await expect(page.getByTestId('game-screen')).toHaveAttribute(
    'data-phase-substate',
    'wall_break_move',
  );

  const dest = cellLocator(page, to.row, to.col);
  await expect(dest).toHaveAttribute('data-valid-move', 'true');
  await expect(dest).toHaveAttribute('data-move-type', 'wall-break');
  await dest.click();

  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
  await expect(placedWallLocator(page, brokenEdge)).toHaveCount(0);

  await placeWallAt(page, placeEdge);
}

export async function playWallGo2AmbiguousBreakTurn(
  page: Page,
  from: E2ECellPos,
  to: E2ECellPos,
  chosenBreakEdge: E2EWallEdge,
  placeEdge: E2EWallEdge,
): Promise<void> {
  await selectCell(page, from.row, from.col);

  const toggle = page.getByTestId('wall-break-toggle');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggleWallBreak(page, true);
  }
  await expect(page.getByTestId('game-screen')).toHaveAttribute(
    'data-phase-substate',
    'wall_break_move',
  );

  const dest = cellLocator(page, to.row, to.col);
  await expect(dest).toHaveAttribute('data-valid-move', 'true');
  await expect(dest).toHaveAttribute('data-move-type', 'wall-break');
  await dest.click();

  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
  await expect(page.getByTestId('game-screen')).toHaveAttribute(
    'data-phase-substate',
    'choose_break_wall',
  );

  const choiceSlot = wallSlotLocator(page, chosenBreakEdge);
  await expect(choiceSlot).toHaveAttribute('data-wall-state', 'breakable-choice');
  await choiceSlot.click();

  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'place_wall');
  await expect(placedWallLocator(page, chosenBreakEdge)).toHaveCount(0);

  await placeWallAt(page, placeEdge);
}

export async function cancelTurnMove(page: Page): Promise<void> {
  const btn = page.getByTestId('cancel-move-button');
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'move_piece');
}

// --- HUD, Undo/Redo, Timer & Modal Helpers ---

export async function clickUndo(page: Page): Promise<void> {
  const btn = page.getByTestId('undo-button');
  await expect(btn).toBeEnabled();
  await btn.click();
}

export async function clickRedo(page: Page): Promise<void> {
  const btn = page.getByTestId('redo-button');
  await expect(btn).toBeEnabled();
  await btn.click();
}

export async function toggleTimerPause(page: Page, expectedPaused: boolean): Promise<void> {
  const btn = page.getByTestId('timer-pause-button');
  await btn.click();
  const expectedStr = String(expectedPaused);
  await expect(btn).toHaveAttribute('aria-pressed', expectedStr);
  await expect(page.getByTestId('turn-timer')).toHaveAttribute('data-paused', expectedStr);
}

export async function openRulesModal(page: Page): Promise<void> {
  await page.getByTestId('rules-button').click();
  await expect(page.getByTestId('rules-modal')).toBeVisible();
}

export async function switchRulesTab(page: Page, tab: E2ERulesTab): Promise<void> {
  const tabBtn = page.getByTestId(`rules-tab-${tab}`);
  await tabBtn.click();
  await expect(tabBtn).toHaveAttribute('aria-selected', 'true');
}

export async function closeRulesModal(
  page: Page,
  method: 'button' | 'escape' | 'backdrop' = 'button',
): Promise<void> {
  const modal = page.getByTestId('rules-modal');
  await expect(modal).toBeVisible();

  if (method === 'button') {
    await page.getByTestId('rules-close-button').click();
  } else if (method === 'escape') {
    await page.keyboard.press('Escape');
  } else {
    const box = await modal.boundingBox();
    expect(box, 'rules-modal must have a bounding box for backdrop click').not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport, 'page viewport must be defined for backdrop click').not.toBeNull();
    if (!box || !viewport) {
      throw new Error('Missing rules-modal bounding box or viewport size');
    }
    let clickX = 8;
    let clickY = 8;
    if (box.x <= 16 && box.y <= 16) {
      if (box.x + box.width < viewport.width - 16) {
        clickX = viewport.width - 8;
        clickY = Math.min(viewport.height - 8, Math.max(8, box.y + box.height / 2));
      } else {
        clickX = Math.min(viewport.width - 8, Math.max(8, box.x + box.width / 2));
        clickY = viewport.height - 8;
      }
    }
    await page.mouse.click(clickX, clickY);
  }

  await expect(modal).toHaveCount(0);
}

export async function returnToLobby(page: Page): Promise<void> {
  await page.getByTestId('lobby-button').click();
  await expect(page.getByTestId('lobby-screen')).toBeVisible();
}

export async function startPrisonMatchRound2(page: Page): Promise<void> {
  await expect(page.getByTestId('result-modal')).toBeVisible();
  await page.getByTestId('start-round2-button').click();
  await expect(page.getByTestId('result-modal')).toHaveCount(0);
  const game = page.getByTestId('game-screen');
  await expect(game).toHaveAttribute('data-format', '2p');
  await expect(game).toHaveAttribute('data-round', '2');
  await expect(game).toHaveAttribute('data-phase', 'placement');
}

export async function inspectBoardFromResult(page: Page): Promise<void> {
  await page.getByTestId('inspect-board-button').click();
  await expect(page.getByTestId('result-modal')).toHaveCount(0);
  await expect(page.getByTestId('reopen-result-button')).toBeVisible();
}

export async function reopenResultModal(page: Page): Promise<void> {
  await page.getByTestId('reopen-result-button').click();
  await expect(page.getByTestId('result-modal')).toBeVisible();
  await expect(page.getByTestId('reopen-result-button')).toHaveCount(0);
}

// --- Atomic DOM State Readers ---

export async function readGameScreenState(page: Page): Promise<GameScreenState> {
  const game = page.getByTestId('game-screen');
  return game.evaluate((el) => ({
    variant: (el.getAttribute('data-variant') ?? 'wallgo1') as E2ERuleVariant,
    format: (el.getAttribute('data-format') ?? '3p') as E2EGameFormat,
    round: Number(el.getAttribute('data-round') ?? '1'),
    phase: (el.getAttribute('data-phase') ?? 'placement') as E2EGamePhase,
    phaseSubstate: (el.getAttribute('data-phase-substate') ?? 'idle') as E2EPhaseSubstate,
    currentPlayer: Number(el.getAttribute('data-current-player') ?? '0'),
    turnNumber: Number(el.getAttribute('data-turn-number') ?? '0'),
    aiThinking: el.getAttribute('data-ai-thinking') === 'true',
    wallBreakActive: el.getAttribute('data-wall-break-active') === 'true',
  }));
}

export async function readCellState(page: Page, row: number, col: number): Promise<CellState> {
  const cell = cellLocator(page, row, col);
  return cell.evaluate((el) => {
    const occupiedRaw = el.getAttribute('data-occupied-by') ?? 'none';
    const pieceIdRaw = el.getAttribute('data-piece-id') ?? 'none';
    const pieceKindRaw = el.getAttribute('data-piece-kind') ?? 'none';
    const territoryOwnerRaw = el.getAttribute('data-territory-owner') ?? 'none';
    return {
      row: Number(el.getAttribute('data-row') ?? '-1'),
      col: Number(el.getAttribute('data-col') ?? '-1'),
      coord: el.getAttribute('data-coord') ?? '',
      occupiedBy: occupiedRaw === 'none' ? null : Number(occupiedRaw),
      pieceId: pieceIdRaw === 'none' ? null : pieceIdRaw,
      pieceKind: pieceKindRaw === 'none' ? null : (pieceKindRaw as E2EPieceKind),
      validMove: el.getAttribute('data-valid-move') === 'true',
      moveType: (el.getAttribute('data-move-type') ?? 'none') as E2EMoveType,
      selected: el.getAttribute('data-selected') === 'true',
      territoryOwner: territoryOwnerRaw === 'none' ? null : Number(territoryOwnerRaw),
      territorySize: Number(el.getAttribute('data-territory-size') ?? '0'),
    };
  });
}

/**
 * Dynamically discovers the piece token inside `cell-{row}-{col}` by reading
 * `data-piece-id` rather than hardcoding any internal pieceId format.
 */
export async function readPieceAtCell(
  page: Page,
  row: number,
  col: number,
): Promise<PieceTokenState> {
  const cell = cellLocator(page, row, col);
  const pieceId = await cell.getAttribute('data-piece-id');
  expect(pieceId, `Cell (${row}, ${col}) must have a non-none data-piece-id`).toBeTruthy();
  expect(pieceId).not.toBe('none');
  if (!pieceId || pieceId === 'none') {
    throw new Error(`No piece present at cell (${row}, ${col})`);
  }

  const piece = cell.getByTestId(`piece-${pieceId}`);
  await expect(piece).toBeVisible();
  const attrs = await piece.evaluate((el) => ({
    owner: Number(el.getAttribute('data-owner') ?? '-1'),
    kind: (el.getAttribute('data-kind') ?? 'standard') as E2EPieceKind,
    row: Number(el.getAttribute('data-row') ?? '-1'),
    col: Number(el.getAttribute('data-col') ?? '-1'),
    selected: el.getAttribute('data-selected') === 'true',
  }));

  return { id: pieceId, ...attrs };
}

export async function readValidMoveCoords(
  page: Page,
  moveType?: Exclude<E2EMoveType, 'none'>,
): Promise<E2ECellPos[]> {
  const selector = moveType
    ? `[data-valid-move="true"][data-move-type="${moveType}"]`
    : '[data-valid-move="true"]';
  return page.locator(selector).evaluateAll((nodes) =>
    nodes
      .map((el) => ({
        row: Number(el.getAttribute('data-row') ?? '-1'),
        col: Number(el.getAttribute('data-col') ?? '-1'),
      }))
      .sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col)),
  );
}

export async function readInteractiveWallEdges(
  page: Page,
  wallState?: E2EWallState,
): Promise<E2EWallEdge[]> {
  const selector = wallState
    ? `[data-wall-interactive="true"][data-wall-state="${wallState}"]`
    : '[data-wall-interactive="true"]';
  return page.locator(selector).evaluateAll((nodes) =>
    nodes
      .map((el) => ({
        orientation: (el.getAttribute('data-orientation') ?? 'h') as E2EWallOrientation,
        row: Number(el.getAttribute('data-row') ?? '-1'),
        col: Number(el.getAttribute('data-col') ?? '-1'),
      }))
      .sort((a, b) => {
        if (a.orientation !== b.orientation) {
          return a.orientation.localeCompare(b.orientation);
        }
        return a.row !== b.row ? a.row - b.row : a.col - b.col;
      }),
  );
}

export async function readPlayerCardState(page: Page, playerId: number): Promise<PlayerCardState> {
  const card = playerCardLocator(page, playerId);
  const cardAttrs = await card.evaluate((el) => ({
    active: el.getAttribute('data-active') === 'true',
    autoSkipped: el.getAttribute('data-auto-skipped') === 'true',
    isAI: el.getAttribute('data-is-ai') === 'true',
    wallBreaks: Number(el.getAttribute('data-wall-breaks') ?? '0'),
  }));

  const score = Number(await page.getByTestId(`player-score-${playerId}`).getAttribute('data-value'));
  const largest = Number(
    await page.getByTestId(`player-largest-${playerId}`).getAttribute('data-value'),
  );
  const wbPill = page.getByTestId(`player-wallbreak-${playerId}`);
  const wallBreakPillRemaining =
    (await wbPill.count()) > 0 ? Number(await wbPill.getAttribute('data-remaining')) : null;

  return {
    playerId,
    ...cardAttrs,
    score,
    largest,
    wallBreakPillRemaining,
  };
}

// --- Race-Free AI Synchronization Waits (ZERO waitForTimeout) ---

export async function waitForHumanTurnOrGameOver(
  page: Page,
  options: {
    readonly expectedPlayer?: number;
    readonly expectedPhase?: E2EGamePhase;
    readonly timeout?: number;
  } = {},
): Promise<'human_turn' | 'game_over'> {
  const timeout = options.timeout ?? 20_000;
  let outcome: 'human_turn' | 'game_over' = 'human_turn';

  await expect
    .poll(
      async () => {
        const state = await readGameScreenState(page);
        if (state.phase === 'game_over') {
          outcome = 'game_over';
          return 'ready';
        }
        if (state.aiThinking) {
          return 'ai_thinking';
        }
        const currentCard = playerCardLocator(page, state.currentPlayer);
        if ((await currentCard.getAttribute('data-is-ai')) !== 'false') {
          return 'ai_actor';
        }
        if (options.expectedPlayer !== undefined && state.currentPlayer !== options.expectedPlayer) {
          return `wrong_player:${state.currentPlayer}`;
        }
        if (options.expectedPhase !== undefined && state.phase !== options.expectedPhase) {
          return `wrong_phase:${state.phase}`;
        }
        outcome = 'human_turn';
        return 'ready';
      },
      { timeout },
    )
    .toBe('ready');

  return outcome;
}

export async function waitForAiActionToAdvance(
  page: Page,
  prev: Pick<GameScreenState, 'turnNumber' | 'phase' | 'currentPlayer'>,
  timeout = 15_000,
): Promise<GameScreenState> {
  let latest = await readGameScreenState(page);

  await expect
    .poll(
      async () => {
        latest = await readGameScreenState(page);
        return (
          latest.phase === 'game_over' ||
          latest.turnNumber > prev.turnNumber ||
          latest.phase !== prev.phase ||
          latest.currentPlayer !== prev.currentPlayer
        );
      },
      { timeout },
    )
    .toBe(true);

  return latest;
}

export async function waitForGameOver(page: Page, timeout = 60_000): Promise<void> {
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'game_over', {
    timeout,
  });
  await expect(page.getByTestId('result-modal')).toBeVisible();
}

// --- Oracle-Verified Multi-Turn Script Drivers (e2e_a_iter1_spec_miner § 3) ---

/** Script A1: Fast 3P Wall Go I 2-Wall Corner Territory Seal ((0,0), 1 Cell). */
export async function runScriptA1(
  page: Page,
  options: Omit<E2ELobbyOptions, 'variant' | 'format' | 'shuffleOrder'> = {},
): Promise<void> {
  await startConfiguredGame(page, {
    ...options,
    variant: 'wallgo1',
    format: '3p',
    shuffleOrder: false,
  });
  await completePlacement(page, SCRIPT_A1_PLACEMENTS);
  await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
  await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, vWall(0, 0));
}

/** Script A2: Fast 3P Wall Go I 3-Wall 2-Cell Corner Seal ({(0,0), (0,1)}, Anchor Proof). */
export async function runScriptA2(page: Page): Promise<void> {
  await startConfiguredGame(page, {
    variant: 'wallgo1',
    format: '3p',
    shuffleOrder: false,
  });
  await completePlacement(page, SCRIPT_A2_PLACEMENTS);
  await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
  await playHumanTurn(page, { row: 1, col: 0 }, { row: 1, col: 1 }, hWall(0, 1));
  await playHumanTurn(page, { row: 0, col: 2 }, { row: 0, col: 2 }, vWall(0, 1));
}

/** Script A3: 5-Turn Two Disjoint Secured Regions for P0 (total = 3, largest = 2). */
export async function runScriptA3(page: Page): Promise<void> {
  await startConfiguredGame(page, {
    variant: 'wallgo1',
    format: '3p',
    shuffleOrder: false,
  });
  await completePlacement(page, SCRIPT_A3_PLACEMENTS);
  await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
  await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, vWall(0, 0));
  await playHumanTurn(page, { row: 6, col: 4 }, { row: 6, col: 4 }, vWall(6, 4));
  await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 5 }, hWall(5, 5));
  await playHumanTurn(page, { row: 5, col: 5 }, { row: 5, col: 6 }, hWall(5, 6));
}

/** Script B Setup (Turns 1-4): P1 at (2,3) blocked from empty (2,2) by P0's wall v(2,2). */
export async function runScriptBSetup(page: Page): Promise<void> {
  await startConfiguredGame(page, {
    variant: 'wallgo1',
    format: '3p',
    shuffleOrder: false,
  });
  await completePlacement(page, SCRIPT_B_PLACEMENTS);
  await playHumanTurn(page, { row: 2, col: 2 }, { row: 2, col: 2 }, vWall(2, 2));
  await playHumanTurn(page, { row: 4, col: 6 }, { row: 4, col: 6 }, hWall(4, 6));
  await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 6 }, vWall(6, 5));
  await playHumanTurn(page, { row: 2, col: 2 }, { row: 2, col: 1 }, hWall(2, 1));
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
}

/** Script C Setup (Turns 1-5): P2 round at (3,3) flanked by v(3,3) & h(3,3) toward (4,4). */
export async function runScriptCSetup(page: Page): Promise<void> {
  await startConfiguredGame(page, {
    variant: 'wallgo2',
    format: '3p',
    shuffleOrder: false,
  });
  await completePlacement(page, SCRIPT_C_PLACEMENTS);
  await playHumanTurn(page, { row: 2, col: 4 }, { row: 3, col: 4 }, vWall(3, 3));
  await playHumanTurn(page, { row: 4, col: 2 }, { row: 4, col: 3 }, hWall(3, 3));
  await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 4 }, hWall(5, 4));
  await playHumanTurn(page, { row: 3, col: 4 }, { row: 3, col: 6 }, hWall(2, 6));
  await playHumanTurn(page, { row: 4, col: 3 }, { row: 4, col: 1 }, vWall(4, 0));
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
}

/** Script C3 Setup (Turns 1-4): P1 square at (3,1) blocked from empty (3,2)-(3,3) by v(3,1). */
export async function runScriptC3Setup(page: Page): Promise<void> {
  await startConfiguredGame(page, {
    variant: 'wallgo2',
    format: '3p',
    shuffleOrder: false,
  });
  await completePlacement(page, SCRIPT_C3_PLACEMENTS);
  await playHumanTurn(page, { row: 2, col: 2 }, { row: 3, col: 2 }, vWall(3, 1));
  await playHumanTurn(page, { row: 6, col: 0 }, { row: 5, col: 1 }, vWall(5, 1));
  await playHumanTurn(page, { row: 6, col: 6 }, { row: 5, col: 5 }, hWall(5, 5));
  await playHumanTurn(page, { row: 3, col: 2 }, { row: 1, col: 2 }, hWall(0, 2));
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
}

/** Script C3 Full: Wall Go II square 2-step straight single-wall path break. */
export async function runScriptC3(page: Page): Promise<void> {
  await runScriptC3Setup(page);
  await playWallGo2SingleBreakTurn(
    page,
    { row: 3, col: 1 },
    { row: 3, col: 3 },
    vWall(3, 1),
    hWall(3, 3),
  );
}

/** Script D: Minimum 7-Turn 3P Wall Go I Full Completion to game_over (P0=43, P1=4, P2=2). */
export async function runScriptD(
  page: Page,
  options: Omit<E2ELobbyOptions, 'variant' | 'format' | 'shuffleOrder'> = {},
): Promise<void> {
  await startConfiguredGame(page, {
    ...options,
    variant: 'wallgo1',
    format: '3p',
    shuffleOrder: false,
  });
  await completePlacement(page, SCRIPT_D_PLACEMENTS);
  await playHumanTurn(page, { row: 1, col: 0 }, { row: 1, col: 0 }, hWall(0, 0));
  await playHumanTurn(page, { row: 5, col: 0 }, { row: 5, col: 0 }, hWall(4, 0));
  await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, hWall(0, 1));
  await playHumanTurn(page, { row: 5, col: 2 }, { row: 5, col: 2 }, vWall(5, 1));
  await playHumanTurn(page, { row: 5, col: 1 }, { row: 5, col: 1 }, hWall(4, 1));
  await playHumanTurn(page, { row: 0, col: 1 }, { row: 0, col: 1 }, vWall(0, 1));
  await playHumanTurn(page, { row: 5, col: 2 }, { row: 6, col: 2 }, vWall(6, 1));
  await waitForGameOver(page, 10_000);
}

/** Script E: 8-Turn 3P Wall Go I Auto-Skip of P2 (allPiecesSecured && wallBreaksRemaining === 0). */
export async function runScriptE(page: Page): Promise<void> {
  await startConfiguredGame(page, {
    variant: 'wallgo1',
    format: '3p',
    shuffleOrder: false,
  });
  await completePlacement(page, SCRIPT_E_PLACEMENTS);
  await playHumanTurn(page, { row: 1, col: 0 }, { row: 1, col: 0 }, hWall(0, 0));
  await playHumanTurn(page, { row: 5, col: 5 }, { row: 5, col: 5 }, hWall(5, 5));
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
}

/** Script F1: Standalone 2P Wall Go I Setup + 2 Legal Turns. */
export async function runScriptF1(page: Page): Promise<void> {
  await startConfiguredGame(page, {
    variant: 'wallgo1',
    format: '2p',
    shuffleOrder: false,
  });
  await completePlacement(page, DEFAULT_2P_PLACEMENTS);
  await playHumanTurn(page, { row: 1, col: 1 }, { row: 0, col: 1 }, vWall(0, 1));
  await playHumanTurn(page, { row: 1, col: 5 }, { row: 1, col: 4 }, hWall(1, 4));
}

/** Script F2: Standalone 2P Wall Go II Setup + 2 Legal Turns (round diagonal + square 2-step). */
export async function runScriptF2(page: Page): Promise<void> {
  await startConfiguredGame(page, {
    variant: 'wallgo2',
    format: '2p',
    shuffleOrder: false,
  });
  await completePlacement(page, DEFAULT_2P_PLACEMENTS);
  await playHumanTurn(page, { row: 1, col: 1 }, { row: 0, col: 2 }, hWall(0, 2));
  await playHumanTurn(page, { row: 2, col: 4 }, { row: 0, col: 4 }, vWall(0, 4));
}

// --- E2E-B Shared Opaque-Box Helpers (Wall Break, Timer, Clock, Geometry & Conservation) ---

export interface BoardGeometryPiece {
  readonly owner: number;
  readonly kind: E2EPieceKind;
  readonly row: number;
  readonly col: number;
}

export interface BoardGeometryWall extends E2EWallEdge {
  readonly owner: number;
  readonly lastWall: boolean;
}

export interface BoardGeometrySnapshot {
  readonly pieces: readonly BoardGeometryPiece[];
  readonly walls: readonly BoardGeometryWall[];
}

/**
 * C08-safe Wall Break activation: reads `aria-pressed` before toggling so
 * selecting a 0-normal-move piece that auto-activated Wall Break is never double-toggled.
 */
export async function ensureWallBreakActive(page: Page, desired: boolean): Promise<void> {
  const toggle = page.getByTestId('wall-break-toggle');
  await expect(toggle).toBeEnabled();
  const desiredStr = String(desired);
  if ((await toggle.getAttribute('aria-pressed')) !== desiredStr) {
    await toggleWallBreak(page, desired);
  } else {
    await expect(toggle).toHaveAttribute('aria-pressed', desiredStr);
    await expect(page.getByTestId('game-screen')).toHaveAttribute(
      'data-wall-break-active',
      desiredStr,
    );
  }
}

/** Verifies mutual exclusion in a segmented toggle group: exact 1 button has `aria-pressed="true"`. */
export async function assertSinglePressed(
  page: Page,
  groupTestIds: readonly string[],
  expectedActiveId: string,
): Promise<void> {
  for (const id of groupTestIds) {
    await expect(page.getByTestId(id)).toHaveAttribute(
      'aria-pressed',
      id === expectedActiveId ? 'true' : 'false',
    );
  }
}

/** Verifies every edge strictly obeys internal 7x7 Wall Go geometry (`h: 0..5 x 0..6`, `v: 0..6 x 0..5`). */
export function assertAllEdgesInternal(edges: readonly E2EWallEdge[]): void {
  for (const edge of edges) {
    if (edge.orientation === 'h') {
      expect(edge.row, `Horizontal wall row ${edge.row} must be >= 0`).toBeGreaterThanOrEqual(0);
      expect(edge.row, `Horizontal wall row ${edge.row} must be <= 5`).toBeLessThanOrEqual(5);
      expect(edge.col, `Horizontal wall col ${edge.col} must be >= 0`).toBeGreaterThanOrEqual(0);
      expect(edge.col, `Horizontal wall col ${edge.col} must be <= 6`).toBeLessThanOrEqual(6);
    } else {
      expect(edge.row, `Vertical wall row ${edge.row} must be >= 0`).toBeGreaterThanOrEqual(0);
      expect(edge.row, `Vertical wall row ${edge.row} must be <= 6`).toBeLessThanOrEqual(6);
      expect(edge.col, `Vertical wall col ${edge.col} must be >= 0`).toBeGreaterThanOrEqual(0);
      expect(edge.col, `Vertical wall col ${edge.col} must be <= 5`).toBeLessThanOrEqual(5);
    }
  }
}

/** Web-first assertion confirming turn timer reset cleanly (tolerates 1s interval edge tick). */
export async function expectTurnTimerReset(
  page: Page,
  timerSeconds: 60 | 90,
): Promise<void> {
  const pattern = timerSeconds === 60 ? /^(59|60)$/ : /^(89|90)$/;
  await expect(page.getByTestId('turn-timer')).toHaveAttribute('data-seconds', pattern);
}

/**
 * Advances a paused fake clock to trigger the active human turn's `00:00` timeout
 * without overshooting the next turn's timer regardless of 0-based vs 1-based interval ticks.
 */
export async function triggerCurrentTurnTimeout(
  page: Page,
  remainingSeconds: number,
): Promise<void> {
  const before = await readGameScreenState(page);
  if (remainingSeconds > 0) {
    await page.clock.runFor(remainingSeconds * 1_000);
  }
  const afterFirst = await readGameScreenState(page);
  if (afterFirst.phase !== 'game_over' && afterFirst.turnNumber === before.turnNumber) {
    await page.clock.runFor(1_000);
  }
  await expect
    .poll(async () => {
      const now = await readGameScreenState(page);
      return now.phase === 'game_over' || now.turnNumber > before.turnNumber;
    })
    .toBe(true);
}

/**
 * Steps a paused Playwright fake clock (`openLobbyWithPausedClock`) until either `game_over`
 * or a human player's interactive turn is active.
 * NEVER pair paused `page.clock` with `ai-hard` (use only `ai-easy` / `ai-normal`) so Hard AI's
 * real-time `performance.now()` 150ms deadline cap is preserved.
 */
export async function advancePausedClockUntilHumanTurnOrGameOver(
  page: Page,
  options: {
    readonly expectedPlayer?: number;
    readonly expectedPhase?: E2EGamePhase;
    readonly stepMs?: number;
    readonly maxSteps?: number;
  } = {},
): Promise<'human_turn' | 'game_over'> {
  const stepMs = options.stepMs ?? 600;
  const maxSteps = options.maxSteps ?? 140;

  for (let step = 0; step <= maxSteps; step += 1) {
    const state = await readGameScreenState(page);
    if (state.phase === 'game_over') {
      return 'game_over';
    }
    if (!state.aiThinking) {
      const isAi = await playerCardLocator(page, state.currentPlayer).getAttribute('data-is-ai');
      if (
        isAi === 'false' &&
        (options.expectedPlayer === undefined || state.currentPlayer === options.expectedPlayer) &&
        (options.expectedPhase === undefined || state.phase === options.expectedPhase)
      ) {
        return 'human_turn';
      }
    }
    if (step < maxSteps) {
      await page.clock.runFor(stepMs);
    }
  }

  const finalState = await readGameScreenState(page);
  throw new Error(
    `Paused clock did not reach human turn or game_over within ${maxSteps} steps (phase=${finalState.phase}, currentPlayer=${finalState.currentPlayer}, aiThinking=${finalState.aiThinking})`,
  );
}

/** Pure geometry check: returns true iff internal edge `edge` borders cell `pos`. */
export function isWallAdjacentToCell(edge: E2EWallEdge, pos: E2ECellPos): boolean {
  if (edge.orientation === 'h') {
    return (edge.row === pos.row - 1 || edge.row === pos.row) && edge.col === pos.col;
  }
  return edge.row === pos.row && (edge.col === pos.col - 1 || edge.col === pos.col);
}

/** Reads all currently mounted pieces and placed walls strictly via frozen `PROJECT.md § 3` DOM attributes. */
export async function readBoardGeometrySnapshot(page: Page): Promise<BoardGeometrySnapshot> {
  return page.evaluate(() => {
    const pieceCells = document.querySelectorAll(
      '[data-testid^="cell-"][data-occupied-by]:not([data-occupied-by="none"])',
    );
    const pieces = Array.from(pieceCells)
      .map((el) => ({
        owner: Number(el.getAttribute('data-occupied-by') ?? '-1'),
        kind: (el.getAttribute('data-piece-kind') ?? 'standard') as E2EPieceKind,
        row: Number(el.getAttribute('data-row') ?? '-1'),
        col: Number(el.getAttribute('data-col') ?? '-1'),
      }))
      .sort((a, b) =>
        a.owner !== b.owner
          ? a.owner - b.owner
          : a.row !== b.row
            ? a.row - b.row
            : a.col - b.col,
      );

    const wallNodes = document.querySelectorAll('[data-testid^="placed-wall-"]');
    const walls = Array.from(wallNodes)
      .map((el) => ({
        orientation: (el.getAttribute('data-orientation') ?? 'h') as E2EWallOrientation,
        row: Number(el.getAttribute('data-row') ?? '-1'),
        col: Number(el.getAttribute('data-col') ?? '-1'),
        owner: Number(el.getAttribute('data-owner') ?? '-1'),
        lastWall: el.getAttribute('data-last-wall') === 'true',
      }))
      .sort((a, b) => {
        if (a.orientation !== b.orientation) {
          return a.orientation.localeCompare(b.orientation);
        }
        return a.row !== b.row ? a.row - b.row : a.col - b.col;
      });

    return { pieces, walls };
  });
}

/** Reads total used Wall Break charges across all 3P players (`0` in 2P). */
export async function readUsedWallBreaksCount(page: Page): Promise<number> {
  const state = await readGameScreenState(page);
  if (state.format !== '3p') {
    return 0;
  }
  let remainingTotal = 0;
  for (const id of [0, 1, 2] as const) {
    const rem = Number(
      await page.getByTestId(`player-wallbreak-${id}`).getAttribute('data-remaining'),
    );
    expect([0, 1], `player-wallbreak-${id} data-remaining must be 0 or 1`).toContain(rem);
    remainingTotal += rem;
  }
  return 3 - remainingTotal;
}

/**
 * Verifies exact Wall Go conservation law over arbitrary turns:
 * `turnNumber === turnBefore + expectedTurnDelta`, `wallsNow >= 1`, and
 * `(wallsNow - wallsBefore) + (usedBreaksNow - usedBreaksBefore) === expectedTurnDelta`.
 */
export async function assertWallBreakConservation(
  page: Page,
  params: {
    readonly turnBefore: number;
    readonly expectedTurnDelta: number;
    readonly wallsBefore: number;
    readonly usedBreaksBefore: number;
  },
): Promise<{
  readonly wallsNow: number;
  readonly usedBreaksNow: number;
  readonly turnNow: number;
}> {
  const expectedTurn = params.turnBefore + params.expectedTurnDelta;
  await expect(page.getByTestId('game-screen')).toHaveAttribute(
    'data-turn-number',
    String(expectedTurn),
  );
  const wallsNow = await page.locator('[data-testid^="placed-wall-"]').count();
  const usedBreaksNow = await readUsedWallBreaksCount(page);

  expect(
    wallsNow,
    'At least 1 placed wall must exist after completed turns',
  ).toBeGreaterThanOrEqual(1);
  expect(
    wallsNow - params.wallsBefore + (usedBreaksNow - params.usedBreaksBefore),
    `Wall Go conservation violated: Δwalls (${wallsNow - params.wallsBefore}) + ΔusedBreaks (${usedBreaksNow - params.usedBreaksBefore}) !== Δturns (${params.expectedTurnDelta})`,
  ).toBe(params.expectedTurnDelta);

  return { wallsNow, usedBreaksNow, turnNow: expectedTurn };
}
