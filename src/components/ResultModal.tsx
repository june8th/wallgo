import { computeRound2Qualification } from '../engine';
import type { GameState, PlayerScoreSummary, Round2Qualification } from '../engine';

export interface ResultModalProps {
  state: GameState;
  onStartRound2: () => void;
  onRematch: () => void;
  onBackToLobby: () => void;
  onInspectBoard: () => void;
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
}: ResultModalProps) {
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
      ? '감옥매치 1라운드 종료'
      : state.isPrisonMatchRound2
        ? '감옥매치 2라운드 종료'
        : '게임 종료';

  const endReasonText =
    state.territory.endReason === 'deadlock'
      ? '모든 영역 분리 또는 이동 불가(교착)로 경기가 종료되었습니다.'
      : '모든 플레이어의 영역이 벽으로 완전히 분리되었습니다.';

  const firstR2Player = qualification
    ? state.players.find((p) => p.id === qualification.defaultFirstPlayerId)
    : undefined;
  const secondR2Player = qualification
    ? state.players.find((p) => p.id === qualification.defaultSecondPlayerId)
    : undefined;

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
              const rankText = isTiedRank ? `공동 ${score.rank}위` : `${score.rank}위`;
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
                      {player?.name ?? `플레이어 ${score.playerId + 1}`}
                    </span>
                    {state.format === '3p' && isSurvivor && (
                      <span className="result-status-tag result-status-tag--survivor">생존</span>
                    )}
                    {state.format === '3p' && isAdvancing && (
                      <span className="result-status-tag result-status-tag--round2">
                        2라운드 진출
                      </span>
                    )}
                  </div>

                  <div className="result-rank-right">
                    <span className="result-score-total">{score.totalTerritory}칸</span>
                    <span className="result-score-sub">
                      최대 단일 {score.largestSingleTerritory}칸
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="result-caption">동점 시 최대 단일 영역이 더 넓은 플레이어가 우선합니다.</p>

          {state.format === '3p' && qualification && firstR2Player && secondR2Player && (
            <div
              className="round2-preview"
              data-testid="round2-preview"
              data-advancing-ids={`${qualification.defaultFirstPlayerId},${qualification.defaultSecondPlayerId}`}
              data-first-player-id={qualification.defaultFirstPlayerId}
            >
              <p className="round2-preview-title">
                2라운드 1:1 감옥매치 대진 · {firstR2Player.name} vs {secondR2Player.name}
              </p>
              <p className="round2-preview-detail">
                선공: <strong>{firstR2Player.name}</strong>
                {qualification.status === 'three_way_tie'
                  ? ' (3인 완전 동률 — 기본 대진 적용, 재경기로 다시 겨룰 수도 있습니다)'
                  : qualification.status === 'tied_for_first'
                    ? ' (공동 1위 동률 — 기본 2라운드 대진 적용)'
                    : qualification.isFirstPlayerOrderTied
                      ? ' (하위 2명 동률 — 앞 순번 선공)'
                      : ' (1라운드 영역 우위 선공)'}
              </p>
              <p className="round2-preview-rule">
                말 4개 · 2개 대각선 고정 · 벽 부수기 없음
              </p>
            </div>
          )}
        </div>

        <footer className="modal-footer">
          {state.format === '3p' && qualification && (
            <button
              type="button"
              className="btn-modal-cta"
              data-testid="start-round2-button"
              onClick={onStartRound2}
            >
              감옥매치 2라운드 (1:1) 시작
            </button>
          )}
          <div className="modal-secondary-actions">
            <button
              type="button"
              className="btn-action"
              data-testid="rematch-button"
              onClick={onRematch}
            >
              다시 하기
            </button>
            <button
              type="button"
              className="btn-action"
              data-testid="inspect-board-button"
              onClick={onInspectBoard}
            >
              보드 보기
            </button>
            <button
              type="button"
              className="btn-action"
              data-testid="result-lobby-button"
              onClick={onBackToLobby}
            >
              로비로
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
