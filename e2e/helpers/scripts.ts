import { expect, type Page } from '@playwright/test';
import {
  SCRIPT_B_PLACEMENTS,
  completePlacement,
  hWall,
  playFirstLegalHumanTurn,
  playHumanTurn,
  playWallGo1BreakTurn,
  readBoardGeometrySnapshot,
  readGameScreenState,
  startConfiguredGame,
  vWall,
  waitForGameOver,
  type BoardGeometryPiece,
  type BoardGeometrySnapshot,
  type E2ECellPos,
  type E2ELobbyOptions,
  type E2EPlacementStep,
  type E2EWallEdge,
} from './game.ts';

const BOARD_SIZE = 7;

// --- Oracle-Verified E2E-B Multi-Turn Script Placements ---

export const SCRIPT_D2_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 4, col: 2, kind: 'square' },
  { row: 6, col: 0, kind: 'square' },
  { row: 1, col: 0, kind: 'round' },
  { row: 0, col: 2, kind: 'square' },
  { row: 6, col: 1, kind: 'round' },
  { row: 1, col: 3, kind: 'round' },
];

export const SCRIPT_2P_WG1_FAST_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 1, col: 6 },
  { row: 0, col: 6 },
  { row: 6, col: 0 },
  { row: 6, col: 2 },
];

export const SCRIPT_R2_WG1_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 1, col: 4 },
  { row: 0, col: 5 },
  { row: 5, col: 0 },
  { row: 5, col: 2 },
];

export const SCRIPT_R2_WG2_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 1, col: 4 },
  { row: 0, col: 6 },
  { row: 6, col: 1 },
  { row: 6, col: 2 },
];

export const SCRIPT_3P_DEADLOCK_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 0, col: 0 },
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 5, col: 5 },
  { row: 6, col: 0 },
  { row: 6, col: 6 },
];

export const SCRIPT_3P_TIE_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 1, col: 0 },
  { row: 0, col: 2 },
  { row: 1, col: 2 },
  { row: 2, col: 2 },
  { row: 2, col: 1 },
  { row: 2, col: 0 },
];

// --- Multi-Turn Script Runners ---

/**
 * Executes Script B placement + Turns 1-4 on an already-started 3P Wall Go I game
 * (enables pairing `openLobbyWithPausedClock` with Script B in timer timeout tests).
 */
export async function runScriptBSetupFromStartedGame(page: Page): Promise<void> {
  await completePlacement(page, SCRIPT_B_PLACEMENTS);
  await playHumanTurn(page, { row: 2, col: 2 }, { row: 2, col: 2 }, vWall(2, 2));
  await playHumanTurn(page, { row: 4, col: 6 }, { row: 4, col: 6 }, hWall(4, 6));
  await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 6 }, vWall(6, 5));
  await playHumanTurn(page, { row: 2, col: 2 }, { row: 2, col: 1 }, hWall(2, 1));
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
}

/**
 * 7-turn 3P Wall Go II full completion on an already-started game (`P0=43, P1=4, P2=2`).
 * Zero stays; exercises both `square` straight moves and `round` 90-degree diagonal move.
 */
export async function run3PWallGo2CompletionFromStartedGame(page: Page): Promise<void> {
  await completePlacement(page, SCRIPT_D2_PLACEMENTS);
  await playHumanTurn(page, { row: 4, col: 2 }, { row: 5, col: 2 }, vWall(5, 1));
  await playHumanTurn(page, { row: 6, col: 0 }, { row: 5, col: 0 }, hWall(4, 0));
  await playHumanTurn(page, { row: 1, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
  await playHumanTurn(page, { row: 5, col: 2 }, { row: 6, col: 2 }, vWall(6, 1));
  await playHumanTurn(page, { row: 6, col: 1 }, { row: 5, col: 1 }, hWall(4, 1));
  await playHumanTurn(page, { row: 0, col: 2 }, { row: 0, col: 1 }, hWall(0, 1));
  await playHumanTurn(page, { row: 1, col: 3 }, { row: 0, col: 2 }, vWall(0, 1));
  await waitForGameOver(page, 10_000);
}

/**
 * Script D2: Launches and completes a 7-turn 3P Wall Go II game to `game_over` (`P0=43, P1=4, P2=2`).
 */
export async function runScriptD2(
  page: Page,
  options: Omit<E2ELobbyOptions, 'variant' | 'format' | 'shuffleOrder'> = {},
): Promise<void> {
  await startConfiguredGame(page, {
    ...options,
    variant: 'wallgo2',
    format: '3p',
    shuffleOrder: false,
  });
  await run3PWallGo2CompletionFromStartedGame(page);
}

/**
 * Fast 6-turn 2P Wall Go I completion from `placement` to `game_over` (`P0=45, P1=4 [2+2, max 2]`).
 * Works identically for Standalone 2P and Prison Match Round 2.
 */
export async function complete2PWallGo1Fast(page: Page): Promise<void> {
  await completePlacement(page, SCRIPT_2P_WG1_FAST_PLACEMENTS);
  await playHumanTurn(page, { row: 1, col: 6 }, { row: 1, col: 6 }, hWall(0, 6));
  await playHumanTurn(page, { row: 1, col: 5 }, { row: 0, col: 5 }, vWall(0, 4));
  await playHumanTurn(page, { row: 1, col: 6 }, { row: 1, col: 5 }, hWall(0, 5));
  await playHumanTurn(page, { row: 5, col: 1 }, { row: 6, col: 1 }, hWall(5, 1));
  await playHumanTurn(page, { row: 6, col: 2 }, { row: 6, col: 2 }, vWall(6, 1));
  await playHumanTurn(page, { row: 6, col: 0 }, { row: 6, col: 0 }, hWall(5, 0));
  await waitForGameOver(page, 10_000);
}

/**
 * Script R2_WG1: 8-turn 2P / Round 2 Wall Go I completion to `game_over` (`P0=41, P1=8 [4+4, max 4]`).
 */
export async function completeRound2WallGo1ToGameOver(page: Page): Promise<void> {
  await completePlacement(page, SCRIPT_R2_WG1_PLACEMENTS);
  await playHumanTurn(page, { row: 1, col: 4 }, { row: 1, col: 4 }, vWall(1, 4));
  await playHumanTurn(page, { row: 0, col: 5 }, { row: 0, col: 5 }, vWall(0, 4));
  await playHumanTurn(page, { row: 5, col: 2 }, { row: 5, col: 2 }, vWall(5, 1));
  await playHumanTurn(page, { row: 5, col: 0 }, { row: 5, col: 0 }, hWall(4, 0));
  await playHumanTurn(page, { row: 5, col: 2 }, { row: 6, col: 2 }, vWall(6, 1));
  await playHumanTurn(page, { row: 5, col: 1 }, { row: 5, col: 1 }, hWall(4, 1));
  await playHumanTurn(page, { row: 1, col: 4 }, { row: 2, col: 5 }, hWall(1, 5));
  await playHumanTurn(page, { row: 1, col: 5 }, { row: 1, col: 6 }, hWall(1, 6));
  await waitForGameOver(page, 10_000);
}

/**
 * Script R2_WG2 (Turns 1-4): Places 2P Wall Go II pieces and seals NE 2x2 (`4` cells) for P1.
 */
export async function complete2PWallGo2Turns1To4(page: Page): Promise<void> {
  await completePlacement(page, SCRIPT_R2_WG2_PLACEMENTS);
  await playHumanTurn(page, { row: 1, col: 4 }, { row: 0, col: 4 }, vWall(0, 4));
  await playHumanTurn(page, { row: 1, col: 5 }, { row: 1, col: 6 }, hWall(1, 6));
  await playHumanTurn(page, { row: 0, col: 4 }, { row: 1, col: 4 }, vWall(1, 4));
  await playHumanTurn(page, { row: 1, col: 6 }, { row: 1, col: 5 }, hWall(1, 5));
}

/**
 * Script R2_WG2 (Turns 5-8): Seals SW 2x2 (`4` cells) for P1, triggering `game_over` (`P0=41, P1=8 [4+4, max 4]`).
 */
export async function complete2PWallGo2Turns5To8(page: Page): Promise<void> {
  await playHumanTurn(page, { row: 6, col: 2 }, { row: 5, col: 2 }, vWall(5, 1));
  await playHumanTurn(page, { row: 5, col: 1 }, { row: 5, col: 0 }, hWall(4, 0));
  await playHumanTurn(page, { row: 5, col: 2 }, { row: 6, col: 2 }, vWall(6, 1));
  await playHumanTurn(page, { row: 6, col: 1 }, { row: 5, col: 1 }, hWall(4, 1));
  await waitForGameOver(page, 10_000);
}

/**
 * Shared Turns 1-6 prefix for `T2-34` (`E20` contested deadlock) and `T2-35` (`E21` wall-break rescue).
 * Leaves P1 with `wb = 0`, P0 with `wb = 1`, and Turn 7 active on P0.
 */
export async function run3PDeadlockBaseTurns1To6(page: Page): Promise<void> {
  await startConfiguredGame(page, {
    variant: 'wallgo1',
    format: '3p',
    shuffleOrder: false,
  });
  await completePlacement(page, SCRIPT_3P_DEADLOCK_PLACEMENTS);
  await playHumanTurn(page, { row: 6, col: 6 }, { row: 6, col: 6 }, hWall(5, 6));
  await playHumanTurn(page, { row: 6, col: 0 }, { row: 6, col: 0 }, hWall(5, 0));
  await playHumanTurn(page, { row: 1, col: 0 }, { row: 1, col: 1 }, hWall(0, 1));
  await playHumanTurn(page, { row: 0, col: 0 }, { row: 0, col: 0 }, hWall(0, 0));
  await playWallGo1BreakTurn(
    page,
    { row: 6, col: 0 },
    hWall(5, 0),
    { row: 6, col: 0 },
    hWall(5, 0),
  );
  await playHumanTurn(page, { row: 5, col: 5 }, { row: 6, col: 4 }, vWall(6, 4));
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '0');
}

/**
 * 12-turn 3P Wall Go I tie scenario driver:
 * - `'tied_for_first'`: P0=3, P1=3, P2=2 (+41 neutral) -> ranks `[1, 1, 3]`.
 * - `'three_way_tie'`:  P0=3, P1=3, P2=3 (+40 neutral) -> ranks `[1, 1, 1]`.
 */
export async function run3PTieScenario(
  page: Page,
  kind: 'tied_for_first' | 'three_way_tie',
): Promise<void> {
  await startConfiguredGame(page, {
    variant: 'wallgo1',
    format: '3p',
    shuffleOrder: false,
  });
  await completePlacement(page, SCRIPT_3P_TIE_PLACEMENTS);
  await playHumanTurn(page, { row: 1, col: 0 }, { row: 0, col: 0 }, vWall(0, 0));
  await playHumanTurn(
    page,
    { row: 0, col: 2 },
    { row: 0, col: 2 },
    kind === 'tied_for_first' ? hWall(0, 2) : vWall(0, 2),
  );
  await playHumanTurn(page, { row: 1, col: 2 }, { row: 1, col: 2 }, vWall(1, 2));
  await playHumanTurn(page, { row: 2, col: 0 }, { row: 1, col: 0 }, vWall(1, 0));
  await playHumanTurn(page, { row: 0, col: 2 }, { row: 0, col: 1 }, vWall(0, 1));
  await playHumanTurn(page, { row: 2, col: 2 }, { row: 2, col: 2 }, vWall(2, 2));
  await playHumanTurn(page, { row: 1, col: 0 }, { row: 2, col: 0 }, hWall(2, 0));
  await playHumanTurn(page, { row: 2, col: 1 }, { row: 2, col: 1 }, hWall(2, 1));
  await playHumanTurn(page, { row: 2, col: 2 }, { row: 2, col: 2 }, hWall(2, 2));
  await playHumanTurn(page, { row: 2, col: 0 }, { row: 2, col: 0 }, vWall(2, 0));
  await playHumanTurn(page, { row: 2, col: 1 }, { row: 1, col: 1 }, vWall(1, 1));
  await playHumanTurn(page, { row: 2, col: 2 }, { row: 2, col: 2 }, vWall(2, 1));
  await waitForGameOver(page, 10_000);
}

// --- Pure Opaque-Box Wall Go I Board Geometry Engine (DOM Snapshot Only, ZERO src/ Imports) ---

function wallKeyStr(edge: E2EWallEdge): string {
  return `${edge.orientation}:${edge.row}:${edge.col}`;
}

function cellIndex(row: number, col: number): number {
  return row * BOARD_SIZE + col;
}

function adjacentWallsOfCell(pos: E2ECellPos): E2EWallEdge[] {
  const edges: E2EWallEdge[] = [];
  if (pos.row > 0) {
    edges.push(hWall(pos.row - 1, pos.col));
  }
  if (pos.row < BOARD_SIZE - 1) {
    edges.push(hWall(pos.row, pos.col));
  }
  if (pos.col > 0) {
    edges.push(vWall(pos.row, pos.col - 1));
  }
  if (pos.col < BOARD_SIZE - 1) {
    edges.push(vWall(pos.row, pos.col));
  }
  return edges;
}

function sharedWallBetween(a: E2ECellPos, b: E2ECellPos): E2EWallEdge | null {
  const dr = b.row - a.row;
  const dc = b.col - a.col;
  if (Math.abs(dr) + Math.abs(dc) !== 1) {
    return null;
  }
  if (dr === 1) {
    return hWall(a.row, a.col);
  }
  if (dr === -1) {
    return hWall(b.row, b.col);
  }
  if (dc === 1) {
    return vWall(a.row, a.col);
  }
  return vWall(b.row, b.col);
}

function buildOccupiedMap(pieces: readonly BoardGeometryPiece[]): Int8Array {
  const occ = new Int8Array(BOARD_SIZE * BOARD_SIZE).fill(-1);
  for (const p of pieces) {
    occ[cellIndex(p.row, p.col)] = p.owner;
  }
  return occ;
}

const ORTHO_DIRS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function wg1DestinationsForPiece(
  occ: Int8Array,
  wallSet: ReadonlySet<string>,
  pos: E2ECellPos,
): E2ECellPos[] {
  const step1: E2ECellPos[] = [];
  const seen = new Uint8Array(BOARD_SIZE * BOARD_SIZE);

  for (const [dr, dc] of ORTHO_DIRS) {
    const nr = pos.row + dr;
    const nc = pos.col + dc;
    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) {
      continue;
    }
    const edge = sharedWallBetween(pos, { row: nr, col: nc });
    if (!edge || wallSet.has(wallKeyStr(edge))) {
      continue;
    }
    if (occ[cellIndex(nr, nc)] !== -1) {
      continue;
    }
    seen[cellIndex(nr, nc)] = 1;
    step1.push({ row: nr, col: nc });
  }

  if (step1.length === 0) {
    return [];
  }

  const destinations: E2ECellPos[] = [{ row: pos.row, col: pos.col }, ...step1];
  seen[cellIndex(pos.row, pos.col)] = 1;

  for (const mid of step1) {
    for (const [dr, dc] of ORTHO_DIRS) {
      const nr = mid.row + dr;
      const nc = mid.col + dc;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) {
        continue;
      }
      const idx = cellIndex(nr, nc);
      if (seen[idx] === 1 || occ[idx] !== -1) {
        continue;
      }
      const edge = sharedWallBetween(mid, { row: nr, col: nc });
      if (!edge || wallSet.has(wallKeyStr(edge))) {
        continue;
      }
      seen[idx] = 1;
      destinations.push({ row: nr, col: nc });
    }
  }

  return destinations;
}

interface BfsComponent {
  readonly id: number;
  readonly size: number;
  readonly owners: ReadonlySet<number>;
}

function computeWallComponents(
  pieces: readonly BoardGeometryPiece[],
  wallSet: ReadonlySet<string>,
): { readonly components: readonly BfsComponent[]; readonly cellCompId: Int8Array } {
  const cellCompId = new Int8Array(BOARD_SIZE * BOARD_SIZE).fill(-1);
  const ownerByCell = buildOccupiedMap(pieces);
  const components: BfsComponent[] = [];
  const queueRow = new Int8Array(BOARD_SIZE * BOARD_SIZE);
  const queueCol = new Int8Array(BOARD_SIZE * BOARD_SIZE);

  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      const startIdx = cellIndex(r, c);
      if (cellCompId[startIdx] !== -1) {
        continue;
      }
      const compId = components.length;
      const owners = new Set<number>();
      let head = 0;
      let tail = 0;
      queueRow[tail] = r;
      queueCol[tail] = c;
      tail += 1;
      cellCompId[startIdx] = compId;

      while (head < tail) {
        const cr = queueRow[head] ?? 0;
        const cc = queueCol[head] ?? 0;
        head += 1;
        const owner = ownerByCell[cellIndex(cr, cc)] ?? -1;
        if (owner !== -1) {
          owners.add(owner);
        }
        for (const [dr, dc] of ORTHO_DIRS) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) {
            continue;
          }
          const nIdx = cellIndex(nr, nc);
          if (cellCompId[nIdx] !== -1) {
            continue;
          }
          const edge = sharedWallBetween({ row: cr, col: cc }, { row: nr, col: nc });
          if (!edge || wallSet.has(wallKeyStr(edge))) {
            continue;
          }
          cellCompId[nIdx] = compId;
          queueRow[tail] = nr;
          queueCol[tail] = nc;
          tail += 1;
        }
      }

      components.push({ id: compId, size: tail, owners });
    }
  }

  return { components, cellCompId };
}

function hasAnyLegalWg1Break(
  pieces: readonly BoardGeometryPiece[],
  wallSet: ReadonlySet<string>,
  owner: number,
): boolean {
  const occ = buildOccupiedMap(pieces);
  for (const p of pieces) {
    if (p.owner !== owner) {
      continue;
    }
    for (const edge of adjacentWallsOfCell(p)) {
      const key = wallKeyStr(edge);
      if (!wallSet.has(key)) {
        continue;
      }
      const without = new Set(wallSet);
      without.delete(key);
      if (wg1DestinationsForPiece(occ, without, p).length > 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Pure opaque-box computation of total legal Wall Go I normal+stay moves available
 * to `owner` from a DOM-read `BoardGeometrySnapshot`.
 */
export function computeWg1NormalMoveCount(
  snapshot: BoardGeometrySnapshot,
  owner: number,
): number {
  const wallSet = new Set(snapshot.walls.map(wallKeyStr));
  const occ = buildOccupiedMap(snapshot.pieces);
  let total = 0;
  for (const p of snapshot.pieces) {
    if (p.owner !== owner) {
      continue;
    }
    total += wg1DestinationsForPiece(occ, wallSet, p).length;
  }
  return total;
}

/**
 * Opaque-box corner self-seal strategy for Human player in Mixed Human + 2-AI 3P Wall Go I tests
 * (`T2-48`, `C08`, `C10`). Rapidly seals own corner pieces, spends remaining Wall Break via
 * legal break-stay-reseal, and hands control to the 2 AIs without ending the game on the human turn.
 */
export async function playHumanSelfSealCornerTurn(
  page: Page,
  humanPlayerId: number,
): Promise<void> {
  const snapshot = await readBoardGeometrySnapshot(page);
  const state = await readGameScreenState(page);
  const wbRemaining =
    state.format === '3p'
      ? Number(
          await page.getByTestId(`player-wallbreak-${humanPlayerId}`).getAttribute('data-remaining'),
        )
      : 0;

  const wallSet = new Set(snapshot.walls.map(wallKeyStr));
  const ownPieces = snapshot.pieces.filter((p) => p.owner === humanPlayerId);
  const { components, cellCompId } = computeWallComponents(snapshot.pieces, wallSet);

  const allOwnSecured =
    ownPieces.length > 0 &&
    ownPieces.every((p) => {
      const comp = components[cellCompId[cellIndex(p.row, p.col)] ?? -1];
      return comp !== undefined && comp.owners.size === 1 && comp.owners.has(humanPlayerId);
    });

  // Once completely sealed with wb=1, spend the Wall Break cleanly via break-stay-reseal so auto-skip activates.
  if (allOwnSecured && wbRemaining === 1) {
    const occ = buildOccupiedMap(snapshot.pieces);
    for (const p of ownPieces) {
      for (const edge of adjacentWallsOfCell(p)) {
        const key = wallKeyStr(edge);
        if (!wallSet.has(key)) {
          continue;
        }
        const without = new Set(wallSet);
        without.delete(key);
        if (wg1DestinationsForPiece(occ, without, p).length > 0) {
          await playWallGo1BreakTurn(page, p, edge, p, edge);
          return;
        }
      }
    }
  }

  const occ = buildOccupiedMap(snapshot.pieces);
  const inHorizPair =
    ownPieces.length >= 2 &&
    ownPieces.every((p) => (p.row === 0 && p.col === 0) || (p.row === 0 && p.col === 1));
  const inVertPair =
    ownPieces.length >= 2 &&
    ownPieces.every((p) => (p.row === 0 && p.col === 0) || (p.row === 1 && p.col === 0));

  const preferredWallKeys = new Set<string>(
    inHorizPair
      ? [wallKeyStr(hWall(0, 0)), wallKeyStr(hWall(0, 1)), wallKeyStr(vWall(0, 1))]
      : inVertPair
        ? [wallKeyStr(vWall(0, 0)), wallKeyStr(vWall(1, 0)), wallKeyStr(hWall(1, 0))]
        : [wallKeyStr(hWall(0, 0)), wallKeyStr(vWall(0, 0))],
  );

  let bestMove: { from: E2ECellPos; to: E2ECellPos; wall: E2EWallEdge; score: number } | null = null;

  for (const p of ownPieces) {
    const destinations = wg1DestinationsForPiece(occ, wallSet, p);
    for (const dest of destinations) {
      const nextPieces = snapshot.pieces.map((piece) =>
        piece === p ? { ...piece, row: dest.row, col: dest.col } : piece,
      );
      for (const edge of adjacentWallsOfCell(dest)) {
        const key = wallKeyStr(edge);
        if (wallSet.has(key)) {
          continue;
        }
        const nextWalls = new Set(wallSet);
        nextWalls.add(key);
        const { components: nextComps, cellCompId: nextCellComp } = computeWallComponents(
          nextPieces,
          nextWalls,
        );

        const anyOtherContested = nextComps.some((c) => c.owners.size >= 2);
        const ownCompIds = new Set<number>();
        let ownSecuredCount = 0;
        for (const np of nextPieces) {
          if (np.owner !== humanPlayerId) {
            continue;
          }
          const cid = nextCellComp[cellIndex(np.row, np.col)] ?? -1;
          ownCompIds.add(cid);
          const comp = nextComps[cid];
          if (comp && comp.owners.size === 1 && comp.owners.has(humanPlayerId)) {
            ownSecuredCount += 1;
          }
        }
        let ownCompSizeSum = 0;
        for (const cid of ownCompIds) {
          ownCompSizeSum += nextComps[cid]?.size ?? 0;
        }

        const staysInTargetCorner =
          (inHorizPair && dest.row === 0 && (dest.col === 0 || dest.col === 1)) ||
          (inVertPair && dest.col === 0 && (dest.row === 0 || dest.row === 1)) ||
          (!inHorizPair && !inVertPair && dest.row <= 1 && dest.col <= 1);

        let score = 0;
        score += anyOtherContested ? 1_000_000 : -1_000_000;
        score += ownSecuredCount * 50_000;
        score -= ownCompSizeSum * 1_000;
        if (staysInTargetCorner) {
          score += 20_000;
        }
        if (preferredWallKeys.has(key) && staysInTargetCorner) {
          score += 30_000;
          // Prefer sealing (0,0)'s vulnerable edge first before AIs approach it.
          if (dest.row === 0 && dest.col === 0) {
            score += 5_000;
          }
        }
        if (dest.row === p.row && dest.col === p.col) {
          score += 200;
        }

        if (!bestMove || score > bestMove.score) {
          bestMove = { from: p, to: dest, wall: edge, score };
        }
      }
    }
  }

  if (bestMove) {
    await playHumanTurn(page, bestMove.from, bestMove.to, bestMove.wall);
    return;
  }

  await playFirstLegalHumanTurn(page, humanPlayerId);
}

/**
 * Cooperating 2-Human surround heuristic for `T2-56` (`E27`):
 * Keeps P0 & P1 connected in a large contested component (preventing premature `game_over`)
 * while systematically collapsing AI P2's mobility to `0` normal moves with a legal Wall Break open.
 */
export async function playCooperatingSurroundTurn(
  page: Page,
  actorOwner: 0 | 1,
): Promise<void> {
  const snapshot = await readBoardGeometrySnapshot(page);
  const wallSet = new Set(snapshot.walls.map(wallKeyStr));
  const occ = buildOccupiedMap(snapshot.pieces);
  const actorPieces = snapshot.pieces.filter((p) => p.owner === actorOwner);
  const p2PiecesInitial = snapshot.pieces.filter((p) => p.owner === 2);

  let bestMove: { from: E2ECellPos; to: E2ECellPos; wall: E2EWallEdge; score: number } | null = null;

  for (const p of actorPieces) {
    const destinations = wg1DestinationsForPiece(occ, wallSet, p);
    for (const dest of destinations) {
      const nextPieces = snapshot.pieces.map((piece) =>
        piece === p ? { ...piece, row: dest.row, col: dest.col } : piece,
      );
      const nextOcc = buildOccupiedMap(nextPieces);

      for (const edge of adjacentWallsOfCell(dest)) {
        const key = wallKeyStr(edge);
        if (wallSet.has(key)) {
          continue;
        }
        const nextWalls = new Set(wallSet);
        nextWalls.add(key);

        const { components, cellCompId } = computeWallComponents(nextPieces, nextWalls);

        let max01Size = 0;
        let max01CompId = -1;
        for (const comp of components) {
          if (comp.owners.has(0) && comp.owners.has(1) && comp.size > max01Size) {
            max01Size = comp.size;
            max01CompId = comp.id;
          }
        }

        let max01Mob = 0;
        if (max01CompId !== -1) {
          for (const np of nextPieces) {
            if (
              (np.owner === 0 || np.owner === 1) &&
              cellCompId[cellIndex(np.row, np.col)] === max01CompId
            ) {
              max01Mob += wg1DestinationsForPiece(nextOcc, nextWalls, np).length;
            }
          }
        }

        const p2CompIds = new Set<number>();
        let p2NormalMoves = 0;
        let p2Secured = p2PiecesInitial.length > 0;
        for (const np of nextPieces) {
          if (np.owner !== 2) {
            continue;
          }
          const cid = cellCompId[cellIndex(np.row, np.col)] ?? -1;
          p2CompIds.add(cid);
          const comp = components[cid];
          if (!comp || comp.owners.size !== 1 || !comp.owners.has(2)) {
            p2Secured = false;
          }
          p2NormalMoves += wg1DestinationsForPiece(nextOcc, nextWalls, np).length;
        }

        let p2CompSum = 0;
        for (const cid of p2CompIds) {
          p2CompSum += components[cid]?.size ?? 0;
        }

        const p2HasBreak = hasAnyLegalWg1Break(nextPieces, nextWalls, 2);
        const adjToP2 = p2PiecesInitial.some((p2) =>
          adjacentWallsOfCell(p2).some((w) => wallKeyStr(w) === key),
        )
          ? 1
          : 0;

        const score =
          (max01Size > 0 ? 1e8 : -1e8) +
          (p2Secured && max01Size > p2CompSum ? 2e7 : 0) +
          max01Size * 5_000 +
          max01Mob * 600 +
          (p2HasBreak ? 1e5 : 0) -
          p2CompSum * 3_000 -
          p2NormalMoves * 1_000 +
          adjToP2 * 800;

        if (!bestMove || score > bestMove.score) {
          bestMove = { from: p, to: dest, wall: edge, score };
        }
      }
    }
  }

  if (bestMove) {
    await playHumanTurn(page, bestMove.from, bestMove.to, bestMove.wall);
    return;
  }

  await playFirstLegalHumanTurn(page, actorOwner);
}
