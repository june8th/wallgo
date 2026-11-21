import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AIDifficulty, CellPos, GameState, PieceKind, WallEdge } from '../engine';
import {
  AI_STEP_DELAY_MS,
  AI_STEP_FAILOVER_EXTRA_MS,
  POLL_INTERVAL_ACTIVE_MS,
  POLL_INTERVAL_BACKGROUND_MS,
  POLL_INTERVAL_FINISHED_MS,
  TIMEOUT_NON_ACTOR_GRACE_MS,
  parseRoomCode,
} from '../shared';
import type {
  ApiErrorCode,
  Locale,
  OnlineGameAction,
  OnlineRoomConfig,
  PublicRoomSnapshot,
  RoomCommand,
  RoomEventNotice,
  RoomPresenceSummary,
  TimeoutPartialMove,
} from '../shared';
import {
  getOrCreateProfile,
  getRoomSession,
  removeRoomSession,
  saveProfileNickname,
  saveRoomSession,
} from '../storage';
import {
  ApiClientError,
  createRoom,
  getRoom,
  sendPingAwayBeacon,
  sendRoomCommand,
} from './client';

export type OnlineConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface OnlineErrorState {
  code: ApiErrorCode | 'NETWORK_ERROR' | 'KICKED';
  message?: string;
}

export interface UseOnlineRoomOptions {
  locale: Locale;
  onRoomEvent?: (event: RoomEventNotice) => void;
  onKicked?: () => void;
  onRoomClosed?: (code: ApiErrorCode) => void;
}

export function extractRoomCodeFromLocation(loc: {
  pathname: string;
  search: string;
}): string | null {
  try {
    const params = new URLSearchParams(loc.search);
    const queryRoom = params.get('room');
    if (queryRoom && queryRoom.trim().length > 0) {
      return parseRoomCode(queryRoom);
    }
    const pathMatch = /^\/room\/([^/]+)\/?$/i.exec(loc.pathname);
    if (pathMatch && pathMatch[1]) {
      return parseRoomCode(decodeURIComponent(pathMatch[1]));
    }
  } catch {
    return null;
  }
  return null;
}

export function extractRawInviteCodeFromLocation(loc: {
  pathname: string;
  search: string;
}): string | null {
  try {
    const params = new URLSearchParams(loc.search);
    const queryRoom = params.get('room');
    if (queryRoom && queryRoom.trim().length > 0) {
      return queryRoom.trim();
    }
    const pathMatch = /^\/room\/([^/]+)\/?$/i.exec(loc.pathname);
    if (pathMatch && pathMatch[1]) {
      return decodeURIComponent(pathMatch[1]).trim();
    }
  } catch {
    return null;
  }
  return null;
}

export function syncRoomUrl(roomCode: string | null): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) {
    return;
  }
  try {
    const url = new URL(window.location.href);
    if (roomCode) {
      const target = `/?room=${encodeURIComponent(roomCode)}`;
      if (url.pathname !== '/' || url.searchParams.get('room') !== roomCode) {
        window.history.replaceState(null, '', target);
      }
    } else if (url.searchParams.has('room') || /^\/room\//i.test(url.pathname)) {
      window.history.replaceState(null, '', '/');
    }
  } catch {
    // Ignore restricted history API environments
  }
}

export function buildCommitTurnActionFromDraft(
  draft: GameState,
  placeWallEdge: WallEdge,
): OnlineGameAction | null {
  if (draft.phase !== 'place_wall') {
    return null;
  }
  const pieceId = draft.turnSubState.selectedPieceId;
  if (!pieceId) {
    return null;
  }
  const piece = draft.pieces.find((p) => p.id === pieceId);
  if (!piece) {
    return null;
  }
  const broken = draft.turnSubState.brokenWallBeforeMove;
  return {
    type: 'commit_turn',
    pieceId,
    useWallBreak: broken !== null,
    breakWall: broken
      ? { orientation: broken.orientation, row: broken.row, col: broken.col }
      : null,
    destination: { row: piece.row, col: piece.col },
    placeWall: {
      orientation: placeWallEdge.orientation,
      row: placeWallEdge.row,
      col: placeWallEdge.col,
    },
  };
}

export function buildTimeoutPartialMoveFromDraft(
  draft: GameState | null,
): TimeoutPartialMove | undefined {
  if (!draft || draft.phase !== 'place_wall') {
    return undefined;
  }
  const pieceId = draft.turnSubState.selectedPieceId;
  if (!pieceId) {
    return undefined;
  }
  const piece = draft.pieces.find((p) => p.id === pieceId);
  if (!piece) {
    return undefined;
  }
  const broken = draft.turnSubState.brokenWallBeforeMove;
  return {
    pieceId,
    useWallBreak: broken !== null,
    breakWall: broken
      ? { orientation: broken.orientation, row: broken.row, col: broken.col }
      : null,
    destination: { row: piece.row, col: piece.col },
  };
}

function mergePresenceSummary(
  prev: PublicRoomSnapshot,
  serverNow: number,
  summary: RoomPresenceSummary,
): PublicRoomSnapshot {
  const seatStatusByIndex = new Map(
    summary.seats.map((s) => [s.seatIndex, s.connectionStatus]),
  );
  const specStatusById = new Map(
    summary.spectators.map((s) => [s.memberId, s.connectionStatus]),
  );

  let changed = prev.canClaimHost !== summary.canClaimHost;
  const nextSeats = prev.seats.map((seat) => {
    const nextStatus = seatStatusByIndex.get(seat.seatIndex);
    if (nextStatus && nextStatus !== seat.connectionStatus) {
      changed = true;
      return { ...seat, connectionStatus: nextStatus };
    }
    return seat;
  });

  const nextSpecs = prev.spectators.map((spec) => {
    const nextStatus = specStatusById.get(spec.memberId);
    if (nextStatus && nextStatus !== spec.connectionStatus) {
      changed = true;
      return { ...spec, connectionStatus: nextStatus };
    }
    return spec;
  });

  if (!changed) {
    return prev;
  }
  return {
    ...prev,
    serverNow,
    canClaimHost: summary.canClaimHost,
    seats: nextSeats,
    spectators: nextSpecs,
  };
}

async function copyTextWithFallback(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function useOnlineRoom({
  locale,
  onRoomEvent,
  onKicked,
  onRoomClosed,
}: UseOnlineRoomOptions) {
  const [room, setRoom] = useState<PublicRoomSnapshot | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<OnlineConnectionStatus>('connected');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<OnlineErrorState | null>(null);
  const [draftState, setDraftState] = useState<GameState | null>(null);
  const [onlineTimerRemaining, setOnlineTimerRemaining] = useState<number>(0);
  const [codeCopied, setCodeCopied] = useState<boolean>(false);
  const [inviteCopied, setInviteCopied] = useState<boolean>(false);

  const epochRef = useRef<number>(0);
  const roomRef = useRef<PublicRoomSnapshot | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const draftStateRef = useRef<GameState | null>(null);
  const clockOffsetRef = useRef<number>(0);
  const consecutiveFailuresRef = useRef<number>(0);
  const lastSeenEventIdRef = useRef<number>(0);
  const explicitlyLeavingRef = useRef<boolean>(false);
  const timeoutSentVersionRef = useRef<number>(-1);
  const aiStepInFlightVersionRef = useRef<number>(-1);
  const onRoomEventRef = useRef(onRoomEvent);
  const onKickedRef = useRef(onKicked);
  const onRoomClosedRef = useRef(onRoomClosed);

  onRoomEventRef.current = onRoomEvent;
  onKickedRef.current = onKicked;
  onRoomClosedRef.current = onRoomClosed;
  roomRef.current = room;
  sessionTokenRef.current = sessionToken;
  draftStateRef.current = draftState;

  const clearRoomState = useCallback((options?: { clearUrl?: boolean; removeSession?: boolean }) => {
    epochRef.current += 1;
    const prevCode = roomRef.current?.code ?? null;
    if (options?.removeSession && prevCode) {
      removeRoomSession(prevCode);
    }
    roomRef.current = null;
    sessionTokenRef.current = null;
    draftStateRef.current = null;
    consecutiveFailuresRef.current = 0;
    lastSeenEventIdRef.current = 0;
    timeoutSentVersionRef.current = -1;
    aiStepInFlightVersionRef.current = -1;
    setRoom(null);
    setSessionToken(null);
    setDraftState(null);
    setConnectionStatus('connected');
    setSubmitting(false);
    setCodeCopied(false);
    setInviteCopied(false);
    if (options?.clearUrl !== false) {
      syncRoomUrl(null);
    }
  }, []);

  const applySnapshot = useCallback(
    (nextRoom: PublicRoomSnapshot, nextToken?: string) => {
      clockOffsetRef.current = nextRoom.serverNow - Date.now();
      consecutiveFailuresRef.current = 0;
      setConnectionStatus('connected');

      if (nextRoom.viewer.wasKicked) {
        clearRoomState({ clearUrl: true, removeSession: true });
        setError({ code: 'KICKED' });
        onKickedRef.current?.();
        return;
      }

      const prevRoom = roomRef.current;
      const tokenToKeep = nextToken ?? sessionTokenRef.current;
      if (tokenToKeep) {
        sessionTokenRef.current = tokenToKeep;
        setSessionToken(tokenToKeep);
        saveRoomSession(nextRoom.code, tokenToKeep);
      }

      const switchedRoom = prevRoom?.code !== nextRoom.code;
      const versionChanged = prevRoom?.version !== nextRoom.version;

      if (switchedRoom) {
        lastSeenEventIdRef.current = nextRoom.lastEvent?.id ?? 0;
      } else if (
        nextRoom.lastEvent &&
        nextRoom.lastEvent.id > lastSeenEventIdRef.current
      ) {
        lastSeenEventIdRef.current = nextRoom.lastEvent.id;
        onRoomEventRef.current?.(nextRoom.lastEvent);
      }

      if (switchedRoom || versionChanged || nextRoom.status !== 'playing') {
        draftStateRef.current = null;
        setDraftState(null);
        timeoutSentVersionRef.current = -1;
      }

      roomRef.current = nextRoom;
      setRoom(nextRoom);
      syncRoomUrl(nextRoom.code);
    },
    [clearRoomState],
  );

  // Compute remaining seconds for online turn timer
  const computeRemainingSeconds = useCallback((snapshot: PublicRoomSnapshot | null): number => {
    const gs = snapshot?.gameState;
    if (
      !snapshot ||
      snapshot.status !== 'playing' ||
      !gs ||
      gs.timerSeconds <= 0 ||
      gs.phase === 'placement' ||
      gs.phase === 'game_over' ||
      snapshot.turnStartedAt === null
    ) {
      return gs?.timerSeconds ?? 0;
    }
    const serverNowEst = Date.now() + clockOffsetRef.current;
    const deadline = snapshot.turnStartedAt + gs.timerSeconds * 1000;
    return Math.max(0, Math.ceil((deadline - serverNowEst) / 1000));
  }, []);

  // Poll loop (visibility-aware, zero AbortController.abort() on exit -> zero net::ERR_ABORTED)
  useEffect(() => {
    if (!room) {
      return;
    }
    const myEpoch = epochRef.current;
    let timerId: number | null = null;
    let pollingNow = false;
    let active = true;

    const getIntervalMs = (): number => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return POLL_INTERVAL_BACKGROUND_MS;
      }
      const cur = roomRef.current;
      return cur?.status === 'finished'
        ? POLL_INTERVAL_FINISHED_MS
        : POLL_INTERVAL_ACTIVE_MS;
    };

    const scheduleNext = () => {
      if (!active || epochRef.current !== myEpoch) {
        return;
      }
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      timerId = window.setTimeout(() => {
        void runPoll();
      }, getIntervalMs());
    };

    const runPoll = async () => {
      if (!active || epochRef.current !== myEpoch || pollingNow) {
        return;
      }
      const cur = roomRef.current;
      if (!cur) {
        return;
      }
      pollingNow = true;
      try {
        const res = await getRoom(cur.code, {
          sessionToken: sessionTokenRef.current ?? undefined,
          sinceVersion: cur.version,
        });
        if (!active || epochRef.current !== myEpoch) {
          return;
        }
        if (res.unchanged) {
          clockOffsetRef.current = res.serverNow - Date.now();
          consecutiveFailuresRef.current = 0;
          setConnectionStatus('connected');
          setRoom((prev) => {
            if (!prev || prev.code !== cur.code || prev.version !== res.version) {
              return prev;
            }
            const merged = mergePresenceSummary(prev, res.serverNow, res.presenceSummary);
            roomRef.current = merged;
            return merged;
          });
        } else {
          applySnapshot(res.room);
        }
      } catch (err) {
        if (!active || epochRef.current !== myEpoch) {
          return;
        }
        if (err instanceof ApiClientError && err.code === 'ROOM_NOT_FOUND') {
          clearRoomState({ clearUrl: true, removeSession: true });
          setError({ code: 'ROOM_NOT_FOUND', message: err.message });
          onRoomClosedRef.current?.('ROOM_NOT_FOUND');
          return;
        }
        consecutiveFailuresRef.current += 1;
        setConnectionStatus(
          consecutiveFailuresRef.current >= 3 ? 'disconnected' : 'reconnecting',
        );
      } finally {
        pollingNow = false;
        scheduleNext();
      }
    };

    const handleVisibilityChange = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        active &&
        epochRef.current === myEpoch
      ) {
        if (timerId !== null) {
          window.clearTimeout(timerId);
          timerId = null;
        }
        void runPoll();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    scheduleNext();

    return () => {
      active = false;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [room?.code, applySnapshot, clearRoomState]);

  // pagehide sendBeacon ping_away (4s refresh grace)
  useEffect(() => {
    if (!room || !sessionToken || typeof window === 'undefined') {
      return;
    }
    const handlePageHide = () => {
      if (explicitlyLeavingRef.current) {
        return;
      }
      const curRoom = roomRef.current;
      const curToken = sessionTokenRef.current;
      if (curRoom && curToken) {
        sendPingAwayBeacon(curRoom.code, curToken);
      }
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [room?.code, sessionToken]);

  // Synchronized online turn timer countdown + timeout trigger
  useEffect(() => {
    if (!room || room.status !== 'playing' || !room.gameState) {
      setOnlineTimerRemaining(0);
      return;
    }
    const gs = room.gameState;
    setOnlineTimerRemaining(computeRemainingSeconds(room));

    if (
      gs.timerSeconds <= 0 ||
      gs.phase === 'placement' ||
      gs.phase === 'game_over' ||
      room.turnStartedAt === null
    ) {
      return;
    }
    const activePlayer = gs.players[gs.currentPlayerIndex];
    if (!activePlayer || activePlayer.isAI) {
      return;
    }

    const myEpoch = epochRef.current;
    const isMyTurn =
      room.viewer.role === 'player' && room.viewer.gamePlayerId === activePlayer.id;
    const canTriggerTimeout = room.viewer.role === 'player' || room.viewer.isHost;

    const tick = () => {
      const cur = roomRef.current;
      const curToken = sessionTokenRef.current;
      if (!cur || !curToken || epochRef.current !== myEpoch || cur.version !== room.version) {
        return;
      }
      setOnlineTimerRemaining(computeRemainingSeconds(cur));

      if (
        !canTriggerTimeout ||
        cur.turnStartedAt === null ||
        timeoutSentVersionRef.current === cur.version
      ) {
        return;
      }

      const serverNowEst = Date.now() + clockOffsetRef.current;
      const elapsed = serverNowEst - cur.turnStartedAt;
      const threshold = isMyTurn
        ? gs.timerSeconds * 1000
        : gs.timerSeconds * 1000 + TIMEOUT_NON_ACTOR_GRACE_MS;

      if (elapsed >= threshold) {
        timeoutSentVersionRef.current = cur.version;
        const partialMove = isMyTurn
          ? buildTimeoutPartialMoveFromDraft(draftStateRef.current)
          : undefined;
        void sendRoomCommand(cur.code, {
          op: 'timeout',
          sessionToken: curToken,
          expectedVersion: cur.version,
          ...(partialMove ? { partialMove } : {}),
        })
          .then((res) => {
            if (epochRef.current !== myEpoch) return;
            applySnapshot(res.room);
            if (!res.executed && res.retryAfterMs && res.retryAfterMs > 0) {
              window.setTimeout(() => {
                if (timeoutSentVersionRef.current === cur.version) {
                  timeoutSentVersionRef.current = -1;
                }
              }, res.retryAfterMs + 50);
            }
          })
          .catch((err) => {
            if (epochRef.current !== myEpoch) return;
            if (err instanceof ApiClientError && err.room) {
              applySnapshot(err.room);
            } else {
              timeoutSentVersionRef.current = -1;
            }
          });
      }
    };

    const intervalId = window.setInterval(tick, 250);
    return () => window.clearInterval(intervalId);
  }, [room, computeRemainingSeconds, applySnapshot]);

  // Paced idempotent online AI turn driver (host primary, non-host +800ms failover)
  useEffect(() => {
    if (
      !room ||
      !sessionToken ||
      room.status !== 'playing' ||
      !room.gameState ||
      room.gameState.phase === 'game_over'
    ) {
      return;
    }
    const activePlayer = room.gameState.players[room.gameState.currentPlayerIndex];
    if (!activePlayer?.isAI) {
      return;
    }
    const canDriveAi = room.viewer.role === 'player' || room.viewer.isHost;
    if (!canDriveAi) {
      return;
    }

    const myEpoch = epochRef.current;
    const targetVersion = room.version;
    const serverNowEst = Date.now() + clockOffsetRef.current;
    const baseDelay =
      room.nextAiStepAt !== null
        ? Math.max(0, room.nextAiStepAt - serverNowEst)
        : AI_STEP_DELAY_MS;
    const extraDelay = room.viewer.isHost ? 0 : AI_STEP_FAILOVER_EXTRA_MS;
    const totalDelay = Math.max(25, baseDelay + extraDelay);

    let retryTimerId: number | null = null;

    const triggerStep = () => {
      const cur = roomRef.current;
      const curToken = sessionTokenRef.current;
      if (
        !cur ||
        !curToken ||
        epochRef.current !== myEpoch ||
        cur.version !== targetVersion ||
        aiStepInFlightVersionRef.current === targetVersion
      ) {
        return;
      }
      aiStepInFlightVersionRef.current = targetVersion;

      void sendRoomCommand(cur.code, {
        op: 'ai_step',
        sessionToken: curToken,
        expectedVersion: targetVersion,
      })
        .then((res) => {
          if (epochRef.current !== myEpoch) return;
          aiStepInFlightVersionRef.current = -1;
          applySnapshot(res.room);
          if (
            !res.executed &&
            res.room.version === targetVersion &&
            res.retryAfterMs &&
            res.retryAfterMs > 0
          ) {
            retryTimerId = window.setTimeout(triggerStep, res.retryAfterMs + 60);
          }
        })
        .catch((err) => {
          if (epochRef.current !== myEpoch) return;
          aiStepInFlightVersionRef.current = -1;
          if (err instanceof ApiClientError && err.room) {
            applySnapshot(err.room);
          }
        });
    };

    const timerId = window.setTimeout(triggerStep, totalDelay);
    return () => {
      window.clearTimeout(timerId);
      if (retryTimerId !== null) {
        window.clearTimeout(retryTimerId);
      }
    };
  }, [room, sessionToken, applySnapshot]);

  // --- Room Entry & Command Helpers ---

  const createNewRoom = useCallback(
    async (rawNickname: string, config: OnlineRoomConfig): Promise<PublicRoomSnapshot | null> => {
      setError(null);
      setSubmitting(true);
      explicitlyLeavingRef.current = false;
      try {
        const profile = saveProfileNickname(rawNickname);
        const res = await createRoom({
          nickname: profile.nickname,
          clientId: profile.clientId,
          config,
          locale,
        });
        epochRef.current += 1;
        applySnapshot(res.room, res.sessionToken);
        return res.room;
      } catch (err) {
        if (err instanceof ApiClientError) {
          setError({ code: err.code, message: err.message });
        } else {
          setError({ code: 'NETWORK_ERROR' });
        }
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [locale, applySnapshot],
  );

  const joinExistingRoom = useCallback(
    async (
      rawCode: string,
      rawNickname?: string,
      options?: { preferStoredSession?: boolean },
    ): Promise<PublicRoomSnapshot | null> => {
      setError(null);
      const parsedCode = parseRoomCode(rawCode);
      if (!parsedCode) {
        setError({ code: 'INVALID_ROOM_CODE' });
        return null;
      }
      setSubmitting(true);
      explicitlyLeavingRef.current = false;
      try {
        const profile =
          rawNickname !== undefined
            ? saveProfileNickname(rawNickname)
            : getOrCreateProfile();
        const storedSession =
          options?.preferStoredSession !== false ? getRoomSession(parsedCode) : null;

        const res = await sendRoomCommand(parsedCode, {
          op: 'join',
          nickname: profile.nickname,
          clientId: profile.clientId,
          ...(storedSession ? { sessionToken: storedSession.sessionToken } : {}),
          locale,
        });
        epochRef.current += 1;
        applySnapshot(res.room, res.sessionToken ?? storedSession?.sessionToken);
        return res.room;
      } catch (err) {
        if (err instanceof ApiClientError) {
          if (err.code === 'UNAUTHORIZED' || err.code === 'ROOM_NOT_FOUND') {
            removeRoomSession(parsedCode);
          }
          setError({ code: err.code, message: err.message });
        } else {
          setError({ code: 'NETWORK_ERROR' });
        }
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [locale, applySnapshot],
  );

  const runCommand = useCallback(
    async (
      buildCommand: (cur: PublicRoomSnapshot, token: string) => RoomCommand,
      options?: { syncBeforeWrite?: boolean },
    ): Promise<PublicRoomSnapshot | null> => {
      let cur = roomRef.current;
      const token = sessionTokenRef.current;
      if (!cur || !token) {
        return null;
      }
      const initialStatus = cur.status;
      setError(null);
      setSubmitting(true);
      const myEpoch = epochRef.current;
      try {
        if (options?.syncBeforeWrite) {
          const pre = await getRoom(cur.code, {
            sessionToken: token,
            sinceVersion: cur.version,
          });
          if (epochRef.current !== myEpoch) {
            return null;
          }
          if (!pre.unchanged) {
            applySnapshot(pre.room);
            if (pre.room.viewer.wasKicked || pre.room.status !== initialStatus) {
              return null;
            }
            cur = pre.room;
          }
        }

        const maxAttempts = options?.syncBeforeWrite ? 3 : 1;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const res = await sendRoomCommand(cur.code, buildCommand(cur, token));
            if (epochRef.current !== myEpoch) {
              return null;
            }
            applySnapshot(res.room, res.sessionToken);
            return res.room;
          } catch (err) {
            if (epochRef.current !== myEpoch) {
              return null;
            }
            if (
              options?.syncBeforeWrite &&
              attempt + 1 < maxAttempts &&
              err instanceof ApiClientError &&
              err.code === 'VERSION_CONFLICT' &&
              err.room &&
              !err.room.viewer.wasKicked &&
              err.room.status === initialStatus
            ) {
              applySnapshot(err.room);
              cur = err.room;
              continue;
            }
            throw err;
          }
        }
        return null;
      } catch (err) {
        if (epochRef.current !== myEpoch) {
          return null;
        }
        if (err instanceof ApiClientError) {
          if (err.room) {
            applySnapshot(err.room);
          }
          if (err.code === 'ROOM_NOT_FOUND') {
            clearRoomState({ clearUrl: true, removeSession: true });
            onRoomClosedRef.current?.('ROOM_NOT_FOUND');
          }
          if (err.code !== 'VERSION_CONFLICT') {
            setError({ code: err.code, message: err.message });
          }
        } else {
          setError({ code: 'NETWORK_ERROR' });
        }
        return null;
      } finally {
        if (epochRef.current === myEpoch) {
          setSubmitting(false);
        }
      }
    },
    [applySnapshot, clearRoomState],
  );

  const leaveRoom = useCallback(async (): Promise<void> => {
    const cur = roomRef.current;
    const token = sessionTokenRef.current;
    explicitlyLeavingRef.current = true;
    clearRoomState({ clearUrl: true, removeSession: true });
    setError(null);

    if (cur && token) {
      try {
        await sendRoomCommand(cur.code, { op: 'leave', sessionToken: token });
      } catch {
        // Ignore network/404 errors on best-effort leave
      }
    }
    explicitlyLeavingRef.current = false;
  }, [clearRoomState]);

  const updateNickname = useCallback(
    async (rawNickname: string): Promise<PublicRoomSnapshot | null> => {
      const profile = saveProfileNickname(rawNickname);
      return runCommand(
        (cur, token) => ({
          op: 'update_nickname',
          sessionToken: token,
          expectedVersion: cur.version,
          nickname: profile.nickname,
        }),
        { syncBeforeWrite: true },
      );
    },
    [runCommand],
  );

  const updateConfig = useCallback(
    async (patch: Partial<OnlineRoomConfig>): Promise<PublicRoomSnapshot | null> =>
      runCommand(
        (cur, token) => ({
          op: 'update_config',
          sessionToken: token,
          expectedVersion: cur.version,
          patch,
        }),
        { syncBeforeWrite: true },
      ),
    [runCommand],
  );

  const setSeat = useCallback(
    async (
      seatIndex: number,
      kind: 'open' | 'ai',
      aiDifficulty?: AIDifficulty,
    ): Promise<PublicRoomSnapshot | null> =>
      runCommand(
        (cur, token) => ({
          op: 'set_seat',
          sessionToken: token,
          expectedVersion: cur.version,
          seatIndex,
          kind,
          ...(kind === 'ai' ? { aiDifficulty: aiDifficulty ?? 'normal' } : {}),
        }),
        { syncBeforeWrite: true },
      ),
    [runCommand],
  );

  const kickSeat = useCallback(
    async (seatIndex: number): Promise<PublicRoomSnapshot | null> =>
      runCommand(
        (cur, token) => ({
          op: 'kick_seat',
          sessionToken: token,
          expectedVersion: cur.version,
          seatIndex,
        }),
        { syncBeforeWrite: true },
      ),
    [runCommand],
  );

  const startGame = useCallback(
    async (): Promise<PublicRoomSnapshot | null> =>
      runCommand(
        (cur, token) => ({
          op: 'start_game',
          sessionToken: token,
          expectedVersion: cur.version,
        }),
        { syncBeforeWrite: true },
      ),
    [runCommand],
  );

  const commitPlacement = useCallback(
    async (pos: CellPos, kind?: PieceKind): Promise<PublicRoomSnapshot | null> =>
      runCommand((cur, token) => ({
        op: 'game_action',
        sessionToken: token,
        expectedVersion: cur.version,
        action: {
          type: 'commit_placement',
          pos,
          ...(kind !== undefined ? { kind } : {}),
        },
      })),
    [runCommand],
  );

  const commitTurn = useCallback(
    async (action: OnlineGameAction): Promise<PublicRoomSnapshot | null> =>
      runCommand((cur, token) => ({
        op: 'game_action',
        sessionToken: token,
        expectedVersion: cur.version,
        action,
      })),
    [runCommand],
  );

  const substituteAi = useCallback(
    async (
      seatIndex: number,
      aiDifficulty: AIDifficulty = 'normal',
    ): Promise<PublicRoomSnapshot | null> =>
      runCommand(
        (cur, token) => ({
          op: 'substitute_ai',
          sessionToken: token,
          expectedVersion: cur.version,
          seatIndex,
          aiDifficulty,
        }),
        { syncBeforeWrite: true },
      ),
    [runCommand],
  );

  const claimHost = useCallback(
    async (): Promise<PublicRoomSnapshot | null> =>
      runCommand(
        (cur, token) => ({
          op: 'claim_host',
          sessionToken: token,
          expectedVersion: cur.version,
        }),
        { syncBeforeWrite: true },
      ),
    [runCommand],
  );

  const startRound2 = useCallback(
    async (overridePair?: [number, number]): Promise<PublicRoomSnapshot | null> =>
      runCommand(
        (cur, token) => ({
          op: 'start_round2',
          sessionToken: token,
          expectedVersion: cur.version,
          ...(overridePair ? { overridePair } : {}),
        }),
        { syncBeforeWrite: true },
      ),
    [runCommand],
  );

  const rematch = useCallback(
    async (): Promise<PublicRoomSnapshot | null> =>
      runCommand(
        (cur, token) => ({
          op: 'rematch',
          sessionToken: token,
          expectedVersion: cur.version,
        }),
        { syncBeforeWrite: true },
      ),
    [runCommand],
  );

  const returnToWaiting = useCallback(
    async (): Promise<PublicRoomSnapshot | null> =>
      runCommand(
        (cur, token) => ({
          op: 'return_to_waiting',
          sessionToken: token,
          expectedVersion: cur.version,
        }),
        { syncBeforeWrite: true },
      ),
    [runCommand],
  );

  const copyCode = useCallback(async () => {
    const code = roomRef.current?.code;
    if (!code) return;
    await copyTextWithFallback(code);
    setCodeCopied(true);
    window.setTimeout(() => setCodeCopied(false), 2000);
  }, []);

  const copyInviteLink = useCallback(async () => {
    const code = roomRef.current?.code;
    if (!code || typeof window === 'undefined') return;
    const url = `${window.location.origin}/?room=${code}`;
    await copyTextWithFallback(url);
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 2000);
  }, []);

  const isMyTurn = useMemo(() => {
    if (!room || room.status !== 'playing' || !room.gameState) {
      return false;
    }
    if (room.gameState.phase === 'game_over') {
      return false;
    }
    if (room.viewer.role !== 'player' || room.viewer.gamePlayerId === null) {
      return false;
    }
    const activePlayer = room.gameState.players[room.gameState.currentPlayerIndex];
    if (!activePlayer || activePlayer.isAI) {
      return false;
    }
    return activePlayer.id === room.viewer.gamePlayerId;
  }, [room]);

  return {
    room,
    sessionToken,
    connectionStatus,
    submitting,
    error,
    setError,
    draftState,
    setDraftState,
    onlineTimerRemaining,
    isMyTurn,
    codeCopied,
    inviteCopied,
    createNewRoom,
    joinExistingRoom,
    leaveRoom,
    clearRoomState,
    updateNickname,
    updateConfig,
    setSeat,
    kickSeat,
    startGame,
    commitPlacement,
    commitTurn,
    substituteAi,
    claimHost,
    startRound2,
    rematch,
    returnToWaiting,
    copyCode,
    copyInviteLink,
  };
}
