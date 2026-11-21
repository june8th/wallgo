import { computeRound2Qualification } from '../engine';
import type { GameState, PlayerScoreSummary, Round2Qualification } from '../engine';
import { useI18n } from '../i18n';

export interface ResultModalProps {
  state: GameState;
  onStartRound2: () => void;
  onRematch: () => void;
  onBackToLobby: () => void;
  onInspectBoard: () => void;
  mode?: 'local' | 'online';
  isHost?: boolean;
  onlineActionPending?: boolean;
  onOnlineRound2?: () => void;
  onOnlineRematch?: () => void;
  onOnlineReturnWaiting?: () => void;
}

function sortScores(scores: readonly PlayerScoreSummary[]): PlayerScoreSummary[] {
  return scores.slice().sort(
    (a, b) =>
      a.rank - b.rank ||
      b.totalTerritory - a.totalTerritory ||
      b.largestSingleTerritory - a.largestSingleTerritory ||
      a.playerId - b.playerId,
  );
}

export function ResultModal({
  state,
  onStartRound2,
  onRematch,
  onBackToLobby,
  onInspectBoard,
  mode = 'local',
  isHost = false,
  onlineActionPending = false,
  onOnlineRound2,
  onOnlineRematch,
  onOnlineReturnWaiting,
}: ResultModalProps) {
  const { t } = useI18n();
  const orderedScores = sortScores(state.territory.scores);
  const rankCounts = new Map<number, number>();
  for (const s of orderedScores) {
    rankCounts.set(s.rank, (rankCounts.get(s.rank) ?? 0) + 1);
  }

  let qualification: Round2Qualification | null = null;
  if (state.format === '3p' && state.phase === 'game_over') {
    qualification = computeRound2Qualification(state);
  }

  const advancingIds = qualification
    ? [qualification.defaultFirstPlayerId, qualification.defaultSecondPlayerId]
    : [];

  const titleText =
    state.format === '3p'
      ? t.result.titleRound1
      : state.isPrisonMatchRound2
        ? t.result.titleRound2
        : t.result.titleGameOver;

  const endReasonText =
    state.territory.endReason === 'deadlock'
      ? t.result.endReasonDeadlock
      : t.result.endReasonSeparated;

  const firstR2Player = qualification
    ? state.players.find((p) => p.id === qualification.defaultFirstPlayerId)
    : undefined;
  const secondR2Player = qualification
    ? state.players.find((p) => p.id === qualification.defaultSecondPlayerId)
    : undefined;

  const round2ReasonSuffix = qualification
    ? qualification.status === 'three_way_tie'
      ? t.result.round2ReasonThreeWayTie
      : qualification.status === 'tied_for_first'
        ? t.result.round2ReasonTiedForFirst
        : qualification.isFirstPlayerOrderTied
          ? t.result.round2ReasonOrderTied
          : t.result.round2ReasonClear
    : '';

  const isOnline = mode === 'online';

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        data-testid="result-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-modal-title"
      >
        <header className="modal-header">
          <div>
            <h2 id="result-modal-title" className="modal-title">
              {titleText}
            </h2>
            <p className="modal-subtitle">{endReasonText}</p>
          </div>
        </header>

        <div className="modal-body">
          <div className="result-rank-list">
            {orderedScores.map((score) => {
              const player = state.players.find((p) => p.id === score.playerId);
              const isTiedRank = (rankCounts.get(score.rank) ?? 0) > 1;
              const rankText = t.result.rank(score.rank, isTiedRank);
              const isAdvancing = advancingIds.includes(score.playerId);
              const isSurvivor =
                qualification !== null && qualification.survivorId === score.playerId;

              return (
                <div
                  key={score.playerId}
                  className="result-rank-row"
                  data-testid={`result-rank-row-${score.playerId}`}
                  data-rank={score.rank}
                  data-total-cells={score.totalTerritory}
                  data-largest-area={score.largestSingleTerritory}
                  data-advancing-round2={isAdvancing ? 'true' : 'false'}
                  data-player-color={player?.colorToken ?? 'p1'}
                >
                  <div className="result-rank-left">
                    <span className="result-rank-badge">{rankText}</span>
                    <span className="player-swatch" aria-hidden="true" />
                    <span className="result-player-name">
                      {player?.name ?? t.common.defaultPlayerName(score.playerId)}
                    </span>
                    {state.format === '3p' && isSurvivor && (
                      <span className="result-status-tag result-status-tag--survivor">
                        {t.result.statusSurvivor}
                      </span>
                    )}
                    {state.format === '3p' && isAdvancing && (
                      <span className="result-status-tag result-status-tag--round2">
                        {t.result.statusRound2}
                      </span>
                    )}
                  </div>

                  <div className="result-rank-right">
                    <span className="result-score-total">
                      {t.result.cellsCount(score.totalTerritory)}
                    </span>
                    <span className="result-score-sub">
                      {t.result.largestSingle(score.largestSingleTerritory)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="result-caption">{t.result.tiebreakerCaption}</p>

          {state.format === '3p' && qualification && firstR2Player && secondR2Player && (
            <div
              className="round2-preview"
              data-testid="round2-preview"
              data-advancing-ids={`${qualification.defaultFirstPlayerId},${qualification.defaultSecondPlayerId}`}
              data-first-player-id={qualification.defaultFirstPlayerId}
            >
              <p className="round2-preview-title">
                {t.result.round2PreviewTitle(firstR2Player.name, secondR2Player.name)}
              </p>
              <p className="round2-preview-detail">
                {t.result.round2FirstTurnPrefix}
                <strong>{firstR2Player.name}</strong>
                {round2ReasonSuffix}
              </p>
              <p className="round2-preview-rule">{t.result.round2PreviewRule}</p>
            </div>
          )}
        </div>

        <footer className="modal-footer">
          {isOnline ? (
            <>
              {isHost && state.format === '3p' && qualification && onOnlineRound2 && (
                <button
                  type="button"
                  className="btn-modal-cta"
                  data-testid="online-round2-button"
                  disabled={onlineActionPending}
                  onClick={onOnlineRound2}
                >
                  {t.result.startRound2Button}
                </button>
              )}
              {!isHost && (
                <p className="result-online-wait" role="status">
                  {t.online.waitingForHostResult}
                </p>
              )}
              <div className="modal-secondary-actions modal-secondary-actions--online">
                {isHost && onOnlineRematch && (
                  <button
                    type="button"
                    className="btn-action"
                    data-testid="online-rematch-button"
                    disabled={onlineActionPending}
                    onClick={onOnlineRematch}
                  >
                    {t.result.rematchButton}
                  </button>
                )}
                {isHost && onOnlineReturnWaiting && (
                  <button
                    type="button"
                    className="btn-action"
                    data-testid="online-return-waiting-button"
                    disabled={onlineActionPending}
                    onClick={onOnlineReturnWaiting}
                  >
                    {t.online.returnWaitingButton}
                  </button>
                )}
                <button
                  type="button"
                  className="btn-action"
                  data-testid="inspect-board-button"
                  onClick={onInspectBoard}
                >
                  {t.result.inspectBoardButton}
                </button>
                <button
                  type="button"
                  className="btn-action"
                  data-testid="result-lobby-button"
                  onClick={onBackToLobby}
                >
                  {t.result.backToLobbyButton}
                </button>
              </div>
            </>
          ) : (
            <>
              {state.format === '3p' && qualification && (
                <button
                  type="button"
                  className="btn-modal-cta"
                  data-testid="start-round2-button"
                  onClick={onStartRound2}
                >
                  {t.result.startRound2Button}
                </button>
              )}
              <div className="modal-secondary-actions">
                <button
                  type="button"
                  className="btn-action"
                  data-testid="rematch-button"
                  onClick={onRematch}
                >
                  {t.result.rematchButton}
                </button>
                <button
                  type="button"
                  className="btn-action"
                  data-testid="inspect-board-button"
                  onClick={onInspectBoard}
                >
                  {t.result.inspectBoardButton}
                </button>
                <button
                  type="button"
                  className="btn-action"
                  data-testid="result-lobby-button"
                  onClick={onBackToLobby}
                >
                  {t.result.backToLobbyButton}
                </button>
              </div>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
