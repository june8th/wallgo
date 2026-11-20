import { BOARD_SIZE, COL_LABELS, ROW_LABELS } from './types';
import type {
  CellPos,
  Direction,
  GameState,
  Piece,
  PlacedWall,
  ValidMoveOption,
  WallEdge,
  WallGo2BreakTarget,
  WallKey,
} from './types';

export const CARDINAL_DIRS: readonly { dir: Direction; dr: number; dc: number }[] = [
  { dir: 'N', dr: -1, dc: 0 },
  { dir: 'S', dr: 1, dc: 0 },
  { dir: 'W', dr: 0, dc: -1 },
  { dir: 'E', dr: 0, dc: 1 },
];

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
}

export function compareCellPos(a: CellPos, b: CellPos): number {
  return a.row - b.row || a.col - b.col;
}

export function compareWallEdge(a: WallEdge, b: WallEdge): number {
  if (a.orientation !== b.orientation) {
    return a.orientation === 'h' ? -1 : 1;
  }
  return a.row - b.row || a.col - b.col;
}

export function isInBounds(row: number, col: number): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < BOARD_SIZE &&
    col >= 0 &&
    col < BOARD_SIZE
  );
}

export function cellToCoordLabel(pos: CellPos): string {
  if (!isInBounds(pos.row, pos.col)) {
    throw new RangeError(`Cell position (${pos.row}, ${pos.col}) is out of bounds`);
  }
  return `${COL_LABELS[pos.col]}${ROW_LABELS[pos.row]}`;
}

export function wallKey(edge: WallEdge): WallKey {
  return `${edge.orientation}:${normalizeZero(edge.row)}:${normalizeZero(edge.col)}`;
}

export function isValidWallEdge(edge: WallEdge): boolean {
  if (!Number.isInteger(edge.row) || !Number.isInteger(edge.col)) {
    return false;
  }
  if (edge.orientation === 'h') {
    return edge.row >= 0 && edge.row <= BOARD_SIZE - 2 && edge.col >= 0 && edge.col <= BOARD_SIZE - 1;
  }
  if (edge.orientation === 'v') {
    return edge.row >= 0 && edge.row <= BOARD_SIZE - 1 && edge.col >= 0 && edge.col <= BOARD_SIZE - 2;
  }
  return false;
}

export function isSameCellPos(a: CellPos, b: CellPos): boolean {
  return a.row === b.row && a.col === b.col;
}

export function isSameWallEdge(a: WallEdge, b: WallEdge): boolean {
  return a.orientation === b.orientation && a.row === b.row && a.col === b.col;
}

export function hasWall(
  walls: Readonly<Record<WallKey, PlacedWall>>,
  edge: WallEdge,
): boolean {
  return Object.prototype.hasOwnProperty.call(walls, wallKey(edge));
}

export function withoutWall(
  walls: Readonly<Record<WallKey, PlacedWall>>,
  removeKey: WallKey,
): Record<WallKey, PlacedWall> {
  const next: Record<WallKey, PlacedWall> = {};
  const keys = Object.keys(walls) as WallKey[];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k !== removeKey && Object.prototype.hasOwnProperty.call(walls, k)) {
      next[k] = walls[k];
    }
  }
  return next;
}

export function getEdgeBetweenCells(a: CellPos, b: CellPos): WallEdge | null {
  if (!isInBounds(a.row, a.col) || !isInBounds(b.row, b.col)) {
    return null;
  }
  const dist = Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
  if (dist !== 1) {
    return null;
  }
  if (a.col === b.col) {
    return {
      orientation: 'h',
      row: normalizeZero(Math.min(a.row, b.row)),
      col: normalizeZero(a.col),
    };
  }
  return {
    orientation: 'v',
    row: normalizeZero(a.row),
    col: normalizeZero(Math.min(a.col, b.col)),
  };
}

export function getAdjacentInternalEdges(pos: CellPos): WallEdge[] {
  if (!isInBounds(pos.row, pos.col)) {
    return [];
  }
  const row = normalizeZero(pos.row);
  const col = normalizeZero(pos.col);
  const edges: WallEdge[] = [];
  if (row > 0) {
    edges.push({ orientation: 'h', row: row - 1, col });
  }
  if (row < BOARD_SIZE - 1) {
    edges.push({ orientation: 'h', row, col });
  }
  if (col > 0) {
    edges.push({ orientation: 'v', row, col: col - 1 });
  }
  if (col < BOARD_SIZE - 1) {
    edges.push({ orientation: 'v', row, col });
  }
  return edges;
}

export function getLegalWallPlacements(state: GameState, pos: CellPos): WallEdge[] {
  return getAdjacentInternalEdges(pos).filter((edge) => !hasWall(state.walls, edge));
}

function isCellOccupied(pieces: readonly Piece[], row: number, col: number): boolean {
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i].row === row && pieces[i].col === col) {
      return true;
    }
  }
  return false;
}

function hasWallBetween(
  walls: Readonly<Record<WallKey, PlacedWall>>,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): boolean {
  const key: WallKey =
    r1 === r2
      ? `v:${r1}:${Math.min(c1, c2)}`
      : `h:${Math.min(r1, r2)}:${c1}`;
  return Object.prototype.hasOwnProperty.call(walls, key);
}

export function getWallGo1Moves(state: GameState, pieceId: string): CellPos[] {
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece || !isInBounds(piece.row, piece.col)) {
    return [];
  }

  const r0 = normalizeZero(piece.row);
  const c0 = normalizeZero(piece.col);
  const step1: CellPos[] = [];

  for (let i = 0; i < CARDINAL_DIRS.length; i++) {
    const { dr, dc } = CARDINAL_DIRS[i];
    const r1 = r0 + dr;
    const c1 = c0 + dc;
    if (!isInBounds(r1, c1)) {
      continue;
    }
    if (hasWallBetween(state.walls, r0, c0, r1, c1)) {
      continue;
    }
    if (isCellOccupied(state.pieces, r1, c1)) {
      continue;
    }
    step1.push({ row: r1, col: c1 });
  }

  // Conditional 0-step stay (F08 / E05): forbidden when |D_1(p)| === 0.
  if (step1.length === 0) {
    return [];
  }

  const visited = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
  visited[r0 * BOARD_SIZE + c0] = 1;
  const result: CellPos[] = [{ row: r0, col: c0 }];

  for (let i = 0; i < step1.length; i++) {
    const cell = step1[i];
    visited[cell.row * BOARD_SIZE + cell.col] = 1;
    result.push(cell);
  }

  for (let i = 0; i < step1.length; i++) {
    const c1Cell = step1[i];
    for (let j = 0; j < CARDINAL_DIRS.length; j++) {
      const { dr, dc } = CARDINAL_DIRS[j];
      const r2 = c1Cell.row + dr;
      const c2 = c1Cell.col + dc;
      if (!isInBounds(r2, c2)) {
        continue;
      }
      const idx = r2 * BOARD_SIZE + c2;
      if (visited[idx] === 1) {
        continue;
      }
      if (hasWallBetween(state.walls, c1Cell.row, c1Cell.col, r2, c2)) {
        continue;
      }
      if (isCellOccupied(state.pieces, r2, c2)) {
        continue;
      }
      visited[idx] = 1;
      result.push({ row: r2, col: c2 });
    }
  }

  result.sort(compareCellPos);
  return result;
}

export function getWallGo1BreakableWallsForBoard(
  state: GameState,
  pieceId: string,
): WallEdge[] {
  if (state.ruleVariant !== 'wallgo1' || state.format !== '3p') {
    return [];
  }
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece || !isInBounds(piece.row, piece.col)) {
    return [];
  }
  const owner = state.players.find((pl) => pl.id === piece.ownerId);
  if (!owner || owner.wallBreaksRemaining <= 0) {
    return [];
  }

  const adjacentEdges = getAdjacentInternalEdges({ row: piece.row, col: piece.col });
  const breakable: WallEdge[] = [];

  for (let i = 0; i < adjacentEdges.length; i++) {
    const edge = adjacentEdges[i];
    if (!hasWall(state.walls, edge)) {
      continue;
    }
    const stateWithoutWall: GameState = {
      ...state,
      walls: withoutWall(state.walls, wallKey(edge)),
    };
    if (getWallGo1Moves(stateWithoutWall, pieceId).length > 0) {
      breakable.push(edge);
    }
  }

  return breakable;
}

export function getWallGo1BreakableWalls(state: GameState, pieceId: string): WallEdge[] {
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) {
    return [];
  }
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (
    state.turnSubState.brokenWallBeforeMove !== null &&
    currentPlayer !== undefined &&
    piece.ownerId === currentPlayer.id
  ) {
    return [];
  }
  return getWallGo1BreakableWallsForBoard(state, pieceId);
}

interface WallGo2Path {
  mid: CellPos | null;
  dest: CellPos;
  edges: WallEdge[];
}

function getWallGo2GeometricPaths(piece: Piece): WallGo2Path[] {
  const r0 = normalizeZero(piece.row);
  const c0 = normalizeZero(piece.col);
  const origin: CellPos = { row: r0, col: c0 };
  const paths: WallGo2Path[] = [];

  if (piece.kind === 'square') {
    for (let i = 0; i < CARDINAL_DIRS.length; i++) {
      const { dr, dc } = CARDINAL_DIRS[i];
      const r1 = r0 + dr;
      const c1 = c0 + dc;
      if (!isInBounds(r1, c1)) {
        continue;
      }
      const step1Cell: CellPos = { row: r1, col: c1 };
      const e1 = getEdgeBetweenCells(origin, step1Cell);
      if (e1 === null) {
        continue;
      }
      paths.push({ mid: null, dest: step1Cell, edges: [e1] });

      const r2 = r0 + 2 * dr;
      const c2 = c0 + 2 * dc;
      if (!isInBounds(r2, c2)) {
        continue;
      }
      const step2Cell: CellPos = { row: r2, col: c2 };
      const e2 = getEdgeBetweenCells(step1Cell, step2Cell);
      if (e2 === null) {
        continue;
      }
      paths.push({ mid: step1Cell, dest: step2Cell, edges: [e1, e2] });
    }
    return paths;
  }

  if (piece.kind === 'round') {
    for (let i = 0; i < CARDINAL_DIRS.length; i++) {
      const { dr: dr1, dc: dc1 } = CARDINAL_DIRS[i];
      const r1 = r0 + dr1;
      const c1 = c0 + dc1;
      if (!isInBounds(r1, c1)) {
        continue;
      }
      const step1Cell: CellPos = { row: r1, col: c1 };
      const e1 = getEdgeBetweenCells(origin, step1Cell);
      if (e1 === null) {
        continue;
      }
      paths.push({ mid: null, dest: step1Cell, edges: [e1] });

      const perpDirs = [
        { dr: dc1, dc: dr1 },
        { dr: -dc1, dc: -dr1 },
      ];
      for (let j = 0; j < perpDirs.length; j++) {
        const r2 = r1 + perpDirs[j].dr;
        const c2 = c1 + perpDirs[j].dc;
        if (!isInBounds(r2, c2)) {
          continue;
        }
        const step2Cell: CellPos = { row: r2, col: c2 };
        const e2 = getEdgeBetweenCells(step1Cell, step2Cell);
        if (e2 === null) {
          continue;
        }
        paths.push({ mid: step1Cell, dest: step2Cell, edges: [e1, e2] });
      }
    }
    return paths;
  }

  return paths;
}

export function getWallGo2NormalMoves(state: GameState, pieceId: string): CellPos[] {
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece || !isInBounds(piece.row, piece.col)) {
    return [];
  }

  const paths = getWallGo2GeometricPaths(piece);
  const destMap = new Map<number, CellPos>();

  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (isCellOccupied(state.pieces, p.dest.row, p.dest.col)) {
      continue;
    }
    if (p.mid !== null && isCellOccupied(state.pieces, p.mid.row, p.mid.col)) {
      continue;
    }
    let blocked = false;
    for (let j = 0; j < p.edges.length; j++) {
      if (hasWall(state.walls, p.edges[j])) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      const idx = p.dest.row * BOARD_SIZE + p.dest.col;
      if (!destMap.has(idx)) {
        destMap.set(idx, p.dest);
      }
    }
  }

  const moves = Array.from(destMap.values());
  moves.sort(compareCellPos);
  return moves;
}

export function getWallGo2BreakTargetsForBoard(
  state: GameState,
  pieceId: string,
): WallGo2BreakTarget[] {
  if (state.ruleVariant !== 'wallgo2' || state.format !== '3p') {
    return [];
  }
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece || !isInBounds(piece.row, piece.col)) {
    return [];
  }
  const owner = state.players.find((pl) => pl.id === piece.ownerId);
  if (!owner || owner.wallBreaksRemaining <= 0) {
    return [];
  }

  const paths = getWallGo2GeometricPaths(piece);
  const targetMap = new Map<
    number,
    { row: number; col: number; wallMap: Map<WallKey, WallEdge> }
  >();

  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (isCellOccupied(state.pieces, p.dest.row, p.dest.col)) {
      continue;
    }
    if (p.mid !== null && isCellOccupied(state.pieces, p.mid.row, p.mid.col)) {
      continue;
    }
    const blockingWalls: WallEdge[] = [];
    for (let j = 0; j < p.edges.length; j++) {
      if (hasWall(state.walls, p.edges[j])) {
        blockingWalls.push(p.edges[j]);
      }
    }
    if (blockingWalls.length !== 1) {
      continue;
    }
    const idx = p.dest.row * BOARD_SIZE + p.dest.col;
    let entry = targetMap.get(idx);
    if (!entry) {
      entry = { row: p.dest.row, col: p.dest.col, wallMap: new Map<WallKey, WallEdge>() };
      targetMap.set(idx, entry);
    }
    const wall = blockingWalls[0];
    entry.wallMap.set(wallKey(wall), wall);
  }

  const targets: WallGo2BreakTarget[] = [];
  targetMap.forEach((entry) => {
    const breakableWalls = Array.from(entry.wallMap.values());
    breakableWalls.sort(compareWallEdge);
    targets.push({
      row: entry.row,
      col: entry.col,
      breakableWalls,
    });
  });

  targets.sort(compareCellPos);
  return targets;
}

export function getWallGo2BreakTargets(
  state: GameState,
  pieceId: string,
): WallGo2BreakTarget[] {
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) {
    return [];
  }
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (
    state.turnSubState.brokenWallBeforeMove !== null &&
    currentPlayer !== undefined &&
    piece.ownerId === currentPlayer.id
  ) {
    return [];
  }
  return getWallGo2BreakTargetsForBoard(state, pieceId);
}

export function pieceHasAnyLegalAction(state: GameState, pieceId: string): boolean {
  if (state.ruleVariant === 'wallgo1') {
    return (
      getWallGo1Moves(state, pieceId).length > 0 ||
      getWallGo1BreakableWallsForBoard(state, pieceId).length > 0
    );
  }
  return (
    getWallGo2NormalMoves(state, pieceId).length > 0 ||
    getWallGo2BreakTargetsForBoard(state, pieceId).length > 0
  );
}

export function hasAnyLegalAction(state: GameState, playerId: number): boolean {
  for (let i = 0; i < state.pieces.length; i++) {
    const piece = state.pieces[i];
    if (piece.ownerId === playerId && pieceHasAnyLegalAction(state, piece.id)) {
      return true;
    }
  }
  return false;
}

export function getSelectablePieceIds(
  state: GameState,
  playerId: number = state.currentPlayerIndex,
): string[] {
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (
    state.turnSubState.brokenWallBeforeMove !== null &&
    state.turnSubState.selectedPieceId !== null &&
    currentPlayer !== undefined &&
    currentPlayer.id === playerId
  ) {
    const locked = state.pieces.find(
      (p) => p.id === state.turnSubState.selectedPieceId && p.ownerId === playerId,
    );
    return locked && pieceHasAnyLegalAction(state, locked.id) ? [locked.id] : [];
  }

  const ids: string[] = [];
  for (let i = 0; i < state.pieces.length; i++) {
    const piece = state.pieces[i];
    if (piece.ownerId === playerId && pieceHasAnyLegalAction(state, piece.id)) {
      ids.push(piece.id);
    }
  }
  return ids;
}

export function getPieceValidMoves(state: GameState, pieceId: string): ValidMoveOption[] {
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) {
    return [];
  }

  const isSelectedContext =
    state.turnSubState.selectedPieceId === null ||
    state.turnSubState.selectedPieceId === pieceId;

  if (state.ruleVariant === 'wallgo1') {
    if (
      state.turnSubState.brokenWallBeforeMove !== null &&
      state.turnSubState.selectedPieceId !== null &&
      state.turnSubState.selectedPieceId !== pieceId
    ) {
      return [];
    }
    if (
      isSelectedContext &&
      state.turnSubState.wallBreakActive &&
      state.turnSubState.brokenWallBeforeMove === null
    ) {
      return [];
    }
    return getWallGo1Moves(state, pieceId).map((cell) => ({
      row: cell.row,
      col: cell.col,
      moveType: cell.row === piece.row && cell.col === piece.col ? 'stay' : 'normal',
    }));
  }

  if (isSelectedContext && state.turnSubState.pendingBreakChoice !== null) {
    return [];
  }
  if (
    isSelectedContext &&
    state.turnSubState.wallBreakActive &&
    state.turnSubState.brokenWallBeforeMove === null
  ) {
    return getWallGo2BreakTargets(state, pieceId).map((target) => ({
      row: target.row,
      col: target.col,
      moveType: 'wall-break',
      breakableWalls: target.breakableWalls,
    }));
  }
  return getWallGo2NormalMoves(state, pieceId).map((cell) => ({
    row: cell.row,
    col: cell.col,
    moveType: 'normal',
  }));
}

export function getPieceBreakableWalls(state: GameState, pieceId: string): WallEdge[] {
  if (state.ruleVariant === 'wallgo1') {
    return getWallGo1BreakableWalls(state, pieceId);
  }
  if (
    state.turnSubState.pendingBreakChoice !== null &&
    (state.turnSubState.selectedPieceId === null ||
      state.turnSubState.selectedPieceId === pieceId)
  ) {
    return state.turnSubState.pendingBreakChoice.breakableWalls.map((w) => ({
      orientation: w.orientation,
      row: normalizeZero(w.row),
      col: normalizeZero(w.col),
    }));
  }
  const wallMap = new Map<WallKey, WallEdge>();
  const targets = getWallGo2BreakTargets(state, pieceId);
  for (let i = 0; i < targets.length; i++) {
    const walls = targets[i].breakableWalls;
    for (let j = 0; j < walls.length; j++) {
      const edge = walls[j];
      wallMap.set(wallKey(edge), edge);
    }
  }
  const uniqueWalls = Array.from(wallMap.values());
  uniqueWalls.sort(compareWallEdge);
  return uniqueWalls;
}
