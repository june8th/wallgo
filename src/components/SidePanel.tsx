import {
  getPhaseSubstate,
  getRemainingPlacementKinds,
  shouldAutoSkipPlayer,
} from '../engine';
import type {
  AIDifficulty,
  GameState,
  ValidMoveOption,
  WallGo2PieceKind,
} from '../engine';

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
}

const AI_DIFFICULTY_LABEL: Record<AIDifficulty, string> = {
  easy: 'AI 쉬움',
  normal: 'AI 보통',
  hard: 'AI 어려움',
};

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
): string {
  if (state.phase === 'game_over') {
    return '게임 종료 · 최종 결과를 확인하세요';
  }
  const actor = state.players[state.currentPlayerIndex];
  const name = actor?.name ?? `플레이어 ${state.currentPlayerIndex + 1}`;

  if (isAiTurn) {
    return `${name} (AI) · 생각 중...`;
  }

  if (state.phase === 'placement') {
    const placed = state.placementStep + 1;
    const total = state.placementQueue.length;
    if (state.ruleVariant === 'wallgo2' && state.format === '3p') {
      const kindLabel =
        state.turnSubState.selectedPlacementKind === 'round' ? '원형' : '사각';
      return `${name} · ${kindLabel} 말을 배치할 빈 칸을 선택하세요 (${placed}/${total})`;
    }
    return `${name} · 말을 배치할 빈 칸을 선택하세요 (${placed}/${total})`;
  }

  if (state.phase === 'select_piece') {
    return `${name} · 이동할 내 말을 선택하세요`;
  }

  if (state.phase === 'move_piece') {
    const substate = getPhaseSubstate(state);
    if (substate === 'wall_break_select_wall') {
      return `${name} · 부술 인접 벽을 선택하세요`;
    }
    if (substate === 'wall_break_move') {
      return `${name} · 벽을 부수며 이동할 칸을 선택하세요`;
    }
    if (substate === 'choose_break_wall') {
      return `${name} · 경로 위 부술 벽 1개를 선택하세요`;
    }
    const canStay =
      state.ruleVariant === 'wallgo1' &&
      validMoves.some((opt) => opt.moveType === 'stay');
    if (canStay) {
      return `${name} · 이동할 칸을 선택하세요 (제자리 유지 가능)`;
    }
    return `${name} · 이동할 칸을 선택하세요`;
  }

  return `${name} · 이동한 말 주변에 벽을 설치하세요`;
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
}: SidePanelProps) {
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

  const guidanceText = getTurnGuidanceText(state, validMoves, isAiTurn);
  const timerUrgency = getTimerUrgency(timerRemaining);

  return (
    <aside className="side-panel">
      {/* 1. Top Status Bar */}
      <header className="game-topbar" data-testid="game-topbar">
        <div className="topbar-meta">
          <span className="topbar-badge topbar-badge--variant">
            {state.ruleVariant === 'wallgo1' ? '벽바둑' : '벽바둑 II'}
          </span>
          {state.isPrisonMatchRound2 ? (
            <span className="topbar-badge topbar-badge--round2">감옥매치 2라운드</span>
          ) : (
            <span className="topbar-badge topbar-badge--format">
              {state.format === '3p' ? '3인전' : '2인전'}
            </span>
          )}
        </div>

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
              aria-pressed={timerPaused}
              disabled={state.phase === 'game_over'}
              onClick={onTogglePause}
            >
              {timerPaused ? '재개' : '일시정지'}
            </button>
          </div>
        )}
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
            aria-label="배치할 말 종류 선택"
          >
            <button
              type="button"
              className="btn-piece-kind"
              data-testid="pick-piece-square"
              aria-pressed={state.turnSubState.selectedPlacementKind === 'square'}
              disabled={!remainingKinds.includes('square') || isAiTurn || timerPaused}
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
              사각 말 (직선)
            </button>
            <button
              type="button"
              className="btn-piece-kind"
              data-testid="pick-piece-round"
              aria-pressed={state.turnSubState.selectedPlacementKind === 'round'}
              disabled={!remainingKinds.includes('round') || isAiTurn || timerPaused}
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
              원형 말 (꺾임)
            </button>
          </div>
        )}
      </section>

      {/* 3. Live Player Score Cards */}
      <section
        className="score-board"
        data-testid="score-board"
        role="region"
        aria-label="플레이어 점수 현황"
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
                      {AI_DIFFICULTY_LABEL[player.aiDifficulty]}
                    </span>
                  )}
                  {isAutoSkipped && (
                    <span className="player-pill player-pill--sealed">영역 확정</span>
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
                    {totalTerritory}칸
                  </span>
                  <span
                    className="player-largest-value"
                    data-testid={`player-largest-${player.id}`}
                    data-value={largestSingle}
                  >
                    최대 {largestSingle}
                  </span>
                </div>

                {state.format === '3p' && (
                  <span
                    className="player-wallbreak-pill"
                    data-testid={`player-wallbreak-${player.id}`}
                    data-remaining={player.wallBreaksRemaining}
                  >
                    {player.wallBreaksRemaining > 0 ? '벽 부수기 1' : '사용 완료'}
                  </span>
                )}
              </div>
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
              결과 보기
            </button>
          ) : (
            <>
              {state.format === '3p' && (
                <button
                  type="button"
                  className="btn-action btn-action--break"
                  data-testid="wall-break-toggle"
                  aria-pressed={state.turnSubState.wallBreakActive}
                  disabled={!canWallBreak || isAiTurn || timerPaused}
                  onClick={onToggleWallBreak}
                >
                  벽 부수기
                </button>
              )}
              <button
                type="button"
                className="btn-action"
                data-testid="cancel-move-button"
                disabled={!canCancelMove || isAiTurn || timerPaused}
                onClick={onCancelMove}
              >
                이동 취소
              </button>
            </>
          )}
        </div>

        <div className="action-utility-row">
          <button
            type="button"
            className="btn-action btn-action--subtle"
            data-testid="undo-button"
            disabled={!canUndo}
            onClick={onUndo}
          >
            무르기
          </button>
          <button
            type="button"
            className="btn-action btn-action--subtle"
            data-testid="redo-button"
            disabled={!canRedo}
            onClick={onRedo}
          >
            다시 실행
          </button>
          <button
            type="button"
            className="btn-action btn-action--subtle"
            data-testid="rules-button"
            onClick={onOpenRules}
          >
            규칙
          </button>
          <button
            type="button"
            className="btn-action btn-action--subtle"
            data-testid="lobby-button"
            onClick={onBackToLobby}
          >
            로비
          </button>
        </div>
      </div>
    </aside>
  );
}
