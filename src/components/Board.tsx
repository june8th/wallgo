import {
  BOARD_SIZE,
  COL_LABELS,
  ROW_LABELS,
  cellToCoordLabel,
  wallKey,
} from '../engine';
import type {
  CellPos,
  GameState,
  InteractiveWallSlot,
  Piece,
  PlacedWall,
  PlayerColorToken,
  TerritoryComponent,
  ValidMoveOption,
  WallEdge,
} from '../engine';
import { useI18n } from '../i18n';

export interface ReplayBoardHighlight {
  /** Starting cell of a moved piece (null on placement or 0-step stay) */
  origin?: CellPos | null;
  /** Destination cell of a moved piece OR newly placed cell */
  dest?: CellPos | null;
  /** True iff Wall Go I 0-step stay */
  isStay?: boolean;
  /** Original PlacedWall destroyed by Wall Break on this step */
  brokenWall?: PlacedWall | null;
  /** True iff brokenWall and placedWall occupy the exact same edge (E10 resealing) */
  isResealed?: boolean;
  /** Wall placed at the end of this step */
  placedWall?: WallEdge | null;
}

export interface BoardProps {
  state: GameState;
  validMoves: ValidMoveOption[];
  interactiveWalls: InteractiveWallSlot[];
  pendingBreakTarget: CellPos | null;
  isInteractive: boolean;
  isPaused: boolean;
  replayHighlight?: ReplayBoardHighlight | null;
  onCellClick: (row: number, col: number) => void;
  onWallClick: (edge: WallEdge) => void;
}

function PieceGlyph({ kind }: { kind: Piece['kind'] }) {
  if (kind === 'square') {
    // Wall Go II Square Piece: 4-way straight orthogonal arrows
    return (
      <svg className="piece-glyph-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3.5V20.5M3.5 12H20.5M12 3.5L9.2 6.3M12 3.5L14.8 6.3M12 20.5L9.2 17.7M12 20.5L14.8 17.7M3.5 12L6.3 9.2M3.5 12L6.3 14.8M20.5 12L17.7 9.2M20.5 12L17.7 14.8"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === 'round') {
    // Wall Go II Round Piece: 90-degree bent L-turn arrows
    return (
      <svg className="piece-glyph-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M7 17V10.5C7 8.6 8.6 7 10.5 7H17M17 7L14.2 4.4M17 7L14.2 9.6M17 17H11.5M7 17L4.5 14.5M7 17L9.5 14.5"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return <span className="piece-inner-ring" aria-hidden="true" />;
}

function HammerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M11.5 3.5L16.5 8.5L14 11L11.5 8.5L4.8 15.2C4.2 15.8 3.2 15.8 2.6 15.2C2 14.6 2 13.6 2.6 13L9.3 6.3L7.5 4.5L9.5 2.5C10.1 1.9 10.9 2.9 11.5 3.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Board({
  state,
  validMoves,
  interactiveWalls,
  pendingBreakTarget,
  isInteractive,
  isPaused,
  replayHighlight = null,
  onCellClick,
  onWallClick,
}: BoardProps) {
  const { t } = useI18n();

  const playerColorById = new Map<number, PlayerColorToken>();
  for (const player of state.players) {
    playerColorById.set(player.id, player.colorToken);
  }
  const activePlayerColor: PlayerColorToken =
    state.players[state.currentPlayerIndex]?.colorToken ?? 'p1';

  const pieceAtKey = new Map<string, Piece>();
  for (const piece of state.pieces) {
    pieceAtKey.set(`${piece.row},${piece.col}`, piece);
  }

  const validMoveByKey = new Map<string, ValidMoveOption>();
  if (isInteractive && state.phase === 'move_piece') {
    for (const opt of validMoves) {
      validMoveByKey.set(`${opt.row},${opt.col}`, opt);
    }
  }

  const interactiveWallByKey = new Map<string, InteractiveWallSlot>();
  if (isInteractive) {
    for (const slot of interactiveWalls) {
      interactiveWallByKey.set(wallKey(slot), slot);
    }
  }

  const componentById = new Map<number, TerritoryComponent>();
  for (const comp of state.territory.components) {
    componentById.set(comp.id, comp);
  }

  const lastWallKey = replayHighlight?.placedWall
    ? wallKey(replayHighlight.placedWall)
    : state.lastPlacedWall
      ? wallKey(state.lastPlacedWall)
      : null;

  const brokenWallKey = replayHighlight?.brokenWall
    ? wallKey(replayHighlight.brokenWall)
    : null;
  const isResealedStep = Boolean(replayHighlight?.isResealed);

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const key = `${r},${c}`;
      const piece = pieceAtKey.get(key);
      const coord = cellToCoordLabel({ row: r, col: c });
      const compId = state.territory.cellToComponentId[r]?.[c];
      const comp = compId !== undefined ? componentById.get(compId) : undefined;
      const securedOwner =
        comp && comp.kind === 'secured' && comp.ownerId !== null ? comp.ownerId : null;
      const territorySize = securedOwner !== null && comp ? comp.size : 0;
      const isAnchor =
        securedOwner !== null &&
        comp !== undefined &&
        comp.anchorCell.row === r &&
        comp.anchorCell.col === c;

      const isPlacementTarget = isInteractive && state.phase === 'placement' && !piece;
      const moveOpt = validMoveByKey.get(key);
      const moveType = isPlacementTarget
        ? 'placement'
        : moveOpt
          ? moveOpt.moveType
          : 'none';
      const isValidMove = moveType !== 'none';

      const isSelected =
        piece !== undefined &&
        state.turnSubState.selectedPieceId === piece.id &&
        (state.phase === 'move_piece' || state.phase === 'place_wall');

      const isPendingTarget =
        pendingBreakTarget !== null &&
        pendingBreakTarget.row === r &&
        pendingBreakTarget.col === c;

      let replayRole: 'origin' | 'dest' | 'stay' | 'none' = 'none';
      if (replayHighlight) {
        if (
          replayHighlight.dest &&
          replayHighlight.dest.row === r &&
          replayHighlight.dest.col === c
        ) {
          replayRole = replayHighlight.isStay ? 'stay' : 'dest';
        } else if (
          replayHighlight.origin &&
          replayHighlight.origin.row === r &&
          replayHighlight.origin.col === c
        ) {
          replayRole = 'origin';
        }
      }

      const pieceColorToken =
        piece !== undefined ? (playerColorById.get(piece.ownerId) ?? 'p1') : undefined;
      const territoryColorToken =
        securedOwner !== null ? (playerColorById.get(securedOwner) ?? 'p1') : undefined;

      const ariaParts = [t.board.cellLabel(coord)];
      if (piece) {
        const ownerName = state.players[piece.ownerId]?.name ?? `${piece.ownerId + 1}P`;
        const kindLabel = t.common.pieceKindFull[piece.kind];
        ariaParts.push(`${ownerName} ${kindLabel}`);
      }
      if (moveType === 'placement') {
        ariaParts.push(t.board.movePlacementAria);
      } else if (moveType === 'stay') {
        ariaParts.push(t.board.moveStayAria);
      } else if (moveType === 'normal') {
        ariaParts.push(t.board.moveNormalAria);
      } else if (moveType === 'wall-break') {
        ariaParts.push(t.board.moveWallBreakAria);
      }

      const cellClassName =
        replayRole !== 'none' ? `board-cell cell-replay-${replayRole}` : 'board-cell';

      cells.push(
        <button
          key={`cell-${r}-${c}`}
          type="button"
          className={cellClassName}
          data-testid={`cell-${r}-${c}`}
          data-row={r}
          data-col={c}
          data-coord={coord}
          data-occupied-by={piece !== undefined ? String(piece.ownerId) : 'none'}
          data-piece-id={piece !== undefined ? piece.id : 'none'}
          data-piece-kind={piece !== undefined ? piece.kind : 'none'}
          data-valid-move={isValidMove ? 'true' : 'false'}
          data-move-type={moveType}
          data-selected={isSelected ? 'true' : 'false'}
          data-territory-owner={securedOwner !== null ? String(securedOwner) : 'none'}
          data-territory-color={territoryColorToken ?? 'none'}
          data-territory-size={territorySize}
          data-pending-target={isPendingTarget ? 'true' : 'false'}
          data-replay-role={replayRole !== 'none' ? replayRole : undefined}
          aria-label={ariaParts.join(', ')}
          style={{
            gridRow: 2 * r + 1,
            gridColumn: 2 * c + 1,
          }}
          onClick={() => {
            if (!isInteractive) return;
            onCellClick(r, c);
          }}
        >
          {piece && (
            <span
              className="piece-token"
              data-testid={`piece-${piece.id}`}
              data-owner={piece.ownerId}
              data-kind={piece.kind}
              data-row={r}
              data-col={c}
              data-selected={isSelected ? 'true' : 'false'}
              data-player-color={pieceColorToken}
            >
              <PieceGlyph kind={piece.kind} />
            </span>
          )}
          {(moveType === 'stay' || replayRole === 'stay') && (
            <span className="cell-stay-tag" aria-hidden="true">
              {t.board.stayTag}
            </span>
          )}
          {isAnchor && securedOwner !== null && comp && (
            <span
              className="territory-badge"
              data-testid={`territory-badge-${r}-${c}`}
              data-territory-badge="true"
              data-owner={securedOwner}
              data-count={comp.size}
              data-player-color={territoryColorToken}
              aria-hidden="true"
            >
              {comp.size}
            </span>
          )}
        </button>,
      );
    }
  }

  const wallTracks: React.ReactNode[] = [];

  // 42 Horizontal Wall Tracks: row 0..5, col 0..6 -> separates (r,c) and (r+1,c)
  for (let r = 0; r < BOARD_SIZE - 1; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const edge: WallEdge = { orientation: 'h', row: r, col: c };
      const key = wallKey(edge);
      const placed = state.walls[key];
      const interactive = interactiveWallByKey.get(key);
      const isLast = lastWallKey === key;
      const isBrokenEdge = brokenWallKey === key;
      const isResealedEdge = isBrokenEdge && isResealedStep && placed !== undefined;

      const c1 = cellToCoordLabel({ row: r, col: c });
      const c2 = cellToCoordLabel({ row: r + 1, col: c });

      wallTracks.push(
        <div
          key={`track-h-${r}-${c}`}
          className="wall-track"
          style={{
            gridRow: 2 * r + 2,
            gridColumn: 2 * c + 1,
          }}
        >
          {placed && (
            <div
              className={
                isResealedEdge ? 'placed-wall wall-replay-resealed' : 'placed-wall'
              }
              data-testid={`placed-wall-h-${r}-${c}`}
              data-orientation="h"
              data-row={r}
              data-col={c}
              data-owner={placed.ownerId}
              data-last-wall={isLast ? 'true' : 'false'}
              data-replay-resealed={isResealedEdge ? 'true' : undefined}
              data-player-color={playerColorById.get(placed.ownerId) ?? 'p1'}
            />
          )}
          {isResealedEdge && (
            <div
              className="wall-replay-resealed-badge"
              data-orientation="h"
              aria-hidden="true"
            >
              <HammerIcon />
            </div>
          )}
          {isBrokenEdge && !placed && replayHighlight?.brokenWall && (
            <div
              className="wall-replay-broken"
              data-orientation="h"
              data-player-color={
                playerColorById.get(replayHighlight.brokenWall.ownerId) ?? 'p1'
              }
              aria-hidden="true"
            >
              <span className="wall-replay-broken-badge">
                <HammerIcon />
              </span>
            </div>
          )}
          {interactive && (
            <button
              type="button"
              className="wall-hit-target"
              data-testid={`wall-h-${r}-${c}`}
              data-orientation="h"
              data-row={r}
              data-col={c}
              data-wall-state={interactive.state}
              data-wall-interactive="true"
              data-player-color={activePlayerColor}
              aria-label={t.board.wallAria(
                c1,
                c2,
                'h',
                interactive.state === 'placeable',
              )}
              onClick={() => onWallClick(edge)}
            >
              <span className="wall-slot-beam" aria-hidden="true" />
              {interactive.state !== 'placeable' && (
                <span className="wall-break-badge" aria-hidden="true">
                  <HammerIcon />
                </span>
              )}
            </button>
          )}
        </div>,
      );
    }
  }

  // 42 Vertical Wall Tracks: row 0..6, col 0..5 -> separates (r,c) and (r,c+1)
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE - 1; c++) {
      const edge: WallEdge = { orientation: 'v', row: r, col: c };
      const key = wallKey(edge);
      const placed = state.walls[key];
      const interactive = interactiveWallByKey.get(key);
      const isLast = lastWallKey === key;
      const isBrokenEdge = brokenWallKey === key;
      const isResealedEdge = isBrokenEdge && isResealedStep && placed !== undefined;

      const c1 = cellToCoordLabel({ row: r, col: c });
      const c2 = cellToCoordLabel({ row: r, col: c + 1 });

      wallTracks.push(
        <div
          key={`track-v-${r}-${c}`}
          className="wall-track"
          style={{
            gridRow: 2 * r + 1,
            gridColumn: 2 * c + 2,
          }}
        >
          {placed && (
            <div
              className={
                isResealedEdge ? 'placed-wall wall-replay-resealed' : 'placed-wall'
              }
              data-testid={`placed-wall-v-${r}-${c}`}
              data-orientation="v"
              data-row={r}
              data-col={c}
              data-owner={placed.ownerId}
              data-last-wall={isLast ? 'true' : 'false'}
              data-replay-resealed={isResealedEdge ? 'true' : undefined}
              data-player-color={playerColorById.get(placed.ownerId) ?? 'p1'}
            />
          )}
          {isResealedEdge && (
            <div
              className="wall-replay-resealed-badge"
              data-orientation="v"
              aria-hidden="true"
            >
              <HammerIcon />
            </div>
          )}
          {isBrokenEdge && !placed && replayHighlight?.brokenWall && (
            <div
              className="wall-replay-broken"
              data-orientation="v"
              data-player-color={
                playerColorById.get(replayHighlight.brokenWall.ownerId) ?? 'p1'
              }
              aria-hidden="true"
            >
              <span className="wall-replay-broken-badge">
                <HammerIcon />
              </span>
            </div>
          )}
          {interactive && (
            <button
              type="button"
              className="wall-hit-target"
              data-testid={`wall-v-${r}-${c}`}
              data-orientation="v"
              data-row={r}
              data-col={c}
              data-wall-state={interactive.state}
              data-wall-interactive="true"
              data-player-color={activePlayerColor}
              aria-label={t.board.wallAria(
                c1,
                c2,
                'v',
                interactive.state === 'placeable',
              )}
              onClick={() => onWallClick(edge)}
            >
              <span className="wall-slot-beam" aria-hidden="true" />
              {interactive.state !== 'placeable' && (
                <span className="wall-break-badge" aria-hidden="true">
                  <HammerIcon />
                </span>
              )}
            </button>
          )}
        </div>,
      );
    }
  }

  return (
    <section className="board-stage" data-testid="board-stage">
      <div
        className="board-frame"
        data-testid="board-frame"
        role="region"
        aria-label={t.board.regionAria}
      >
        <div className="board-coords-top" aria-hidden="true">
          {COL_LABELS.map((label, c) => (
            <span
              key={label}
              className="coord-label"
              style={{ gridColumn: 2 * c + 1 }}
            >
              {label}
            </span>
          ))}
        </div>
        <div className="board-coords-left" aria-hidden="true">
          {ROW_LABELS.map((label, r) => (
            <span
              key={label}
              className="coord-label"
              style={{ gridRow: 2 * r + 1 }}
            >
              {label}
            </span>
          ))}
        </div>

        <div
          className="board-grid"
          data-testid="board-grid"
          role="grid"
          aria-label={t.board.gridAria}
        >
          {cells}
          {wallTracks}
          {isPaused && (
            <div className="board-paused-shield" role="status">
              <span className="board-paused-pill">{t.board.pausedOverlay}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
