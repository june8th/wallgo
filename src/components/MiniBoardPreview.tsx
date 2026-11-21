import { useMemo } from 'react';
import {
  BOARD_SIZE,
  analyzeBoardComponents,
  isInBounds,
  isSameWallEdge,
  isValidWallEdge,
  wallKey,
} from '../engine';
import type {
  Piece,
  PlacedWall,
  PlayerColorToken,
  TerritoryComponent,
  WallEdge,
  WallKey,
} from '../engine';
import type { MatchFinalBoardSnapshot, MatchPlayerSummary } from '../shared';

export interface MiniBoardPreviewProps {
  board: MatchFinalBoardSnapshot;
  players: readonly Pick<MatchPlayerSummary, 'playerId' | 'colorToken'>[];
  ariaLabel?: string;
  className?: string;
}

const FRAME_PAD = 5;
const CELL_SIZE = 18;
const GROOVE_SIZE = 3;
const STEP = CELL_SIZE + GROOVE_SIZE; // 21

function isValidMiniWallEdge(value: unknown): value is WallEdge {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const edge = value as Partial<WallEdge>;
  if (
    (edge.orientation !== 'h' && edge.orientation !== 'v') ||
    typeof edge.row !== 'number' ||
    typeof edge.col !== 'number'
  ) {
    return false;
  }
  return isValidWallEdge({
    orientation: edge.orientation,
    row: edge.row,
    col: edge.col,
  });
}

function isValidMiniPlacedWall(value: unknown): value is PlacedWall {
  if (!isValidMiniWallEdge(value)) {
    return false;
  }
  const wall = value as Partial<PlacedWall>;
  return typeof wall.ownerId === 'number' && Number.isInteger(wall.ownerId);
}

function isValidMiniPiece(value: unknown): value is Piece {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const piece = value as Partial<Piece>;
  if (
    typeof piece.id !== 'string' ||
    typeof piece.ownerId !== 'number' ||
    !Number.isInteger(piece.ownerId) ||
    typeof piece.row !== 'number' ||
    typeof piece.col !== 'number'
  ) {
    return false;
  }
  return isInBounds(piece.row, piece.col);
}

/**
 * Pure read-only 7x7 walnut-framed final board thumbnail.
 * Intentionally emits ZERO `data-testid` attributes so it never collides with `<Board />`.
 */
export function MiniBoardPreview({
  board,
  players,
  ariaLabel,
  className,
}: MiniBoardPreviewProps) {
  const colorByPlayerId = useMemo(() => {
    const map = new Map<number, PlayerColorToken>();
    if (Array.isArray(players)) {
      for (const p of players) {
        if (p && typeof p.playerId === 'number') {
          map.set(p.playerId, p.colorToken);
        }
      }
    }
    return map;
  }, [players]);

  const safePieces = useMemo<Piece[]>(() => {
    if (!board || !Array.isArray(board.pieces)) {
      return [];
    }
    return board.pieces.filter(isValidMiniPiece);
  }, [board]);

  const { safeWalls, safeWallsRecord } = useMemo(() => {
    const record: Record<WallKey, PlacedWall> = Object.create(null);
    const list: PlacedWall[] = [];
    if (board && board.walls && typeof board.walls === 'object' && !Array.isArray(board.walls)) {
      for (const wall of Object.values(board.walls)) {
        if (!isValidMiniPlacedWall(wall)) {
          continue;
        }
        const key = wallKey(wall);
        record[key] = wall;
        list.push(wall);
      }
    }
    return { safeWalls: list, safeWallsRecord: record };
  }, [board]);

  const safeLastPlacedWall = useMemo<WallEdge | null>(() => {
    const rawLast = board?.lastPlacedWall;
    if (rawLast != null && isValidMiniWallEdge(rawLast)) {
      return rawLast;
    }
    return null;
  }, [board]);

  const componentAnalysis = useMemo(
    () => analyzeBoardComponents(safeWallsRecord, safePieces),
    [safeWallsRecord, safePieces],
  );

  const componentById = useMemo(() => {
    const map = new Map<number, TerritoryComponent>();
    for (const comp of componentAnalysis.components) {
      map.set(comp.id, comp);
    }
    return map;
  }, [componentAnalysis.components]);

  const cellElements: React.ReactNode[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const x = FRAME_PAD + c * STEP;
      const y = FRAME_PAD + r * STEP;
      const compId = componentAnalysis.cellToComponentId[r]?.[c];
      const comp = compId !== undefined ? componentById.get(compId) : undefined;
      const securedOwner =
        comp && comp.kind === 'secured' && comp.ownerId !== null ? comp.ownerId : null;
      const washToken =
        securedOwner !== null ? (colorByPlayerId.get(securedOwner) ?? 'p1') : null;

      cellElements.push(
        <g key={`c-${r}-${c}`}>
          <rect
            x={x}
            y={y}
            width={CELL_SIZE}
            height={CELL_SIZE}
            rx={2.5}
            fill="var(--surface-tile)"
          />
          {washToken && (
            <rect
              x={x}
              y={y}
              width={CELL_SIZE}
              height={CELL_SIZE}
              rx={2.5}
              fill={`var(--${washToken}-wash)`}
            />
          )}
        </g>,
      );
    }
  }

  return (
    <div className={className ? `mini-board ${className}` : 'mini-board'}>
      <svg
        viewBox="0 0 154 154"
        className="mini-board-svg"
        role={ariaLabel ? 'img' : undefined}
        aria-label={ariaLabel}
        aria-hidden={ariaLabel ? undefined : true}
      >
        <rect x="0" y="0" width="154" height="154" rx="8" fill="var(--wood-mid)" />
        <rect x="4" y="4" width="146" height="146" rx="5" fill="var(--surface-groove)" />

        {cellElements}

        {safeWalls.map((wall) => {
          const token = colorByPlayerId.get(wall.ownerId) ?? 'p1';
          const isLast =
            safeLastPlacedWall !== null && isSameWallEdge(wall, safeLastPlacedWall);
          if (wall.orientation === 'h') {
            const x = FRAME_PAD + wall.col * STEP - 1;
            const y = FRAME_PAD + wall.row * STEP + CELL_SIZE;
            return (
              <rect
                key={`w-h-${wall.row}-${wall.col}`}
                x={x}
                y={y}
                width={CELL_SIZE + 2}
                height={GROOVE_SIZE}
                rx={1.2}
                fill={`var(--${token}-main)`}
                stroke={isLast ? 'var(--brass-accent)' : undefined}
                strokeWidth={isLast ? 1 : undefined}
              />
            );
          }
          const x = FRAME_PAD + wall.col * STEP + CELL_SIZE;
          const y = FRAME_PAD + wall.row * STEP - 1;
          return (
            <rect
              key={`w-v-${wall.row}-${wall.col}`}
              x={x}
              y={y}
              width={GROOVE_SIZE}
              height={CELL_SIZE + 2}
              rx={1.2}
              fill={`var(--${token}-main)`}
              stroke={isLast ? 'var(--brass-accent)' : undefined}
              strokeWidth={isLast ? 1 : undefined}
            />
          );
        })}

        {safePieces.map((piece, idx) => {
          const token = colorByPlayerId.get(piece.ownerId) ?? 'p1';
          const cx = FRAME_PAD + piece.col * STEP + CELL_SIZE / 2;
          const cy = FRAME_PAD + piece.row * STEP + CELL_SIZE / 2;
          const key = piece.id.length > 0 ? piece.id : `p-${idx}`;
          if (piece.kind === 'square') {
            return (
              <rect
                key={key}
                x={cx - 5.5}
                y={cy - 5.5}
                width="11"
                height="11"
                rx="2.5"
                fill={`var(--${token}-main)`}
                stroke="#fffdf7"
                strokeWidth="1.2"
              />
            );
          }
          return (
            <g key={key}>
              <circle
                cx={cx}
                cy={cy}
                r="5.8"
                fill={`var(--${token}-main)`}
                stroke="#fffdf7"
                strokeWidth="1.2"
              />
              {piece.kind === 'round' && (
                <circle cx={cx} cy={cy} r="1.8" fill="#fffdf7" opacity="0.88" />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
