import { BOARD_SIZE } from './types.js';
import type {
  BoardComponentResult,
  CellPos,
  ComponentKind,
  GameEndResult,
  GameState,
  Piece,
  PlacedWall,
  PlayerScoreSummary,
  PlayerState,
  TerritoryAnalysis,
  TerritoryComponent,
  WallKey,
} from './types.js';
import {
  CARDINAL_DIRS,
  compareCellPos,
  getEdgeBetweenCells,
  hasAnyLegalAction,
  hasWall,
  isInBounds,
  pieceHasAnyLegalAction,
} from './moves.js';

export function analyzeBoardComponents(
  walls: Readonly<Record<WallKey, PlacedWall>>,
  pieces: readonly Piece[],
): BoardComponentResult {
  const piecesByCell: Piece[][] = Array.from(
    { length: BOARD_SIZE * BOARD_SIZE },
    () => [],
  );
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (isInBounds(piece.row, piece.col)) {
      piecesByCell[piece.row * BOARD_SIZE + piece.col].push(piece);
    }
  }

  const cellToComponentId: number[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => -1),
  );
  const components: TerritoryComponent[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (cellToComponentId[r][c] !== -1) {
        continue;
      }
      const compId = components.length;
      const queue: CellPos[] = [{ row: r, col: c }];
      cellToComponentId[r][c] = compId;

      for (let head = 0; head < queue.length; head++) {
        const cur = queue[head];
        for (let d = 0; d < CARDINAL_DIRS.length; d++) {
          const { dr, dc } = CARDINAL_DIRS[d];
          const nr = cur.row + dr;
          const nc = cur.col + dc;
          if (!isInBounds(nr, nc) || cellToComponentId[nr][nc] !== -1) {
            continue;
          }
          const edge = getEdgeBetweenCells(cur, { row: nr, col: nc });
          if (edge === null || hasWall(walls, edge)) {
            continue;
          }
          // Pieces never split connected components (F15 / E18).
          cellToComponentId[nr][nc] = compId;
          queue.push({ row: nr, col: nc });
        }
      }

      queue.sort(compareCellPos);
      const anchorCell: CellPos = { row: queue[0].row, col: queue[0].col };

      const pieceIds: string[] = [];
      const ownerSet = new Set<number>();
      for (let i = 0; i < queue.length; i++) {
        const cell = queue[i];
        const cellPieces = piecesByCell[cell.row * BOARD_SIZE + cell.col];
        for (let j = 0; j < cellPieces.length; j++) {
          pieceIds.push(cellPieces[j].id);
          ownerSet.add(cellPieces[j].ownerId);
        }
      }

      const ownerIds = Array.from(ownerSet).sort((a, b) => a - b);
      let kind: ComponentKind;
      let ownerId: number | null;
      if (ownerIds.length === 0) {
        kind = 'neutral';
        ownerId = null;
      } else if (ownerIds.length === 1) {
        kind = 'secured';
        ownerId = ownerIds[0];
      } else {
        kind = 'contested';
        ownerId = null;
      }

      components.push({
        id: compId,
        cells: queue,
        anchorCell,
        pieceIds,
        ownerIds,
        kind,
        ownerId,
        size: queue.length,
      });
    }
  }

  return { components, cellToComponentId };
}

function checkGameEndWithComponents(
  state: GameState,
  components: readonly TerritoryComponent[],
): GameEndResult {
  if (
    state.phase === 'placement' ||
    state.phase === 'move_piece' ||
    state.phase === 'place_wall' ||
    state.pieces.length === 0
  ) {
    return { isGameOver: false, endReason: null };
  }

  let hasDeadlockedContested = false;

  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    if (comp.ownerIds.length <= 1) {
      // Single-owner or empty component is resolved even if unused wall breaks remain (E19).
      continue;
    }

    let hasAnyMovablePiece = false;
    for (let j = 0; j < comp.pieceIds.length; j++) {
      if (pieceHasAnyLegalAction(state, comp.pieceIds[j])) {
        hasAnyMovablePiece = true;
        break;
      }
    }

    if (hasAnyMovablePiece) {
      return { isGameOver: false, endReason: null };
    }
    hasDeadlockedContested = true;
  }

  return {
    isGameOver: true,
    endReason: hasDeadlockedContested ? 'deadlock' : 'all_separated',
  };
}

export function checkGameEnd(state: GameState): GameEndResult {
  const { components } = analyzeBoardComponents(state.walls, state.pieces);
  return checkGameEndWithComponents(state, components);
}

export function shouldAutoSkipPlayer(state: GameState, playerId: number): boolean {
  const player = state.players.find((pl) => pl.id === playerId);
  if (!player) {
    return true;
  }

  if (!hasAnyLegalAction(state, playerId)) {
    return true;
  }

  // Players holding a wall break with >= 1 legal action are NEVER auto-skipped (E22).
  if (player.wallBreaksRemaining > 0) {
    return false;
  }

  const { components, cellToComponentId } = analyzeBoardComponents(
    state.walls,
    state.pieces,
  );
  const playerPieces = state.pieces.filter((p) => p.ownerId === playerId);
  if (playerPieces.length === 0) {
    return true;
  }

  for (let i = 0; i < playerPieces.length; i++) {
    const p = playerPieces[i];
    if (!isInBounds(p.row, p.col)) {
      return false;
    }
    const compId = cellToComponentId[p.row][p.col];
    const comp = components[compId];
    if (!comp || comp.kind !== 'secured' || comp.ownerId !== playerId) {
      return false;
    }
  }

  return true;
}

export function computeRankings(
  components: readonly TerritoryComponent[],
  pieces: readonly Piece[],
  players: readonly PlayerState[],
  isGameOver: boolean,
): PlayerScoreSummary[] {
  const securedRegionsByPlayer = new Map<number, number[]>();
  const deadlockCountByPlayer = new Map<number, number>();

  for (let i = 0; i < players.length; i++) {
    const id = players[i].id;
    securedRegionsByPlayer.set(id, []);
    deadlockCountByPlayer.set(id, 0);
  }

  const pieceById = new Map<string, Piece>();
  for (let i = 0; i < pieces.length; i++) {
    pieceById.set(pieces[i].id, pieces[i]);
  }

  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    if (comp.kind === 'secured' && comp.ownerId !== null) {
      const list = securedRegionsByPlayer.get(comp.ownerId);
      if (list) {
        list.push(comp.size);
      }
    } else if (comp.kind === 'contested' && isGameOver) {
      for (let j = 0; j < comp.pieceIds.length; j++) {
        const piece = pieceById.get(comp.pieceIds[j]);
        if (piece !== undefined) {
          const prev = deadlockCountByPlayer.get(piece.ownerId);
          if (prev !== undefined) {
            deadlockCountByPlayer.set(piece.ownerId, prev + 1);
          }
        }
      }
    }
  }

  const summaries: PlayerScoreSummary[] = [];
  for (let i = 0; i < players.length; i++) {
    const playerId = players[i].id;
    const rawRegions = securedRegionsByPlayer.get(playerId) ?? [];
    const securedRegions = rawRegions.slice().sort((a, b) => b - a);
    let securedSum = 0;
    for (let j = 0; j < securedRegions.length; j++) {
      securedSum += securedRegions[j];
    }
    const deadlockPieceCount = isGameOver
      ? (deadlockCountByPlayer.get(playerId) ?? 0)
      : 0;
    const totalTerritory = securedSum + deadlockPieceCount;
    const maxSecured = securedRegions.length > 0 ? securedRegions[0] : 0;
    const largestSingleTerritory =
      deadlockPieceCount > 0 ? Math.max(maxSecured, 1) : maxSecured;

    summaries.push({
      playerId,
      totalTerritory,
      largestSingleTerritory,
      securedRegions,
      deadlockPieceCount,
      rank: 1,
    });
  }

  summaries.sort(
    (a, b) =>
      b.totalTerritory - a.totalTerritory ||
      b.largestSingleTerritory - a.largestSingleTerritory ||
      a.playerId - b.playerId,
  );

  for (let i = 0; i < summaries.length; i++) {
    if (i === 0) {
      summaries[i].rank = 1;
    } else {
      const prev = summaries[i - 1];
      const cur = summaries[i];
      cur.rank =
        cur.totalTerritory === prev.totalTerritory &&
        cur.largestSingleTerritory === prev.largestSingleTerritory
          ? prev.rank
          : i + 1;
    }
  }

  return summaries;
}

export function analyzeTerritory(state: GameState): TerritoryAnalysis {
  const { components, cellToComponentId } = analyzeBoardComponents(
    state.walls,
    state.pieces,
  );
  const { isGameOver, endReason } = checkGameEndWithComponents(state, components);
  const ranked = computeRankings(components, state.pieces, state.players, isGameOver);
  const byId = new Map<number, PlayerScoreSummary>();
  for (let i = 0; i < ranked.length; i++) {
    byId.set(ranked[i].playerId, ranked[i]);
  }
  const scores: PlayerScoreSummary[] = [];
  for (let i = 0; i < state.players.length; i++) {
    const summary = byId.get(state.players[i].id);
    if (summary !== undefined) {
      scores.push(summary);
    }
  }

  return {
    components,
    cellToComponentId,
    scores,
    isGameOver,
    endReason,
  };
}
