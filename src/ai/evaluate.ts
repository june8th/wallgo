import { BOARD_SIZE, isInBounds, isValidWallEdge } from '../engine/index.js';
import type { GameState, RngFn, WallEdge, WallKey } from '../engine/index.js';

const NUM_CELLS = BOARD_SIZE * BOARD_SIZE; // 49
const NUM_H_WALLS = (BOARD_SIZE - 1) * BOARD_SIZE; // 42
const NUM_V_WALLS = BOARD_SIZE * (BOARD_SIZE - 1); // 42

const DR: readonly number[] = [-1, 1, 0, 0];
const DC: readonly number[] = [0, 0, -1, 1];

// Heuristic weights (F22)
const W_SECURED_CELL = 10.0;
const W_LARGEST_SINGLE = 0.6;
const W_VORONOI_CELL = 2.8;
const W_WALL_BREAK_RESERVE = 14.0;
const W_MOBILITY_WG1 = 0.65;
const W_MOBILITY_WG2 = 1.0;
const W_CONTAIN_2P = 3.5;
const W_CONTAIN_3P = 2.1;

/**
 * Strategic opening placement weights (F21):
 * Corner-adjacent hubs C3=(2,2), E3=(2,4), C5=(4,2), E5=(4,4) = 10.0;
 * Center D4=(3,3) = 9.5; inner ring medium; outer edges/corners lowest.
 */
export const OPENING_CELL_WEIGHTS: readonly number[] = [
  1.0, 2.5, 3.5, 4.0, 3.5, 2.5, 1.0,
  2.5, 5.5, 7.0, 7.5, 7.0, 5.5, 2.5,
  3.5, 7.0, 10.0, 8.5, 10.0, 7.0, 3.5,
  4.0, 7.5, 8.5, 9.5, 8.5, 7.5, 4.0,
  3.5, 7.0, 10.0, 8.5, 10.0, 7.0, 3.5,
  2.5, 5.5, 7.0, 7.5, 7.0, 5.5, 2.5,
  1.0, 2.5, 3.5, 4.0, 3.5, 2.5, 1.0,
];

export interface SearchBoard {
  ruleVariant: 0 | 1; // 0 = 'wallgo1', 1 = 'wallgo2'
  is3P: boolean;
  playerCount: number; // 2 or 3
  playerIds: Int8Array; // length playerCount -> GameState PlayerState.id
  hWalls: Uint8Array; // length 42: h(r:0..5, c:0..6) at r*7 + c
  vWalls: Uint8Array; // length 42: v(r:0..6, c:0..5) at r*6 + c
  cellPiece: Int8Array; // length 49: -1 = empty, 0..pieceCount-1 = piece index
  pieceCount: number;
  pieceIds: readonly string[];
  pieceRow: Int8Array;
  pieceCol: Int8Array;
  pieceOwner: Uint8Array; // 0..playerCount-1 (index into players)
  pieceKind: Uint8Array; // 0 = 'standard', 1 = 'square', 2 = 'round'
  wallBreaksRemaining: Uint8Array; // length 3, indexed by playerIdx 0..playerCount-1
}

export interface CompactAction {
  pieceIdx: number;
  useWallBreak: boolean;
  breakWallCode: number; // -1 if normal move, else 0..83
  destRow: number;
  destCol: number;
  placeWallCode: number; // 0..83
}

export interface EvalScratch {
  compId: Int8Array; // 49
  bfsQueue: Uint8Array; // 49
  compSize: Uint8Array; // 49
  compOwnerMask: Uint8Array; // 49 (bit 0 = P0, bit 1 = P1, bit 2 = P2)
  securedTotal: Uint8Array; // 3
  largestSingle: Uint8Array; // 3
  deadlockPieces: Uint8Array; // 3
  finalTotal: Uint8Array; // 3
  finalLargest: Uint8Array; // 3
  vorDist: Uint8Array; // 49 (255 = unreached)
  vorOwner: Int8Array; // 49 (-1 = unreached, 0..2 = owner, -2 = contested tie)
  vorQueue: Uint8Array; // 49
  vorCount: Uint8Array; // 3
  rawScores: Float64Array; // 3
  finalScores: Float64Array; // 3
  mobScores: Float64Array; // 3
  trapPenalties: Float64Array; // 3
  trappedOppCount: Uint8Array; // 3
  moveStamp: Uint32Array; // 49
  stampCounter: number;
  destBuf: Uint8Array; // 13
  wallBuf: Uint8Array; // 4
}

export interface SearchEvalResult {
  score: number;
  isTerminal: boolean;
}

export function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function safeRng(rng: RngFn): number {
  const raw = rng();
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  if (raw >= 1) {
    return 0.9999999999999999;
  }
  return raw;
}

export function encodeWallCode(edge: WallEdge): number {
  if (edge.orientation === 'h') {
    return edge.row * BOARD_SIZE + edge.col;
  }
  return NUM_H_WALLS + edge.row * (BOARD_SIZE - 1) + edge.col;
}

export function decodeWallCode(code: number): WallEdge {
  if (code < NUM_H_WALLS) {
    const row = (code / BOARD_SIZE) | 0;
    const col = code - row * BOARD_SIZE;
    return { orientation: 'h', row, col };
  }
  const v = code - NUM_H_WALLS;
  const row = (v / (BOARD_SIZE - 1)) | 0;
  const col = v - row * (BOARD_SIZE - 1);
  return { orientation: 'v', row, col };
}

export function getWallByCode(board: SearchBoard, code: number): number {
  return code < NUM_H_WALLS ? board.hWalls[code] : board.vWalls[code - NUM_H_WALLS];
}

export function setWallByCode(board: SearchBoard, code: number, val: 0 | 1): void {
  if (code < NUM_H_WALLS) {
    board.hWalls[code] = val;
  } else {
    board.vWalls[code - NUM_H_WALLS] = val;
  }
}

/**
 * Returns the internal wall code (0..83) separating two orthogonally adjacent
 * in-bounds cells `(r1, c1)` and `(r2, c2)`.
 */
export function wallCodeBetween(r1: number, c1: number, r2: number, c2: number): number {
  if (r1 === r2) {
    const minC = c1 < c2 ? c1 : c2;
    return NUM_H_WALLS + r1 * (BOARD_SIZE - 1) + minC;
  }
  const minR = r1 < r2 ? r1 : r2;
  return minR * BOARD_SIZE + c1;
}

export function findPlayerIndex(state: GameState, playerId: number): number {
  if (
    playerId >= 0 &&
    playerId < state.players.length &&
    state.players[playerId].id === playerId
  ) {
    return playerId;
  }
  for (let i = 0; i < state.players.length; i++) {
    if (state.players[i].id === playerId) {
      return i;
    }
  }
  return -1;
}

export function createSearchBoard(state: GameState): SearchBoard {
  const playerCount = state.players.length;
  const is3P = state.format === '3p';
  const playerIds = new Int8Array(playerCount);
  const wallBreaksRemaining = new Uint8Array(3);

  for (let i = 0; i < playerCount; i++) {
    playerIds[i] = state.players[i].id;
    const rem = state.players[i].wallBreaksRemaining;
    wallBreaksRemaining[i] = is3P && rem > 0 ? rem : 0;
  }

  const hWalls = new Uint8Array(NUM_H_WALLS);
  const vWalls = new Uint8Array(NUM_V_WALLS);
  const wallKeys = Object.keys(state.walls);
  for (let i = 0; i < wallKeys.length; i++) {
    const k = wallKeys[i];
    if (!Object.prototype.hasOwnProperty.call(state.walls, k)) {
      continue;
    }
    const wall = state.walls[k as WallKey];
    if (wall && isValidWallEdge(wall)) {
      const code = encodeWallCode(wall);
      if (code < NUM_H_WALLS) {
        hWalls[code] = 1;
      } else {
        vWalls[code - NUM_H_WALLS] = 1;
      }
    }
  }

  const pieceCount = state.pieces.length;
  const cellPiece = new Int8Array(NUM_CELLS);
  cellPiece.fill(-1);
  const pieceIds: string[] = new Array<string>(pieceCount);
  const pieceRow = new Int8Array(pieceCount);
  const pieceCol = new Int8Array(pieceCount);
  const pieceOwner = new Uint8Array(pieceCount);
  const pieceKind = new Uint8Array(pieceCount);

  for (let i = 0; i < pieceCount; i++) {
    const p = state.pieces[i];
    pieceIds[i] = p.id;
    pieceRow[i] = p.row;
    pieceCol[i] = p.col;
    if (isInBounds(p.row, p.col)) {
      cellPiece[p.row * BOARD_SIZE + p.col] = i;
    }
    const ownerIdx = findPlayerIndex(state, p.ownerId);
    pieceOwner[i] = ownerIdx >= 0 ? ownerIdx : 0;
    pieceKind[i] = p.kind === 'standard' ? 0 : p.kind === 'square' ? 1 : 2;
  }

  return {
    ruleVariant: state.ruleVariant === 'wallgo1' ? 0 : 1,
    is3P,
    playerCount,
    playerIds,
    hWalls,
    vWalls,
    cellPiece,
    pieceCount,
    pieceIds,
    pieceRow,
    pieceCol,
    pieceOwner,
    pieceKind,
    wallBreaksRemaining,
  };
}

export function createEvalScratch(): EvalScratch {
  return {
    compId: new Int8Array(NUM_CELLS),
    bfsQueue: new Uint8Array(NUM_CELLS),
    compSize: new Uint8Array(NUM_CELLS),
    compOwnerMask: new Uint8Array(NUM_CELLS),
    securedTotal: new Uint8Array(3),
    largestSingle: new Uint8Array(3),
    deadlockPieces: new Uint8Array(3),
    finalTotal: new Uint8Array(3),
    finalLargest: new Uint8Array(3),
    vorDist: new Uint8Array(NUM_CELLS),
    vorOwner: new Int8Array(NUM_CELLS),
    vorQueue: new Uint8Array(NUM_CELLS),
    vorCount: new Uint8Array(3),
    rawScores: new Float64Array(3),
    finalScores: new Float64Array(3),
    mobScores: new Float64Array(3),
    trapPenalties: new Float64Array(3),
    trappedOppCount: new Uint8Array(3),
    moveStamp: new Uint32Array(NUM_CELLS),
    stampCounter: 0,
    destBuf: new Uint8Array(13),
    wallBuf: new Uint8Array(4),
  };
}

function nextMoveStamp(scratch: EvalScratch): number {
  let stamp = scratch.stampCounter + 1;
  if (stamp >= 0xfffffffe) {
    scratch.moveStamp.fill(0);
    stamp = 1;
  }
  scratch.stampCounter = stamp;
  return stamp;
}

/**
 * Applies `action` in-place onto `board`. Returns `origCell = origRow * 7 + origCol`
 * for zero-allocation unmake. Safe for F08 stay-in-place and E10 resealing.
 */
export function makeCompactAction(
  board: SearchBoard,
  actorIdx: number,
  action: CompactAction,
): number {
  const pIdx = action.pieceIdx;
  const origRow = board.pieceRow[pIdx];
  const origCol = board.pieceCol[pIdx];
  const origCell = origRow * BOARD_SIZE + origCol;

  if (action.breakWallCode !== -1) {
    setWallByCode(board, action.breakWallCode, 0);
    board.wallBreaksRemaining[actorIdx] -= 1;
  }

  board.cellPiece[origCell] = -1;
  board.pieceRow[pIdx] = action.destRow;
  board.pieceCol[pIdx] = action.destCol;
  board.cellPiece[action.destRow * BOARD_SIZE + action.destCol] = pIdx;

  setWallByCode(board, action.placeWallCode, 1);
  return origCell;
}

/**
 * Reverses `makeCompactAction` in exact reverse order so E10 resealed edges
 * (`breakWallCode === placeWallCode`) and F08 stay moves restore identically.
 */
export function unmakeCompactAction(
  board: SearchBoard,
  actorIdx: number,
  action: CompactAction,
  origCell: number,
): void {
  setWallByCode(board, action.placeWallCode, 0);

  const pIdx = action.pieceIdx;
  board.cellPiece[action.destRow * BOARD_SIZE + action.destCol] = -1;
  const origRow = (origCell / BOARD_SIZE) | 0;
  const origCol = origCell - origRow * BOARD_SIZE;
  board.pieceRow[pIdx] = origRow;
  board.pieceCol[pIdx] = origCol;
  board.cellPiece[origCell] = pIdx;

  if (action.breakWallCode !== -1) {
    setWallByCode(board, action.breakWallCode, 1);
    board.wallBreaksRemaining[actorIdx] += 1;
  }
}

/**
 * Enumerates legal Wall Go I 0..2 step destinations into `scratch.destBuf`.
 * Includes origin `(r0, c0)` iff `|D_1| >= 1` (F08 / E05 parity).
 */
export function genWallGo1DestsFast(
  board: SearchBoard,
  r0: number,
  c0: number,
  scratch: EvalScratch,
): number {
  const destBuf = scratch.destBuf;
  const cellPiece = board.cellPiece;
  const hWalls = board.hWalls;
  const vWalls = board.vWalls;

  let step1Count = 0;

  // North
  if (r0 > 0) {
    const nIdx = (r0 - 1) * BOARD_SIZE + c0;
    if (hWalls[nIdx] === 0 && cellPiece[nIdx] === -1) {
      destBuf[1 + step1Count] = nIdx;
      step1Count++;
    }
  }
  // South
  if (r0 < BOARD_SIZE - 1) {
    const sIdx = (r0 + 1) * BOARD_SIZE + c0;
    if (hWalls[r0 * BOARD_SIZE + c0] === 0 && cellPiece[sIdx] === -1) {
      destBuf[1 + step1Count] = sIdx;
      step1Count++;
    }
  }
  // West
  if (c0 > 0) {
    const wIdx = r0 * BOARD_SIZE + (c0 - 1);
    if (vWalls[r0 * (BOARD_SIZE - 1) + (c0 - 1)] === 0 && cellPiece[wIdx] === -1) {
      destBuf[1 + step1Count] = wIdx;
      step1Count++;
    }
  }
  // East
  if (c0 < BOARD_SIZE - 1) {
    const eIdx = r0 * BOARD_SIZE + (c0 + 1);
    if (vWalls[r0 * (BOARD_SIZE - 1) + c0] === 0 && cellPiece[eIdx] === -1) {
      destBuf[1 + step1Count] = eIdx;
      step1Count++;
    }
  }

  if (step1Count === 0) {
    return 0;
  }

  const stamp = nextMoveStamp(scratch);
  const moveStamp = scratch.moveStamp;
  const originIdx = r0 * BOARD_SIZE + c0;
  destBuf[0] = originIdx;
  moveStamp[originIdx] = stamp;

  for (let i = 1; i <= step1Count; i++) {
    moveStamp[destBuf[i]] = stamp;
  }

  let count = 1 + step1Count;

  for (let i = 1; i <= step1Count; i++) {
    const cell = destBuf[i];
    const r1 = (cell / BOARD_SIZE) | 0;
    const c1 = cell - r1 * BOARD_SIZE;

    // North from step1
    if (r1 > 0) {
      const nIdx = cell - BOARD_SIZE;
      if (moveStamp[nIdx] !== stamp && hWalls[nIdx] === 0 && cellPiece[nIdx] === -1) {
        moveStamp[nIdx] = stamp;
        destBuf[count++] = nIdx;
      }
    }
    // South from step1
    if (r1 < BOARD_SIZE - 1) {
      const sIdx = cell + BOARD_SIZE;
      if (moveStamp[sIdx] !== stamp && hWalls[cell] === 0 && cellPiece[sIdx] === -1) {
        moveStamp[sIdx] = stamp;
        destBuf[count++] = sIdx;
      }
    }
    // West from step1
    if (c1 > 0) {
      const wIdx = cell - 1;
      if (
        moveStamp[wIdx] !== stamp &&
        vWalls[r1 * (BOARD_SIZE - 1) + (c1 - 1)] === 0 &&
        cellPiece[wIdx] === -1
      ) {
        moveStamp[wIdx] = stamp;
        destBuf[count++] = wIdx;
      }
    }
    // East from step1
    if (c1 < BOARD_SIZE - 1) {
      const eIdx = cell + 1;
      if (
        moveStamp[eIdx] !== stamp &&
        vWalls[r1 * (BOARD_SIZE - 1) + c1] === 0 &&
        cellPiece[eIdx] === -1
      ) {
        moveStamp[eIdx] = stamp;
        destBuf[count++] = eIdx;
      }
    }
  }

  return count;
}

/**
 * Enumerates legal Wall Go II normal destinations into `scratch.destBuf` (max 8).
 * Never includes stay-in-place (E12).
 */
export function genWallGo2NormalDestsFast(
  board: SearchBoard,
  pIdx: number,
  scratch: EvalScratch,
): number {
  const kind = board.pieceKind[pIdx];
  if (kind !== 1 && kind !== 2) {
    return 0;
  }

  const r0 = board.pieceRow[pIdx];
  const c0 = board.pieceCol[pIdx];
  const cellPiece = board.cellPiece;
  const destBuf = scratch.destBuf;
  let count = 0;

  if (kind === 1) {
    // 'square': straight orthogonal 1-2 steps
    for (let d = 0; d < 4; d++) {
      const dr = DR[d];
      const dc = DC[d];
      const r1 = r0 + dr;
      const c1 = c0 + dc;
      if (r1 < 0 || r1 >= BOARD_SIZE || c1 < 0 || c1 >= BOARD_SIZE) {
        continue;
      }
      const idx1 = r1 * BOARD_SIZE + c1;
      if (cellPiece[idx1] !== -1) {
        continue;
      }
      if (getWallByCode(board, wallCodeBetween(r0, c0, r1, c1)) !== 0) {
        continue;
      }
      destBuf[count++] = idx1;

      const r2 = r1 + dr;
      const c2 = c1 + dc;
      if (r2 < 0 || r2 >= BOARD_SIZE || c2 < 0 || c2 >= BOARD_SIZE) {
        continue;
      }
      const idx2 = r2 * BOARD_SIZE + c2;
      if (cellPiece[idx2] !== -1) {
        continue;
      }
      if (getWallByCode(board, wallCodeBetween(r1, c1, r2, c2)) !== 0) {
        continue;
      }
      destBuf[count++] = idx2;
    }
    return count;
  }

  // 'round': orthogonal 1 step or 1 step + 90-degree turn + 1 step
  const stamp = nextMoveStamp(scratch);
  const moveStamp = scratch.moveStamp;

  for (let d = 0; d < 4; d++) {
    const dr1 = DR[d];
    const dc1 = DC[d];
    const r1 = r0 + dr1;
    const c1 = c0 + dc1;
    if (r1 < 0 || r1 >= BOARD_SIZE || c1 < 0 || c1 >= BOARD_SIZE) {
      continue;
    }
    const idx1 = r1 * BOARD_SIZE + c1;
    if (cellPiece[idx1] !== -1) {
      continue;
    }
    if (getWallByCode(board, wallCodeBetween(r0, c0, r1, c1)) !== 0) {
      continue;
    }
    if (moveStamp[idx1] !== stamp) {
      moveStamp[idx1] = stamp;
      destBuf[count++] = idx1;
    }

    // Two 90-degree perpendicular turns: (dc1, dr1) and (-dc1, -dr1)
    for (let t = 0; t < 2; t++) {
      const dr2 = t === 0 ? dc1 : -dc1;
      const dc2 = t === 0 ? dr1 : -dr1;
      const r2 = r1 + dr2;
      const c2 = c1 + dc2;
      if (r2 < 0 || r2 >= BOARD_SIZE || c2 < 0 || c2 >= BOARD_SIZE) {
        continue;
      }
      const idx2 = r2 * BOARD_SIZE + c2;
      if (cellPiece[idx2] !== -1) {
        continue;
      }
      if (getWallByCode(board, wallCodeBetween(r1, c1, r2, c2)) !== 0) {
        continue;
      }
      if (moveStamp[idx2] !== stamp) {
        moveStamp[idx2] = stamp;
        destBuf[count++] = idx2;
      }
    }
  }

  return count;
}

/**
 * Enumerates open adjacent internal wall codes (0..83) around `(r, c)` into `outBuf` (max 4).
 */
export function genOpenAdjacentWallsFast(
  board: SearchBoard,
  r: number,
  c: number,
  outBuf: Uint8Array,
): number {
  let count = 0;
  if (r > 0) {
    const code = (r - 1) * BOARD_SIZE + c;
    if (board.hWalls[code] === 0) {
      outBuf[count++] = code;
    }
  }
  if (r < BOARD_SIZE - 1) {
    const code = r * BOARD_SIZE + c;
    if (board.hWalls[code] === 0) {
      outBuf[count++] = code;
    }
  }
  if (c > 0) {
    const vIdx = r * (BOARD_SIZE - 1) + (c - 1);
    if (board.vWalls[vIdx] === 0) {
      outBuf[count++] = NUM_H_WALLS + vIdx;
    }
  }
  if (c < BOARD_SIZE - 1) {
    const vIdx = r * (BOARD_SIZE - 1) + c;
    if (board.vWalls[vIdx] === 0) {
      outBuf[count++] = NUM_H_WALLS + vIdx;
    }
  }
  return count;
}

/**
 * Exact O(1) parity with `src/engine/moves.ts:pieceHasAnyLegalAction` for both
 * Wall Go I and Wall Go II (including E08 soft-lock and E21 wall-break rescue).
 */
export function pieceHasAnyLegalActionFast(board: SearchBoard, pIdx: number): boolean {
  if (board.ruleVariant === 1) {
    const kind = board.pieceKind[pIdx];
    if (kind !== 1 && kind !== 2) {
      return false;
    }
  }

  const r = board.pieceRow[pIdx];
  const c = board.pieceCol[pIdx];
  const cellPiece = board.cellPiece;
  const hWalls = board.hWalls;
  const vWalls = board.vWalls;

  // Step 1: check for any un-walled empty cardinal neighbor (normal move)
  let hasBreakableEmptyNeighbor = false;

  if (r > 0) {
    const nIdx = (r - 1) * BOARD_SIZE + c;
    if (cellPiece[nIdx] === -1) {
      if (hWalls[nIdx] === 0) {
        return true;
      }
      hasBreakableEmptyNeighbor = true;
    }
  }
  if (r < BOARD_SIZE - 1) {
    const sIdx = (r + 1) * BOARD_SIZE + c;
    if (cellPiece[sIdx] === -1) {
      if (hWalls[r * BOARD_SIZE + c] === 0) {
        return true;
      }
      hasBreakableEmptyNeighbor = true;
    }
  }
  if (c > 0) {
    const wIdx = r * BOARD_SIZE + (c - 1);
    if (cellPiece[wIdx] === -1) {
      if (vWalls[r * (BOARD_SIZE - 1) + (c - 1)] === 0) {
        return true;
      }
      hasBreakableEmptyNeighbor = true;
    }
  }
  if (c < BOARD_SIZE - 1) {
    const eIdx = r * BOARD_SIZE + (c + 1);
    if (cellPiece[eIdx] === -1) {
      if (vWalls[r * (BOARD_SIZE - 1) + c] === 0) {
        return true;
      }
      hasBreakableEmptyNeighbor = true;
    }
  }

  if (
    hasBreakableEmptyNeighbor &&
    board.is3P &&
    board.wallBreaksRemaining[board.pieceOwner[pIdx]] > 0
  ) {
    return true;
  }

  return false;
}

/**
 * O(49) wall-only connected components BFS + exact terminal/deadlock check (F15, F16, E17-E21).
 * Populates `scratch.compId`, `scratch.compSize`, `scratch.compOwnerMask`,
 * `scratch.securedTotal`, `scratch.largestSingle`, and `scratch.deadlockPieces`.
 * Returns `true` iff the board is terminal (`all_separated` or `deadlock`).
 */
export function analyzeComponentsFast(
  board: SearchBoard,
  scratch: EvalScratch,
  allowTerminal = true,
): boolean {
  const compId = scratch.compId;
  const bfsQueue = scratch.bfsQueue;
  const compSize = scratch.compSize;
  const compOwnerMask = scratch.compOwnerMask;
  const securedTotal = scratch.securedTotal;
  const largestSingle = scratch.largestSingle;
  const deadlockPieces = scratch.deadlockPieces;
  const hWalls = board.hWalls;
  const vWalls = board.vWalls;
  const cellPiece = board.cellPiece;
  const pieceOwner = board.pieceOwner;

  compId.fill(-1);
  securedTotal[0] = 0;
  securedTotal[1] = 0;
  securedTotal[2] = 0;
  largestSingle[0] = 0;
  largestSingle[1] = 0;
  largestSingle[2] = 0;
  deadlockPieces[0] = 0;
  deadlockPieces[1] = 0;
  deadlockPieces[2] = 0;

  let compCount = 0;

  for (let start = 0; start < NUM_CELLS; start++) {
    if (compId[start] !== -1) {
      continue;
    }
    const cid = compCount++;
    compId[start] = cid;
    bfsQueue[0] = start;
    let head = 0;
    let tail = 1;
    let ownerMask = 0;

    while (head < tail) {
      const cur = bfsQueue[head++];
      const pIdx = cellPiece[cur];
      if (pIdx !== -1) {
        ownerMask |= 1 << pieceOwner[pIdx];
      }

      const r = (cur / BOARD_SIZE) | 0;
      const c = cur - r * BOARD_SIZE;

      if (r > 0) {
        const next = cur - BOARD_SIZE;
        if (compId[next] === -1 && hWalls[next] === 0) {
          compId[next] = cid;
          bfsQueue[tail++] = next;
        }
      }
      if (r < BOARD_SIZE - 1) {
        const next = cur + BOARD_SIZE;
        if (compId[next] === -1 && hWalls[cur] === 0) {
          compId[next] = cid;
          bfsQueue[tail++] = next;
        }
      }
      if (c > 0) {
        const next = cur - 1;
        if (compId[next] === -1 && vWalls[r * (BOARD_SIZE - 1) + (c - 1)] === 0) {
          compId[next] = cid;
          bfsQueue[tail++] = next;
        }
      }
      if (c < BOARD_SIZE - 1) {
        const next = cur + 1;
        if (compId[next] === -1 && vWalls[r * (BOARD_SIZE - 1) + c] === 0) {
          compId[next] = cid;
          bfsQueue[tail++] = next;
        }
      }
    }

    compSize[cid] = tail;
    compOwnerMask[cid] = ownerMask;

    if (ownerMask !== 0 && (ownerMask & (ownerMask - 1)) === 0) {
      const owner = ownerMask === 1 ? 0 : ownerMask === 2 ? 1 : 2;
      securedTotal[owner] += tail;
      if (tail > largestSingle[owner]) {
        largestSingle[owner] = tail;
      }
    }
  }

  if (!allowTerminal) {
    return false;
  }

  // Exact F16 / E19 / E20 / E21 terminal check
  let hasContested = false;
  let contestedCanMove = false;
  const pieceCount = board.pieceCount;

  for (let i = 0; i < pieceCount; i++) {
    const cell = board.pieceRow[i] * BOARD_SIZE + board.pieceCol[i];
    const mask = compOwnerMask[compId[cell]];
    if (mask !== 0 && (mask & (mask - 1)) !== 0) {
      hasContested = true;
      if (pieceHasAnyLegalActionFast(board, i)) {
        contestedCanMove = true;
        break;
      }
    }
  }

  const isTerminal = !hasContested || !contestedCanMove;
  if (isTerminal && hasContested) {
    // E20 deadlock: +1 pt per piece inside any deadlocked contested component
    for (let i = 0; i < pieceCount; i++) {
      const cell = board.pieceRow[i] * BOARD_SIZE + board.pieceCol[i];
      const mask = compOwnerMask[compId[cell]];
      if (mask !== 0 && (mask & (mask - 1)) !== 0) {
        deadlockPieces[pieceOwner[i]] += 1;
      }
    }
  }

  return isTerminal;
}

/**
 * Exact parity with `src/engine/territory.ts:shouldAutoSkipPlayer` (F17, E22, E23).
 * Assumes `analyzeComponentsFast` has already populated `scratch.compId` & `scratch.compOwnerMask`.
 */
export function shouldAutoSkipPlayerFast(
  board: SearchBoard,
  scratch: EvalScratch,
  playerIdx: number,
): boolean {
  const pieceCount = board.pieceCount;
  const pieceOwner = board.pieceOwner;
  const compId = scratch.compId;
  const compOwnerMask = scratch.compOwnerMask;
  const targetMask = 1 << playerIdx;

  let anyPiece = false;
  let anyLegal = false;
  let allSecured = true;

  for (let i = 0; i < pieceCount; i++) {
    if (pieceOwner[i] !== playerIdx) {
      continue;
    }
    anyPiece = true;
    if (!anyLegal && pieceHasAnyLegalActionFast(board, i)) {
      anyLegal = true;
    }
    const cell = board.pieceRow[i] * BOARD_SIZE + board.pieceCol[i];
    if (compOwnerMask[compId[cell]] !== targetMask) {
      allSecured = false;
    }
  }

  if (!anyPiece || !anyLegal) {
    return true;
  }
  if (board.is3P && board.wallBreaksRemaining[playerIdx] > 0) {
    return false;
  }
  return allSecured;
}

function computeVoronoiFast(board: SearchBoard, scratch: EvalScratch): void {
  const vorDist = scratch.vorDist;
  const vorOwner = scratch.vorOwner;
  const vorQueue = scratch.vorQueue;
  const vorCount = scratch.vorCount;
  const hWalls = board.hWalls;
  const vWalls = board.vWalls;

  vorDist.fill(255);
  vorOwner.fill(-1);
  vorCount[0] = 0;
  vorCount[1] = 0;
  vorCount[2] = 0;

  let head = 0;
  let tail = 0;
  const pieceCount = board.pieceCount;

  for (let i = 0; i < pieceCount; i++) {
    const cell = board.pieceRow[i] * BOARD_SIZE + board.pieceCol[i];
    vorDist[cell] = 0;
    vorOwner[cell] = board.pieceOwner[i];
    vorQueue[tail++] = cell;
  }

  while (head < tail) {
    const cur = vorQueue[head++];
    const curDist = vorDist[cur];
    const curOwner = vorOwner[cur];
    const nextDist = curDist + 1;
    const r = (cur / BOARD_SIZE) | 0;
    const c = cur - r * BOARD_SIZE;

    // North
    if (r > 0) {
      const next = cur - BOARD_SIZE;
      if (hWalls[next] === 0) {
        const prevDist = vorDist[next];
        if (prevDist === 255) {
          vorDist[next] = nextDist;
          vorOwner[next] = curOwner;
          vorQueue[tail++] = next;
        } else if (prevDist === nextDist && vorOwner[next] !== curOwner) {
          vorOwner[next] = -2;
        }
      }
    }
    // South
    if (r < BOARD_SIZE - 1) {
      const next = cur + BOARD_SIZE;
      if (hWalls[cur] === 0) {
        const prevDist = vorDist[next];
        if (prevDist === 255) {
          vorDist[next] = nextDist;
          vorOwner[next] = curOwner;
          vorQueue[tail++] = next;
        } else if (prevDist === nextDist && vorOwner[next] !== curOwner) {
          vorOwner[next] = -2;
        }
      }
    }
    // West
    if (c > 0) {
      const next = cur - 1;
      if (vWalls[r * (BOARD_SIZE - 1) + (c - 1)] === 0) {
        const prevDist = vorDist[next];
        if (prevDist === 255) {
          vorDist[next] = nextDist;
          vorOwner[next] = curOwner;
          vorQueue[tail++] = next;
        } else if (prevDist === nextDist && vorOwner[next] !== curOwner) {
          vorOwner[next] = -2;
        }
      }
    }
    // East
    if (c < BOARD_SIZE - 1) {
      const next = cur + 1;
      if (vWalls[r * (BOARD_SIZE - 1) + c] === 0) {
        const prevDist = vorDist[next];
        if (prevDist === 255) {
          vorDist[next] = nextDist;
          vorOwner[next] = curOwner;
          vorQueue[tail++] = next;
        } else if (prevDist === nextDist && vorOwner[next] !== curOwner) {
          vorOwner[next] = -2;
        }
      }
    }
  }

  // Count exclusive Voronoi cells strictly inside contested components
  const compId = scratch.compId;
  const compOwnerMask = scratch.compOwnerMask;
  for (let idx = 0; idx < NUM_CELLS; idx++) {
    const o = vorOwner[idx];
    if (o >= 0) {
      const mask = compOwnerMask[compId[idx]];
      if (mask !== 0 && (mask & (mask - 1)) !== 0) {
        vorCount[o] += 1;
      }
    }
  }
}

function fillTerminalScores(board: SearchBoard, scratch: EvalScratch): void {
  const playerCount = board.playerCount;
  const total = scratch.finalTotal;
  const largest = scratch.finalLargest;
  const finalScores = scratch.finalScores;

  for (let p = 0; p < playerCount; p++) {
    const dl = scratch.deadlockPieces[p];
    total[p] = scratch.securedTotal[p] + dl;
    const ls = scratch.largestSingle[p];
    largest[p] = dl > 0 && ls < 1 ? 1 : ls;
  }

  if (playerCount === 2) {
    for (let me = 0; me < 2; me++) {
      const opp = 1 - me;
      const dt = total[me] - total[opp];
      const dl = largest[me] - largest[opp];
      if (dt > 0 || (dt === 0 && dl > 0)) {
        finalScores[me] = 10000 + dt * 20 + dl * 2;
      } else if (dt === 0 && dl === 0) {
        finalScores[me] = 0;
      } else {
        finalScores[me] = -10000 + dt * 20 + dl * 2;
      }
    }
    return;
  }

  // 3P competition ranking & Prison Match Round 2 margin calibration
  for (let me = 0; me < playerCount; me++) {
    let betterCount = 0;
    let tiedCount = 0;
    let bestOppTotal = -1;
    let bestOppLargest = -1;
    let worstOppTotal = 999;

    for (let other = 0; other < playerCount; other++) {
      if (other === me) {
        continue;
      }
      const ot = total[other];
      const ol = largest[other];
      if (ot > total[me] || (ot === total[me] && ol > largest[me])) {
        betterCount++;
      } else if (ot === total[me] && ol === largest[me]) {
        tiedCount++;
      }
      if (ot > bestOppTotal || (ot === bestOppTotal && ol > bestOppLargest)) {
        bestOppTotal = ot;
        bestOppLargest = ol;
      }
      if (ot < worstOppTotal) {
        worstOppTotal = ot;
      }
    }

    const myRank = 1 + betterCount;
    if (myRank === 1 && tiedCount === 0) {
      finalScores[me] =
        10000 + (total[me] - bestOppTotal) * 20 + (largest[me] - bestOppLargest) * 2;
    } else if (myRank === 1) {
      finalScores[me] = 3000 + total[me] * 10 + largest[me];
    } else if (myRank === 2 && tiedCount === 0) {
      finalScores[me] =
        -2000 +
        (total[me] - bestOppTotal) * 20 +
        (total[me] - worstOppTotal) * 10 +
        (largest[me] - bestOppLargest);
    } else if (myRank === 2) {
      finalScores[me] = -4000 + (total[me] - bestOppTotal) * 20 + total[me] * 5;
    } else {
      finalScores[me] =
        -10000 + (total[me] - bestOppTotal) * 20 + (largest[me] - bestOppLargest) * 2;
    }
  }
}

/**
 * Evaluates `board` in a single zero-allocation pass, populating `scratch.finalScores[0..playerCount-1]`.
 * Returns `true` iff the position is terminal.
 */
export function evaluateSearchBoardAll(
  board: SearchBoard,
  scratch: EvalScratch,
  allowTerminal = true,
): boolean {
  const isTerminal = analyzeComponentsFast(board, scratch, allowTerminal);
  if (isTerminal) {
    fillTerminalScores(board, scratch);
    return true;
  }

  computeVoronoiFast(board, scratch);

  const mobScores = scratch.mobScores;
  const trapPenalties = scratch.trapPenalties;
  const trappedOppCount = scratch.trappedOppCount;
  const rawScores = scratch.rawScores;
  const finalScores = scratch.finalScores;

  mobScores[0] = 0;
  mobScores[1] = 0;
  mobScores[2] = 0;
  trapPenalties[0] = 0;
  trapPenalties[1] = 0;
  trapPenalties[2] = 0;
  trappedOppCount[0] = 0;
  trappedOppCount[1] = 0;
  trappedOppCount[2] = 0;

  const compId = scratch.compId;
  const compOwnerMask = scratch.compOwnerMask;
  const hWalls = board.hWalls;
  const vWalls = board.vWalls;
  const cellPiece = board.cellPiece;
  const mobWeight = board.ruleVariant === 0 ? W_MOBILITY_WG1 : W_MOBILITY_WG2;
  const pieceCount = board.pieceCount;

  for (let i = 0; i < pieceCount; i++) {
    const r = board.pieceRow[i];
    const c = board.pieceCol[i];
    const cell = r * BOARD_SIZE + c;
    const mask = compOwnerMask[compId[cell]];

    // Only evaluate mobility & trap penalties for pieces inside contested components
    if (mask === 0 || (mask & (mask - 1)) === 0) {
      continue;
    }

    const owner = board.pieceOwner[i];
    const mob =
      board.ruleVariant === 0
        ? genWallGo1DestsFast(board, r, c, scratch)
        : genWallGo2NormalDestsFast(board, i, scratch);
    mobScores[owner] += mob * mobWeight;

    let wallBlocked = 0;
    let hardBlocked = 0;

    // North
    if (r === 0) {
      wallBlocked++;
      hardBlocked++;
    } else if (hWalls[cell - BOARD_SIZE] !== 0) {
      wallBlocked++;
      hardBlocked++;
    } else if (cellPiece[cell - BOARD_SIZE] !== -1) {
      hardBlocked++;
    }

    // South
    if (r === BOARD_SIZE - 1) {
      wallBlocked++;
      hardBlocked++;
    } else if (hWalls[cell] !== 0) {
      wallBlocked++;
      hardBlocked++;
    } else if (cellPiece[cell + BOARD_SIZE] !== -1) {
      hardBlocked++;
    }

    // West
    if (c === 0) {
      wallBlocked++;
      hardBlocked++;
    } else if (vWalls[r * (BOARD_SIZE - 1) + (c - 1)] !== 0) {
      wallBlocked++;
      hardBlocked++;
    } else if (cellPiece[cell - 1] !== -1) {
      hardBlocked++;
    }

    // East
    if (c === BOARD_SIZE - 1) {
      wallBlocked++;
      hardBlocked++;
    } else if (vWalls[r * (BOARD_SIZE - 1) + c] !== 0) {
      wallBlocked++;
      hardBlocked++;
    } else if (cellPiece[cell + 1] !== -1) {
      hardBlocked++;
    }

    if (hardBlocked === 4) {
      trapPenalties[owner] += board.wallBreaksRemaining[owner] > 0 ? 9.0 : 18.0;
    } else if (wallBlocked >= 3) {
      trapPenalties[owner] += 11.0;
    } else if (hardBlocked === 3) {
      trapPenalties[owner] += 6.5;
    } else if (mob <= 2) {
      trapPenalties[owner] += 3.0;
    }

    if (hardBlocked >= 3) {
      trappedOppCount[owner] += 1;
    }
  }

  const playerCount = board.playerCount;
  for (let p = 0; p < playerCount; p++) {
    rawScores[p] =
      scratch.securedTotal[p] * W_SECURED_CELL +
      scratch.largestSingle[p] * W_LARGEST_SINGLE +
      scratch.vorCount[p] * W_VORONOI_CELL +
      mobScores[p] -
      trapPenalties[p] +
      board.wallBreaksRemaining[p] * W_WALL_BREAK_RESERVE;
  }

  if (playerCount === 2) {
    finalScores[0] = rawScores[0] - rawScores[1] + trappedOppCount[1] * W_CONTAIN_2P;
    finalScores[1] = rawScores[1] - rawScores[0] + trappedOppCount[0] * W_CONTAIN_2P;
  } else {
    for (let p = 0; p < playerCount; p++) {
      const opp1 = p === 0 ? 1 : 0;
      const opp2 = p === 2 ? 1 : 2;
      const r1 = rawScores[opp1];
      const r2 = rawScores[opp2];
      const maxOpp = r1 >= r2 ? r1 : r2;
      const minOpp = r1 >= r2 ? r2 : r1;
      const containBonus = (trappedOppCount[opp1] + trappedOppCount[opp2]) * W_CONTAIN_3P;
      finalScores[p] = rawScores[p] - (0.65 * maxOpp + 0.35 * minOpp) + containBonus;
    }
  }

  return false;
}

export function evaluateSearchBoard(
  board: SearchBoard,
  perspectiveIdx: number,
  scratch: EvalScratch,
  allowTerminal = true,
): SearchEvalResult {
  const isTerminal = evaluateSearchBoardAll(board, scratch, allowTerminal);
  return {
    score: scratch.finalScores[perspectiveIdx],
    isTerminal,
  };
}

/**
 * Public position evaluator (F22). Never mutates `state`.
 */
export function evaluatePosition(state: GameState, playerId: number): number {
  const playerIdx = findPlayerIndex(state, playerId);
  if (playerIdx < 0) {
    throw new Error(`evaluatePosition: invalid playerId ${playerId}`);
  }
  const board = createSearchBoard(state);
  const scratch = createEvalScratch();
  const allowTerminal = state.phase !== 'placement';
  return evaluateSearchBoard(board, playerIdx, scratch, allowTerminal).score;
}

/**
 * Opening placement cell heuristic (F21):
 * Combines strategic board hub weights (C3, E3, C5, E5, D4), own-piece spread
 * (optimal Manhattan distance 3..5), and opponent containment proximity (distance 2..3).
 */
export function evaluateOpeningPlacementCell(
  state: GameState,
  playerId: number,
  row: number,
  col: number,
): number {
  let score = OPENING_CELL_WEIGHTS[row * BOARD_SIZE + col];
  const pieces = state.pieces;

  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const d = Math.abs(row - p.row) + Math.abs(col - p.col);
    if (p.ownerId === playerId) {
      if (d === 1) {
        score -= 4.5;
      } else if (d === 2) {
        score -= 1.5;
      } else if (d === 3 || d === 4) {
        score += 3.2;
      } else if (d === 5) {
        score += 2.5;
      } else {
        score += 0.8;
      }
    } else {
      if (d === 1) {
        score -= 1.0;
      } else if (d === 2) {
        score += 2.2;
      } else if (d === 3) {
        score += 1.6;
      } else if (d === 4) {
        score += 0.5;
      }
    }
  }

  return score;
}
