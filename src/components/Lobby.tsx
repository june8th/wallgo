import type { ReactNode } from 'react';
import type {
  AIDifficulty,
  GameFormat,
  LobbyConfig,
  PlayerConfig,
  RuleVariant,
  TimerSeconds,
} from '../engine';
import { LanguageToggle, useI18n } from '../i18n';
import { NICKNAME_MAX_LENGTH } from '../shared';

export type LobbyModeTab = 'local' | 'online';

export interface LobbyProps {
  config: LobbyConfig;
  allSeats: PlayerConfig[];
  activeTab?: LobbyModeTab;
  onTabChange?: (tab: LobbyModeTab) => void;
  onOpenHistory?: () => void;
  onlinePanelSlot?: ReactNode;
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
  isAI: boolean;
  difficulty: AIDifficulty;
}[] = [
  { key: 'human', isAI: false, difficulty: 'normal' },
  { key: 'ai-easy', isAI: true, difficulty: 'easy' },
  { key: 'ai-normal', isAI: true, difficulty: 'normal' },
  { key: 'ai-hard', isAI: true, difficulty: 'hard' },
];

export function Lobby({
  config,
  allSeats,
  activeTab = 'local',
  onTabChange,
  onOpenHistory,
  onlinePanelSlot,
  onChangeVariant,
  onChangeFormat,
  onChangeTimer,
  onToggleShuffle,
  onChangeSeatName,
  onChangeSeatController,
  onOpenRules,
  onStart,
}: LobbyProps) {
  const { t } = useI18n();
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
                {t.lobby.title}
              </h1>
              <p className="lobby-tagline">{t.lobby.tagline}</p>
            </div>
          </div>
          <div className="lobby-header-actions">
            <LanguageToggle />
            <button
              type="button"
              className="btn-lobby-rules"
              data-testid="rules-button"
              aria-label={t.lobby.rulesButtonAria}
              onClick={onOpenRules}
            >
              {t.lobby.rulesButton}
            </button>
          </div>
        </header>

        <nav className="lobby-nav" aria-label={t.nav.ariaLabel}>
          <div className="lobby-nav-tabs" role="tablist" aria-label={t.nav.ariaLabel}>
            <button
              type="button"
              role="tab"
              className="lobby-nav-tab"
              data-testid="nav-local-tab"
              aria-selected={activeTab === 'local'}
              onClick={() => onTabChange?.('local')}
            >
              {t.nav.localTab}
            </button>
            <button
              type="button"
              role="tab"
              className="lobby-nav-tab"
              data-testid="nav-online-tab"
              aria-selected={activeTab === 'online'}
              onClick={() => onTabChange?.('online')}
            >
              {t.nav.onlineTab}
            </button>
          </div>
          <button
            type="button"
            className="lobby-nav-history"
            data-testid="nav-history-tab"
            aria-label={t.nav.historyAria}
            onClick={() => onOpenHistory?.()}
          >
            {t.nav.historyTab}
          </button>
        </nav>

        {activeTab === 'local' ? (
          <>
            <div className="lobby-content">
              {/* Left Column: Variant, Format, Timer, Shuffle */}
              <div className="lobby-column">
                <section className="lobby-section" aria-label={t.lobby.ruleSectionAria}>
                  <span className="lobby-label">{t.lobby.ruleLabel}</span>
                  <div className="variant-grid">
                    <button
                      type="button"
                      className="variant-card"
                      data-testid="variant-wallgo1"
                      aria-pressed={config.ruleVariant === 'wallgo1'}
                      onClick={() => onChangeVariant('wallgo1')}
                    >
                      <span className="variant-card-head">
                        <span className="variant-card-name">{t.lobby.wg1Name}</span>
                        <span className="variant-card-sub">{t.lobby.wg1Sub}</span>
                      </span>
                      <span className="variant-card-desc">{t.lobby.wg1Desc}</span>
                    </button>
                    <button
                      type="button"
                      className="variant-card"
                      data-testid="variant-wallgo2"
                      aria-pressed={config.ruleVariant === 'wallgo2'}
                      onClick={() => onChangeVariant('wallgo2')}
                    >
                      <span className="variant-card-head">
                        <span className="variant-card-name">{t.lobby.wg2Name}</span>
                        <span className="variant-card-sub">{t.lobby.wg2Sub}</span>
                      </span>
                      <span className="variant-card-desc">{t.lobby.wg2Desc}</span>
                    </button>
                  </div>
                </section>

                <div className="lobby-inline-row">
                  <section className="lobby-section" aria-label={t.lobby.formatSectionAria}>
                    <span className="lobby-label">{t.lobby.formatLabel}</span>
                    <div className="segmented-control">
                      <button
                        type="button"
                        className="segmented-btn"
                        data-testid="format-3p"
                        aria-pressed={config.format === '3p'}
                        onClick={() => onChangeFormat('3p')}
                      >
                        {t.lobby.format3p}
                      </button>
                      <button
                        type="button"
                        className="segmented-btn"
                        data-testid="format-2p"
                        aria-pressed={config.format === '2p'}
                        onClick={() => onChangeFormat('2p')}
                      >
                        {t.lobby.format2p}
                      </button>
                    </div>
                  </section>

                  <section className="lobby-section" aria-label={t.lobby.timerSectionAria}>
                    <span className="lobby-label">{t.lobby.timerLabel}</span>
                    <div className="segmented-control">
                      <button
                        type="button"
                        className="segmented-btn"
                        data-testid="timer-0"
                        aria-pressed={config.timerSeconds === 0}
                        onClick={() => onChangeTimer(0)}
                      >
                        {t.lobby.timerUnlimited}
                      </button>
                      <button
                        type="button"
                        className="segmented-btn"
                        data-testid="timer-90"
                        aria-pressed={config.timerSeconds === 90}
                        onClick={() => onChangeTimer(90)}
                      >
                        {t.lobby.timerSeconds(90)}
                      </button>
                      <button
                        type="button"
                        className="segmented-btn"
                        data-testid="timer-60"
                        aria-pressed={config.timerSeconds === 60}
                        onClick={() => onChangeTimer(60)}
                      >
                        {t.lobby.timerSeconds(60)}
                      </button>
                    </div>
                  </section>
                </div>

                <div className="shuffle-row">
                  <div className="shuffle-text">
                    <span className="shuffle-title">{t.lobby.shuffleTitle}</span>
                    <span className="shuffle-desc">{t.lobby.shuffleDesc}</span>
                  </div>
                  <button
                    type="button"
                    className="switch-btn"
                    data-testid="shuffle-order-toggle"
                    role="switch"
                    aria-checked={config.shuffleOrder}
                    aria-label={t.lobby.shuffleAria}
                    onClick={onToggleShuffle}
                  >
                    <span className="switch-thumb" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Right Column: Player Seat Config */}
              <div className="lobby-column">
                <section className="lobby-section" aria-label={t.lobby.seatsSectionAria}>
                  <span className="lobby-label">
                    {config.format === '3p' ? t.lobby.seatsLabel3p : t.lobby.seatsLabel2p}
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
                            aria-label={t.lobby.seatNameAria(idx + 1)}
                            value={seat.name}
                            maxLength={NICKNAME_MAX_LENGTH}
                            placeholder={t.lobby.seatNamePlaceholder(idx + 1)}
                            onChange={(e) => onChangeSeatName(idx, e.target.value)}
                          />
                        </div>
                        <div
                          className="seat-controller-group"
                          role="group"
                          aria-label={t.lobby.seatControllerAria(idx + 1)}
                        >
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
                                onClick={() =>
                                  onChangeSeatController(idx, opt.isAI, opt.difficulty)
                                }
                              >
                                {t.lobby.controllers[opt.key]}
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
                {t.lobby.footerSummary(
                  config.ruleVariant,
                  config.format,
                  config.timerSeconds,
                )}
              </p>
              <button
                type="button"
                className="btn-start-game"
                data-testid="start-game-button"
                onClick={onStart}
              >
                {t.lobby.startGame}
              </button>
            </footer>
          </>
        ) : (
          onlinePanelSlot ?? (
            <section
              className="online-panel online-panel--placeholder"
              data-testid="online-panel"
              data-redis-configured="checking"
            >
              <div className="online-card">
                <h2 className="online-card-title">{t.online.panelTitle}</h2>
                <p className="online-card-subtitle">{t.online.comingSoonFallback}</p>
              </div>
            </section>
          )
        )}
      </div>
    </main>
  );
}
