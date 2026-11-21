import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSameWallEdge } from '../engine';
import type { InteractiveWallSlot, ValidMoveOption, WallEdge } from '../engine';
import { LanguageToggle, formatReplayStepDescription, useI18n } from '../i18n';
import type { ReplaySpeed } from '../i18n';
import { ReplayValidationError, buildReplayFrames } from '../shared';
import type { MatchRecord, ReplayFrame } from '../shared';
import { Board } from './Board';
import type { ReplayBoardHighlight } from './Board';
import { MiniBoardPreview } from './MiniBoardPreview';

export interface ReplayViewerProps {
  match: MatchRecord;
  onClose: () => void;
}

const EMPTY_VALID_MOVES: ValidMoveOption[] = [];
const EMPTY_INTERACTIVE_WALLS: InteractiveWallSlot[] = [];
const NOOP_CELL_CLICK = (_row: number, _col: number) => {};
const NOOP_WALL_CLICK = (_edge: WallEdge) => {};

const SPEED_DELAY_MS: Readonly<Record<ReplaySpeed, number>> = {
  0.5: 1800,
  1: 900,
  2: 450,
};

const NEXT_SPEED: Readonly<Record<ReplaySpeed, ReplaySpeed>> = {
  0.5: 1,
  1: 2,
  2: 0.5,
};

type FrameBuildResult =
  | { ok: true; frames: ReplayFrame[] }
  | { ok: false; failedStepIndex: number };

export function ReplayViewer({ match, onClose }: ReplayViewerProps) {
  const { locale, t } = useI18n();
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const moveListRef = useRef<HTMLOListElement | null>(null);

  const buildResult = useMemo<FrameBuildResult>(() => {
    try {
      const frames = buildReplayFrames(match.replay);
      return { ok: true, frames };
    } catch (err) {
      const failedStepIndex = err instanceof ReplayValidationError ? err.stepIndex : 0;
      return { ok: false, failedStepIndex };
    }
  }, [match]);

  // Reset playback state when switching to a different match
  useEffect(() => {
    setStepIndex(0);
    setIsPlaying(false);
  }, [match.id]);

  const frames = buildResult.ok ? buildResult.frames : null;
  const totalSteps = frames ? Math.max(0, frames.length - 1) : 0;
  const clampedStep = Math.min(Math.max(0, stepIndex), totalSteps);
  const currentFrame = frames ? frames[clampedStep] : null;
  const hasFixedPieces = (match.replay?.initialConfig?.format ?? match.format) === '2p';

  // Auto-advance timer & auto-pause at final step
  useEffect(() => {
    if (!isPlaying || !frames) {
      return;
    }
    if (clampedStep >= totalSteps) {
      setIsPlaying(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setStepIndex((prev) => {
        const next = Math.min(prev + 1, totalSteps);
        if (next >= totalSteps) {
          setIsPlaying(false);
        }
        return next;
      });
    }, SPEED_DELAY_MS[speed]);

    return () => window.clearTimeout(timeoutId);
  }, [isPlaying, clampedStep, totalSteps, speed, frames]);

  // Auto-scroll active move item into view inside the move list
  useEffect(() => {
    const listEl = moveListRef.current;
    if (!listEl) {
      return;
    }
    const activeItem = listEl.querySelector<HTMLElement>(
      `[data-step="${clampedStep}"]`,
    );
    activeItem?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [clampedStep]);

  const handleClose = useCallback(() => {
    setIsPlaying(false);
    onClose();
  }, [onClose]);

  const handleFirst = useCallback(() => {
    setIsPlaying(false);
    setStepIndex(0);
  }, []);

  const handlePrev = useCallback(() => {
    setIsPlaying(false);
    setStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNext = useCallback(() => {
    setIsPlaying(false);
    setStepIndex((prev) => Math.min(totalSteps, prev + 1));
  }, [totalSteps]);

  const handleLast = useCallback(() => {
    setIsPlaying(false);
    setStepIndex(totalSteps);
  }, [totalSteps]);

  const handleTogglePlay = useCallback(() => {
    if (totalSteps === 0) {
      return;
    }
    setIsPlaying((prev) => {
      if (prev) {
        return false;
      }
      if (clampedStep >= totalSteps) {
        setStepIndex(0);
      }
      return true;
    });
  }, [clampedStep, totalSteps]);

  const handleCycleSpeed = useCallback(() => {
    setSpeed((prev) => NEXT_SPEED[prev]);
  }, []);

  const handleScrub = useCallback(
    (nextStep: number) => {
      setIsPlaying(false);
      setStepIndex(Math.min(Math.max(0, nextStep), totalSteps));
    },
    [totalSteps],
  );

  // Input-safe keyboard shortcuts (ArrowLeft, ArrowRight, Space, Home, End, Escape)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }
      const target = event.target as HTMLElement | null;
      const isInputTarget =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isInputTarget || !frames) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handlePrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleNext();
      } else if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        handleTogglePlay();
      } else if (event.key === 'Home') {
        event.preventDefault();
        handleFirst();
      } else if (event.key === 'End') {
        event.preventDefault();
        handleLast();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [frames, handleClose, handleFirst, handleLast, handleNext, handlePrev, handleTogglePlay]);

  const replayHighlight = useMemo<ReplayBoardHighlight | null>(() => {
    if (!currentFrame || !currentFrame.step) {
      return null;
    }
    const step = currentFrame.step;
    if (step.kind === 'placement') {
      return {
        origin: null,
        dest: step.pos,
        isStay: false,
        brokenWall: null,
        isResealed: false,
        placedWall: null,
      };
    }
    const isResealed = Boolean(
      step.usedWallBreak &&
        step.brokenWall !== null &&
        isSameWallEdge(step.brokenWall, step.placedWall),
    );
    return {
      origin: step.isStay ? null : step.from,
      dest: step.to,
      isStay: step.isStay,
      brokenWall: step.usedWallBreak ? step.brokenWall : null,
      isResealed,
      placedWall: step.placedWall,
    };
  }, [currentFrame]);

  // Graceful fallback view if replay payload fails deterministic engine validation
  if (!buildResult.ok || !frames || !currentFrame) {
    const failedStep = !buildResult.ok ? buildResult.failedStepIndex : 0;
    return (
      <main
        className="replay-screen"
        data-testid="replay-screen"
        role="main"
        data-match-id={match.id}
        data-step={0}
        data-total-steps={0}
        data-playing="false"
      >
        <div className="replay-shell">
          <header className="replay-header">
            <div className="replay-header-left">
              <button
                type="button"
                className="btn-history-back"
                data-testid="replay-close-button"
                onClick={handleClose}
              >
                ← {t.replay.closeButton}
              </button>
              <div className="replay-title-wrap">
                <h1 className="replay-title">{t.replay.title}</h1>
                <div className="replay-meta-chips">
                  <span className="history-chip history-chip--variant">
                    {t.common.variantShort[match.ruleVariant]}
                  </span>
                  <span className="history-chip history-chip--format">
                    {match.isPrisonMatchRound2
                      ? t.history.round2Badge
                      : t.common.formatShort[match.format]}
                  </span>
                </div>
              </div>
            </div>
            <div className="replay-header-actions">
              <LanguageToggle />
            </div>
          </header>

          <div className="replay-error-banner" role="alert">
            <strong>{t.replay.validationErrorTitle}</strong>
            <p>{t.replay.validationErrorDesc(failedStep)}</p>
          </div>

          <div className="replay-fallback-content">
            <div
              className="replay-board-wrap replay-board-wrap--fallback"
              data-testid="replay-board"
            >
              <MiniBoardPreview
                board={match.finalBoard}
                players={match.players}
                ariaLabel={t.replay.fallbackFinalBoardNotice}
                className="mini-board--large"
              />
            </div>

            <div className="replay-fallback-summary">
              <p className="replay-fallback-label">{t.replay.fallbackFinalBoardNotice}</p>
              <div className="replay-scores" style={{ '--player-count': match.players.length } as React.CSSProperties}>
                {match.players.map((p) => (
                  <div
                    key={p.playerId}
                    className="replay-score-card"
                    data-player-color={p.colorToken}
                  >
                    <div className="replay-score-head">
                      <span className="player-swatch" aria-hidden="true" />
                      <span className="replay-score-name">{p.name}</span>
                    </div>
                    <div className="replay-score-metrics">
                      <span className="replay-score-total">
                        {t.hud.cellsCount(p.totalTerritory)}
                      </span>
                      <span className="replay-score-sub">
                        {t.hud.largestArea(p.largestSingleTerritory)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const playersForDisplay = currentFrame.state.players;
  const scoreByPlayerId = new Map(
    currentFrame.state.territory.scores.map((s) => [s.playerId, s]),
  );

  const currentDescription = formatReplayStepDescription(
    currentFrame.step,
    playersForDisplay,
    locale,
    { hasFixedPieces },
  );

  return (
    <main
      className="replay-screen"
      data-testid="replay-screen"
      role="main"
      data-match-id={match.id}
      data-step={clampedStep}
      data-total-steps={totalSteps}
      data-playing={isPlaying ? 'true' : 'false'}
    >
      <div className="replay-shell">
        <header className="replay-header">
          <div className="replay-header-left">
            <button
              type="button"
              className="btn-history-back"
              data-testid="replay-close-button"
              onClick={handleClose}
            >
              ← {t.replay.closeButton}
            </button>
            <div className="replay-title-wrap">
              <h1 className="replay-title">{t.replay.title}</h1>
              <div className="replay-meta-chips">
                <span className={`history-chip history-chip--${match.mode}`}>
                  {match.mode === 'online'
                    ? t.history.sourceOnline
                    : t.history.sourceLocal}
                </span>
                {match.roomCode && (
                  <span className="history-chip history-chip--code">
                    {t.history.roomCodeLabel(match.roomCode)}
                  </span>
                )}
                <span className="history-chip history-chip--variant">
                  {t.common.variantShort[match.ruleVariant]}
                </span>
                <span className="history-chip history-chip--format">
                  {match.isPrisonMatchRound2
                    ? t.history.round2Badge
                    : t.common.formatShort[match.format]}
                </span>
              </div>
            </div>
          </div>
          <div className="replay-header-actions">
            <LanguageToggle />
          </div>
        </header>

        <div className="replay-main">
          <div className="replay-board-col">
            <div className="replay-board-wrap" data-testid="replay-board">
              <Board
                state={currentFrame.state}
                validMoves={EMPTY_VALID_MOVES}
                interactiveWalls={EMPTY_INTERACTIVE_WALLS}
                pendingBreakTarget={null}
                isInteractive={false}
                isPaused={false}
                replayHighlight={replayHighlight}
                onCellClick={NOOP_CELL_CLICK}
                onWallClick={NOOP_WALL_CLICK}
              />
            </div>

            <section
              className="replay-transport-card"
              aria-label={t.replay.controlsAria}
            >
              <p
                className="replay-step-description"
                data-testid="replay-step-description"
                role="status"
                aria-live="polite"
              >
                {currentDescription}
              </p>

              <div className="replay-scrubber-row">
                <input
                  type="range"
                  className="replay-scrubber"
                  data-testid="replay-scrubber"
                  aria-label={t.replay.scrubberAria}
                  min={0}
                  max={totalSteps}
                  value={clampedStep}
                  disabled={totalSteps === 0}
                  onChange={(e) => handleScrub(Number(e.target.value))}
                />
                <div
                  className="replay-step-indicator"
                  data-testid="replay-step-indicator"
                  data-step={clampedStep}
                  data-total={totalSteps}
                >
                  {t.replay.stepIndicator(clampedStep, totalSteps)}
                </div>
              </div>

              <div className="replay-transport-buttons">
                <button
                  type="button"
                  className="replay-btn"
                  data-testid="replay-first-button"
                  aria-label={t.replay.firstButton}
                  disabled={clampedStep === 0}
                  onClick={handleFirst}
                >
                  ⏮ {t.replay.firstButton}
                </button>
                <button
                  type="button"
                  className="replay-btn"
                  data-testid="replay-prev-button"
                  aria-label={t.replay.prevButton}
                  disabled={clampedStep === 0}
                  onClick={handlePrev}
                >
                  ◀ {t.replay.prevButton}
                </button>
                <button
                  type="button"
                  className="replay-btn replay-btn--play"
                  data-testid="replay-play-pause-button"
                  aria-pressed={isPlaying}
                  disabled={totalSteps === 0}
                  onClick={handleTogglePlay}
                >
                  {isPlaying ? `⏸ ${t.replay.pauseButton}` : `▶ ${t.replay.playButton}`}
                </button>
                <button
                  type="button"
                  className="replay-btn"
                  data-testid="replay-next-button"
                  aria-label={t.replay.nextButton}
                  disabled={clampedStep >= totalSteps}
                  onClick={handleNext}
                >
                  {t.replay.nextButton} ▶
                </button>
                <button
                  type="button"
                  className="replay-btn"
                  data-testid="replay-last-button"
                  aria-label={t.replay.lastButton}
                  disabled={clampedStep >= totalSteps}
                  onClick={handleLast}
                >
                  {t.replay.lastButton} ⏭
                </button>
                <button
                  type="button"
                  className="replay-btn replay-btn--speed"
                  data-testid="replay-speed-button"
                  data-speed={String(speed)}
                  aria-label={t.replay.speedAria(speed)}
                  onClick={handleCycleSpeed}
                >
                  {t.replay.speedLabel(speed)}
                </button>
              </div>
            </section>
          </div>

          <aside className="replay-side-col">
            <section className="replay-scores-card" aria-label={t.replay.playersTitle}>
              <h2 className="replay-side-heading">{t.replay.playersTitle}</h2>
              <div
                className="replay-scores"
                style={{ '--player-count': playersForDisplay.length } as React.CSSProperties}
              >
                {playersForDisplay.map((player) => {
                  const score = scoreByPlayerId.get(player.id);
                  const totalTerritory = score?.totalTerritory ?? 0;
                  const largestSingle = score?.largestSingleTerritory ?? 0;
                  const isActor = currentFrame.step?.playerId === player.id;
                  return (
                    <div
                      key={player.id}
                      className="replay-score-card"
                      data-player-color={player.colorToken}
                      data-active={isActor ? 'true' : 'false'}
                    >
                      <div className="replay-score-head">
                        <span className="player-swatch" aria-hidden="true" />
                        <span className="replay-score-name">{player.name}</span>
                      </div>
                      <div className="replay-score-metrics">
                        <span className="replay-score-total">
                          {t.hud.cellsCount(totalTerritory)}
                        </span>
                        <span className="replay-score-sub">
                          {t.hud.largestArea(largestSingle)}
                        </span>
                        {currentFrame.state.format === '3p' && (
                          <span
                            className="replay-wallbreak-tag"
                            data-remaining={player.wallBreaksRemaining}
                          >
                            {player.wallBreaksRemaining > 0
                              ? t.hud.wallBreakAvailable
                              : t.hud.wallBreakUsed}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="replay-moves-card" aria-label={t.replay.moveListTitle}>
              <div className="replay-moves-header">
                <h2 className="replay-side-heading">{t.replay.moveListTitle}</h2>
                <span className="replay-keyboard-hint">{t.replay.keyboardHint}</span>
              </div>
              <ol
                ref={moveListRef}
                className="replay-move-list"
                data-testid="replay-move-list"
                data-move-count={frames.length}
              >
                {frames.map((frame) => {
                  const n = frame.stepIndex;
                  const isActive = n === clampedStep;
                  const stepText =
                    frame.step === null
                      ? t.replay.moveListInitial
                      : `${n}. ${formatReplayStepDescription(
                          frame.step,
                          frame.state.players,
                          locale,
                          { hasFixedPieces },
                        )}`;
                  const actorColor =
                    frame.step !== null
                      ? frame.state.players.find((p) => p.id === frame.step?.playerId)
                          ?.colorToken
                      : undefined;

                  return (
                    <li key={n} className="replay-move-li">
                      <button
                        type="button"
                        className="replay-move-item"
                        data-testid={`replay-move-item-${n}`}
                        data-step={n}
                        data-player-color={actorColor}
                        aria-current={isActive ? 'step' : 'false'}
                        onClick={() => handleScrub(n)}
                      >
                        {actorColor && (
                          <span className="replay-move-dot" aria-hidden="true" />
                        )}
                        <span className="replay-move-text">{stepText}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
