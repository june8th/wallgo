import { BOARD_SIZE } from './types.js';
import type {
  AIDifficulty,
  AtomicTurnAction,
  CellPos,
  GameHistoryState,
  GamePhase,
  GameState,
  HistorySnapshot,
  InteractiveWallSlot,
  PhaseSubstate,
  PieceKind,
  PlacedWall,
  PlacementActionEvent,
  PlayerScoreSummary,
  RngFn,
  TurnActionEvent,
  TurnTimeoutResolution,
  WallEdge,
  WallGo2PieceKind,
} from './types.js';
import {
  cellToCoordLabel,
  getLegalWallPlacements,
  getPieceBreakableWalls,
  getWallGo1BreakableWalls,
  getWallGo1Moves,
  getWallGo2BreakTargets,
  getWallGo2NormalMoves,
  hasWall,
  isInBounds,
  isSameCellPos,
  isSameWallEdge,
  isValidWallEdge,
  wallKey,
  withoutWall,
} from './moves.js';
import { analyzeTerritory, computeRankings, shouldAutoSkipPlayer } from './territory.js';
import { createFreshTurnSubState, getRemainingPlacementKinds } from './setup.js';

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
}

function cloneCellPos(pos: CellPos): CellPos {
  return {
    row: normalizeZero(pos.row),
    col: normalizeZero(pos.col),
  };
}

function cloneWallEdge(edge: WallEdge): WallEdge {
  return {
    orientation: edge.orientation,
    row: normalizeZero(edge.row),
    col: normalizeZero(edge.col),
  };
}

function pickRandom<T>(items: readonly T[], rng: RngFn): T {
  const raw = rng();
  const safe = Number.isFinite(raw) ? raw : 0;
  const index = Math.min(items.length - 1, Math.max(0, Math.floor(safe * items.length)));
  return items[index];
}

// ============================================================================
// Consumer Convenience Selectors (M4 UI / E2E Contract)
// ============================================================================

export function getPhaseSubstate(state: GameState): PhaseSubstate {
  if (state.phase !== 'move_piece') {
    return 'idle';
  }
  if (state.turnSubState.pendingBreakChoice !== null) {
    return 'choose_break_wall';
  }
  if (state.turnSubState.wallBreakActive) {
    return state.ruleVariant === 'wallgo1' ? 'wall_break_select_wall' : 'wall_break_move';
  }
  return 'idle';
}

export function canToggleWallBreak(state: GameState): boolean {
  if (state.phase !== 'move_piece' || state.format !== '3p') {
    return false;
  }
  const pieceId = state.turnSubState.selectedPieceId;
  if (pieceId === null || state.turnSubState.brokenWallBeforeMove !== null) {
    return false;
  }
  const actor = state.players[state.currentPlayerIndex];
  if (!actor || actor.wallBreaksRemaining <= 0) {
    return false;
  }
  if (state.turnSubState.wallBreakActive) {
    return true;
  }
  return getPieceBreakableWalls(state, pieceId).length > 0;
}

export function canCancelTurnMove(state: GameState): boolean {
  if (state.phase === 'place_wall') {
    return true;
  }
  if (state.phase === 'move_piece') {
    return (
      state.turnSubState.brokenWallBeforeMove !== null ||
      state.turnSubState.pendingBreakChoice !== null
    );
  }
  return false;
}

export function getInteractiveWalls(state: GameState): InteractiveWallSlot[] {
  if (state.phase === 'place_wall') {
    const pieceId = state.turnSubState.selectedPieceId;
    if (pieceId === null) {
      return [];
    }
    const piece = state.pieces.find((p) => p.id === pieceId);
    if (!piece) {
      return [];
    }
    return getLegalWallPlacements(state, { row: piece.row, col: piece.col }).map((edge) => ({
      orientation: edge.orientation,
      row: edge.row,
      col: edge.col,
      state: 'placeable',
    }));
  }

  if (state.phase === 'move_piece') {
    if (state.turnSubState.pendingBreakChoice !== null) {
      return state.turnSubState.pendingBreakChoice.breakableWalls.map((edge) => ({
        orientation: edge.orientation,
        row: normalizeZero(edge.row),
        col: normalizeZero(edge.col),
        state: 'breakable-choice',
      }));
    }
    if (
      state.ruleVariant === 'wallgo1' &&
      state.turnSubState.wallBreakActive &&
      state.turnSubState.brokenWallBeforeMove === null &&
      state.turnSubState.selectedPieceId !== null
    ) {
      return getWallGo1BreakableWalls(state, state.turnSubState.selectedPieceId).map((edge) => ({
        orientation: edge.orientation,
        row: edge.row,
        col: edge.col,
        state: 'breakable',
      }));
    }
  }

  return [];
}

export function isDirtyIntraTurn(state: GameState): boolean {
  return state.phase === 'place_wall' || state.turnSubState.brokenWallBeforeMove !== null;
}

// ============================================================================
// Internal Turn Advancement & Wall Go II Break Execution Helpers
// ============================================================================

function advanceTurnWithAutoSkip(
  state: GameState,
  startPlayerIndex: number,
  isFromPlacement: boolean,
): GameState {
  const n = state.players.length;
  const skippedIds: number[] = [];

  for (let offset = 0; offset < n; offset++) {
    const candidateIdx = (startPlayerIndex + offset) % n;
    const candidate = state.players[candidateIdx];
    if (!candidate) {
      continue;
    }
    if (shouldAutoSkipPlayer(state, candidate.id)) {
      skippedIds.push(candidate.id);
    } else {
      return {
        ...state,
        phase: 'select_piece',
        currentPlayerIndex: candidateIdx,
        lastSkippedPlayerIds: skippedIds,
      };
    }
  }

  // Defensive safeguard: unreachable in legal play when !isGameOver, protects synthetic fixtures.
  const ranked = computeRankings(state.territory.components, state.pieces, state.players, true);
  const byId = new Map<number, PlayerScoreSummary>();
  for (let i = 0; i < ranked.length; i++) {
    byId.set(ranked[i].playerId, ranked[i]);
  }
  const scores: PlayerScoreSummary[] = [];
  for (let i = 0; i < state.players.length; i++) {
    const summary = byId.get(state.players[i].id);
    if (summary !== undefined) {
      scores.push(summary);
    }
  }

  return {
    ...state,
    phase: 'game_over',
    currentPlayerIndex: isFromPlacement ? 0 : state.currentPlayerIndex,
    lastSkippedPlayerIds: skippedIds,
    territory: {
      ...state.territory,
      scores,
      isGameOver: true,
      endReason: 'deadlock',
    },
  };
}

function executeWallGo2BreakAndMove(
  state: GameState,
  dest: CellPos,
  wallEdge: WallEdge,
): GameState {
  const pieceId = state.turnSubState.selectedPieceId;
  if (pieceId === null) {
    return state;
  }
  const piece = state.pieces.find((p) => p.id === pieceId);
  const actor = state.players[state.currentPlayerIndex];
  if (!piece || !actor) {
    return state;
  }

  const key = wallKey(wallEdge);
  if (!hasWall(state.walls, wallEdge)) {
    return state;
  }
  const existingWall = state.walls[key];
  const removedWall: PlacedWall = {
    orientation: existingWall.orientation,
    row: normalizeZero(existingWall.row),
    col: normalizeZero(existingWall.col),
    ownerId: existingWall.ownerId,
  };

  const nextWalls = withoutWall(state.walls, key);
  const nextPlayers = state.players.map((pl, idx) =>
    idx === state.currentPlayerIndex
      ? { ...pl, wallBreaksRemaining: pl.wallBreaksRemaining - 1 }
      : pl,
  );
  const originPos: CellPos = cloneCellPos(piece);
  const cleanDest: CellPos = cloneCellPos(dest);
  const nextPieces = state.pieces.map((p) =>
    p.id === piece.id ? { ...p, row: cleanDest.row, col: cleanDest.col } : p,
  );

  const draft: GameState = {
    ...state,
    players: nextPlayers,
    pieces: nextPieces,
    walls: nextWalls,
    phase: 'place_wall',
    turnSubState: {
      selectedPieceId: piece.id,
      originPos,
      wallBreakActive: false,
      brokenWallBeforeMove: removedWall,
      pendingBreakChoice: null,
      selectedPlacementKind: state.turnSubState.selectedPlacementKind,
    },
  };

  return {
    ...draft,
    territory: analyzeTerritory(draft),
  };
}

// ============================================================================
// 12 Pure No-Throw Game State Transition Actions
// ============================================================================

export function placeInitialPiece(
  state: GameState,
  pos: CellPos,
  kind?: PieceKind,
): GameState {
  if (state.phase !== 'placement') {
    return state;
  }
  if (state.placementStep < 0 || state.placementStep >= state.placementQueue.length) {
    return state;
  }
  if (!isInBounds(pos.row, pos.col)) {
    return state;
  }
  if (state.pieces.some((p) => p.row === pos.row && p.col === pos.col)) {
    return state;
  }

  const playerId = state.placementQueue[state.placementStep];
  const actor = state.players[playerId];
  if (!actor) {
    return state;
  }

  let resolvedKind: PieceKind;
  if (state.ruleVariant === 'wallgo1') {
    if (kind !== undefined && kind !== 'standard') {
      return state;
    }
    resolvedKind = 'standard';
  } else {
    const remaining = getRemainingPlacementKinds(state, playerId);
    if (remaining.length === 0) {
      return state;
    }
    if (kind !== undefined) {
      if (kind === 'standard' || !remaining.includes(kind)) {
        return state;
      }
      resolvedKind = kind;
    } else if (remaining.length === 1) {
      resolvedKind = remaining[0];
    } else {
      resolvedKind = remaining.includes(state.turnSubState.selectedPlacementKind)
        ? state.turnSubState.selectedPlacementKind
        : remaining[0];
    }
  }

  let ownCount = 0;
  for (let i = 0; i < state.pieces.length; i++) {
    if (state.pieces[i].ownerId === playerId) {
      ownCount += 1;
    }
  }
  const cleanPos = cloneCellPos(pos);
  const newPieceId = `p${playerId}_${ownCount}`;
  const nextPieces = [
    ...state.pieces,
    {
      id: newPieceId,
      ownerId: playerId,
      kind: resolvedKind,
      row: cleanPos.row,
      col: cleanPos.col,
    },
  ];

  const nextStep = state.placementStep + 1;
  const isDone = nextStep >= state.placementQueue.length;
  const nextPhase: GamePhase = isDone ? 'select_piece' : 'placement';
  const tentativeNextPlayer = isDone ? 0 : state.placementQueue[nextStep];

  let nextSelectedPlacementKind: WallGo2PieceKind = 'square';
  if (!isDone && state.ruleVariant === 'wallgo2') {
    const probeState: GameState = {
      ...state,
      pieces: nextPieces,
      placementStep: nextStep,
      phase: 'placement',
      currentPlayerIndex: tentativeNextPlayer,
    };
    const nextRemaining = getRemainingPlacementKinds(probeState, tentativeNextPlayer);
    if (nextRemaining.length === 1) {
      nextSelectedPlacementKind = nextRemaining[0];
    } else if (nextRemaining.length > 1) {
      nextSelectedPlacementKind = nextRemaining.includes('square')
        ? 'square'
        : nextRemaining[0];
    }
  }

  const draft: GameState = {
    ...state,
    pieces: nextPieces,
    placementStep: nextStep,
    phase: nextPhase,
    currentPlayerIndex: tentativeNextPlayer,
    turnSubState: createFreshTurnSubState(nextSelectedPlacementKind),
    lastSkippedPlayerIds: [],
    lastActionSummary: `${actor.name}: ${cellToCoordLabel(cleanPos)} 말 배치`,
  };

  const territory = analyzeTerritory(draft);
  const stateWithTerritory: GameState = {
    ...draft,
    territory,
  };

  let finalState: GameState;
  if (!isDone) {
    finalState = stateWithTerritory;
  } else if (territory.isGameOver) {
    finalState = {
      ...stateWithTerritory,
      phase: 'game_over',
      lastSkippedPlayerIds: [],
    };
  } else {
    // Adversarial Turn 0 safeguard: auto-skip player 0 if boxed by pieces in corners.
    finalState = advanceTurnWithAutoSkip(stateWithTerritory, 0, true);
  }

  const actionEvent: PlacementActionEvent = {
    kind: 'placement',
    playerId: actor.id,
    actorIsAI: actor.isAI,
    pieceId: newPieceId,
    pieceKind: resolvedKind,
    pos: cloneCellPos(cleanPos),
    timedOut: false,
    skippedPlayerIds: finalState.lastSkippedPlayerIds.slice(),
  };

  return {
    ...finalState,
    lastActionEvent: actionEvent,
  };
}

export function setSelectedPlacementKind(
  state: GameState,
  kind: WallGo2PieceKind,
): GameState {
  if (state.phase !== 'placement' || state.ruleVariant !== 'wallgo2') {
    return state;
  }
  if (state.placementStep < 0 || state.placementStep >= state.placementQueue.length) {
    return state;
  }
  const playerId = state.placementQueue[state.placementStep];
  const remaining = getRemainingPlacementKinds(state, playerId);
  if (!remaining.includes(kind)) {
    return state;
  }
  if (state.turnSubState.selectedPlacementKind === kind) {
    return state;
  }
  return {
    ...state,
    turnSubState: {
      ...state.turnSubState,
      selectedPlacementKind: kind,
    },
  };
}

export function selectPiece(state: GameState, pieceId: string): GameState {
  if (state.phase !== 'select_piece' && state.phase !== 'move_piece') {
    return state;
  }
  if (state.phase === 'move_piece') {
    // E11: Piece is locked after Wall Go I wall break until move or cancelTurnMove.
    if (state.turnSubState.brokenWallBeforeMove !== null) {
      return state;
    }
    if (state.turnSubState.selectedPieceId === pieceId) {
      return state;
    }
  }

  const actor = state.players[state.currentPlayerIndex];
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!actor || !piece || piece.ownerId !== actor.id) {
    return state;
  }

  const hasMoveOrBreak =
    state.ruleVariant === 'wallgo1'
      ? getWallGo1Moves(state, pieceId).length > 0 ||
        getWallGo1BreakableWalls(state, pieceId).length > 0
      : getWallGo2NormalMoves(state, pieceId).length > 0 ||
        getWallGo2BreakTargets(state, pieceId).length > 0;

  if (!hasMoveOrBreak) {
    return state;
  }

  // Always keep wallBreakActive: false on selection (E07 toggled cleanly via toggleWallBreak).
  return {
    ...state,
    phase: 'move_piece',
    turnSubState: {
      ...state.turnSubState,
      selectedPieceId: pieceId,
      originPos: null,
      wallBreakActive: false,
      brokenWallBeforeMove: null,
      pendingBreakChoice: null,
    },
  };
}

export function deselectPiece(state: GameState): GameState {
  if (state.phase !== 'move_piece') {
    return state;
  }
  if (state.turnSubState.brokenWallBeforeMove !== null) {
    return state;
  }
  return {
    ...state,
    phase: 'select_piece',
    turnSubState: createFreshTurnSubState(state.turnSubState.selectedPlacementKind),
  };
}

export function toggleWallBreak(state: GameState): GameState {
  if (!canToggleWallBreak(state)) {
    return state;
  }
  return {
    ...state,
    turnSubState: {
      ...state.turnSubState,
      wallBreakActive: !state.turnSubState.wallBreakActive,
      pendingBreakChoice: null,
    },
  };
}

export function breakWallAt(state: GameState, wallEdge: WallEdge): GameState {
  if (
    state.ruleVariant !== 'wallgo1' ||
    state.format !== '3p' ||
    state.phase !== 'move_piece'
  ) {
    return state;
  }
  const pieceId = state.turnSubState.selectedPieceId;
  if (
    pieceId === null ||
    !state.turnSubState.wallBreakActive ||
    state.turnSubState.brokenWallBeforeMove !== null
  ) {
    return state;
  }
  const actor = state.players[state.currentPlayerIndex];
  if (!actor || actor.wallBreaksRemaining <= 0) {
    return state;
  }
  if (!isValidWallEdge(wallEdge) || !hasWall(state.walls, wallEdge)) {
    return state;
  }

  const breakableWalls = getWallGo1BreakableWalls(state, pieceId);
  if (!breakableWalls.some((edge) => isSameWallEdge(edge, wallEdge))) {
    return state;
  }

  const key = wallKey(wallEdge);
  const existingWall = state.walls[key];
  const removedWall: PlacedWall = {
    orientation: existingWall.orientation,
    row: normalizeZero(existingWall.row),
    col: normalizeZero(existingWall.col),
    ownerId: existingWall.ownerId,
  };

  const nextWalls = withoutWall(state.walls, key);
  const nextPlayers = state.players.map((pl, idx) =>
    idx === state.currentPlayerIndex
      ? { ...pl, wallBreaksRemaining: pl.wallBreaksRemaining - 1 }
      : pl,
  );

  const draft: GameState = {
    ...state,
    players: nextPlayers,
    walls: nextWalls,
    phase: 'move_piece',
    turnSubState: {
      ...state.turnSubState,
      originPos: null,
      wallBreakActive: false,
      brokenWallBeforeMove: removedWall,
      pendingBreakChoice: null,
    },
  };

  return {
    ...draft,
    territory: analyzeTerritory(draft),
  };
}

export function movePiece(state: GameState, dest: CellPos): GameState {
  if (state.phase !== 'move_piece') {
    return state;
  }
  const pieceId = state.turnSubState.selectedPieceId;
  if (
    pieceId === null ||
    state.turnSubState.wallBreakActive ||
    state.turnSubState.pendingBreakChoice !== null
  ) {
    return state;
  }
  if (!isInBounds(dest.row, dest.col)) {
    return state;
  }
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) {
    return state;
  }

  const validDestinations =
    state.ruleVariant === 'wallgo1'
      ? getWallGo1Moves(state, pieceId)
      : getWallGo2NormalMoves(state, pieceId);

  if (!validDestinations.some((cell) => isSameCellPos(cell, dest))) {
    return state;
  }

  const originPos: CellPos = cloneCellPos(piece);
  const cleanDest: CellPos = cloneCellPos(dest);
  const nextPieces = state.pieces.map((p) =>
    p.id === pieceId ? { ...p, row: cleanDest.row, col: cleanDest.col } : p,
  );

  const draft: GameState = {
    ...state,
    pieces: nextPieces,
    phase: 'place_wall',
    turnSubState: {
      ...state.turnSubState,
      originPos,
      wallBreakActive: false,
      pendingBreakChoice: null,
    },
  };

  return {
    ...draft,
    territory: analyzeTerritory(draft),
  };
}

export function selectWallGo2BreakDestination(
  state: GameState,
  dest: CellPos,
): GameState {
  if (
    state.ruleVariant !== 'wallgo2' ||
    state.format !== '3p' ||
    state.phase !== 'move_piece'
  ) {
    return state;
  }
  const pieceId = state.turnSubState.selectedPieceId;
  if (
    pieceId === null ||
    !state.turnSubState.wallBreakActive ||
    state.turnSubState.brokenWallBeforeMove !== null
  ) {
    return state;
  }
  const actor = state.players[state.currentPlayerIndex];
  if (!actor || actor.wallBreaksRemaining <= 0) {
    return state;
  }
  if (!isInBounds(dest.row, dest.col)) {
    return state;
  }

  const target = getWallGo2BreakTargets(state, pieceId).find((t) =>
    isSameCellPos(t, dest),
  );
  if (!target) {
    return state;
  }

  const cleanDest = cloneCellPos(dest);

  if (target.breakableWalls.length === 1) {
    return executeWallGo2BreakAndMove(state, cleanDest, target.breakableWalls[0]);
  }

  if (target.breakableWalls.length === 2) {
    if (
      state.turnSubState.pendingBreakChoice !== null &&
      isSameCellPos(state.turnSubState.pendingBreakChoice.destination, cleanDest)
    ) {
      return state;
    }
    return {
      ...state,
      turnSubState: {
        ...state.turnSubState,
        pendingBreakChoice: {
          destination: cleanDest,
          breakableWalls: [
            cloneWallEdge(target.breakableWalls[0]),
            cloneWallEdge(target.breakableWalls[1]),
          ],
        },
      },
    };
  }

  return state;
}

export function confirmWallGo2BreakWall(
  state: GameState,
  wallEdge: WallEdge,
): GameState {
  if (
    state.ruleVariant !== 'wallgo2' ||
    state.format !== '3p' ||
    state.phase !== 'move_piece'
  ) {
    return state;
  }
  const pieceId = state.turnSubState.selectedPieceId;
  const choice = state.turnSubState.pendingBreakChoice;
  if (
    pieceId === null ||
    choice === null ||
    state.turnSubState.brokenWallBeforeMove !== null
  ) {
    return state;
  }
  const actor = state.players[state.currentPlayerIndex];
  if (!actor || actor.wallBreaksRemaining <= 0) {
    return state;
  }
  if (!isValidWallEdge(wallEdge) || !hasWall(state.walls, wallEdge)) {
    return state;
  }
  if (!choice.breakableWalls.some((w) => isSameWallEdge(w, wallEdge))) {
    return state;
  }

  return executeWallGo2BreakAndMove(state, choice.destination, wallEdge);
}

export function placeWall(state: GameState, wallEdge: WallEdge): GameState {
  if (state.phase !== 'place_wall') {
    return state;
  }
  const pieceId = state.turnSubState.selectedPieceId;
  if (pieceId === null) {
    return state;
  }
  const actor = state.players[state.currentPlayerIndex];
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!actor || !piece) {
    return state;
  }
  if (!isValidWallEdge(wallEdge)) {
    return state;
  }

  const legalWalls = getLegalWallPlacements(state, { row: piece.row, col: piece.col });
  if (!legalWalls.some((edge) => isSameWallEdge(edge, wallEdge))) {
    return state;
  }

  const cleanEdge = cloneWallEdge(wallEdge);
  const from =
    state.turnSubState.originPos !== null
      ? cloneCellPos(state.turnSubState.originPos)
      : cloneCellPos(piece);
  const to = cloneCellPos(piece);
  const isStay = from.row === to.row && from.col === to.col;
  const brokenWall: PlacedWall | null =
    state.turnSubState.brokenWallBeforeMove !== null
      ? {
          orientation: state.turnSubState.brokenWallBeforeMove.orientation,
          row: normalizeZero(state.turnSubState.brokenWallBeforeMove.row),
          col: normalizeZero(state.turnSubState.brokenWallBeforeMove.col),
          ownerId: state.turnSubState.brokenWallBeforeMove.ownerId,
        }
      : null;
  const nextTurnNumber = state.turnNumber + 1;

  const placedWall: PlacedWall = {
    orientation: cleanEdge.orientation,
    row: cleanEdge.row,
    col: cleanEdge.col,
    ownerId: actor.id,
  };
  const nextWalls: GameState['walls'] = {
    ...state.walls,
    [wallKey(cleanEdge)]: placedWall,
  };

  const draft: GameState = {
    ...state,
    walls: nextWalls,
    lastPlacedWall: cleanEdge,
    turnNumber: nextTurnNumber,
    phase: 'select_piece',
    turnSubState: createFreshTurnSubState('square'),
    lastSkippedPlayerIds: [],
    lastActionSummary: `${actor.name}: ${cellToCoordLabel(piece)} 이동 후 벽 설치`,
  };

  const territory = analyzeTerritory(draft);
  const stateWithTerritory: GameState = {
    ...draft,
    territory,
  };

  let finalState: GameState;
  if (territory.isGameOver) {
    finalState = {
      ...stateWithTerritory,
      phase: 'game_over',
      lastSkippedPlayerIds: [],
    };
  } else {
    const nextStartIdx = (state.currentPlayerIndex + 1) % state.players.length;
    finalState = advanceTurnWithAutoSkip(stateWithTerritory, nextStartIdx, false);
  }

  const actionEvent: TurnActionEvent = {
    kind: 'turn',
    turnNumber: nextTurnNumber,
    playerId: actor.id,
    actorIsAI: actor.isAI,
    pieceId: piece.id,
    pieceKind: piece.kind,
    from,
    to,
    isStay,
    usedWallBreak: brokenWall !== null,
    brokenWall,
    placedWall: cloneWallEdge(cleanEdge),
    timedOut: false,
    skippedPlayerIds: finalState.lastSkippedPlayerIds.slice(),
  };

  return {
    ...finalState,
    lastActionEvent: actionEvent,
  };
}

export function cancelTurnMove(state: GameState): GameState {
  if (!canCancelTurnMove(state)) {
    return state;
  }

  const { selectedPieceId, originPos, brokenWallBeforeMove, selectedPlacementKind } =
    state.turnSubState;

  let nextPieces = state.pieces;
  if (originPos !== null && selectedPieceId !== null) {
    const cleanOrigin = cloneCellPos(originPos);
    nextPieces = state.pieces.map((p) =>
      p.id === selectedPieceId
        ? { ...p, row: cleanOrigin.row, col: cleanOrigin.col }
        : p,
    );
  }

  let nextWalls = state.walls;
  let nextPlayers = state.players;
  if (brokenWallBeforeMove !== null) {
    const restoredWall: PlacedWall = {
      orientation: brokenWallBeforeMove.orientation,
      row: normalizeZero(brokenWallBeforeMove.row),
      col: normalizeZero(brokenWallBeforeMove.col),
      ownerId: brokenWallBeforeMove.ownerId,
    };
    nextWalls = {
      ...state.walls,
      [wallKey(restoredWall)]: restoredWall,
    };
    nextPlayers = state.players.map((pl, idx) =>
      idx === state.currentPlayerIndex
        ? { ...pl, wallBreaksRemaining: pl.wallBreaksRemaining + 1 }
        : pl,
    );
  }

  const draft: GameState = {
    ...state,
    players: nextPlayers,
    pieces: nextPieces,
    walls: nextWalls,
    phase: 'move_piece',
    turnSubState: {
      selectedPieceId,
      originPos: null,
      wallBreakActive: false,
      brokenWallBeforeMove: null,
      pendingBreakChoice: null,
      selectedPlacementKind,
    },
  };

  return {
    ...draft,
    territory: analyzeTerritory(draft),
  };
}

function completePlaceWallTimeout(
  state: GameState,
  actorName: string,
  rng: RngFn,
): TurnTimeoutResolution {
  if (state.phase !== 'place_wall' || state.turnSubState.selectedPieceId === null) {
    return { state, event: null };
  }
  const piece = state.pieces.find((p) => p.id === state.turnSubState.selectedPieceId);
  if (!piece) {
    return { state, event: null };
  }
  const legalWalls = getLegalWallPlacements(state, { row: piece.row, col: piece.col });
  if (legalWalls.length === 0) {
    return { state, event: null };
  }
  const chosenWall = pickRandom(legalWalls, rng);
  const completed = placeWall(state, chosenWall);
  if (completed === state || completed.lastActionEvent?.kind !== 'turn') {
    return { state, event: null };
  }
  const timedOutEvent: TurnActionEvent = {
    ...completed.lastActionEvent,
    timedOut: true,
  };
  const nextState: GameState = {
    ...completed,
    lastActionSummary: `시간 초과! ${actorName}의 랜덤 벽이 자동 설치되었습니다.`,
    lastActionEvent: timedOutEvent,
  };
  return { state: nextState, event: timedOutEvent };
}

export function resolveTurnTimeout(
  state: GameState,
  rng: RngFn = Math.random,
): TurnTimeoutResolution {
  if (state.phase === 'game_over') {
    return { state, event: null };
  }

  // Case 1: Placement timeout
  if (state.phase === 'placement') {
    if (state.placementStep < 0 || state.placementStep >= state.placementQueue.length) {
      return { state, event: null };
    }
    const playerId = state.placementQueue[state.placementStep];
    const actor = state.players[playerId];
    if (!actor) {
      return { state, event: null };
    }

    const emptyCells: CellPos[] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (!state.pieces.some((p) => p.row === r && p.col === c)) {
          emptyCells.push({ row: r, col: c });
        }
      }
    }
    if (emptyCells.length === 0) {
      return { state, event: null };
    }

    const pos = pickRandom(emptyCells, rng);
    let kind: PieceKind = 'standard';
    if (state.ruleVariant === 'wallgo2') {
      const remaining = getRemainingPlacementKinds(state, playerId);
      if (remaining.length === 0) {
        return { state, event: null };
      }
      if (remaining.length === 1) {
        kind = remaining[0];
      } else {
        kind = remaining.includes(state.turnSubState.selectedPlacementKind)
          ? state.turnSubState.selectedPlacementKind
          : remaining[0];
      }
    }

    const placed = placeInitialPiece(state, pos, kind);
    if (placed === state || placed.lastActionEvent?.kind !== 'placement') {
      return { state, event: null };
    }
    const timedOutEvent: PlacementActionEvent = {
      ...placed.lastActionEvent,
      timedOut: true,
    };
    const nextState: GameState = {
      ...placed,
      lastActionSummary: `시간 초과! ${actor.name}의 말이 ${cellToCoordLabel(pos)}에 자동 배치되었습니다.`,
      lastActionEvent: timedOutEvent,
    };
    return { state: nextState, event: timedOutEvent };
  }

  const actor = state.players[state.currentPlayerIndex];
  if (!actor) {
    return { state, event: null };
  }

  // Case 2: Place-wall timeout (keep moved piece, place random adjacent open wall)
  if (state.phase === 'place_wall') {
    return completePlaceWallTimeout(state, actor.name, rng);
  }

  // Case 3: Post-break Wall Go I move_piece timeout (piece locked)
  if (state.phase === 'move_piece' && state.turnSubState.brokenWallBeforeMove !== null) {
    const pieceId = state.turnSubState.selectedPieceId;
    if (pieceId === null) {
      return { state, event: null };
    }
    const piece = state.pieces.find((p) => p.id === pieceId);
    if (!piece) {
      return { state, event: null };
    }
    const moves = getWallGo1Moves(state, pieceId);
    if (moves.length === 0) {
      return { state, event: null };
    }
    const originCell: CellPos = { row: piece.row, col: piece.col };
    const stayMove = moves.find((m) => isSameCellPos(m, originCell));
    const dest = stayMove !== undefined ? stayMove : pickRandom(moves, rng);
    const moved = movePiece(state, dest);
    if (moved === state) {
      return { state, event: null };
    }
    const res = completePlaceWallTimeout(moved, actor.name, rng);
    return res.event === null ? { state, event: null } : res;
  }

  // Normalize clean pre-break move_piece back to select_piece so all own pieces are considered.
  const base = state.phase === 'move_piece' ? deselectPiece(state) : state;
  if (base.phase !== 'select_piece') {
    return { state, event: null };
  }

  const ownPieces = base.pieces.filter((p) => p.ownerId === actor.id);

  // Case 4: Wall Go I select_piece / pre-break move_piece timeout
  if (base.ruleVariant === 'wallgo1') {
    const stayCandidates: { pieceId: string; dest: CellPos }[] = [];
    const anyNormalCandidates: { pieceId: string; dest: CellPos }[] = [];

    for (let i = 0; i < ownPieces.length; i++) {
      const p = ownPieces[i];
      const moves = getWallGo1Moves(base, p.id);
      for (let j = 0; j < moves.length; j++) {
        const dest = moves[j];
        if (dest.row === p.row && dest.col === p.col) {
          stayCandidates.push({ pieceId: p.id, dest });
        }
        anyNormalCandidates.push({ pieceId: p.id, dest });
      }
    }

    const normalPool =
      stayCandidates.length > 0 ? stayCandidates : anyNormalCandidates;

    if (normalPool.length > 0) {
      const chosen = pickRandom(normalPool, rng);
      const selected = selectPiece(base, chosen.pieceId);
      const moved = movePiece(selected, chosen.dest);
      if (moved === selected) {
        return { state, event: null };
      }
      const res = completePlaceWallTimeout(moved, actor.name, rng);
      return res.event === null ? { state, event: null } : res;
    }

    // Tier 3 fallback: Wall Break ONLY if 0 normal moves exist across all own pieces.
    const breakCandidates: { pieceId: string; wall: WallEdge }[] = [];
    for (let i = 0; i < ownPieces.length; i++) {
      const p = ownPieces[i];
      const walls = getWallGo1BreakableWalls(base, p.id);
      for (let j = 0; j < walls.length; j++) {
        breakCandidates.push({ pieceId: p.id, wall: walls[j] });
      }
    }
    if (breakCandidates.length === 0) {
      return { state, event: null };
    }

    const chosen = pickRandom(breakCandidates, rng);
    const selected = selectPiece(base, chosen.pieceId);
    const toggled = toggleWallBreak(selected);
    const broken = breakWallAt(toggled, chosen.wall);
    if (broken === toggled) {
      return { state, event: null };
    }
    const postBreakMoves = getWallGo1Moves(broken, chosen.pieceId);
    const lockedPiece = broken.pieces.find((p) => p.id === chosen.pieceId);
    if (!lockedPiece || postBreakMoves.length === 0) {
      return { state, event: null };
    }
    const stayCell = postBreakMoves.find(
      (m) => m.row === lockedPiece.row && m.col === lockedPiece.col,
    );
    const dest = stayCell !== undefined ? stayCell : pickRandom(postBreakMoves, rng);
    const moved = movePiece(broken, dest);
    if (moved === broken) {
      return { state, event: null };
    }
    const res = completePlaceWallTimeout(moved, actor.name, rng);
    return res.event === null ? { state, event: null } : res;
  }

  // Case 5: Wall Go II select_piece / pre-break move_piece timeout
  const oneStepCandidates: { pieceId: string; dest: CellPos }[] = [];
  const anyNormalCandidates: { pieceId: string; dest: CellPos }[] = [];

  for (let i = 0; i < ownPieces.length; i++) {
    const p = ownPieces[i];
    const moves = getWallGo2NormalMoves(base, p.id);
    for (let j = 0; j < moves.length; j++) {
      const dest = moves[j];
      const manhattan = Math.abs(dest.row - p.row) + Math.abs(dest.col - p.col);
      if (manhattan === 1) {
        oneStepCandidates.push({ pieceId: p.id, dest });
      }
      anyNormalCandidates.push({ pieceId: p.id, dest });
    }
  }

  const normalPool =
    oneStepCandidates.length > 0 ? oneStepCandidates : anyNormalCandidates;

  if (normalPool.length > 0) {
    const chosen = pickRandom(normalPool, rng);
    const selected = selectPiece(base, chosen.pieceId);
    const moved = movePiece(selected, chosen.dest);
    if (moved === selected) {
      return { state, event: null };
    }
    const res = completePlaceWallTimeout(moved, actor.name, rng);
    return res.event === null ? { state, event: null } : res;
  }

  // Tier 3 fallback: Wall Go II path-through Wall Break (handles 1-wall & 2-wall diagonals).
  const breakCandidates: { pieceId: string; dest: CellPos; wall: WallEdge }[] = [];
  for (let i = 0; i < ownPieces.length; i++) {
    const p = ownPieces[i];
    const targets = getWallGo2BreakTargets(base, p.id);
    for (let j = 0; j < targets.length; j++) {
      const target = targets[j];
      for (let k = 0; k < target.breakableWalls.length; k++) {
        breakCandidates.push({
          pieceId: p.id,
          dest: { row: target.row, col: target.col },
          wall: target.breakableWalls[k],
        });
      }
    }
  }
  if (breakCandidates.length === 0) {
    return { state, event: null };
  }

  const chosen = pickRandom(breakCandidates, rng);
  const selected = selectPiece(base, chosen.pieceId);
  const toggled = toggleWallBreak(selected);
  let afterDest = selectWallGo2BreakDestination(toggled, chosen.dest);
  if (afterDest === toggled) {
    return { state, event: null };
  }
  if (afterDest.turnSubState.pendingBreakChoice !== null) {
    const confirmed = confirmWallGo2BreakWall(afterDest, chosen.wall);
    if (confirmed === afterDest) {
      return { state, event: null };
    }
    afterDest = confirmed;
  }

  const res = completePlaceWallTimeout(afterDest, actor.name, rng);
  return res.event === null ? { state, event: null } : res;
}

export function handleTurnTimeout(
  state: GameState,
  rng: RngFn = Math.random,
): GameState {
  return resolveTurnTimeout(state, rng).state;
}

// ============================================================================
// Authoritative Atomic Turn Execution & Controller Takeover Helpers (v2)
// ============================================================================

const VALID_AI_DIFFICULTIES: ReadonlySet<AIDifficulty> = new Set([
  'easy',
  'normal',
  'hard',
]);

function assertAtomicTransition(
  prev: GameState,
  next: GameState,
  step: string,
): GameState {
  if (next === prev) {
    throw new Error(`applyAtomicTurnAction failed at "${step}": engine returned no-op`);
  }
  return next;
}

/**
 * Executes a complete turn atomically strictly through pure `src/engine` transitions.
 * Throws `Error` if ANY engine transition returns a no-op or if payload fields violate rules.
 * Shared by AI bots (`applyBotTurnAction`), online server validation, and deterministic replay.
 */
export function applyAtomicTurnAction(
  state: GameState,
  action: AtomicTurnAction,
): GameState {
  if (state.phase !== 'select_piece') {
    throw new Error(
      `applyAtomicTurnAction requires phase "select_piece", received "${state.phase}"`,
    );
  }
  const actor = state.players[state.currentPlayerIndex];
  if (!actor) {
    throw new Error(
      `applyAtomicTurnAction: invalid currentPlayerIndex ${state.currentPlayerIndex}`,
    );
  }
  if (!action || typeof action !== 'object') {
    throw new Error('applyAtomicTurnAction: action must be a non-null object');
  }
  if (typeof action.pieceId !== 'string' || action.pieceId.length === 0) {
    throw new Error('applyAtomicTurnAction: pieceId must be a non-empty string');
  }
  if (typeof action.useWallBreak !== 'boolean') {
    throw new Error('applyAtomicTurnAction: useWallBreak must be a boolean');
  }
  if (
    !action.destination ||
    typeof action.destination !== 'object' ||
    !isInBounds(action.destination.row, action.destination.col)
  ) {
    throw new Error('applyAtomicTurnAction: destination is not a valid in-bounds cell');
  }
  if (
    !action.placeWall ||
    typeof action.placeWall !== 'object' ||
    !isValidWallEdge(action.placeWall)
  ) {
    throw new Error('applyAtomicTurnAction: placeWall is not a valid internal wall edge');
  }
  if (action.useWallBreak && (action.breakWall === null || action.breakWall === undefined)) {
    throw new Error('applyAtomicTurnAction: useWallBreak is true but breakWall is null');
  }
  if (!action.useWallBreak && action.breakWall !== null && action.breakWall !== undefined) {
    throw new Error('applyAtomicTurnAction: useWallBreak is false but breakWall is non-null');
  }
  if (
    action.breakWall !== null &&
    action.breakWall !== undefined &&
    (typeof action.breakWall !== 'object' || !isValidWallEdge(action.breakWall))
  ) {
    throw new Error('applyAtomicTurnAction: breakWall is not a valid internal wall edge');
  }

  let cur = assertAtomicTransition(state, selectPiece(state, action.pieceId), 'selectPiece');

  if (!action.useWallBreak) {
    cur = assertAtomicTransition(cur, movePiece(cur, action.destination), 'movePiece');
  } else {
    const breakWall = action.breakWall!;
    cur = assertAtomicTransition(cur, toggleWallBreak(cur), 'toggleWallBreak');

    if (state.ruleVariant === 'wallgo1') {
      cur = assertAtomicTransition(cur, breakWallAt(cur, breakWall), 'breakWallAt');
      cur = assertAtomicTransition(cur, movePiece(cur, action.destination), 'movePiece');
    } else {
      cur = assertAtomicTransition(
        cur,
        selectWallGo2BreakDestination(cur, action.destination),
        'selectWallGo2BreakDestination',
      );
      if (cur.turnSubState.pendingBreakChoice !== null) {
        cur = assertAtomicTransition(
          cur,
          confirmWallGo2BreakWall(cur, breakWall),
          'confirmWallGo2BreakWall',
        );
      }
      const broken = cur.turnSubState.brokenWallBeforeMove;
      if (
        cur.phase !== 'place_wall' ||
        broken === null ||
        !isSameWallEdge(broken, breakWall)
      ) {
        throw new Error(
          `applyAtomicTurnAction: Wall Go II breakWall mismatch (requested ${wallKey(breakWall)}, actual ${broken ? wallKey(broken) : 'none'})`,
        );
      }
    }
  }

  cur = assertAtomicTransition(cur, placeWall(cur, action.placeWall), 'placeWall');
  return cur;
}

export function normalizeTurnForTakeover(state: GameState): GameState {
  return normalizeToCleanTurnEntry(state);
}

export function setPlayerControllerInGame(
  state: GameState,
  playerId: number,
  isAI: boolean,
  aiDifficulty?: AIDifficulty,
): GameState {
  if (state.phase === 'game_over' || typeof isAI !== 'boolean') {
    return state;
  }
  const targetIdx = state.players.findIndex((p) => p.id === playerId);
  if (targetIdx === -1) {
    return state;
  }
  const target = state.players[targetIdx];
  const nextDifficulty: AIDifficulty =
    aiDifficulty !== undefined ? aiDifficulty : target.aiDifficulty;
  if (!VALID_AI_DIFFICULTIES.has(nextDifficulty)) {
    return state;
  }
  if (target.isAI === isAI && target.aiDifficulty === nextDifficulty) {
    return state;
  }

  const isActivePlayer = state.players[state.currentPlayerIndex]?.id === playerId;
  const baseState =
    isActivePlayer && state.phase !== 'placement'
      ? normalizeTurnForTakeover(state)
      : state;

  const nextPlayers = baseState.players.map((pl, idx) =>
    idx === targetIdx ? { ...pl, isAI, aiDifficulty: nextDifficulty } : pl,
  );

  return {
    ...baseState,
    players: nextPlayers,
  };
}

// ============================================================================
// Smart Undo / Symmetric Redo History Manager (F20 & E26)
// ============================================================================

function makeSnapshot(state: GameState): HistorySnapshot {
  const actorPlayerId = state.currentPlayerIndex;
  const actor =
    state.players.find((p) => p.id === actorPlayerId) ??
    state.players[actorPlayerId];
  const actorIsAI =
    state.phase === 'game_over' ? false : (actor?.isAI ?? false);
  return {
    state,
    actorPlayerId,
    actorIsAI,
  };
}

function isMixedHumanAIMode(state: GameState): boolean {
  let hasHuman = false;
  let hasAI = false;
  for (let i = 0; i < state.players.length; i++) {
    if (state.players[i].isAI) {
      hasAI = true;
    } else {
      hasHuman = true;
    }
  }
  return hasHuman && hasAI;
}

function normalizeToCleanTurnEntry(state: GameState): GameState {
  if (isDirtyIntraTurn(state)) {
    const cancelled = cancelTurnMove(state);
    return cancelled.phase === 'move_piece' ? deselectPiece(cancelled) : cancelled;
  }
  if (state.phase === 'move_piece') {
    return deselectPiece(state);
  }
  return state;
}

function getCleanTurnEntryState(history: GameHistoryState): GameState {
  if (!isDirtyIntraTurn(history.turnEntryState)) {
    return normalizeToCleanTurnEntry(history.turnEntryState);
  }
  return normalizeToCleanTurnEntry(history.present);
}

export function createHistory(initialState: GameState): GameHistoryState {
  return {
    past: [],
    turnEntryState: initialState,
    present: initialState,
    future: [],
  };
}

export function updatePresentTransient(
  history: GameHistoryState,
  nextState: GameState,
): GameHistoryState {
  if (nextState === history.present) {
    return history;
  }
  return {
    ...history,
    present: nextState,
  };
}

export function commitTurnSnapshot(
  history: GameHistoryState,
  nextState: GameState,
): GameHistoryState {
  if (nextState === history.present) {
    return history;
  }
  const cleanEntry = getCleanTurnEntryState(history);
  return {
    past: [...history.past, makeSnapshot(cleanEntry)],
    turnEntryState: nextState,
    present: nextState,
    future: [],
  };
}

export function canSmartUndo(history: GameHistoryState): boolean {
  if (isDirtyIntraTurn(history.present)) {
    return true;
  }
  if (isMixedHumanAIMode(history.present)) {
    for (let i = history.past.length - 1; i >= 0; i--) {
      const snap = history.past[i];
      if (!snap.actorIsAI && snap.state.phase !== 'game_over') {
        return true;
      }
    }
    return false;
  }
  return history.past.length > 0;
}

export function smartUndo(history: GameHistoryState): GameHistoryState {
  if (!canSmartUndo(history)) {
    return history;
  }

  // Dirty-turn-first rollback (F20 & E26a): restore clean select_piece without popping past.
  if (isDirtyIntraTurn(history.present)) {
    const cleanState = getCleanTurnEntryState(history);
    return {
      past: history.past.slice(),
      turnEntryState: cleanState,
      present: cleanState,
      future: history.future.slice(),
    };
  }

  const currentClean = getCleanTurnEntryState(history);
  let targetIdx = history.past.length - 1;

  if (isMixedHumanAIMode(history.present)) {
    targetIdx = -1;
    for (let i = history.past.length - 1; i >= 0; i--) {
      const snap = history.past[i];
      if (!snap.actorIsAI && snap.state.phase !== 'game_over') {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx === -1) {
      return history;
    }
  }

  const restored = history.past[targetIdx].state;
  const skippedSnapshots = history.past.slice(targetIdx + 1);

  return {
    past: history.past.slice(0, targetIdx),
    turnEntryState: restored,
    present: restored,
    future: [...skippedSnapshots, makeSnapshot(currentClean), ...history.future],
  };
}

export function canSmartRedo(history: GameHistoryState): boolean {
  return history.future.length > 0;
}

export function smartRedo(history: GameHistoryState): GameHistoryState {
  if (history.future.length === 0) {
    return history;
  }

  const currentClean = getCleanTurnEntryState(history);
  let targetIdx = 0;

  if (isMixedHumanAIMode(history.present)) {
    targetIdx = -1;
    for (let i = 0; i < history.future.length; i++) {
      const snap = history.future[i];
      if (!snap.actorIsAI || snap.state.phase === 'game_over') {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx === -1) {
      // E26(b) mid-AI-think redo: all remaining future entries are AI turns; restore last.
      targetIdx = history.future.length - 1;
    }
  }

  const restored = history.future[targetIdx].state;
  const skippedFuture = history.future.slice(0, targetIdx);

  return {
    past: [...history.past, makeSnapshot(currentClean), ...skippedFuture],
    turnEntryState: restored,
    present: restored,
    future: history.future.slice(targetIdx + 1),
  };
}
