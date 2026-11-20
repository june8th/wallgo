import type { AIDifficulty, GameFormat, LobbyConfig, PlayerConfig, RuleVariant, TimerSeconds } from '../engine';

export interface LobbyProps {
  config: LobbyConfig;
  allSeats: PlayerConfig[];
  onChangeVariant: (variant: RuleVariant) => void;
  onChangeFormat: (format: GameFormat) => void;
  onChangeTimer: (timerSeconds: TimerSeconds) => void;
  onToggleShuffle: () => void;
  onChangeSeatName: (index: number, name: string) => void;
  onChangeSeatController: (index: number, isAI: boolean, difficulty?: AIDifficulty) => void;
  onOpenRules: () => void;
  onStart: () => void;
}

const CONTROLLER_OPTIONS: readonly {
  key: 'human' | 'ai-easy' | 'ai-normal' | 'ai-hard';
  label: string;
  isAI: boolean;
  difficulty: AIDifficulty;
}[] = [
  { key: 'human', label: '사람', isAI: false, difficulty: 'normal' },
  { key: 'ai-easy', label: 'AI 쉬움', isAI: true, difficulty: 'easy' },
  { key: 'ai-normal', label: 'AI 보통', isAI: true, difficulty: 'normal' },
  { key: 'ai-hard', label: 'AI 어려움', isAI: true, difficulty: 'hard' },
];

export function Lobby({
  config,
  allSeats,
  onChangeVariant,
  onChangeFormat,
  onChangeTimer,
  onToggleShuffle,
  onChangeSeatName,
  onChangeSeatController,
  onOpenRules,
  onStart,
}: LobbyProps) {
  const activeSeatCount = config.format === '3p' ? 3 : 2;
  const visibleSeats = allSeats.slice(0, activeSeatCount);

  return (
    <main className="lobby-screen" data-testid="lobby-screen" role="main">
      <div className="lobby-shell">
        <header className="lobby-header">
          <div className="lobby-brand">
            <div className="lobby-emblem" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 28 28" fill="none">
                <rect x="2" y="2" width="24" height="24" rx="5" fill="#F7F3EA" />
                <rect x="12.5" y="4" width="3" height="20" rx="1.5" fill="#C84B31" />
                <circle cx="7.5" cy="9.5" r="3" fill="#2B5F8F" />
                <circle cx="20.5" cy="18.5" r="3" fill="#2E7D5B" />
              </svg>
            </div>
            <div className="lobby-title-wrap">
              <h1 className="lobby-title" data-testid="lobby-title">
                벽바둑
              </h1>
              <p className="lobby-tagline">데블스 플랜 감옥매치 · 7×7 영역 쟁탈 전략 보드게임</p>
            </div>
          </div>
          <button
            type="button"
            className="btn-lobby-rules"
            data-testid="rules-button"
            aria-label="게임 규칙 보기"
            onClick={onOpenRules}
          >
            규칙 보기
          </button>
        </header>

        <div className="lobby-content">
          {/* Left Column: Variant, Format, Timer, Shuffle */}
          <div className="lobby-column">
            <section className="lobby-section" aria-label="게임 룰 버전 선택">
              <span className="lobby-label">게임 룰</span>
              <div className="variant-grid">
                <button
                  type="button"
                  className="variant-card"
                  data-testid="variant-wallgo1"
                  aria-pressed={config.ruleVariant === 'wallgo1'}
                  onClick={() => onChangeVariant('wallgo1')}
                >
                  <span className="variant-card-head">
                    <span className="variant-card-name">벽바둑</span>
                    <span className="variant-card-sub">시즌 2 · 원작</span>
                  </span>
                  <span className="variant-card-desc">
                    상하좌우 0~2칸 자유 이동(제자리·꺾기) · 3인전 인접 벽 부수기 1회
                  </span>
                </button>
                <button
                  type="button"
                  className="variant-card"
                  data-testid="variant-wallgo2"
                  aria-pressed={config.ruleVariant === 'wallgo2'}
                  onClick={() => onChangeVariant('wallgo2')}
                >
                  <span className="variant-card-head">
                    <span className="variant-card-name">벽바둑 II</span>
                    <span className="variant-card-sub">시즌 3 · 사각/원형</span>
                  </span>
                  <span className="variant-card-desc">
                    사각(직선 1~2) · 원형(1칸·90° 꺾기) · 제자리 불가 · 경로 벽 부수기
                  </span>
                </button>
              </div>
            </section>

            <div className="lobby-inline-row">
              <section className="lobby-section" aria-label="경기 인원 선택">
                <span className="lobby-label">경기 인원</span>
                <div className="segmented-control">
                  <button
                    type="button"
                    className="segmented-btn"
                    data-testid="format-3p"
                    aria-pressed={config.format === '3p'}
                    onClick={() => onChangeFormat('3p')}
                  >
                    3인전
                  </button>
                  <button
                    type="button"
                    className="segmented-btn"
                    data-testid="format-2p"
                    aria-pressed={config.format === '2p'}
                    onClick={() => onChangeFormat('2p')}
                  >
                    2인전
                  </button>
                </div>
              </section>

              <section className="lobby-section" aria-label="턴 제한 시간 선택">
                <span className="lobby-label">턴 제한 시간</span>
                <div className="segmented-control">
                  <button
                    type="button"
                    className="segmented-btn"
                    data-testid="timer-0"
                    aria-pressed={config.timerSeconds === 0}
                    onClick={() => onChangeTimer(0)}
                  >
                    무제한
                  </button>
                  <button
                    type="button"
                    className="segmented-btn"
                    data-testid="timer-90"
                    aria-pressed={config.timerSeconds === 90}
                    onClick={() => onChangeTimer(90)}
                  >
                    90초
                  </button>
                  <button
                    type="button"
                    className="segmented-btn"
                    data-testid="timer-60"
                    aria-pressed={config.timerSeconds === 60}
                    onClick={() => onChangeTimer(60)}
                  >
                    60초
                  </button>
                </div>
              </section>
            </div>

            <div className="shuffle-row">
              <div className="shuffle-text">
                <span className="shuffle-title">시작 순서 랜덤 섞기</span>
                <span className="shuffle-desc">켜면 매 경기 시작 시 좌석 순서를 무작위로 추첨합니다</span>
              </div>
              <button
                type="button"
                className="switch-btn"
                data-testid="shuffle-order-toggle"
                role="switch"
                aria-checked={config.shuffleOrder}
                aria-label="시작 순서 랜덤 섞기"
                onClick={onToggleShuffle}
              >
                <span className="switch-thumb" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Right Column: Player Seat Config */}
          <div className="lobby-column">
            <section className="lobby-section" aria-label="플레이어 설정">
              <span className="lobby-label">
                플레이어 구성 ({config.format === '3p' ? '각자 말 2개 · 벽 부수기 1회' : '각자 말 4개 · 2개 고정 · 벽 부수기 없음'})
              </span>
              <div className="seat-list">
                {visibleSeats.map((seat, idx) => (
                  <div
                    key={idx}
                    className="seat-row"
                    data-testid={`seat-row-${idx}`}
                    data-seat-index={idx}
                    data-player-color={seat.colorToken}
                  >
                    <div className="seat-row-top">
                      <span className="seat-badge">{idx + 1}P</span>
                      <input
                        type="text"
                        className="seat-name-input"
                        data-testid={`seat-name-${idx}`}
                        aria-label={`${idx + 1}P 이름`}
                        value={seat.name}
                        maxLength={12}
                        placeholder={`플레이어 ${idx + 1}`}
                        onChange={(e) => onChangeSeatName(idx, e.target.value)}
                      />
                    </div>
                    <div className="seat-controller-group" role="group" aria-label={`${idx + 1}P 조작 방식`}>
                      {CONTROLLER_OPTIONS.map((opt) => {
                        const pressed = opt.isAI
                          ? seat.isAI && seat.aiDifficulty === opt.difficulty
                          : !seat.isAI;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            className="seat-ctrl-btn"
                            data-testid={`seat-controller-${idx}-${opt.key}`}
                            aria-pressed={pressed}
                            onClick={() => onChangeSeatController(idx, opt.isAI, opt.difficulty)}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <footer className="lobby-footer">
          <p className="lobby-summary">
            {config.ruleVariant === 'wallgo1' ? '벽바둑 (시즌 2)' : '벽바둑 II (시즌 3)'} ·{' '}
            {config.format === '3p' ? '3인전 (종료 후 2라운드 1:1 가능)' : '2인전 1:1'} ·{' '}
            {config.timerSeconds === 0 ? '시간 제한 없음' : `턴당 ${config.timerSeconds}초`}
          </p>
          <button
            type="button"
            className="btn-start-game"
            data-testid="start-game-button"
            onClick={onStart}
          >
            게임 시작
          </button>
        </footer>
      </div>
    </main>
  );
}
