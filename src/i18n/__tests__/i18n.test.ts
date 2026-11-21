import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialGameState } from '../../engine';
import type { ActionEvent, GameState } from '../../engine';
import {
  I18nProvider,
  detectInitialLocale,
  enMessages,
  formatActionEvent,
  formatAutoSkipToast,
  formatReplayStepDescription,
  formatTimeoutToast,
  koMessages,
  resolveLocale,
  saveLocale,
} from '../index';
import { Lobby } from '../../components/Lobby';
import { MatchHistoryView } from '../../components/MatchHistoryView';
import { MiniBoardPreview } from '../../components/MiniBoardPreview';
import { ReplayViewer } from '../../components/ReplayViewer';
import { RulesModal } from '../../components/RulesModal';
import { STORAGE_KEY_LOCALE, createReplayInitialConfig } from '../../shared';
import type { MatchRecord } from '../../shared';

const HANGUL_REGEX = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/;

function createMockStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function assertDeepMessageParity(
  koVal: unknown,
  enVal: unknown,
  path: string,
): void {
  if (typeof koVal === 'string') {
    expect(typeof enVal, `${path} type mismatch`).toBe('string');
    expect(koVal.trim().length, `${path} KO empty`).toBeGreaterThan(0);
    expect((enVal as string).trim().length, `${path} EN empty`).toBeGreaterThan(0);
    expect(HANGUL_REGEX.test(enVal as string), `${path} EN contains Hangul: ${String(enVal)}`).toBe(
      false,
    );
    return;
  }

  if (typeof koVal === 'function') {
    expect(typeof enVal, `${path} function type mismatch`).toBe('function');
    expect((enVal as (...args: unknown[]) => unknown).length, `${path} function arity mismatch`).toBe(
      koVal.length,
    );
    return;
  }

  if (Array.isArray(koVal)) {
    expect(Array.isArray(enVal), `${path} array mismatch`).toBe(true);
    expect((enVal as unknown[]).length, `${path} array length mismatch`).toBe(koVal.length);
    for (let i = 0; i < koVal.length; i++) {
      assertDeepMessageParity(koVal[i], (enVal as unknown[])[i], `${path}[${i}]`);
    }
    return;
  }

  if (koVal && typeof koVal === 'object') {
    expect(enVal && typeof enVal === 'object', `${path} object mismatch`).toBe(true);
    const koKeys = Object.keys(koVal as Record<string, unknown>).sort();
    const enKeys = Object.keys(enVal as Record<string, unknown>).sort();
    expect(enKeys, `${path} keys mismatch`).toEqual(koKeys);
    for (const k of koKeys) {
      assertDeepMessageParity(
        (koVal as Record<string, unknown>)[k],
        (enVal as Record<string, unknown>)[k],
        `${path}.${k}`,
      );
    }
    return;
  }

  expect(enVal, `${path} primitive mismatch`).toBe(koVal);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('i18n locale detection & SSR safety', () => {
  it('returns "ko" in Node 24 SSR where typeof window === "undefined" (Landmine #1)', () => {
    expect(typeof window).toBe('undefined');
    expect(detectInitialLocale()).toBe('ko');
  });

  it('resolves saved overrides and browser language tags accurately', () => {
    // Explicit saved overrides always win
    expect(resolveLocale({ savedLocale: 'ko', languages: ['en-US'] })).toBe('ko');
    expect(resolveLocale({ savedLocale: 'en', languages: ['ko-KR'] })).toBe('en');

    // Invalid saved values fall through to browser languages
    expect(resolveLocale({ savedLocale: 'fr', languages: ['ko-KR'] })).toBe('ko');
    expect(resolveLocale({ savedLocale: '', languages: ['en-US'] })).toBe('en');

    // Browser tag detection
    expect(resolveLocale({ languages: ['ko-KR', 'en-US'] })).toBe('ko');
    expect(resolveLocale({ languages: ['ko'] })).toBe('ko');
    expect(resolveLocale({ languages: ['KO_kr'] })).toBe('ko');
    expect(resolveLocale({ languages: ['en-US', 'ko-KR'] })).toBe('en');
    expect(resolveLocale({ languages: ['ja-JP'] })).toBe('en');
    expect(resolveLocale({ languages: ['kok-IN'] })).toBe('en');
    expect(resolveLocale({ languages: [], language: 'ko-KR' })).toBe('ko');
    expect(resolveLocale({ languages: [], language: '' })).toBe('en');
    expect(resolveLocale({})).toBe('en');
  });

  it('auto-detects browser locale and persists via wallgo.locale safely', () => {
    const storage = createMockStorage();
    vi.stubGlobal('window', {
      localStorage: storage,
      navigator: { languages: ['en-US'], language: 'en-US' },
    });

    expect(detectInitialLocale()).toBe('en');
    saveLocale('ko');
    expect(storage.getItem(STORAGE_KEY_LOCALE)).toBe('ko');
    expect(detectInitialLocale()).toBe('ko');
  });

  it('survives Safari Private Mode SecurityError on localStorage access', () => {
    const throwingStorage = {
      getItem: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    };
    vi.stubGlobal('window', {
      localStorage: throwingStorage,
      navigator: { languages: ['ko-KR'], language: 'ko-KR' },
    });

    expect(() => detectInitialLocale()).not.toThrow();
    expect(detectInitialLocale()).toBe('ko');
    expect(() => saveLocale('en')).not.toThrow();
  });
});

describe('i18n message dictionary parity & v1 KO verbatim preservation', () => {
  it('enforces 1:1 recursive key parity, non-empty strings, and zero Hangul in EN', () => {
    assertDeepMessageParity(koMessages, enMessages, 'messages');
    expect(koMessages.rules.wg1Items).toHaveLength(5);
    expect(koMessages.rules.wg2Items).toHaveLength(3);
    expect(koMessages.rules.scoringItems).toHaveLength(5);
    expect(Object.keys(koMessages.online.errors)).toHaveLength(21);
  });

  it('preserves all critical v1 KO strings verbatim', () => {
    expect(koMessages.meta.title).toBe('벽바둑 | Wall Go');
    expect(enMessages.meta.title).toBe('Wall Go');
    expect(koMessages.lobby.title).toBe('벽바둑');
    expect(koMessages.lobby.rulesButton).toBe('규칙 보기');
    expect(koMessages.lobby.startGame).toBe('게임 시작');
    expect(koMessages.hud.securedBadge).toBe('영역 확정');
    expect(koMessages.hud.wallBreakAvailable).toBe('벽 부수기 1');
    expect(koMessages.hud.wallBreakUsed).toBe('사용 완료');
    expect(koMessages.hud.pickSquare).toBe('사각 말 (직선)');
    expect(koMessages.hud.pickRound).toBe('원형 말 (꺾임)');
    expect(koMessages.board.moveStayAria).toBe('제자리 유지 가능');
    expect(koMessages.result.startRound2Button).toBe('감옥매치 2라운드 (1:1) 시작');
    expect(koMessages.result.rank(1, true)).toBe('공동 1위');
    expect(koMessages.result.largestSingle(41)).toBe('최대 단일 41칸');
    expect(koMessages.toast.autoSkip(['플레이어 1'])).toMatch(/패스|영역/);
    expect(koMessages.toast.timeoutWall('플레이어 1')).toMatch(/시간 초과/);
  });
});

describe('i18n dynamic ActionEvent, ReplayStep & toast formatters', () => {
  const players = [
    { id: 0, name: 'Alice' },
    { id: 1, name: 'Bob' },
    { id: 2, name: 'Carol' },
  ];

  it('formats placement, stay, move, wall break, E10 resealing, timeout, and auto-skip in KO & EN', () => {
    const placementEvent: ActionEvent = {
      kind: 'placement',
      playerId: 0,
      actorIsAI: false,
      pieceId: 'p0_0',
      pieceKind: 'square',
      pos: { row: 2, col: 2 },
      timedOut: false,
      skippedPlayerIds: [],
    };
    expect(formatActionEvent(placementEvent, players, 'ko')).toContain('C3');
    expect(formatActionEvent(placementEvent, players, 'ko')).toContain('사각 말');
    const enPlacement = formatActionEvent(placementEvent, players, 'en');
    expect(enPlacement).toContain('C3');
    expect(enPlacement).toContain('Square piece');
    expect(HANGUL_REGEX.test(enPlacement)).toBe(false);

    const stayEvent: ActionEvent = {
      kind: 'turn',
      turnNumber: 1,
      playerId: 1,
      actorIsAI: false,
      pieceId: 'p1_0',
      pieceKind: 'standard',
      from: { row: 3, col: 3 },
      to: { row: 3, col: 3 },
      isStay: true,
      usedWallBreak: false,
      brokenWall: null,
      placedWall: { orientation: 'h', row: 3, col: 3 },
      timedOut: false,
      skippedPlayerIds: [],
    };
    expect(formatActionEvent(stayEvent, players, 'ko')).toContain('제자리');
    expect(formatActionEvent(stayEvent, players, 'ko')).toContain('D4-D5');
    const enStay = formatActionEvent(stayEvent, players, 'en');
    expect(enStay).toContain('Stayed at D4');
    expect(enStay).toContain('D4-D5');
    expect(HANGUL_REGEX.test(enStay)).toBe(false);

    const resealEvent: ActionEvent = {
      kind: 'turn',
      turnNumber: 5,
      playerId: 0,
      actorIsAI: false,
      pieceId: 'p0_0',
      pieceKind: 'standard',
      from: { row: 2, col: 2 },
      to: { row: 2, col: 3 },
      isStay: false,
      usedWallBreak: true,
      brokenWall: { orientation: 'v', row: 2, col: 2, ownerId: 1 },
      placedWall: { orientation: 'v', row: 2, col: 2 },
      timedOut: true,
      skippedPlayerIds: [2],
    };
    const koReseal = formatActionEvent(resealEvent, players, 'ko');
    expect(koReseal).toContain('C3 → D3');
    expect(koReseal).toContain('재설치');
    expect(koReseal).toContain('시간 초과');
    expect(koReseal).toContain('Carol 패스');

    const enReseal = formatActionEvent(resealEvent, players, 'en');
    expect(enReseal).toContain('C3 → D3');
    expect(enReseal).toContain('Broke & resealed C3-D3');
    expect(enReseal).toContain('[Timeout]');
    expect(enReseal).toContain('Carol skipped');
    expect(HANGUL_REGEX.test(enReseal)).toBe(false);

    // Step 0 descriptions (with & without fixed diagonal pieces)
    expect(formatReplayStepDescription(null, players, 'ko', { hasFixedPieces: false })).toBe(
      koMessages.replay.initialBoardDescription,
    );
    expect(formatReplayStepDescription(null, players, 'en', { hasFixedPieces: true })).toBe(
      enMessages.replay.initialBoardFixedDescription,
    );

    // Toast formatters
    expect(formatAutoSkipToast([1, 2], players, 'ko')).toBe('Bob, Carol 영역 확정으로 턴 패스');
    expect(formatAutoSkipToast([1, 2], players, 'en')).toBe(
      'Bob, Carol skipped (territory secured)',
    );
    const enTimeoutWithSkip = formatTimeoutToast(resealEvent, players, 'en');
    expect(enTimeoutWithSkip).toContain('Time out!');
    expect(enTimeoutWithSkip).toContain('Carol skipped');
    expect(HANGUL_REGEX.test(enTimeoutWithSkip)).toBe(false);
    expect(formatTimeoutToast(null, players, 'ko')).toMatch(/시간 초과/);
  });
});

describe('i18n SSR component rendering (KO vs EN + MiniBoardPreview isolation)', () => {
  function makeSampleMatchRecord(state: GameState): MatchRecord {
    return {
      id: 'local_sample_1',
      schemaVersion: 1,
      mode: 'local',
      playedAt: '2026-11-20T10:00:00.000Z',
      ruleVariant: state.ruleVariant,
      format: state.format,
      isPrisonMatchRound2: state.isPrisonMatchRound2,
      timerSeconds: state.timerSeconds,
      endReason: 'all_separated',
      totalTurns: 0,
      totalSteps: 0,
      players: state.players.map((p, i) => ({
        playerId: p.id,
        name: p.name,
        colorToken: p.colorToken,
        isAI: p.isAI,
        aiDifficulty: p.aiDifficulty,
        totalTerritory: 10 - i,
        largestSingleTerritory: 10 - i,
        securedRegions: [10 - i],
        deadlockPieceCount: 0,
        rank: i + 1,
        isWinner: i === 0,
        isDraw: false,
      })),
      finalBoard: {
        pieces: state.pieces,
        walls: state.walls,
        lastPlacedWall: null,
      },
      hasReplay: true,
      replay: {
        schemaVersion: 1,
        initialConfig: createReplayInitialConfig(state),
        steps: [],
      },
    };
  }

  it('renders Lobby, RulesModal, MatchHistoryView, and ReplayViewer cleanly with zero Hangul in EN', () => {
    const initialState = createInitialGameState({
      ruleVariant: 'wallgo2',
      format: '2p',
      players: [
        { name: 'Player 1', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
        { name: 'Player 2', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
      ],
      shuffleOrder: false,
      timerSeconds: 0,
    });
    const matchRecord = makeSampleMatchRecord(initialState);

    const lobbyEnHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(Lobby, {
          config: {
            ruleVariant: 'wallgo1',
            format: '3p',
            shuffleOrder: false,
            timerSeconds: 0,
            players: [
              { name: 'Player 1', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
              { name: 'Player 2', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
              { name: 'Player 3', colorToken: 'p3', isAI: false, aiDifficulty: 'normal' },
            ],
          },
          allSeats: [
            { name: 'Player 1', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
            { name: 'Player 2', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
            { name: 'Player 3', colorToken: 'p3', isAI: false, aiDifficulty: 'normal' },
          ],
          onChangeVariant: () => {},
          onChangeFormat: () => {},
          onChangeTimer: () => {},
          onToggleShuffle: () => {},
          onChangeSeatName: () => {},
          onChangeSeatController: () => {},
          onOpenRules: () => {},
          onStart: () => {},
        }),
      }),
    );
    expect(lobbyEnHtml).toContain('Start Game');
    expect(lobbyEnHtml).toContain('data-testid="language-toggle"');
    expect(lobbyEnHtml).toContain('data-locale="en"');
    expect(HANGUL_REGEX.test(lobbyEnHtml)).toBe(false);

    const rulesEnHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(RulesModal, {
          open: true,
          initialVariant: 'wallgo2',
          onClose: () => {},
        }),
      }),
    );
    expect(rulesEnHtml).toContain('Wall Go Rules');
    expect(rulesEnHtml).toContain('<title>Square piece straight 1 to 2 step movement diagram</title>');
    expect(HANGUL_REGEX.test(rulesEnHtml)).toBe(false);

    const historyEnHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(MatchHistoryView, {
          localMatches: [matchRecord],
          onBack: () => {},
          onOpenReplay: () => {},
        }),
      }),
    );
    expect(historyEnHtml).toContain('data-testid="history-screen"');
    expect(historyEnHtml).toContain(`data-testid="history-match-card-${matchRecord.id}"`);
    expect(historyEnHtml).toContain(`data-testid="history-replay-button-${matchRecord.id}"`);
    expect(HANGUL_REGEX.test(historyEnHtml)).toBe(false);

    const replayEnHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(ReplayViewer, {
          match: matchRecord,
          onClose: () => {},
        }),
      }),
    );
    expect(replayEnHtml).toContain('data-testid="replay-screen"');
    expect(replayEnHtml).toContain('data-testid="replay-speed-button"');
    expect(replayEnHtml).toContain('data-speed="1"');
    expect(HANGUL_REGEX.test(replayEnHtml)).toBe(false);

    // Graceful ReplayValidationError fallback rendering
    const corruptMatch: MatchRecord = {
      ...matchRecord,
      replay: {
        ...matchRecord.replay,
        steps: [
          {
            stepIndex: 1,
            kind: 'placement',
            playerId: 99,
            actorIsAI: false,
            pieceId: 'bad',
            pieceKind: 'square',
            pos: { row: 99, col: 99 },
            timedOut: false,
            skippedPlayerIds: [],
          },
        ],
      },
    };
    const fallbackHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(ReplayViewer, {
          match: corruptMatch,
          onClose: () => {},
        }),
      }),
    );
    expect(fallbackHtml).toContain('Unable to reconstruct replay');
    expect(fallbackHtml).toContain('step 1');
    expect(HANGUL_REGEX.test(fallbackHtml)).toBe(false);
  });

  it('MiniBoardPreview emits zero colliding board data-testids', () => {
    const initialState = createInitialGameState({
      ruleVariant: 'wallgo1',
      format: '2p',
      players: [
        { name: 'P1', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
        { name: 'P2', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
      ],
      shuffleOrder: false,
      timerSeconds: 0,
    });
    const html = renderToStaticMarkup(
      createElement(MiniBoardPreview, {
        board: {
          pieces: initialState.pieces,
          walls: {
            'h:1:1': { orientation: 'h', row: 1, col: 1, ownerId: 0 },
          },
          lastPlacedWall: { orientation: 'h', row: 1, col: 1 },
        },
        players: [
          { playerId: 0, colorToken: 'p1' },
          { playerId: 1, colorToken: 'p2' },
        ],
        ariaLabel: 'Final board snapshot',
      }),
    );
    expect(html).not.toContain('data-testid=');
  });

  it('renders Board (with E10 reseal replayHighlight), SidePanel (online HUD), and ResultModal in EN with zero Hangul', async () => {
    const { Board } = await import('../../components/Board');
    const { SidePanel } = await import('../../components/SidePanel');
    const { ResultModal } = await import('../../components/ResultModal');

    const baseState = createInitialGameState({
      ruleVariant: 'wallgo1',
      format: '3p',
      players: [
        { name: 'Player 1', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
        { name: 'Player 2', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
        { name: 'Player 3', colorToken: 'p3', isAI: true, aiDifficulty: 'hard' },
      ],
      shuffleOrder: false,
      timerSeconds: 90,
    });
    const stateWithWall: GameState = {
      ...baseState,
      walls: {
        'v:2:2': { orientation: 'v', row: 2, col: 2, ownerId: 0 },
      },
      lastPlacedWall: { orientation: 'v', row: 2, col: 2 },
    };

    const boardHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(Board, {
          state: stateWithWall,
          validMoves: [],
          interactiveWalls: [],
          pendingBreakTarget: null,
          isInteractive: false,
          isPaused: false,
          replayHighlight: {
            origin: { row: 2, col: 2 },
            dest: { row: 2, col: 3 },
            isStay: false,
            brokenWall: { orientation: 'v', row: 2, col: 2, ownerId: 1 },
            isResealed: true,
            placedWall: { orientation: 'v', row: 2, col: 2 },
          },
          onCellClick: () => {},
          onWallClick: () => {},
        }),
      }),
    );
    expect(boardHtml).toContain('data-replay-role="origin"');
    expect(boardHtml).toContain('data-replay-role="dest"');
    expect(boardHtml).toContain('data-replay-resealed="true"');
    expect(boardHtml).toContain('wall-replay-resealed-badge');
    expect(HANGUL_REGEX.test(boardHtml)).toBe(false);

    const sidePanelHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(SidePanel, {
          state: stateWithWall,
          validMoves: [],
          canWallBreak: false,
          canCancelMove: true,
          canUndo: true,
          canRedo: true,
          isAiTurn: false,
          timerRemaining: 80,
          timerPaused: false,
          isTimerEffectivelyPaused: false,
          showReopenResult: false,
          onSelectPlacementKind: () => {},
          onToggleWallBreak: () => {},
          onCancelMove: () => {},
          onUndo: () => {},
          onRedo: () => {},
          onTogglePause: () => {},
          onOpenRules: () => {},
          onBackToLobby: () => {},
          onReopenResult: () => {},
          onlineProps: {
            roomCode: 'AB3K9M',
            connectionStatus: 'connected',
            isSpectator: true,
            spectatorRole: 'survivor_spectator',
            isMyTurn: false,
            isHost: true,
            canClaimHost: true,
            inviteCopied: false,
            seatMetaByPlayerId: {
              0: { gamePlayerId: 0, seatIndex: 0, status: 'online', isMe: true, isHost: true, canSubstituteAI: false },
              1: { gamePlayerId: 1, seatIndex: 1, status: 'offline', isMe: false, isHost: false, canSubstituteAI: true },
              2: { gamePlayerId: 2, seatIndex: 2, status: 'ai', isMe: false, isHost: false, canSubstituteAI: false },
            },
            onCopyInvite: () => {},
            onSubstituteAI: () => {},
            onClaimHost: () => {},
          },
        }),
      }),
    );
    expect(sidePanelHtml).toContain('data-testid="online-connection-badge"');
    expect(sidePanelHtml).toContain('data-testid="online-copy-invite-button"');
    expect(sidePanelHtml).toContain('data-testid="online-spectator-banner"');
    expect(sidePanelHtml).toContain('data-testid="online-seat-status-1"');
    expect(sidePanelHtml).toContain('data-testid="substitute-ai-button-1"');
    expect(sidePanelHtml).toContain('data-testid="online-claim-host-button"');
    expect(sidePanelHtml).toContain('data-online-disabled="true"');
    expect(HANGUL_REGEX.test(sidePanelHtml)).toBe(false);

    const finishedState: GameState = {
      ...stateWithWall,
      phase: 'game_over',
      territory: {
        ...stateWithWall.territory,
        isGameOver: true,
        endReason: 'all_separated',
        scores: [
          { playerId: 0, totalTerritory: 20, largestSingleTerritory: 20, securedRegions: [20], deadlockPieceCount: 0, rank: 1 },
          { playerId: 1, totalTerritory: 15, largestSingleTerritory: 15, securedRegions: [15], deadlockPieceCount: 0, rank: 2 },
          { playerId: 2, totalTerritory: 14, largestSingleTerritory: 14, securedRegions: [14], deadlockPieceCount: 0, rank: 3 },
        ],
      },
    };
    const resultHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(ResultModal, {
          state: finishedState,
          mode: 'online',
          isHost: true,
          onStartRound2: () => {},
          onRematch: () => {},
          onBackToLobby: () => {},
          onInspectBoard: () => {},
          onOnlineRound2: () => {},
          onOnlineRematch: () => {},
          onOnlineReturnWaiting: () => {},
        }),
      }),
    );
    expect(resultHtml).toContain('data-testid="online-round2-button"');
    expect(resultHtml).toContain('data-testid="online-rematch-button"');
    expect(resultHtml).toContain('data-testid="online-return-waiting-button"');
    expect(HANGUL_REGEX.test(resultHtml)).toBe(false);
  });
});
