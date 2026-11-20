import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_PLAYER_NAMES,
  breakWallAt,
  canCancelTurnMove,
  canSmartRedo,
  canSmartUndo,
  canToggleWallBreak,
  cancelTurnMove,
  commitTurnSnapshot,
  confirmWallGo2BreakWall,
  createHistory,
  createInitialGameState,
  createPrisonMatchRound2State,
  deselectPiece,
  getInteractiveWalls,
  getPhaseSubstate,
  getPieceValidMoves,
  handleTurnTimeout,
  movePiece,
  placeInitialPiece,
  placeWall,
  selectPiece,
  selectWallGo2BreakDestination,
  setSelectedPlacementKind,
  smartRedo,
  smartUndo,
  toggleWallBreak,
  updatePresentTransient,
} from './engine';
import type {
  AIDifficulty,
  GameFormat,
  GameHistoryState,
  GameState,
  LobbyConfig,
  PlayerConfig,
  RuleVariant,
  TimerSeconds,
  WallEdge,
  WallGo2PieceKind,
} from './engine';
import { applyBotTurnAction, chooseAiPlacement, chooseAiTurn } from './ai';
import { Board } from './components/Board';
import { Lobby } from './components/Lobby';
import { ResultModal } from './components/ResultModal';
import { RulesModal } from './components/RulesModal';
import { SidePanel } from './components/SidePanel';

type AppScreen = 'lobby' | 'game';

interface ToastState {
  id: number;
  message: string;
}

const INITIAL_SEATS: PlayerConfig[] = [
  { name: DEFAULT_PLAYER_NAMES[0], colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
  { name: DEFAULT_PLAYER_NAMES[1], colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
  { name: DEFAULT_PLAYER_NAMES[2], colorToken: 'p3', isAI: false, aiDifficulty: 'normal' },
];

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('lobby');
  const [ruleVariant, setRuleVariant] = useState<RuleVariant>('wallgo1');
  const [format, setFormat] = useState<GameFormat>('3p');
  const [timerSeconds, setTimerSeconds] = useState<TimerSeconds>(0);
  const [shuffleOrder, setShuffleOrder] = useState<boolean>(false);
  const [allSeats, setAllSeats] = useState<PlayerConfig[]>(INITIAL_SEATS);

  const [history, setHistory] = useState<GameHistoryState | null>(null);
  const [sessionId, setSessionId] = useState<number>(0);
  const [rulesOpen, setRulesOpen] = useState<boolean>(false);
  const [resultDismissed, setResultDismissed] = useState<boolean>(false);
  const [timerPaused, setTimerPaused] = useState<boolean>(false);
  const [timerRemaining, setTimerRemaining] = useState<number>(0);
  const [toast, setToast] = useState<ToastState | null>(null);

  const toastSeqRef = useRef<number>(1);
  const prevStateRef = useRef<GameState | null>(null);

  const showToast = useCallback((message: string) => {
    toastSeqRef.current += 1;
    setToast({ id: toastSeqRef.current, message });
  }, []);

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

  const state = history?.present ?? null;

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

  const isTimerEffectivelyPaused = timerPaused || rulesOpen || !isHumanMainTurn;

  // Auto-dismiss toast after 2.5s
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 2500);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Reset turn timer ONLY when entering a new game session or a new turn epoch (never on intra-turn cancel!)
  const turnEpochKey = state
    ? `${sessionId}:${state.phase === 'placement' ? 'placement' : state.phase === 'game_over' ? 'over' : `play:${state.turnNumber}:${state.currentPlayerIndex}`}`
    : 'none';

  useEffect(() => {
    if (!state) return;
    setTimerRemaining(state.timerSeconds);
  }, [turnEpochKey, state?.timerSeconds]);

  // Reset result modal dismissal when leaving game_over (e.g., Undo from game_over)
  useEffect(() => {
    if (state && state.phase !== 'game_over' && resultDismissed) {
      setResultDismissed(false);
    }
  }, [state, resultDismissed]);

  // Surface auto-skip toast whenever a turn transition skips one or more players
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!state || !prev || state === prev) {
      return;
    }
    const turnAdvanced =
      state.turnNumber > prev.turnNumber ||
      (prev.phase === 'placement' && state.phase === 'select_piece');
    if (turnAdvanced && state.lastSkippedPlayerIds.length > 0) {
      const skippedNames = state.lastSkippedPlayerIds
        .map((id) => state.players.find((p) => p.id === id)?.name ?? `플레이어 ${id + 1}`)
        .join(', ');
      showToast(`${skippedNames} 영역 확정으로 턴 패스`);
    }
  }, [state, showToast]);

  // Active 1s interval countdown for human main turns
  useEffect(() => {
    if (
      screen !== 'game' ||
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
  }, [screen, state, isTimerEffectivelyPaused, timerRemaining > 0]);

  // Fire legal timeout action immediately when countdown reaches 0
  useEffect(() => {
    if (
      screen !== 'game' ||
      !state ||
      state.timerSeconds <= 0 ||
      isTimerEffectivelyPaused ||
      timerRemaining > 0
    ) {
      return;
    }
    const timedOutState = handleTurnTimeout(state);
    if (timedOutState !== state) {
      setHistory((prev) => (prev ? commitTurnSnapshot(prev, timedOutState) : prev));
      setTimerRemaining(timedOutState.timerSeconds);
      showToast(timedOutState.lastActionSummary ?? '시간 초과! 랜덤 벽이 자동 설치되었습니다.');
    }
  }, [screen, state, isTimerEffectivelyPaused, timerRemaining, showToast]);

  // Cancellable ~450ms AI turn scheduler
  useEffect(() => {
    if (screen !== 'game' || !state || !isAiTurn || timerPaused || rulesOpen) {
      return;
    }
    const snapshotState = state;
    const aiPlayer = snapshotState.players[snapshotState.currentPlayerIndex];
    if (!aiPlayer) return;

    const timeoutId = window.setTimeout(() => {
      setHistory((prevHistory) => {
        if (!prevHistory || prevHistory.present !== snapshotState) {
          return prevHistory;
        }
        if (snapshotState.phase === 'placement') {
          const placement = chooseAiPlacement(snapshotState, aiPlayer.aiDifficulty);
          const next = placeInitialPiece(
            snapshotState,
            { row: placement.row, col: placement.col },
            placement.kind,
          );
          return next === snapshotState ? prevHistory : commitTurnSnapshot(prevHistory, next);
        }
        const action = chooseAiTurn(snapshotState, aiPlayer.aiDifficulty);
        const next = applyBotTurnAction(snapshotState, action);
        return next === snapshotState ? prevHistory : commitTurnSnapshot(prevHistory, next);
      });
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [screen, state, isAiTurn, timerPaused, rulesOpen]);

  // --- Lobby Handlers ---

  const handleChangeSeatName = useCallback((index: number, name: string) => {
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

  const launchFreshGame = useCallback(
    (initial: GameState) => {
      prevStateRef.current = initial;
      setHistory(createHistory(initial));
      setSessionId((prev) => prev + 1);
      setResultDismissed(false);
      setTimerPaused(false);
      setTimerRemaining(initial.timerSeconds);
      setToast(null);
      setScreen('game');
    },
    [],
  );

  const handleStartFromLobby = useCallback(() => {
    const initial = createInitialGameState(lobbyConfig);
    launchFreshGame(initial);
  }, [lobbyConfig, launchFreshGame]);

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
    const fresh = createInitialGameState(lobbyConfig);
    launchFreshGame(fresh);
  }, [state, lobbyConfig, launchFreshGame]);

  const handleBackToLobby = useCallback(() => {
    setRulesOpen(false);
    setTimerPaused(false);
    setResultDismissed(false);
    setToast(null);
    setScreen('lobby');
  }, []);

  // --- In-Game Board & HUD Handlers ---

  const validMoves = useMemo(() => {
    if (!state || state.phase !== 'move_piece' || state.turnSubState.selectedPieceId === null) {
      return [];
    }
    return getPieceValidMoves(state, state.turnSubState.selectedPieceId);
  }, [state]);

  const interactiveWalls = useMemo(() => {
    if (!state) return [];
    return getInteractiveWalls(state);
  }, [state]);

  const isBoardInteractive =
    screen === 'game' &&
    state !== null &&
    state.phase !== 'game_over' &&
    !isAiTurn &&
    !timerPaused &&
    !rulesOpen;

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (!history || !isBoardInteractive) return;
      const current = history.present;

      if (current.phase === 'placement') {
        const kind =
          current.ruleVariant === 'wallgo2'
            ? current.turnSubState.selectedPlacementKind
            : undefined;
        const next = placeInitialPiece(current, { row, col }, kind);
        if (next !== current) {
          setHistory(commitTurnSnapshot(history, next));
        }
        return;
      }

      const clickedPiece = current.pieces.find((p) => p.row === row && p.col === col);

      if (current.phase === 'select_piece') {
        if (clickedPiece && clickedPiece.ownerId === current.currentPlayerIndex) {
          const next = selectPiece(current, clickedPiece.id);
          if (next !== current) {
            setHistory(updatePresentTransient(history, next));
          }
        }
        return;
      }

      if (current.phase === 'move_piece') {
        // 1. Check valid move targets first (handles normal, stay-in-place, and WG2 wall-break destinations)
        const matchingMove = validMoves.find((m) => m.row === row && m.col === col);
        if (matchingMove) {
          if (matchingMove.moveType === 'wall-break') {
            const next = selectWallGo2BreakDestination(current, { row, col });
            if (next !== current) {
              setHistory(updatePresentTransient(history, next));
            }
          } else {
            const next = movePiece(current, { row, col });
            if (next !== current) {
              setHistory(updatePresentTransient(history, next));
            }
          }
          return;
        }

        // 2. Clicking own piece: switch selection or deselect (locked if WG1 already broke a wall)
        if (clickedPiece && clickedPiece.ownerId === current.currentPlayerIndex) {
          if (clickedPiece.id === current.turnSubState.selectedPieceId) {
            const next = deselectPiece(current);
            if (next !== current) {
              setHistory(updatePresentTransient(history, next));
            }
          } else {
            const next = selectPiece(current, clickedPiece.id);
            if (next !== current) {
              setHistory(updatePresentTransient(history, next));
            }
          }
          return;
        }

        // 3. Clicking non-valid cell: cancel pending WG2 break choice or deselect if safe
        if (current.turnSubState.pendingBreakChoice !== null) {
          const next = cancelTurnMove(current);
          if (next !== current) {
            setHistory(updatePresentTransient(history, next));
          }
          return;
        }

        if (current.turnSubState.brokenWallBeforeMove === null) {
          const next = deselectPiece(current);
          if (next !== current) {
            setHistory(updatePresentTransient(history, next));
          }
        }
      }
    },
    [history, isBoardInteractive, validMoves],
  );

  const handleWallClick = useCallback(
    (edge: WallEdge) => {
      if (!history || !isBoardInteractive) return;
      const current = history.present;

      if (current.phase === 'place_wall') {
        const next = placeWall(current, edge);
        if (next !== current) {
          setHistory(commitTurnSnapshot(history, next));
        }
        return;
      }

      if (current.phase === 'move_piece') {
        if (current.turnSubState.pendingBreakChoice !== null) {
          const next = confirmWallGo2BreakWall(current, edge);
          if (next !== current) {
            setHistory(updatePresentTransient(history, next));
          }
          return;
        }
        if (current.ruleVariant === 'wallgo1' && current.turnSubState.wallBreakActive) {
          const next = breakWallAt(current, edge);
          if (next !== current) {
            setHistory(updatePresentTransient(history, next));
          }
        }
      }
    },
    [history, isBoardInteractive],
  );

  const handleSelectPlacementKind = useCallback(
    (kind: WallGo2PieceKind) => {
      if (!history || !isBoardInteractive) return;
      const next = setSelectedPlacementKind(history.present, kind);
      if (next !== history.present) {
        setHistory(updatePresentTransient(history, next));
      }
    },
    [history, isBoardInteractive],
  );

  const handleToggleWallBreak = useCallback(() => {
    if (!history || !isBoardInteractive) return;
    const next = toggleWallBreak(history.present);
    if (next !== history.present) {
      setHistory(updatePresentTransient(history, next));
    }
  }, [history, isBoardInteractive]);

  const handleCancelMove = useCallback(() => {
    if (!history || !isBoardInteractive) return;
    const next = cancelTurnMove(history.present);
    if (next !== history.present) {
      setHistory(updatePresentTransient(history, next));
    }
  }, [history, isBoardInteractive]);

  const handleUndo = useCallback(() => {
    if (!history) return;
    const nextHistory = smartUndo(history);
    if (nextHistory !== history) {
      setHistory(nextHistory);
      setResultDismissed(false);
    }
  }, [history]);

  const handleRedo = useCallback(() => {
    if (!history) return;
    const nextHistory = smartRedo(history);
    if (nextHistory !== history) {
      setHistory(nextHistory);
      setResultDismissed(false);
    }
  }, [history]);

  const activeVariantForRules = screen === 'game' && state ? state.ruleVariant : ruleVariant;

  return (
    <>
      {screen === 'lobby' || !state || !history ? (
        <Lobby
          config={lobbyConfig}
          allSeats={allSeats}
          onChangeVariant={setRuleVariant}
          onChangeFormat={setFormat}
          onChangeTimer={setTimerSeconds}
          onToggleShuffle={() => setShuffleOrder((prev) => !prev)}
          onChangeSeatName={handleChangeSeatName}
          onChangeSeatController={handleChangeSeatController}
          onOpenRules={() => setRulesOpen(true)}
          onStart={handleStartFromLobby}
        />
      ) : (
        <div
          className="game-screen"
          data-testid="game-screen"
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
            isPaused={timerPaused}
            onCellClick={handleCellClick}
            onWallClick={handleWallClick}
          />

          <SidePanel
            state={state}
            validMoves={validMoves}
            canWallBreak={canToggleWallBreak(state)}
            canCancelMove={canCancelTurnMove(state)}
            canUndo={canSmartUndo(history)}
            canRedo={canSmartRedo(history)}
            isAiTurn={isAiTurn}
            timerRemaining={timerRemaining}
            timerPaused={timerPaused}
            isTimerEffectivelyPaused={isTimerEffectivelyPaused}
            showReopenResult={state.phase === 'game_over' && resultDismissed}
            onSelectPlacementKind={handleSelectPlacementKind}
            onToggleWallBreak={handleToggleWallBreak}
            onCancelMove={handleCancelMove}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onTogglePause={() => setTimerPaused((prev) => !prev)}
            onOpenRules={() => setRulesOpen(true)}
            onBackToLobby={handleBackToLobby}
            onReopenResult={() => setResultDismissed(false)}
          />

          {toast && (
            <div
              key={toast.id}
              className="game-toast"
              data-testid="game-toast"
              role="alert"
              aria-live="assertive"
            >
              {toast.message}
            </div>
          )}

          {state.phase === 'game_over' && !resultDismissed && (
            <ResultModal
              state={state}
              onStartRound2={handleStartRound2}
              onRematch={handleRematch}
              onBackToLobby={handleBackToLobby}
              onInspectBoard={() => setResultDismissed(true)}
            />
          )}
        </div>
      )}

      <RulesModal
        open={rulesOpen}
        initialVariant={activeVariantForRules}
        onClose={() => setRulesOpen(false)}
      />
    </>
  );
}
