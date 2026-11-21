import {
  getPhaseSubstate,
  getRemainingPlacementKinds,
  shouldAutoSkipPlayer,
} from '../engine';
import type {
  GameState,
  ValidMoveOption,
  WallGo2PieceKind,
} from '../engine';
import { LanguageToggle, useI18n } from '../i18n';
import type {
  Messages,
  OnlineConnectionStatusLabel,
  OnlineSeatStatusLabel,
} from '../i18n';
import type { SpectatorRole } from '../shared';

export type OnlineConnectionBadgeStatus = OnlineConnectionStatusLabel;
export type OnlineSeatBadgeStatus = OnlineSeatStatusLabel;

export interface SidePanelOnlineSeatMeta {
  gamePlayerId: number;
  seatIndex: number;
  status: OnlineSeatBadgeStatus;
  isMe: boolean;
  isHost: boolean;
  canSubstituteAI: boolean;
  substitutedFromNickname?: string | null;
}

export interface SidePanelOnlineProps {
  roomCode: string;
  connectionStatus: OnlineConnectionBadgeStatus;
  isSpectator: boolean;
  spectatorRole?: SpectatorRole | null;
  isMyTurn: boolean;
  isHost: boolean;
  canClaimHost: boolean;
  inviteCopied: boolean;
  seatMetaByPlayerId: Readonly<Record<number, SidePanelOnlineSeatMeta>>;
  submitting?: boolean;
  onCopyInvite: () => void;
  onSubstituteAI: (seatIndex: number) => void;
  onClaimHost: () => void;
}

export interface SidePanelProps {
  state: GameState;
  validMoves: ValidMoveOption[];
  canWallBreak: boolean;
  canCancelMove: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isAiTurn: boolean;
  timerRemaining: number;
  timerPaused: boolean;
  isTimerEffectivelyPaused: boolean;
  showReopenResult: boolean;
  onSelectPlacementKind: (kind: WallGo2PieceKind) => void;
  onToggleWallBreak: () => void;
  onCancelMove: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onTogglePause: () => void;
  onOpenRules: () => void;
  onBackToLobby: () => void;
  onReopenResult: () => void;
  onlineProps?: SidePanelOnlineProps;
}

function formatMMSS(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getTimerUrgency(seconds: number): 'normal' | 'warning' | 'critical' {
  if (seconds <= 10) return 'critical';
  if (seconds <= 20) return 'warning';
  return 'normal';
}

function getTurnGuidanceText(
  state: GameState,
  validMoves: ValidMoveOption[],
  isAiTurn: boolean,
  t: Messages,
  onlineProps?: SidePanelOnlineProps,
): string {
  if (state.phase === 'game_over') {
    return t.hud.guidance.gameOver;
  }
  const actor = state.players[state.currentPlayerIndex];
  const name = actor?.name ?? t.common.defaultPlayerName(state.currentPlayerIndex);

  if (isAiTurn) {
    return t.hud.guidance.aiThinking(name);
  }

  if (onlineProps && !onlineProps.isMyTurn) {
    return t.hud.guidance.waitingForOnlineTurn(name);
  }

  if (state.phase === 'placement') {
    const placed = state.placementStep + 1;
    const total = state.placementQueue.length;
    if (state.ruleVariant === 'wallgo2' && state.format === '3p') {
      return t.hud.guidance.placementWg2(
        name,
        state.turnSubState.selectedPlacementKind,
        placed,
        total,
      );
    }
    return t.hud.guidance.placement(name, placed, total);
  }

  if (state.phase === 'select_piece') {
    return t.hud.guidance.selectPiece(name);
  }

  if (state.phase === 'move_piece') {
    const substate = getPhaseSubstate(state);
    if (substate === 'wall_break_select_wall') {
      return t.hud.guidance.wallBreakSelectWall(name);
    }
    if (substate === 'wall_break_move') {
      return t.hud.guidance.wallBreakMove(name);
    }
    if (substate === 'choose_break_wall') {
      return t.hud.guidance.chooseBreakWall(name);
    }
    const canStay =
      state.ruleVariant === 'wallgo1' &&
      validMoves.some((opt) => opt.moveType === 'stay');
    if (canStay) {
      return t.hud.guidance.movePieceStay(name);
    }
    return t.hud.guidance.movePiece(name);
  }

  return t.hud.guidance.placeWall(name);
}

export function SidePanel({
  state,
  validMoves,
  canWallBreak,
  canCancelMove,
  canUndo,
  canRedo,
  isAiTurn,
  timerRemaining,
  timerPaused,
  isTimerEffectivelyPaused,
  showReopenResult,
  onSelectPlacementKind,
  onToggleWallBreak,
  onCancelMove,
  onUndo,
  onRedo,
  onTogglePause,
  onOpenRules,
  onBackToLobby,
  onReopenResult,
  onlineProps,
}: SidePanelProps) {
  const { t } = useI18n();
  const isOnline = Boolean(onlineProps);
  const onlineInteractionLocked = Boolean(
    onlineProps &&
      (!onlineProps.isMyTurn || onlineProps.isSpectator || onlineProps.submitting),
  );

  const activePlayer = state.players[state.currentPlayerIndex];
  const scoreByPlayerId = new Map(
    state.territory.scores.map((summary) => [summary.playerId, summary]),
  );

  const showPieceKindPicker =
    state.phase === 'placement' &&
    state.ruleVariant === 'wallgo2' &&
    state.format === '3p';

  const remainingKinds = showPieceKindPicker
    ? getRemainingPlacementKinds(state, state.currentPlayerIndex)
    : [];

  const guidanceText = getTurnGuidanceText(state, validMoves, isAiTurn, t, onlineProps);
  const timerUrgency = getTimerUrgency(timerRemaining);

  const spectatorRole: SpectatorRole = onlineProps?.spectatorRole ?? 'spectator';

  return (
    <aside className="side-panel">
      {/* 1. Top Status Bar */}
      <header className="game-topbar" data-testid="game-topbar">
        <div className="topbar-meta">
          <span className="topbar-badge topbar-badge--variant">
            {t.common.variantShort[state.ruleVariant]}
          </span>
          {state.isPrisonMatchRound2 ? (
            <span className="topbar-badge topbar-badge--round2">
              {t.hud.round2Badge}
            </span>
          ) : (
            <span className="topbar-badge topbar-badge--format">
              {t.common.formatShort[state.format]}
            </span>
          )}
        </div>

        <div className="topbar-right">
          {onlineProps && (
            <>
              <span
                className="online-connection-badge"
                data-testid="online-connection-badge"
                data-status={onlineProps.connectionStatus}
              >
                {t.online.connectionStatus[onlineProps.connectionStatus]}
              </span>
              <button
                type="button"
                className="btn-online-invite"
                data-testid="online-copy-invite-button"
                data-copied={onlineProps.inviteCopied ? 'true' : 'false'}
                onClick={onlineProps.onCopyInvite}
              >
                {onlineProps.inviteCopied
                  ? t.online.copiedLabel
                  : t.online.inviteShortButton}
              </button>
            </>
          )}

          {state.timerSeconds > 0 && (
            <div className="topbar-timer-group">
              <div
                className="turn-timer"
                data-testid="turn-timer"
                role="timer"
                data-seconds={timerRemaining}
                data-paused={isTimerEffectivelyPaused ? 'true' : 'false'}
                data-urgency={timerUrgency}
              >
                {formatMMSS(timerRemaining)}
              </div>
              <button
                type="button"
                className="btn-timer-pause"
                data-testid="timer-pause-button"
                aria-pressed={isOnline ? false : timerPaused}
                disabled={state.phase === 'game_over' || isOnline}
                onClick={onTogglePause}
              >
                {timerPaused ? t.hud.resume : t.hud.pause}
              </button>
            </div>
          )}

          <LanguageToggle className="btn-lang-toggle--compact" />
        </div>
      </header>

      {/* 2. Turn Phase Guidance Banner (+ Wall Go II 3P Placement Kind Picker) */}
      <section
        className="turn-banner"
        data-testid="turn-banner"
        role="status"
        aria-live="polite"
        data-phase={state.phase}
        data-current-player={state.currentPlayerIndex}
        data-player-color={activePlayer?.colorToken ?? 'p1'}
      >
        {onlineProps?.isSpectator && (
          <div
            className="online-spectator-banner"
            data-testid="online-spectator-banner"
            role="note"
          >
            {t.online.spectatorBanners[spectatorRole]}
          </div>
        )}

        <div className="turn-banner-row">
          <div className="turn-banner-main">
            <span className="turn-player-dot" aria-hidden="true" />
            <p className="turn-banner-text">{guidanceText}</p>
          </div>
          {isAiTurn && state.phase !== 'game_over' && (
            <span className="ai-thinking-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
        </div>

        {showPieceKindPicker && (
          <div
            className="piece-kind-picker"
            data-testid="piece-kind-picker"
            role="group"
            aria-label={t.hud.pieceKindPickerAria}
          >
            <button
              type="button"
              className="btn-piece-kind"
              data-testid="pick-piece-square"
              aria-pressed={state.turnSubState.selectedPlacementKind === 'square'}
              disabled={
                !remainingKinds.includes('square') ||
                isAiTurn ||
                timerPaused ||
                onlineInteractionLocked
              }
              onClick={() => onSelectPlacementKind('square')}
            >
              <span className="piece-kind-glyph" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <rect
                    x="2"
                    y="2"
                    width="12"
                    height="12"
                    rx="2.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M8 4.2V11.8M4.2 8H11.8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              {t.hud.pickSquare}
            </button>
            <button
              type="button"
              className="btn-piece-kind"
              data-testid="pick-piece-round"
              aria-pressed={state.turnSubState.selectedPlacementKind === 'round'}
              disabled={
                !remainingKinds.includes('round') ||
                isAiTurn ||
                timerPaused ||
                onlineInteractionLocked
              }
              onClick={() => onSelectPlacementKind('round')}
            >
              <span className="piece-kind-glyph" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.8" />
                  <path
                    d="M6 11V7.2C6 6.5 6.5 6 7.2 6H11"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              {t.hud.pickRound}
            </button>
          </div>
        )}
      </section>

      {/* 3. Live Player Score Cards */}
      <section
        className="score-board"
        data-testid="score-board"
        role="region"
        aria-label={t.hud.scoreBoardAria}
        style={{ '--player-count': state.players.length } as React.CSSProperties}
      >
        {state.players.map((player) => {
          const score = scoreByPlayerId.get(player.id);
          const totalTerritory = score?.totalTerritory ?? 0;
          const largestSingle = score?.largestSingleTerritory ?? 0;
          const isActive =
            state.phase !== 'game_over' && state.currentPlayerIndex === player.id;
          const isAutoSkipped =
            state.phase !== 'placement' &&
            state.phase !== 'game_over' &&
            shouldAutoSkipPlayer(state, player.id);
          const seatMeta = onlineProps?.seatMetaByPlayerId[player.id];

          return (
            <div
              key={player.id}
              className="player-card"
              data-testid={`player-card-${player.id}`}
              data-player-id={player.id}
              data-player-color={player.colorToken}
              data-active={isActive ? 'true' : 'false'}
              data-auto-skipped={isAutoSkipped ? 'true' : 'false'}
              data-is-ai={player.isAI ? 'true' : 'false'}
              data-wall-breaks={player.wallBreaksRemaining}
            >
              <div className="player-card-header">
                <div className="player-identity">
                  <span className="player-swatch" aria-hidden="true" />
                  <span className="player-name">{player.name}</span>
                </div>
                <div className="player-tags">
                  {player.isAI && (
                    <span className="player-pill player-pill--ai">
                      {t.common.aiDifficulty[player.aiDifficulty]}
                    </span>
                  )}
                  {seatMeta && (
                    <span
                      className="player-pill online-seat-status"
                      data-testid={`online-seat-status-${player.id}`}
                      data-status={seatMeta.status}
                    >
                      {t.online.seatStatus[seatMeta.status]}
                    </span>
                  )}
                  {isAutoSkipped && (
                    <span className="player-pill player-pill--sealed">
                      {t.hud.securedBadge}
                    </span>
                  )}
                </div>
              </div>

              <div className="player-card-metrics">
                <div className="player-score-group">
                  <span
                    className="player-score-value"
                    data-testid={`player-score-${player.id}`}
                    data-value={totalTerritory}
                  >
                    {t.hud.cellsCount(totalTerritory)}
                  </span>
                  <span
                    className="player-largest-value"
                    data-testid={`player-largest-${player.id}`}
                    data-value={largestSingle}
                  >
                    {t.hud.largestArea(largestSingle)}
                  </span>
                </div>

                {state.format === '3p' && (
                  <span
                    className="player-wallbreak-pill"
                    data-testid={`player-wallbreak-${player.id}`}
                    data-remaining={player.wallBreaksRemaining}
                  >
                    {player.wallBreaksRemaining > 0
                      ? t.hud.wallBreakAvailable
                      : t.hud.wallBreakUsed}
                  </span>
                )}
              </div>

              {seatMeta?.canSubstituteAI && onlineProps && (
                <button
                  type="button"
                  className="btn-substitute-ai"
                  data-testid={`substitute-ai-button-${player.id}`}
                  disabled={Boolean(onlineProps.submitting)}
                  onClick={() => onlineProps.onSubstituteAI(seatMeta.seatIndex)}
                >
                  {t.online.substituteAiButton}
                </button>
              )}
            </div>
          );
        })}
      </section>

      {/* 4. Action Dock */}
      <div className="action-dock" data-testid="action-dock">
        <div className="action-turn-row">
          {showReopenResult ? (
            <button
              type="button"
              className="btn-action btn-action--primary"
              data-testid="reopen-result-button"
              onClick={onReopenResult}
            >
              {t.hud.reopenResult}
            </button>
          ) : (
            <>
              {state.format === '3p' && (
                <button
                  type="button"
                  className="btn-action btn-action--break"
                  data-testid="wall-break-toggle"
                  aria-pressed={state.turnSubState.wallBreakActive}
                  disabled={
                    !canWallBreak ||
                    isAiTurn ||
                    timerPaused ||
                    onlineInteractionLocked
                  }
                  onClick={onToggleWallBreak}
                >
                  {t.hud.wallBreakButton}
                </button>
              )}
              <button
                type="button"
                className="btn-action"
                data-testid="cancel-move-button"
                disabled={
                  !canCancelMove ||
                  isAiTurn ||
                  timerPaused ||
                  onlineInteractionLocked
                }
                onClick={onCancelMove}
              >
                {t.hud.cancelMoveButton}
              </button>
            </>
          )}

          {onlineProps?.canClaimHost && (
            <button
              type="button"
              className="btn-action btn-claim-host"
              data-testid="online-claim-host-button"
              disabled={Boolean(onlineProps.submitting)}
              onClick={onlineProps.onClaimHost}
            >
              {t.online.claimHostButton}
            </button>
          )}
        </div>

        <div className="action-utility-row">
          <button
            type="button"
            className="btn-action btn-action--subtle"
            data-testid="undo-button"
            data-online-disabled={isOnline ? 'true' : undefined}
            title={isOnline ? t.online.undoDisabledHint : undefined}
            disabled={isOnline || !canUndo}
            onClick={onUndo}
          >
            {t.hud.undoButton}
          </button>
          <button
            type="button"
            className="btn-action btn-action--subtle"
            data-testid="redo-button"
            data-online-disabled={isOnline ? 'true' : undefined}
            title={isOnline ? t.online.undoDisabledHint : undefined}
            disabled={isOnline || !canRedo}
            onClick={onRedo}
          >
            {t.hud.redoButton}
          </button>
          <button
            type="button"
            className="btn-action btn-action--subtle"
            data-testid="rules-button"
            onClick={onOpenRules}
          >
            {t.hud.rulesButton}
          </button>
          <button
            type="button"
            className="btn-action btn-action--subtle"
            data-testid="lobby-button"
            onClick={onBackToLobby}
          >
            {t.hud.lobbyButton}
          </button>
        </div>
      </div>
    </aside>
  );
}
