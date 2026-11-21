import { cellToCoordLabel, isSameWallEdge } from '../engine';
import type { ActionEvent, CellPos, PlayerState, WallEdge } from '../engine';
import { formatWallEdgeLabel } from '../shared';
import type { Locale, ReplayStep } from '../shared';
import { enMessages } from './en';
import { koMessages } from './ko';
import type { Messages } from './types';

type PlayerNameRef = Pick<PlayerState, 'id' | 'name'>;

function getMessagesForLocale(locale: Locale): Messages {
  return locale === 'en' ? enMessages : koMessages;
}

function resolvePlayerName(
  playerId: number,
  players: readonly PlayerNameRef[],
  messages: Messages,
): string {
  const found = players.find((p) => p.id === playerId);
  if (found && found.name.trim().length > 0) {
    return found.name;
  }
  return messages.common.defaultPlayerName(playerId);
}

function safeCoordLabel(pos: CellPos): string {
  try {
    return cellToCoordLabel(pos);
  } catch {
    return `(${pos.row},${pos.col})`;
  }
}

function safeWallLabel(edge: WallEdge): string {
  try {
    return formatWallEdgeLabel(edge);
  } catch {
    return `${edge.orientation}:${edge.row}:${edge.col}`;
  }
}

/**
 * Formats an engine ActionEvent (placement or full turn) in the active locale.
 */
export function formatActionEvent(
  event: ActionEvent,
  players: readonly PlayerNameRef[],
  locale: Locale,
): string {
  const m = getMessagesForLocale(locale);
  const name = resolvePlayerName(event.playerId, players, m);

  if (event.kind === 'placement') {
    const coord = safeCoordLabel(event.pos);
    const pieceLabel = m.common.pieceKindFull[event.pieceKind];
    const base = event.timedOut
      ? m.replay.stepPlacementTimeout(name, pieceLabel, coord)
      : m.replay.stepPlacement(name, pieceLabel, coord);
    if (event.skippedPlayerIds.length > 0) {
      const skippedNames = event.skippedPlayerIds.map((id) =>
        resolvePlayerName(id, players, m),
      );
      return `${base}${m.replay.stepSkipSuffix(skippedNames)}`;
    }
    return base;
  }

  const fromCoord = safeCoordLabel(event.from);
  const toCoord = safeCoordLabel(event.to);
  const wallLabel = safeWallLabel(event.placedWall);
  const brokenLabel =
    event.usedWallBreak && event.brokenWall !== null
      ? safeWallLabel(event.brokenWall)
      : null;
  const resealed = Boolean(
    event.usedWallBreak &&
      event.brokenWall !== null &&
      isSameWallEdge(event.brokenWall, event.placedWall),
  );

  let base: string;
  if (brokenLabel !== null) {
    base = event.isStay
      ? m.replay.stepTurnStayBreak(name, toCoord, brokenLabel, wallLabel, resealed)
      : m.replay.stepTurnBreak(name, fromCoord, toCoord, brokenLabel, wallLabel, resealed);
  } else if (event.isStay) {
    base = m.replay.stepTurnStay(name, toCoord, wallLabel);
  } else {
    base = m.replay.stepTurnMove(name, fromCoord, toCoord, wallLabel);
  }

  if (event.timedOut) {
    base += m.replay.stepTimeoutSuffix;
  }
  if (event.skippedPlayerIds.length > 0) {
    const skippedNames = event.skippedPlayerIds.map((id) =>
      resolvePlayerName(id, players, m),
    );
    base += m.replay.stepSkipSuffix(skippedNames);
  }
  return base;
}

/**
 * Formats Step 0 (`step === null`) or any `ReplayStep` for ReplayViewer description & move list.
 */
export function formatReplayStepDescription(
  step: ReplayStep | null,
  players: readonly PlayerNameRef[],
  locale: Locale,
  options?: { hasFixedPieces?: boolean },
): string {
  const m = getMessagesForLocale(locale);
  if (step === null) {
    return options?.hasFixedPieces
      ? m.replay.initialBoardFixedDescription
      : m.replay.initialBoardDescription;
  }
  return formatActionEvent(step, players, locale);
}

/**
 * Formats an auto-skip toast notification in the active locale.
 */
export function formatAutoSkipToast(
  skippedPlayerIds: readonly number[],
  players: readonly PlayerNameRef[],
  locale: Locale,
): string {
  const m = getMessagesForLocale(locale);
  const names = skippedPlayerIds.map((id) => resolvePlayerName(id, players, m));
  return m.toast.autoSkip(names);
}

/**
 * Formats a turn-timeout toast notification in the active locale, preserving
 * any concurrent auto-skip notice triggered by the timed-out move.
 */
export function formatTimeoutToast(
  event: ActionEvent | null,
  players: readonly PlayerNameRef[],
  locale: Locale,
): string {
  const m = getMessagesForLocale(locale);
  if (event === null) {
    return m.toast.timeoutFallback;
  }
  const name = resolvePlayerName(event.playerId, players, m);
  const base =
    event.kind === 'placement'
      ? m.toast.timeoutPlacement(name, safeCoordLabel(event.pos))
      : m.toast.timeoutWall(name);

  if (event.skippedPlayerIds.length > 0) {
    return `${base} · ${formatAutoSkipToast(event.skippedPlayerIds, players, locale)}`;
  }
  return base;
}
