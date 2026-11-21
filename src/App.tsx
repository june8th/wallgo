import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_PLAYER_NAMES_BY_LOCALE,
  breakWallAt,
  canCancelTurnMove,
  canSmartRedo,
  canSmartUndo,
  canToggleWallBreak,
  cancelTurnMove,
  confirmWallGo2BreakWall,
  createInitialGameState,
  createPrisonMatchRound2State,
  deselectPiece,
  getInteractiveWalls,
  getPhaseSubstate,
  getPieceValidMoves,
  movePiece,
  placeInitialPiece,
  placeWall,
  resolveTurnTimeout,
  selectPiece,
  selectWallGo2BreakDestination,
  setSelectedPlacementKind,
  toggleWallBreak,
} from './engine';
import type {
  AIDifficulty,
  ActionEvent,
  GameFormat,
  GameState,
  LobbyConfig,
  PlayerConfig,
  RuleVariant,
  TimerSeconds,
  WallEdge,
  WallGo2PieceKind,
} from './engine';
import { applyBotTurnAction, chooseAiPlacement, chooseAiTurn } from './ai';
import {
  buildCommitTurnActionFromDraft,
  extractRawInviteCodeFromLocation,
  extractRoomCodeFromLocation,
  fetchHealth,
  getOnlineMatch,
  listOnlineMatches,
  syncRoomUrl,
  useOnlineRoom,
} from './api';
import { Board } from './components/Board';
import { Lobby } from './components/Lobby';
import type { LobbyModeTab } from './components/Lobby';
import { MatchHistoryView } from './components/MatchHistoryView';
import { OnlinePanel } from './components/OnlinePanel';
import type { RedisConfiguredState } from './components/OnlinePanel';
import { OnlineWaitingRoom } from './components/OnlineWaitingRoom';
import { ReplayViewer } from './components/ReplayViewer';
import { ResultModal } from './components/ResultModal';
import { RulesModal } from './components/RulesModal';
import { SidePanel } from './components/SidePanel';
import type { SidePanelOnlineProps, SidePanelOnlineSeatMeta } from './components/SidePanel';
import {
  I18nProvider,
  formatAutoSkipToast,
  formatTimeoutToast,
  useI18n,
} from './i18n';
import { MAX_LOCAL_MATCHES } from './shared';
import type {
  Locale,
  MatchRecord,
  MatchSummary,
  OnlineRoomConfig,
  RoomEventNotice,
} from './shared';
import {
  buildLocalMatchRecord,
  commitLocalSessionTurn,
  createLocalGameSession,
  getRoomSession,
  getSavedNickname,
  loadLocalMatches,
  readLocalMatchesSafe,
  redoLocalSession,
  undoLocalSession,
  updateLocalSessionTransient,
  upsertLocalMatch,
} from './storage';
import type { LocalGameSession } from './storage';

type AppScreen = 'lobby' | 'online-room' | 'game' | 'history' | 'replay';

type ToastPayload =
  | {
      kind: 'auto_skip';
      skippedPlayerIds: number[];
      players: Array<{ id: number; name: string }>;
    }
  | {
      kind: 'timeout';
      event: ActionEvent | null;
      players: Array<{ id: number; name: string }>;
    }
  | {
      kind: 'room_event';
      event: RoomEventNotice;
      players: Array<{ id: number; name: string }>;
    }
  | {
      kind: 'custom';
      message: string;
    };

interface ToastState {
  id: number;
  payload: ToastPayload;
}

function normalizeLobbyConfigForLocale(
  config: LobbyConfig,
  locale: Locale,
): LobbyConfig {
  const defaults = DEFAULT_PLAYER_NAMES_BY_LOCALE[locale];
  return {
    ...config,
    players: config.players.map((p, idx) => ({
      ...p,
      name: p.name.trim().length > 0 ? p.name : (defaults[idx] ?? `Player ${idx + 1}`),
    })),
  };
}

function AppContent() {
  const { locale, t } = useI18n();

  const [screen, setScreen] = useState<AppScreen>('lobby');
  const [lobbyTab, setLobbyTab] = useState<LobbyModeTab>('local');
  const [ruleVariant, setRuleVariant] = useState<RuleVariant>('wallgo1');
  const [format, setFormat] = useState<GameFormat>('3p');
  const [timerSeconds, setTimerSeconds] = useState<TimerSeconds>(0);
  const [shuffleOrder, setShuffleOrder] = useState<boolean>(false);

  // Online lobby state
  const [onlineNickname, setOnlineNickname] = useState<string>(
    () => getSavedNickname() ?? '',
  );
  const [onlineConfig, setOnlineConfig] = useState<OnlineRoomConfig>({
    ruleVariant: 'wallgo1',
    format: '3p',
    timerSeconds: 0,
    shuffleOrder: false,
  });
  const [joinCode, setJoinCode] = useState<string>('');
  const [redisConfigured, setRedisConfigured] =
    useState<RedisConfiguredState>('checking');

  // Online match history state (fetched lazily ONLY when opening History screen)
  const [onlineMatches, setOnlineMatches] = useState<MatchSummary[]>([]);
  const [onlineHistoryAvailable, setOnlineHistoryAvailable] = useState<
    boolean | undefined
  >(undefined);
  const [onlineHistoryLoading, setOnlineHistoryLoading] = useState<boolean>(false);

  const seatNameTouchedRef = useRef<[boolean, boolean, boolean]>([false, false, false]);
  const [allSeats, setAllSeats] = useState<PlayerConfig[]>(() => {
    const defaults = DEFAULT_PLAYER_NAMES_BY_LOCALE[locale];
    const savedNick = getSavedNickname();
    if (savedNick !== null) {
      seatNameTouchedRef.current = [true, false, false];
    }
    return [
      {
        name: savedNick ?? defaults[0],
        colorToken: 'p1',
        isAI: false,
        aiDifficulty: 'normal',
      },
      { name: defaults[1], colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
      { name: defaults[2], colorToken: 'p3', isAI: false, aiDifficulty: 'normal' },
    ];
  });

  const [localSession, setLocalSession] = useState<LocalGameSession | null>(null);
  const [localMatches, setLocalMatches] = useState<MatchRecord[]>(() =>
    loadLocalMatches(),
  );
  const [activeReplayMatch, setActiveReplayMatch] = useState<MatchRecord | null>(null);

  const [sessionId, setSessionId] = useState<number>(0);
  const [rulesOpen, setRulesOpen] = useState<boolean>(false);
  const [resultDismissed, setResultDismissed] = useState<boolean>(false);
  const [timerPaused, setTimerPaused] = useState<boolean>(false);
  const [timerRemaining, setTimerRemaining] = useState<number>(0);
  const [toast, setToast] = useState<ToastState | null>(null);

  const toastSeqRef = useRef<number>(1);
  const prevStateRef = useRef<GameState | null>(null);
  const lastSavedGameOverStateRef = useRef<GameState | null>(null);
  const storageBlockedRef = useRef<boolean>(false);
  const onlineGameSeqRef = useRef<number>(0);
  const deepLinkCheckedRef = useRef<boolean>(false);
  const healthCheckedRef = useRef<boolean>(false);

  const showToast = useCallback((payload: ToastPayload) => {
    toastSeqRef.current += 1;
    setToast({ id: toastSeqRef.current, payload });
  }, []);

  const handleOnlineRoomEvent = useCallback(
    (event: RoomEventNotice) => {
      const players =
        onlineRoomPlayersRef.current.length > 0 ? onlineRoomPlayersRef.current : [];
      showToast({ kind: 'room_event', event, players });
    },
    [showToast],
  );

  const handleOnlineEvicted = useCallback(() => {
    setRulesOpen(false);
    setResultDismissed(false);
    setLobbyTab('online');
    setScreen('lobby');
  }, []);

  const onlineRoom = useOnlineRoom({
    locale,
    onRoomEvent: handleOnlineRoomEvent,
    onKicked: handleOnlineEvicted,
    onRoomClosed: handleOnlineEvicted,
  });

  const onlineRoomPlayersRef = useRef<Array<{ id: number; name: string }>>([]);
  onlineRoomPlayersRef.current =
    onlineRoom.room?.gameState?.players.map((p) => ({ id: p.id, name: p.name })) ?? [];

  // Keep App screen synchronized with active online room lifecycle
  useEffect(() => {
    const r = onlineRoom.room;
    if (!r) {
      return;
    }
    if (r.status === 'waiting') {
      setResultDismissed(false);
      setScreen('online-room');
    } else if (r.status === 'playing') {
      if (onlineGameSeqRef.current !== r.gameSequence) {
        onlineGameSeqRef.current = r.gameSequence;
        setResultDismissed(false);
      }
      setScreen('game');
    } else if (r.status === 'finished') {
      if (onlineGameSeqRef.current !== r.gameSequence) {
        onlineGameSeqRef.current = r.gameSequence;
        setResultDismissed(false);
      }
      setScreen('game');
    }
  }, [onlineRoom.room?.status, onlineRoom.room?.gameSequence, onlineRoom.room?.code]);

  // One-time deep-link inspection on mount (/?room=CODE or /room/CODE ONLY; zero /api/* on /)
  useEffect(() => {
    if (deepLinkCheckedRef.current || typeof window === 'undefined') {
      return;
    }
    deepLinkCheckedRef.current = true;

    const parsedCode = extractRoomCodeFromLocation(window.location);
    if (parsedCode) {
      const stored = getRoomSession(parsedCode);
      if (stored) {
        void onlineRoom
          .joinExistingRoom(parsedCode, undefined, { preferStoredSession: true })
          .then((joined) => {
            if (!joined) {
              syncRoomUrl(null);
              setJoinCode(parsedCode);
              setLobbyTab('online');
              setScreen('lobby');
            }
          });
      } else {
        setJoinCode(parsedCode);
        setLobbyTab('online');
        setScreen('lobby');
      }
      return;
    }

    const rawInvite = extractRawInviteCodeFromLocation(window.location);
    if (rawInvite) {
      setJoinCode(rawInvite.replace(/[\s-]+/g, '').toUpperCase().slice(0, 6));
      setLobbyTab('online');
      setScreen('lobby');
      onlineRoom.setError({ code: 'INVALID_ROOM_CODE' });
    }
  }, [onlineRoom.joinExistingRoom, onlineRoom.setError]);

  // Lazy /api/health check ONLY when viewing Online Lobby tab (never on / Local Lobby!)
  useEffect(() => {
    if (screen !== 'lobby' || lobbyTab !== 'online' || healthCheckedRef.current) {
      return;
    }
    healthCheckedRef.current = true;
    let active = true;
    setRedisConfigured('checking');
    void fetchHealth()
      .then((res) => {
        if (!active) return;
        setRedisConfigured(res.onlineAvailable ? 'true' : 'false');
      })
      .catch(() => {
        if (!active) return;
        healthCheckedRef.current = false;
        setRedisConfigured('false');
      });
    return () => {
      active = false;
    };
  }, [screen, lobbyTab]);

  // Lazy /api/matches fetch ONLY when opening History screen
  const refreshOnlineHistory = useCallback(() => {
    setOnlineHistoryLoading(true);
    void listOnlineMatches(100)
      .then((res) => {
        setOnlineMatches(res.matches);
        setOnlineHistoryAvailable(res.onlineAvailable);
        setOnlineHistoryLoading(false);
      })
      .catch(() => {
        setOnlineHistoryAvailable(false);
        setOnlineHistoryLoading(false);
      });
  }, []);

  useEffect(() => {
    if (screen !== 'history') {
      return;
    }
    refreshOnlineHistory();
  }, [screen, refreshOnlineHistory]);

  // Sync untouched default seat names when switching KO <-> EN without clobbering custom names
  useEffect(() => {
    const defaults = DEFAULT_PLAYER_NAMES_BY_LOCALE[locale];
    setAllSeats((prev) =>
      prev.map((seat, idx) =>
        seatNameTouchedRef.current[idx]
          ? seat
          : { ...seat, name: defaults[idx] ?? seat.name },
      ),
    );
  }, [locale]);

  const lobbyConfig: LobbyConfig = useMemo(
    () => ({
      ruleVariant,
      format,
      shuffleOrder,
      timerSeconds,
      players: allSeats.slice(0, format === '3p' ? 3 : 2),
    }),
    [ruleVariant, format, shuffleOrder, timerSeconds, allSeats],
  );

  const isOnlineGame =
    screen === 'game' &&
    onlineRoom.room !== null &&
    onlineRoom.room.gameState !== null;

  const history = isOnlineGame ? null : (localSession?.history ?? null);
  const state: GameState | null = isOnlineGame
    ? (onlineRoom.draftState ?? onlineRoom.room!.gameState!)
    : (history?.present ?? null);

  const isAiTurn = useMemo(() => {
    if (screen !== 'game' || !state || state.phase === 'game_over') {
      return false;
    }
    return state.players[state.currentPlayerIndex]?.isAI ?? false;
  }, [screen, state]);

  const isHumanMainTurn = useMemo(() => {
    if (screen !== 'game' || !state || isAiTurn) {
      return false;
    }
    return (
      state.phase === 'select_piece' ||
      state.phase === 'move_piece' ||
      state.phase === 'place_wall'
    );
  }, [screen, state, isAiTurn]);

  const isTimerEffectivelyPaused = isOnlineGame
    ? !state ||
      onlineRoom.room!.turnStartedAt === null ||
      state.phase === 'placement' ||
      state.phase === 'game_over' ||
      isAiTurn
    : timerPaused || rulesOpen || !isHumanMainTurn;

  // Auto-dismiss toast after 2.5s
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 2500);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Reset LOCAL turn timer ONLY when entering a new game session or a new turn epoch (never on intra-turn cancel!)
  const localState = isOnlineGame ? null : state;
  const turnEpochKey = localState
    ? `${sessionId}:${localState.phase === 'placement' ? 'placement' : localState.phase === 'game_over' ? 'over' : `play:${localState.turnNumber}:${localState.currentPlayerIndex}`}`
    : 'none';

  useEffect(() => {
    if (!localState) return;
    setTimerRemaining(localState.timerSeconds);
  }, [turnEpochKey, localState?.timerSeconds]);

  // Reset result modal dismissal when leaving game_over (e.g., Undo from game_over)
  useEffect(() => {
    if (state && state.phase !== 'game_over' && resultDismissed) {
      setResultDismissed(false);
    }
  }, [state, resultDismissed]);

  // Idempotent local match auto-save on game_over (local mode only)
  useEffect(() => {
    if (screen !== 'game' || isOnlineGame || !localSession) {
      return;
    }
    const current = localSession.history.present;
    if (current.phase !== 'game_over') {
      return;
    }
    if (lastSavedGameOverStateRef.current === current) {
      return;
    }
    lastSavedGameOverStateRef.current = current;
    const record = buildLocalMatchRecord({
      id: localSession.matchId,
      finalState: current,
      initialConfig: localSession.initialConfig,
      steps: localSession.replay.past,
    });
    const updated = upsertLocalMatch(record);
    const verified = readLocalMatchesSafe();
    if (!verified.ok || !verified.matches.some((m) => m.id === record.id)) {
      storageBlockedRef.current = true;
      setLocalMatches((prev) => {
        const filtered = prev.filter((m) => m.id !== record.id);
        return [record, ...filtered].slice(0, MAX_LOCAL_MATCHES);
      });
    } else {
      storageBlockedRef.current = false;
      setLocalMatches(updated);
    }
  }, [screen, isOnlineGame, localSession]);

  // Surface auto-skip toast whenever a LOCAL non-timeout turn transition skips one or more players
  useEffect(() => {
    if (isOnlineGame) {
      prevStateRef.current = null;
      return;
    }
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!state || !prev || state === prev) {
      return;
    }
    const turnAdvanced =
      state.turnNumber > prev.turnNumber ||
      (prev.phase === 'placement' && state.phase === 'select_piece');
    if (
      turnAdvanced &&
      state.lastSkippedPlayerIds.length > 0 &&
      !state.lastActionEvent?.timedOut
    ) {
      showToast({
        kind: 'auto_skip',
        skippedPlayerIds: state.lastSkippedPlayerIds.slice(),
        players: state.players.map((p) => ({ id: p.id, name: p.name })),
      });
    }
  }, [state, isOnlineGame, showToast]);

  // Active 1s interval countdown for LOCAL human main turns
  useEffect(() => {
    if (
      screen !== 'game' ||
      isOnlineGame ||
      !state ||
      state.timerSeconds <= 0 ||
      isTimerEffectivelyPaused ||
      timerRemaining <= 0
    ) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setTimerRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [screen, isOnlineGame, state, isTimerEffectivelyPaused, timerRemaining > 0]);

  // Fire legal timeout action immediately when LOCAL countdown reaches 0 via resolveTurnTimeout
  useEffect(() => {
    if (
      screen !== 'game' ||
      isOnlineGame ||
      !state ||
      state.timerSeconds <= 0 ||
      isTimerEffectivelyPaused ||
      timerRemaining > 0
    ) {
      return;
    }
    const { state: timedOutState, event } = resolveTurnTimeout(state);
    if (timedOutState !== state) {
      setLocalSession((prev) =>
        prev && prev.history.present === state
          ? commitLocalSessionTurn(prev, timedOutState, event)
          : prev,
      );
      setTimerRemaining(timedOutState.timerSeconds);
      showToast({
        kind: 'timeout',
        event,
        players: timedOutState.players.map((p) => ({ id: p.id, name: p.name })),
      });
    }
  }, [screen, isOnlineGame, state, isTimerEffectivelyPaused, timerRemaining, showToast]);

  // Cancellable ~450ms LOCAL AI turn scheduler
  useEffect(() => {
    if (
      screen !== 'game' ||
      isOnlineGame ||
      !state ||
      !isAiTurn ||
      timerPaused ||
      rulesOpen
    ) {
      return;
    }
    const snapshotState = state;
    const aiPlayer = snapshotState.players[snapshotState.currentPlayerIndex];
    if (!aiPlayer) return;

    const timeoutId = window.setTimeout(() => {
      setLocalSession((prevSession) => {
        if (!prevSession || prevSession.history.present !== snapshotState) {
          return prevSession;
        }
        if (snapshotState.phase === 'placement') {
          const placement = chooseAiPlacement(snapshotState, aiPlayer.aiDifficulty);
          const next = placeInitialPiece(
            snapshotState,
            { row: placement.row, col: placement.col },
            placement.kind,
          );
          return next === snapshotState
            ? prevSession
            : commitLocalSessionTurn(prevSession, next);
        }
        const action = chooseAiTurn(snapshotState, aiPlayer.aiDifficulty);
        const next = applyBotTurnAction(snapshotState, action);
        return next === snapshotState
          ? prevSession
          : commitLocalSessionTurn(prevSession, next);
      });
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [screen, isOnlineGame, state, isAiTurn, timerPaused, rulesOpen]);

  // --- Lobby & Navigation Handlers ---

  const handleChangeSeatName = useCallback((index: number, name: string) => {
    seatNameTouchedRef.current[index] = true;
    setAllSeats((prev) =>
      prev.map((seat, i) => (i === index ? { ...seat, name } : seat)),
    );
  }, []);

  const handleChangeSeatController = useCallback(
    (index: number, isAI: boolean, difficulty: AIDifficulty = 'normal') => {
      setAllSeats((prev) =>
        prev.map((seat, i) =>
          i === index
            ? { ...seat, isAI, aiDifficulty: isAI ? difficulty : seat.aiDifficulty }
            : seat,
        ),
      );
    },
    [],
  );

  const launchFreshGame = useCallback((initial: GameState) => {
    prevStateRef.current = initial;
    lastSavedGameOverStateRef.current = null;
    setLocalSession(createLocalGameSession(initial));
    setSessionId((prev) => prev + 1);
    setResultDismissed(false);
    setTimerPaused(false);
    setTimerRemaining(initial.timerSeconds);
    setToast(null);
    setScreen('game');
  }, []);

  const handleStartFromLobby = useCallback(() => {
    const normalized = normalizeLobbyConfigForLocale(lobbyConfig, locale);
    const initial = createInitialGameState(normalized);
    launchFreshGame(initial);
  }, [lobbyConfig, locale, launchFreshGame]);

  const handleStartRound2 = useCallback(() => {
    if (!state || state.format !== '3p' || state.phase !== 'game_over') return;
    const round2State = createPrisonMatchRound2State(state);
    launchFreshGame(round2State);
  }, [state, launchFreshGame]);

  const handleRematch = useCallback(() => {
    if (!state) return;
    if (state.isPrisonMatchRound2) {
      const round2Rematch = createInitialGameState({
        ruleVariant: state.ruleVariant,
        format: '2p',
        players: state.players.map((p) => ({
          name: p.name,
          colorToken: p.colorToken,
          isAI: p.isAI,
          aiDifficulty: p.aiDifficulty,
        })),
        shuffleOrder: false,
        timerSeconds: state.timerSeconds,
      });
      launchFreshGame({ ...round2Rematch, isPrisonMatchRound2: true });
      return;
    }
    const normalized = normalizeLobbyConfigForLocale(lobbyConfig, locale);
    const fresh = createInitialGameState(normalized);
    launchFreshGame(fresh);
  }, [state, lobbyConfig, locale, launchFreshGame]);

  const handleBackToLobby = useCallback(() => {
    setRulesOpen(false);
    setTimerPaused(false);
    setResultDismissed(false);
    setToast(null);
    setActiveReplayMatch(null);
    if (onlineRoom.room) {
      void onlineRoom.leaveRoom();
    }
    setScreen('lobby');
  }, [onlineRoom.room, onlineRoom.leaveRoom]);

  const handleOpenHistory = useCallback(() => {
    setRulesOpen(false);
    setActiveReplayMatch(null);
    const loaded = readLocalMatchesSafe();
    if (loaded.ok && !storageBlockedRef.current) {
      setLocalMatches(loaded.matches);
    }
    setScreen('history');
  }, []);

  const handleOpenReplay = useCallback((match: MatchRecord) => {
    setRulesOpen(false);
    setActiveReplayMatch(match);
    setScreen('replay');
  }, []);

  const handleCloseReplay = useCallback(() => {
    setActiveReplayMatch(null);
    const loaded = readLocalMatchesSafe();
    if (loaded.ok && !storageBlockedRef.current) {
      setLocalMatches(loaded.matches);
    }
    setScreen('history');
  }, []);

  const handleLoadOnlineMatch = useCallback(async (matchId: string): Promise<MatchRecord> => {
    const res = await getOnlineMatch(matchId);
    return res.match;
  }, []);

  // --- Online Lobby & Waiting Room Handlers ---

  const handleCreateOnlineRoom = useCallback(() => {
    void onlineRoom.createNewRoom(onlineNickname, onlineConfig);
  }, [onlineRoom.createNewRoom, onlineNickname, onlineConfig]);

  const handleJoinOnlineRoom = useCallback(() => {
    void onlineRoom.joinExistingRoom(joinCode, onlineNickname, {
      preferStoredSession: true,
    });
  }, [onlineRoom.joinExistingRoom, joinCode, onlineNickname]);

  const handleUpdateOnlineNickname = useCallback(
    (nextNick: string) => {
      setOnlineNickname(nextNick);
      void onlineRoom.updateNickname(nextNick);
    },
    [onlineRoom.updateNickname],
  );

  // --- In-Game Board & HUD Handlers (Local + Online 0ms Draft) ---

  const isBoardInteractive = isOnlineGame
    ? onlineRoom.room!.status === 'playing' &&
      state !== null &&
      state.phase !== 'game_over' &&
      onlineRoom.isMyTurn &&
      !onlineRoom.submitting &&
      !rulesOpen
    : screen === 'game' &&
      state !== null &&
      state.phase !== 'game_over' &&
      !isAiTurn &&
      !timerPaused &&
      !rulesOpen;

  const validMoves = useMemo(() => {
    if (
      !state ||
      state.phase !== 'move_piece' ||
      state.turnSubState.selectedPieceId === null
    ) {
      return [];
    }
    if (isOnlineGame && (!onlineRoom.isMyTurn || onlineRoom.submitting)) {
      return [];
    }
    return getPieceValidMoves(state, state.turnSubState.selectedPieceId);
  }, [state, isOnlineGame, onlineRoom.isMyTurn, onlineRoom.submitting]);

  const interactiveWalls = useMemo(() => {
    if (!state) return [];
    if (isOnlineGame && (!onlineRoom.isMyTurn || onlineRoom.submitting)) {
      return [];
    }
    return getInteractiveWalls(state);
  }, [state, isOnlineGame, onlineRoom.isMyTurn, onlineRoom.submitting]);

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (!state || !isBoardInteractive) return;
      const current = state;

      if (current.phase === 'placement') {
        const kind =
          current.ruleVariant === 'wallgo2'
            ? current.turnSubState.selectedPlacementKind
            : undefined;
        const next = placeInitialPiece(current, { row, col }, kind);
        if (next !== current) {
          if (isOnlineGame) {
            void onlineRoom.commitPlacement({ row, col }, kind);
          } else if (localSession) {
            setLocalSession(commitLocalSessionTurn(localSession, next));
          }
        }
        return;
      }

      const clickedPiece = current.pieces.find((p) => p.row === row && p.col === col);

      const applyTransient = (next: GameState) => {
        if (next === current) return;
        if (isOnlineGame) {
          onlineRoom.setDraftState(next);
        } else if (localSession) {
          setLocalSession(updateLocalSessionTransient(localSession, next));
        }
      };

      if (current.phase === 'select_piece') {
        if (clickedPiece && clickedPiece.ownerId === current.currentPlayerIndex) {
          applyTransient(selectPiece(current, clickedPiece.id));
        }
        return;
      }

      if (current.phase === 'move_piece') {
        const matchingMove = validMoves.find((m) => m.row === row && m.col === col);
        if (matchingMove) {
          if (matchingMove.moveType === 'wall-break') {
            applyTransient(selectWallGo2BreakDestination(current, { row, col }));
          } else {
            applyTransient(movePiece(current, { row, col }));
          }
          return;
        }

        if (clickedPiece && clickedPiece.ownerId === current.currentPlayerIndex) {
          if (clickedPiece.id === current.turnSubState.selectedPieceId) {
            applyTransient(deselectPiece(current));
          } else {
            applyTransient(selectPiece(current, clickedPiece.id));
          }
          return;
        }

        if (current.turnSubState.pendingBreakChoice !== null) {
          applyTransient(cancelTurnMove(current));
          return;
        }

        if (current.turnSubState.brokenWallBeforeMove === null) {
          applyTransient(deselectPiece(current));
        }
      }
    },
    [
      state,
      isBoardInteractive,
      isOnlineGame,
      localSession,
      validMoves,
      onlineRoom.commitPlacement,
      onlineRoom.setDraftState,
    ],
  );

  const handleWallClick = useCallback(
    (edge: WallEdge) => {
      if (!state || !isBoardInteractive) return;
      const current = state;

      if (current.phase === 'place_wall') {
        const next = placeWall(current, edge);
        if (next !== current) {
          if (isOnlineGame) {
            const action = buildCommitTurnActionFromDraft(current, edge);
            if (action) {
              void onlineRoom.commitTurn(action);
            }
          } else if (localSession) {
            setLocalSession(commitLocalSessionTurn(localSession, next));
          }
        }
        return;
      }

      const applyTransient = (next: GameState) => {
        if (next === current) return;
        if (isOnlineGame) {
          onlineRoom.setDraftState(next);
        } else if (localSession) {
          setLocalSession(updateLocalSessionTransient(localSession, next));
        }
      };

      if (current.phase === 'move_piece') {
        if (current.turnSubState.pendingBreakChoice !== null) {
          applyTransient(confirmWallGo2BreakWall(current, edge));
          return;
        }
        if (current.ruleVariant === 'wallgo1' && current.turnSubState.wallBreakActive) {
          applyTransient(breakWallAt(current, edge));
        }
      }
    },
    [
      state,
      isBoardInteractive,
      isOnlineGame,
      localSession,
      onlineRoom.commitTurn,
      onlineRoom.setDraftState,
    ],
  );

  const handleSelectPlacementKind = useCallback(
    (kind: WallGo2PieceKind) => {
      if (!state || !isBoardInteractive) return;
      const next = setSelectedPlacementKind(state, kind);
      if (next === state) return;
      if (isOnlineGame) {
        onlineRoom.setDraftState(next);
      } else if (localSession) {
        setLocalSession(updateLocalSessionTransient(localSession, next));
      }
    },
    [state, isBoardInteractive, isOnlineGame, localSession, onlineRoom.setDraftState],
  );

  const handleToggleWallBreak = useCallback(() => {
    if (!state || !isBoardInteractive) return;
    const next = toggleWallBreak(state);
    if (next === state) return;
    if (isOnlineGame) {
      onlineRoom.setDraftState(next);
    } else if (localSession) {
      setLocalSession(updateLocalSessionTransient(localSession, next));
    }
  }, [state, isBoardInteractive, isOnlineGame, localSession, onlineRoom.setDraftState]);

  const handleCancelMove = useCallback(() => {
    if (!state || !isBoardInteractive) return;
    const next = cancelTurnMove(state);
    if (next === state) return;
    if (isOnlineGame) {
      onlineRoom.setDraftState(next);
    } else if (localSession) {
      setLocalSession(updateLocalSessionTransient(localSession, next));
    }
  }, [state, isBoardInteractive, isOnlineGame, localSession, onlineRoom.setDraftState]);

  const handleUndo = useCallback(() => {
    if (isOnlineGame || !localSession) return;
    const nextSession = undoLocalSession(localSession);
    if (nextSession !== localSession) {
      setLocalSession(nextSession);
      setResultDismissed(false);
    }
  }, [isOnlineGame, localSession]);

  const handleRedo = useCallback(() => {
    if (isOnlineGame || !localSession) return;
    const nextSession = redoLocalSession(localSession);
    if (nextSession !== localSession) {
      setLocalSession(nextSession);
      setResultDismissed(false);
    }
  }, [isOnlineGame, localSession]);

  // --- SidePanelOnlineProps construction ---

  const sidePanelOnlineProps = useMemo<SidePanelOnlineProps | undefined>(() => {
    if (!isOnlineGame || !onlineRoom.room || !state) {
      return undefined;
    }
    const r = onlineRoom.room;
    const seatMetaByPlayerId: Record<number, SidePanelOnlineSeatMeta> = {};

    for (const seat of r.seats) {
      if (seat.gamePlayerId === null) continue;
      const status =
        seat.kind === 'ai'
          ? 'ai'
          : seat.connectionStatus === 'connected'
            ? 'online'
            : 'offline';
      const isMe = r.viewer.role === 'player' && r.viewer.seatIndex === seat.seatIndex;
      const canSubstituteAI =
        r.viewer.isHost &&
        r.status === 'playing' &&
        state.phase !== 'game_over' &&
        seat.kind === 'human' &&
        !seat.isHost &&
        seat.connectionStatus !== 'connected';

      seatMetaByPlayerId[seat.gamePlayerId] = {
        gamePlayerId: seat.gamePlayerId,
        seatIndex: seat.seatIndex,
        status,
        isMe,
        isHost: seat.isHost,
        canSubstituteAI,
        substitutedFromNickname: seat.substitutedFromNickname,
      };
    }

    return {
      roomCode: r.code,
      connectionStatus: onlineRoom.connectionStatus,
      isSpectator: r.viewer.role !== 'player',
      spectatorRole: r.viewer.spectatorRole,
      isMyTurn: onlineRoom.isMyTurn,
      isHost: r.viewer.isHost,
      canClaimHost: r.canClaimHost && !r.viewer.isHost,
      inviteCopied: onlineRoom.inviteCopied,
      seatMetaByPlayerId,
      submitting: onlineRoom.submitting,
      onCopyInvite: () => void onlineRoom.copyInviteLink(),
      onSubstituteAI: (seatIdx) => void onlineRoom.substituteAi(seatIdx, 'normal'),
      onClaimHost: () => void onlineRoom.claimHost(),
    };
  }, [
    isOnlineGame,
    onlineRoom.room,
    onlineRoom.connectionStatus,
    onlineRoom.isMyTurn,
    onlineRoom.inviteCopied,
    onlineRoom.submitting,
    onlineRoom.copyInviteLink,
    onlineRoom.substituteAi,
    onlineRoom.claimHost,
    state,
  ]);

  const onlineErrorMessage = useMemo(() => {
    if (!onlineRoom.error) return null;
    if (onlineRoom.error.code === 'KICKED') {
      return t.online.kickedNotice;
    }
    if (onlineRoom.error.code === 'NETWORK_ERROR') {
      return t.online.networkError;
    }
    return t.online.errors[onlineRoom.error.code] ?? onlineRoom.error.message ?? t.online.networkError;
  }, [onlineRoom.error, t]);

  const toastMessage = useMemo(() => {
    if (!toast) {
      return null;
    }
    if (toast.payload.kind === 'auto_skip') {
      return formatAutoSkipToast(
        toast.payload.skippedPlayerIds,
        toast.payload.players,
        locale,
      );
    }
    if (toast.payload.kind === 'timeout') {
      return formatTimeoutToast(
        toast.payload.event,
        toast.payload.players,
        locale,
      );
    }
    if (toast.payload.kind === 'room_event') {
      const ev = toast.payload.event;
      switch (ev.type) {
        case 'ai_substituted':
          return t.toast.aiSubstituted(ev.nickname, ev.aiDifficulty);
        case 'host_transferred':
          return t.toast.hostTransferred(ev.newHostNickname);
        case 'round2_started':
          return t.toast.round2Started(ev.survivorNickname);
        case 'player_timed_out':
          return t.toast.timeoutWall(ev.nickname);
        case 'player_auto_skipped':
          return formatAutoSkipToast(ev.skippedPlayerIds, toast.payload.players, locale);
      }
    }
    return toast.payload.message;
  }, [toast, locale, t]);

  const activeVariantForRules: RuleVariant =
    screen === 'game' && state
      ? state.ruleVariant
      : screen === 'online-room' && onlineRoom.room
        ? onlineRoom.room.config.ruleVariant
        : lobbyTab === 'online'
          ? onlineConfig.ruleVariant
          : ruleVariant;

  const onlineMySeatAttr =
    isOnlineGame && onlineRoom.room
      ? onlineRoom.room.viewer.role === 'player'
        ? String(onlineRoom.room.viewer.gamePlayerId ?? onlineRoom.room.viewer.seatIndex ?? 0)
        : 'spectator'
      : undefined;

  return (
    <>
      {screen === 'replay' && activeReplayMatch ? (
        <ReplayViewer match={activeReplayMatch} onClose={handleCloseReplay} />
      ) : screen === 'history' ? (
        <MatchHistoryView
          localMatches={localMatches}
          onlineMatches={onlineMatches}
          onlineAvailable={onlineHistoryAvailable}
          onlineLoading={onlineHistoryLoading}
          onBack={handleBackToLobby}
          onOpenReplay={handleOpenReplay}
          onLoadOnlineMatch={handleLoadOnlineMatch}
          onRefreshOnline={refreshOnlineHistory}
        />
      ) : screen === 'online-room' && onlineRoom.room ? (
        <OnlineWaitingRoom
          room={onlineRoom.room}
          connectionStatus={onlineRoom.connectionStatus}
          submitting={onlineRoom.submitting}
          errorMessage={onlineErrorMessage}
          codeCopied={onlineRoom.codeCopied}
          inviteCopied={onlineRoom.inviteCopied}
          onCopyCode={() => void onlineRoom.copyCode()}
          onCopyInviteLink={() => void onlineRoom.copyInviteLink()}
          onUpdateNickname={handleUpdateOnlineNickname}
          onUpdateConfig={(patch) => void onlineRoom.updateConfig(patch)}
          onSetSeat={(idx, kind, diff) => void onlineRoom.setSeat(idx, kind, diff)}
          onKickSeat={(idx) => void onlineRoom.kickSeat(idx)}
          onStartGame={() => void onlineRoom.startGame()}
          onClaimHost={() => void onlineRoom.claimHost()}
          onLeaveRoom={handleBackToLobby}
          onOpenRules={() => setRulesOpen(true)}
        />
      ) : screen === 'game' && state && (isOnlineGame || history) ? (
        <div
          className="game-screen"
          data-testid="game-screen"
          data-mode={isOnlineGame ? 'online' : 'local'}
          data-room-code={isOnlineGame ? onlineRoom.room!.code : undefined}
          data-my-seat={onlineMySeatAttr}
          data-is-host={
            isOnlineGame ? (onlineRoom.room!.viewer.isHost ? 'true' : 'false') : undefined
          }
          data-variant={state.ruleVariant}
          data-format={state.format}
          data-round={state.isPrisonMatchRound2 ? '2' : '1'}
          data-phase={state.phase}
          data-phase-substate={getPhaseSubstate(state)}
          data-current-player={state.currentPlayerIndex}
          data-turn-number={state.turnNumber}
          data-ai-thinking={isAiTurn ? 'true' : 'false'}
          data-wall-break-active={state.turnSubState.wallBreakActive ? 'true' : 'false'}
        >
          <Board
            state={state}
            validMoves={validMoves}
            interactiveWalls={interactiveWalls}
            pendingBreakTarget={state.turnSubState.pendingBreakChoice?.destination ?? null}
            isInteractive={isBoardInteractive}
            isPaused={isOnlineGame ? false : timerPaused}
            onCellClick={handleCellClick}
            onWallClick={handleWallClick}
          />

          <SidePanel
            state={state}
            validMoves={validMoves}
            canWallBreak={canToggleWallBreak(state)}
            canCancelMove={canCancelTurnMove(state)}
            canUndo={!isOnlineGame && history !== null && canSmartUndo(history)}
            canRedo={!isOnlineGame && history !== null && canSmartRedo(history)}
            isAiTurn={isAiTurn}
            timerRemaining={
              isOnlineGame ? onlineRoom.onlineTimerRemaining : timerRemaining
            }
            timerPaused={isOnlineGame ? false : timerPaused}
            isTimerEffectivelyPaused={isTimerEffectivelyPaused}
            showReopenResult={state.phase === 'game_over' && resultDismissed}
            onSelectPlacementKind={handleSelectPlacementKind}
            onToggleWallBreak={handleToggleWallBreak}
            onCancelMove={handleCancelMove}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onTogglePause={() => {
              if (!isOnlineGame) {
                setTimerPaused((prev) => !prev);
              }
            }}
            onOpenRules={() => setRulesOpen(true)}
            onBackToLobby={handleBackToLobby}
            onReopenResult={() => setResultDismissed(false)}
            onlineProps={sidePanelOnlineProps}
          />

          {toast && toastMessage && (
            <div
              key={toast.id}
              className="game-toast"
              data-testid="game-toast"
              role="alert"
              aria-live="assertive"
            >
              {toastMessage}
            </div>
          )}

          {state.phase === 'game_over' && !resultDismissed && (
            <ResultModal
              state={state}
              mode={isOnlineGame ? 'online' : 'local'}
              isHost={isOnlineGame ? onlineRoom.room!.viewer.isHost : false}
              onlineActionPending={isOnlineGame ? onlineRoom.submitting : false}
              onStartRound2={handleStartRound2}
              onRematch={handleRematch}
              onOnlineRound2={() => void onlineRoom.startRound2()}
              onOnlineRematch={() => void onlineRoom.rematch()}
              onOnlineReturnWaiting={() => void onlineRoom.returnToWaiting()}
              onBackToLobby={handleBackToLobby}
              onInspectBoard={() => setResultDismissed(true)}
            />
          )}
        </div>
      ) : (
        <Lobby
          config={lobbyConfig}
          allSeats={allSeats}
          activeTab={lobbyTab}
          onTabChange={(tab) => {
            onlineRoom.setError(null);
            setLobbyTab(tab);
          }}
          onOpenHistory={handleOpenHistory}
          onlinePanelSlot={
            <OnlinePanel
              redisConfigured={redisConfigured}
              nickname={onlineNickname}
              config={onlineConfig}
              joinCode={joinCode}
              submitting={onlineRoom.submitting}
              errorMessage={onlineErrorMessage}
              onChangeNickname={setOnlineNickname}
              onChangeVariant={(v) =>
                setOnlineConfig((prev) => ({ ...prev, ruleVariant: v }))
              }
              onChangeFormat={(f) =>
                setOnlineConfig((prev) => ({ ...prev, format: f }))
              }
              onChangeTimer={(sec) =>
                setOnlineConfig((prev) => ({ ...prev, timerSeconds: sec }))
              }
              onToggleShuffle={() =>
                setOnlineConfig((prev) => ({ ...prev, shuffleOrder: !prev.shuffleOrder }))
              }
              onChangeJoinCode={setJoinCode}
              onCreateRoom={handleCreateOnlineRoom}
              onJoinRoom={handleJoinOnlineRoom}
            />
          }
          onChangeVariant={setRuleVariant}
          onChangeFormat={setFormat}
          onChangeTimer={setTimerSeconds}
          onToggleShuffle={() => setShuffleOrder((prev) => !prev)}
          onChangeSeatName={handleChangeSeatName}
          onChangeSeatController={handleChangeSeatController}
          onOpenRules={() => setRulesOpen(true)}
          onStart={handleStartFromLobby}
        />
      )}

      <RulesModal
        open={rulesOpen}
        initialVariant={activeVariantForRules}
        onClose={() => setRulesOpen(false)}
      />
    </>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}
