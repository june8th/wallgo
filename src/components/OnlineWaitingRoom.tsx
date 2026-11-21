import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { AIDifficulty, GameFormat, RuleVariant, TimerSeconds } from '../engine';
import { LanguageToggle, useI18n } from '../i18n';
import { NICKNAME_MAX_LENGTH } from '../shared';
import type { OnlineRoomConfig, PublicRoomSnapshot } from '../shared';
import type { OnlineConnectionStatus } from '../api';

export interface OnlineWaitingRoomProps {
  room: PublicRoomSnapshot;
  connectionStatus: OnlineConnectionStatus;
  submitting: boolean;
  errorMessage: string | null;
  codeCopied: boolean;
  inviteCopied: boolean;
  onCopyCode: () => void;
  onCopyInviteLink: () => void;
  onUpdateNickname: (nickname: string) => void;
  onUpdateConfig: (patch: Partial<OnlineRoomConfig>) => void;
  onSetSeat: (seatIndex: number, kind: 'open' | 'ai', aiDifficulty?: AIDifficulty) => void;
  onKickSeat: (seatIndex: number) => void;
  onStartGame: () => void;
  onClaimHost: () => void;
  onLeaveRoom: () => void;
  onOpenRules: () => void;
}

function getCurrentViewerNickname(room: PublicRoomSnapshot): string {
  if (room.viewer.role === 'player' && room.viewer.seatIndex !== null) {
    return room.seats[room.viewer.seatIndex]?.nickname ?? '';
  }
  if (room.viewer.role === 'spectator' && room.viewer.memberId) {
    return (
      room.spectators.find((s) => s.memberId === room.viewer.memberId)?.nickname ?? ''
    );
  }
  return '';
}

export function OnlineWaitingRoom({
  room,
  connectionStatus,
  submitting,
  errorMessage,
  codeCopied,
  inviteCopied,
  onCopyCode,
  onCopyInviteLink,
  onUpdateNickname,
  onUpdateConfig,
  onSetSeat,
  onKickSeat,
  onStartGame,
  onClaimHost,
  onLeaveRoom,
  onOpenRules,
}: OnlineWaitingRoomProps) {
  const { t } = useI18n();
  const isHost = room.viewer.isHost;
  const mySeatAttr =
    room.viewer.role === 'player' && room.viewer.seatIndex !== null
      ? String(room.viewer.seatIndex)
      : 'spectator';

  const serverNickname = getCurrentViewerNickname(room);
  const [nicknameDraft, setNicknameDraft] = useState<string>(serverNickname);

  useEffect(() => {
    setNicknameDraft(serverNickname);
  }, [serverNickname]);

  const allSeatsFilled = room.seats.every((s) => s.kind !== 'open');
  const hasHuman = room.seats.some((s) => s.kind === 'human');
  const canStart = isHost && allSeatsFilled && hasHuman && !submitting;

  const commitNicknameIfChanged = () => {
    const trimmed = nicknameDraft.trim();
    if (trimmed === serverNickname.trim()) {
      return;
    }
    onUpdateNickname(nicknameDraft);
  };

  const handleNicknameSubmit = (e: FormEvent) => {
    e.preventDefault();
    commitNicknameIfChanged();
  };

  const handleRoleChange = (seatIndex: number, value: string) => {
    if (value === 'open') {
      onSetSeat(seatIndex, 'open');
    } else if (value === 'ai-easy') {
      onSetSeat(seatIndex, 'ai', 'easy');
    } else if (value === 'ai-normal') {
      onSetSeat(seatIndex, 'ai', 'normal');
    } else if (value === 'ai-hard') {
      onSetSeat(seatIndex, 'ai', 'hard');
    }
  };

  return (
    <main
      className="online-room-screen"
      data-testid="online-room-screen"
      role="main"
      data-room-code={room.code}
      data-is-host={isHost ? 'true' : 'false'}
      data-my-seat={mySeatAttr}
      data-room-status={room.status}
    >
      <div className="online-room-shell">
        <header className="lobby-header">
          <div className="lobby-brand">
            <div className="lobby-title-wrap">
              <h1 className="lobby-title">{t.online.waitingTitle}</h1>
              <p className="lobby-tagline">
                {t.common.variantShort[room.config.ruleVariant]} ·{' '}
                {t.common.formatShort[room.config.format]}
              </p>
            </div>
          </div>
          <div className="lobby-header-actions">
            <span
              className="online-connection-badge"
              data-testid="online-connection-badge"
              data-status={connectionStatus}
            >
              {t.online.connectionStatus[connectionStatus]}
            </span>
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

        {errorMessage && (
          <div
            className="online-error-message"
            data-testid="online-error-message"
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        <div className="invite-bar">
          <div className="invite-code-group">
            <span className="online-field-label">{t.online.roomCodeLabel}</span>
            <span
              className="room-code-display"
              data-testid="room-code-display"
              data-room-code={room.code}
            >
              {room.code}
            </span>
          </div>
          <div className="invite-actions">
            <button
              type="button"
              className="btn-online-secondary"
              data-testid="copy-room-code-button"
              data-copied={codeCopied ? 'true' : 'false'}
              onClick={onCopyCode}
            >
              {codeCopied ? t.online.copiedLabel : t.online.copyCodeButton}
            </button>
            <button
              type="button"
              className="btn-online-secondary"
              data-testid="copy-invite-link-button"
              data-copied={inviteCopied ? 'true' : 'false'}
              onClick={onCopyInviteLink}
            >
              {inviteCopied ? t.online.copiedLabel : t.online.copyLinkButton}
            </button>
          </div>
        </div>

        <form className="online-nickname-row" onSubmit={handleNicknameSubmit}>
          <label htmlFor="room-nickname-input" className="online-field-label">
            {t.online.editNicknameLabel}
          </label>
          <input
            id="room-nickname-input"
            type="text"
            className="online-text-input"
            data-testid="room-nickname-input"
            maxLength={NICKNAME_MAX_LENGTH}
            value={nicknameDraft}
            placeholder={t.online.nicknamePlaceholder}
            onChange={(e) => setNicknameDraft(e.target.value)}
            onBlur={commitNicknameIfChanged}
          />
          <button
            type="submit"
            className="btn-online-secondary"
            disabled={submitting || nicknameDraft.trim() === serverNickname.trim()}
          >
            {t.online.saveNicknameButton}
          </button>
        </form>

        <div className="online-room-body">
          {/* Left Column: Host Room Config */}
          <div className="online-card">
            <h2 className="online-card-title">{t.online.configTitle}</h2>

            <section className="lobby-section" aria-label={t.lobby.ruleSectionAria}>
              <span className="lobby-label">{t.lobby.ruleLabel}</span>
              <div className="variant-grid">
                {(['wallgo1', 'wallgo2'] as const satisfies readonly RuleVariant[]).map(
                  (variant) => (
                    <button
                      key={variant}
                      type="button"
                      className="variant-card"
                      data-testid={`room-variant-${variant}`}
                      aria-pressed={room.config.ruleVariant === variant}
                      disabled={!isHost || submitting}
                      onClick={() => onUpdateConfig({ ruleVariant: variant })}
                    >
                      <span className="variant-card-head">
                        <span className="variant-card-name">
                          {variant === 'wallgo1' ? t.lobby.wg1Name : t.lobby.wg2Name}
                        </span>
                        <span className="variant-card-sub">
                          {variant === 'wallgo1' ? t.lobby.wg1Sub : t.lobby.wg2Sub}
                        </span>
                      </span>
                    </button>
                  ),
                )}
              </div>
            </section>

            <div className="lobby-inline-row">
              <section className="lobby-section" aria-label={t.lobby.formatSectionAria}>
                <span className="lobby-label">{t.lobby.formatLabel}</span>
                <div className="segmented-control">
                  {(['3p', '2p'] as const satisfies readonly GameFormat[]).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      className="segmented-btn"
                      data-testid={`room-format-${fmt}`}
                      aria-pressed={room.config.format === fmt}
                      disabled={!isHost || submitting}
                      onClick={() => onUpdateConfig({ format: fmt })}
                    >
                      {fmt === '3p' ? t.lobby.format3p : t.lobby.format2p}
                    </button>
                  ))}
                </div>
              </section>

              <section className="lobby-section" aria-label={t.lobby.timerSectionAria}>
                <span className="lobby-label">{t.lobby.timerLabel}</span>
                <div className="segmented-control">
                  {([0, 90, 60] as const satisfies readonly TimerSeconds[]).map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      className="segmented-btn"
                      data-testid={`room-timer-${sec}`}
                      aria-pressed={room.config.timerSeconds === sec}
                      disabled={!isHost || submitting}
                      onClick={() => onUpdateConfig({ timerSeconds: sec })}
                    >
                      {sec === 0 ? t.lobby.timerUnlimited : t.lobby.timerSeconds(sec)}
                    </button>
                  ))}
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
                data-testid="room-shuffle-toggle"
                role="switch"
                aria-checked={room.config.shuffleOrder}
                aria-label={t.lobby.shuffleAria}
                disabled={!isHost || submitting}
                onClick={() =>
                  onUpdateConfig({ shuffleOrder: !room.config.shuffleOrder })
                }
              >
                <span className="switch-thumb" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Right Column: Seats & Spectators */}
          <div className="online-card">
            <h2 className="online-card-title">{t.online.seatsTitle}</h2>

            <div className="room-seat-list">
              {room.seats.map((seat) => {
                const isMe =
                  room.viewer.role === 'player' &&
                  room.viewer.seatIndex === seat.seatIndex;
                const connected =
                  seat.kind === 'ai'
                    ? true
                    : seat.kind === 'human' && seat.connectionStatus === 'connected';
                const seatRoleValue =
                  seat.kind === 'ai' ? `ai-${seat.aiDifficulty}` : 'open';

                return (
                  <div
                    key={seat.seatIndex}
                    className="room-seat-row"
                    data-testid={`room-seat-${seat.seatIndex}`}
                    data-seat-index={seat.seatIndex}
                    data-seat-type={seat.kind}
                    data-is-me={isMe ? 'true' : 'false'}
                    data-is-host={seat.isHost ? 'true' : 'false'}
                    data-connected={connected ? 'true' : 'false'}
                    data-player-color={seat.colorToken}
                  >
                    <div className="room-seat-head">
                      <div className="room-seat-identity">
                        <span className="seat-badge">{seat.seatIndex + 1}P</span>
                        <span className="room-seat-name">
                          {seat.kind === 'open' ? t.online.seatOpen : seat.nickname}
                        </span>
                      </div>

                      <div className="player-tags">
                        {seat.isHost && (
                          <span className="player-pill player-pill--sealed">
                            {t.online.hostBadge}
                          </span>
                        )}
                        {isMe && (
                          <span className="player-pill">{t.online.meBadge}</span>
                        )}
                        {seat.kind === 'ai' && (
                          <span className="player-pill player-pill--ai">
                            {t.common.aiDifficulty[seat.aiDifficulty]}
                          </span>
                        )}
                        {seat.kind === 'human' && (
                          <span
                            className="player-pill online-seat-status"
                            data-status={connected ? 'online' : 'offline'}
                          >
                            {
                              t.online.seatStatus[
                                connected ? 'online' : 'offline'
                              ]
                            }
                          </span>
                        )}
                      </div>
                    </div>

                    {isHost && !seat.isHost && (
                      <div className="room-seat-controls">
                        {seat.kind === 'human' ? (
                          <button
                            type="button"
                            className="btn-room-kick"
                            data-testid={`room-seat-kick-${seat.seatIndex}`}
                            aria-label={t.online.kickAria(seat.nickname)}
                            disabled={submitting}
                            onClick={() => onKickSeat(seat.seatIndex)}
                          >
                            {t.online.kickButton}
                          </button>
                        ) : (
                          <select
                            className="room-seat-role-select"
                            data-testid={`room-seat-role-${seat.seatIndex}`}
                            aria-label={t.online.seatRoleAria(seat.seatIndex + 1)}
                            value={seatRoleValue}
                            disabled={submitting}
                            onChange={(e) =>
                              handleRoleChange(seat.seatIndex, e.target.value)
                            }
                          >
                            <option value="open">{t.online.seatRoleOpen}</option>
                            <option value="ai-easy">
                              {t.lobby.controllers['ai-easy']}
                            </option>
                            <option value="ai-normal">
                              {t.lobby.controllers['ai-normal']}
                            </option>
                            <option value="ai-hard">
                              {t.lobby.controllers['ai-hard']}
                            </option>
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="lobby-section">
              <span className="lobby-label">
                {t.online.spectatorsTitle(room.spectators.length)}
              </span>
              <div
                className="room-spectator-list"
                data-testid="room-spectator-list"
                data-spectator-count={room.spectators.length}
              >
                {room.spectators.length === 0 ? (
                  <span className="online-card-subtitle">
                    {t.online.spectatorsEmpty}
                  </span>
                ) : (
                  room.spectators.map((spec) => (
                    <span key={spec.memberId} className="room-spectator-chip">
                      <span>{spec.nickname}</span>
                      <span>· {t.online.spectatorRoleLabels[spec.role]}</span>
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <footer className="online-room-footer">
          <div className="invite-actions">
            <button
              type="button"
              className="btn-online-secondary"
              data-testid="room-leave-button"
              onClick={onLeaveRoom}
            >
              {t.online.leaveRoomButton}
            </button>
            {room.canClaimHost && !isHost && (
              <button
                type="button"
                className="btn-online-secondary"
                data-testid="room-claim-host-button"
                disabled={submitting}
                onClick={onClaimHost}
              >
                {t.online.claimHostButton}
              </button>
            )}
          </div>

          <div className="invite-actions">
            {isHost ? (
              <>
                {!allSeatsFilled && (
                  <span className="online-card-subtitle">
                    {t.online.seatsNotReadyHint}
                  </span>
                )}
                <button
                  type="button"
                  className="btn-start-game"
                  data-testid="room-start-game-button"
                  disabled={!canStart}
                  onClick={onStartGame}
                >
                  {t.online.startGameButton}
                </button>
              </>
            ) : (
              <span className="online-card-subtitle" role="status">
                {t.online.waitingForHostHint}
              </span>
            )}
          </div>
        </footer>
      </div>
    </main>
  );
}
