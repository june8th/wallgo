import type { FormEvent } from 'react';
import type { GameFormat, RuleVariant, TimerSeconds } from '../engine';
import { useI18n } from '../i18n';
import { NICKNAME_MAX_LENGTH, ROOM_CODE_LENGTH } from '../shared';
import type { OnlineRoomConfig } from '../shared';

export type RedisConfiguredState = 'checking' | 'true' | 'false';

export interface OnlinePanelProps {
  redisConfigured: RedisConfiguredState;
  nickname: string;
  config: OnlineRoomConfig;
  joinCode: string;
  submitting: boolean;
  errorMessage: string | null;
  onChangeNickname: (value: string) => void;
  onChangeVariant: (variant: RuleVariant) => void;
  onChangeFormat: (format: GameFormat) => void;
  onChangeTimer: (timerSeconds: TimerSeconds) => void;
  onToggleShuffle: () => void;
  onChangeJoinCode: (value: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
}

export function OnlinePanel({
  redisConfigured,
  nickname,
  config,
  joinCode,
  submitting,
  errorMessage,
  onChangeNickname,
  onChangeVariant,
  onChangeFormat,
  onChangeTimer,
  onToggleShuffle,
  onChangeJoinCode,
  onCreateRoom,
  onJoinRoom,
}: OnlinePanelProps) {
  const { t } = useI18n();
  const onlineReady = redisConfigured === 'true';

  const handleJoinSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!onlineReady || submitting || joinCode.trim().length === 0) {
      return;
    }
    onJoinRoom();
  };

  return (
    <section
      className="online-panel"
      data-testid="online-panel"
      data-redis-configured={redisConfigured}
      aria-label={t.online.panelTitle}
    >
      {redisConfigured === 'false' && (
        <div
          className="redis-unconfigured-notice"
          data-testid="redis-unconfigured-notice"
          role="status"
        >
          <strong>{t.online.redisUnconfiguredTitle}</strong>
          <p className="online-card-subtitle">{t.online.redisUnconfiguredDesc}</p>
          <ol>
            {t.online.redisUnconfiguredSteps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
          <p className="online-card-subtitle">{t.online.redisUnconfiguredLocalNote}</p>
        </div>
      )}

      {errorMessage && (
        <div
          className="online-error-message"
          data-testid="online-error-message"
          role="alert"
        >
          {errorMessage}
        </div>
      )}

      <div className="online-card">
        <div className="online-nickname-row">
          <label htmlFor="online-nickname-input" className="online-field-label">
            {t.online.nicknameLabel}
          </label>
          <input
            id="online-nickname-input"
            type="text"
            className="online-text-input"
            data-testid="nickname-input"
            maxLength={NICKNAME_MAX_LENGTH}
            value={nickname}
            placeholder={t.online.nicknamePlaceholder}
            onChange={(e) => onChangeNickname(e.target.value)}
          />
        </div>
        <p className="online-card-subtitle">{t.online.nicknameHint}</p>
      </div>

      <div className="online-panel-grid">
        {/* Left Card: Create New Room */}
        <div className="online-card">
          <h2 className="online-card-title">{t.online.createTitle}</h2>

          <section className="lobby-section" aria-label={t.lobby.ruleSectionAria}>
            <span className="lobby-label">{t.lobby.ruleLabel}</span>
            <div className="variant-grid">
              <button
                type="button"
                className="variant-card"
                data-testid="online-variant-wallgo1"
                aria-pressed={config.ruleVariant === 'wallgo1'}
                onClick={() => onChangeVariant('wallgo1')}
              >
                <span className="variant-card-head">
                  <span className="variant-card-name">{t.lobby.wg1Name}</span>
                  <span className="variant-card-sub">{t.lobby.wg1Sub}</span>
                </span>
              </button>
              <button
                type="button"
                className="variant-card"
                data-testid="online-variant-wallgo2"
                aria-pressed={config.ruleVariant === 'wallgo2'}
                onClick={() => onChangeVariant('wallgo2')}
              >
                <span className="variant-card-head">
                  <span className="variant-card-name">{t.lobby.wg2Name}</span>
                  <span className="variant-card-sub">{t.lobby.wg2Sub}</span>
                </span>
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
                  data-testid="online-format-3p"
                  aria-pressed={config.format === '3p'}
                  onClick={() => onChangeFormat('3p')}
                >
                  {t.lobby.format3p}
                </button>
                <button
                  type="button"
                  className="segmented-btn"
                  data-testid="online-format-2p"
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
                  data-testid="online-timer-0"
                  aria-pressed={config.timerSeconds === 0}
                  onClick={() => onChangeTimer(0)}
                >
                  {t.lobby.timerUnlimited}
                </button>
                <button
                  type="button"
                  className="segmented-btn"
                  data-testid="online-timer-90"
                  aria-pressed={config.timerSeconds === 90}
                  onClick={() => onChangeTimer(90)}
                >
                  {t.lobby.timerSeconds(90)}
                </button>
                <button
                  type="button"
                  className="segmented-btn"
                  data-testid="online-timer-60"
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
              data-testid="online-shuffle-toggle"
              role="switch"
              aria-checked={config.shuffleOrder}
              aria-label={t.lobby.shuffleAria}
              onClick={onToggleShuffle}
            >
              <span className="switch-thumb" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            className="btn-online-primary"
            data-testid="create-room-button"
            disabled={!onlineReady || submitting}
            onClick={onCreateRoom}
          >
            {redisConfigured === 'checking'
              ? t.online.checkingStatus
              : submitting
                ? t.online.creatingButton
                : t.online.createButton}
          </button>
        </div>

        {/* Right Card: Join by Room Code */}
        <form className="online-card" onSubmit={handleJoinSubmit}>
          <h2 className="online-card-title">{t.online.joinTitle}</h2>
          <p className="online-card-subtitle">{t.online.panelSubtitle}</p>

          <label htmlFor="join-room-code-input" className="online-field-label">
            {t.online.joinCodeLabel}
          </label>
          <input
            id="join-room-code-input"
            type="text"
            className="room-code-input"
            data-testid="join-room-code-input"
            maxLength={ROOM_CODE_LENGTH}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={t.online.joinCodePlaceholder}
            value={joinCode}
            onChange={(e) =>
              onChangeJoinCode(
                e.target.value.replace(/[\s-]+/g, '').toUpperCase().slice(0, ROOM_CODE_LENGTH),
              )
            }
          />

          <button
            type="submit"
            className="btn-online-primary"
            data-testid="join-room-button"
            disabled={!onlineReady || submitting || joinCode.trim().length === 0}
          >
            {submitting ? t.online.joiningButton : t.online.joinButton}
          </button>
        </form>
      </div>
    </section>
  );
}
