import {
  applyAtomicTurnAction,
  cellToCoordLabel,
  computeRound2Qualification,
  createInitialGameState,
  hasWall,
  isValidWallEdge,
  placeInitialPiece,
  wallKey,
} from '../engine/index.js';
import type {
  ActionEvent,
  AtomicTurnAction,
  CellPos,
  GameState,
  Piece,
  PlacedWall,
  PlayerConfig,
  PlayerScoreSummary,
  Round2Qualification,
  WallEdge,
  WallKey,
} from '../engine/index.js';
import type {
  MatchFinalBoardSnapshot,
  MatchPlayerSummary,
  MatchRecord,
  MatchSummary,
  PlayerAggregateStats,
  ReplayData,
  ReplayFrame,
  ReplayInitialConfig,
  ReplayStep,
} from './historyTypes.js';

export class ReplayValidationError extends Error {
  readonly stepIndex: number;

  constructor(stepIndex: number, message: string) {
    super(message);
    this.name = 'ReplayValidationError';
    this.stepIndex = stepIndex;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
}

function isCellPosLike(value: unknown): value is CellPos {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const pos = value as Partial<CellPos>;
  return (
    typeof pos.row === 'number' &&
    typeof pos.col === 'number' &&
    Number.isInteger(pos.row) &&
    Number.isInteger(pos.col)
  );
}

function isWallEdgeLike(value: unknown): value is WallEdge {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const edge = value as Partial<WallEdge>;
  return (
    (edge.orientation === 'h' || edge.orientation === 'v') &&
    typeof edge.row === 'number' &&
    typeof edge.col === 'number' &&
    isValidWallEdge(edge as WallEdge)
  );
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

function clonePlacedWall(wall: PlacedWall): PlacedWall {
  return {
    orientation: wall.orientation,
    row: normalizeZero(wall.row),
    col: normalizeZero(wall.col),
    ownerId: wall.ownerId,
  };
}

function clonePlayerConfig(p: PlayerConfig): PlayerConfig {
  return {
    name: p.name,
    colorToken: p.colorToken,
    isAI: p.isAI,
    aiDifficulty: p.aiDifficulty,
  };
}

function cloneInitialConfig(config: ReplayInitialConfig): ReplayInitialConfig {
  return {
    ruleVariant: config.ruleVariant,
    format: config.format,
    isPrisonMatchRound2: config.isPrisonMatchRound2,
    timerSeconds: config.timerSeconds,
    players: config.players.map(clonePlayerConfig),
  };
}

function cloneReplayStepWithIndex(step: ReplayStep, stepIndex: number): ReplayStep {
  if (step.kind === 'placement') {
    return {
      stepIndex,
      kind: 'placement',
      playerId: step.playerId,
      actorIsAI: Boolean(step.actorIsAI),
      pieceId: step.pieceId,
      pieceKind: step.pieceKind,
      pos: cloneCellPos(step.pos),
      timedOut: Boolean(step.timedOut),
      skippedPlayerIds: step.skippedPlayerIds.slice(),
    };
  }
  return {
    stepIndex,
    kind: 'turn',
    turnNumber: step.turnNumber,
    playerId: step.playerId,
    actorIsAI: Boolean(step.actorIsAI),
    pieceId: step.pieceId,
    pieceKind: step.pieceKind,
    from: cloneCellPos(step.from),
    to: cloneCellPos(step.to),
    isStay: step.isStay,
    usedWallBreak: step.usedWallBreak,
    brokenWall: step.brokenWall !== null ? clonePlacedWall(step.brokenWall) : null,
    placedWall: cloneWallEdge(step.placedWall),
    timedOut: Boolean(step.timedOut),
    skippedPlayerIds: step.skippedPlayerIds.slice(),
  };
}

/**
 * Formats an internal wall edge into its human-readable coordinate pair label
 * matching `Board.tsx` (e.g. `h:2:2` -> `"C3-C4"`, `v:2:2` -> `"C3-D3"`).
 * Throws `RangeError` for invalid wall edges.
 */
export function formatWallEdgeLabel(edge: WallEdge): string {
  if (!edge || typeof edge !== 'object' || !isValidWallEdge(edge)) {
    throw new RangeError(
      `Invalid wall edge: ${edge && typeof edge === 'object' ? `${String(edge.orientation)}:${String(edge.row)}:${String(edge.col)}` : String(edge)}`,
    );
  }
  const row = normalizeZero(edge.row);
  const col = normalizeZero(edge.col);
  if (edge.orientation === 'h') {
    return `${cellToCoordLabel({ row, col })}-${cellToCoordLabel({ row: row + 1, col })}`;
  }
  return `${cellToCoordLabel({ row, col })}-${cellToCoordLabel({ row, col: col + 1 })}`;
}

/**
 * Captures the exact post-shuffle initial configuration from a freshly started `GameState`
 * (including `isPrisonMatchRound2` fidelity for 2P Prison Match Round 2).
 */
export function createReplayInitialConfig(state: GameState): ReplayInitialConfig {
  return {
    ruleVariant: state.ruleVariant,
    format: state.format,
    isPrisonMatchRound2: state.isPrisonMatchRound2,
    timerSeconds: state.timerSeconds,
    players: state.players.map((p) => ({
      name: p.name,
      colorToken: p.colorToken,
      isAI: p.isAI,
      aiDifficulty: p.aiDifficulty,
    })),
  };
}

/**
 * Reconstructs the Step 0 `GameState` from a `ReplayInitialConfig`, faithfully
 * preserving `isPrisonMatchRound2: true` (with 4 fixed diagonal pieces and 0 wall breaks)
 * and wrapping all validation errors as `ReplayValidationError(0, ...)`.
 */
export function createInitialStateFromReplayConfig(
  initialConfig: ReplayInitialConfig,
): GameState {
  if (!initialConfig || typeof initialConfig !== 'object') {
    throw new ReplayValidationError(0, 'Replay initialConfig must be a non-null object');
  }
  if (typeof initialConfig.isPrisonMatchRound2 !== 'boolean') {
    throw new ReplayValidationError(
      0,
      'Replay initialConfig.isPrisonMatchRound2 must be a boolean',
    );
  }
  if (initialConfig.isPrisonMatchRound2 && initialConfig.format !== '2p') {
    throw new ReplayValidationError(
      0,
      `Replay initialConfig cannot set isPrisonMatchRound2=true with format "${String(initialConfig.format)}"`,
    );
  }
  if (!Array.isArray(initialConfig.players)) {
    throw new ReplayValidationError(0, 'Replay initialConfig.players must be an array');
  }
  for (let i = 0; i < initialConfig.players.length; i++) {
    const player = initialConfig.players[i];
    if (!player || typeof player !== 'object') {
      throw new ReplayValidationError(
        0,
        `Replay initialConfig.players[${i}] must be a non-null object`,
      );
    }
  }

  let base: GameState;
  try {
    base = createInitialGameState({
      ruleVariant: initialConfig.ruleVariant,
      format: initialConfig.format,
      players: initialConfig.players.map(clonePlayerConfig),
      shuffleOrder: false,
      timerSeconds: initialConfig.timerSeconds,
    });
  } catch (err) {
    throw new ReplayValidationError(
      0,
      err instanceof Error ? err.message : 'Invalid replay initialConfig',
    );
  }

  return initialConfig.isPrisonMatchRound2
    ? { ...base, isPrisonMatchRound2: true }
    : base;
}

/**
 * Converts a committed engine `ActionEvent` into a deeply cloned 1-based `ReplayStep`.
 */
export function actionEventToReplayStep(
  event: ActionEvent,
  stepIndex: number,
): ReplayStep {
  if (!Number.isInteger(stepIndex) || stepIndex < 1) {
    throw new RangeError(`Replay stepIndex must be an integer >= 1, received ${stepIndex}`);
  }
  if (event.kind === 'placement') {
    return {
      stepIndex,
      kind: 'placement',
      playerId: event.playerId,
      actorIsAI: event.actorIsAI,
      pieceId: event.pieceId,
      pieceKind: event.pieceKind,
      pos: cloneCellPos(event.pos),
      timedOut: event.timedOut,
      skippedPlayerIds: event.skippedPlayerIds.slice(),
    };
  }
  return {
    stepIndex,
    kind: 'turn',
    turnNumber: event.turnNumber,
    playerId: event.playerId,
    actorIsAI: event.actorIsAI,
    pieceId: event.pieceId,
    pieceKind: event.pieceKind,
    from: cloneCellPos(event.from),
    to: cloneCellPos(event.to),
    isStay: event.isStay,
    usedWallBreak: event.usedWallBreak,
    brokenWall: event.brokenWall !== null ? clonePlacedWall(event.brokenWall) : null,
    placedWall: cloneWallEdge(event.placedWall),
    timedOut: event.timedOut,
    skippedPlayerIds: event.skippedPlayerIds.slice(),
  };
}

/**
 * Packages an initial config and ordered replay steps into an immutable `ReplayData` v1 payload.
 */
export function extractReplayFromHistory(
  initialConfig: ReplayInitialConfig,
  steps: readonly ReplayStep[],
): ReplayData {
  return {
    schemaVersion: 1,
    initialConfig: cloneInitialConfig(initialConfig),
    steps: steps.map((step, i) => cloneReplayStepWithIndex(step, i + 1)),
  };
}

function validateSkippedPlayerIds(step: ReplayStep, expectedStepIndex: number): void {
  if (!Array.isArray(step.skippedPlayerIds)) {
    throw new ReplayValidationError(
      expectedStepIndex,
      `Step ${expectedStepIndex}: skippedPlayerIds must be an array`,
    );
  }
  for (let i = 0; i < step.skippedPlayerIds.length; i++) {
    if (!Number.isInteger(step.skippedPlayerIds[i])) {
      throw new ReplayValidationError(
        expectedStepIndex,
        `Step ${expectedStepIndex}: skippedPlayerIds[${i}] must be an integer`,
      );
    }
  }
}

function assertSkippedPlayerIdsMatch(
  recorded: readonly number[],
  actual: readonly number[],
  expectedStepIndex: number,
): void {
  let matches = recorded.length === actual.length;
  if (matches) {
    for (let i = 0; i < recorded.length; i++) {
      if (recorded[i] !== actual[i]) {
        matches = false;
        break;
      }
    }
  }
  if (!matches) {
    throw new ReplayValidationError(
      expectedStepIndex,
      `Step ${expectedStepIndex}: skippedPlayerIds mismatch (expected [${actual.join(', ')}], received [${recorded.join(', ')}])`,
    );
  }
}

/**
 * Deterministically reconstructs every board state `Step 0..N` from compact `ReplayData`
 * strictly through pure `src/engine` transitions (`createInitialStateFromReplayConfig`,
 * `placeInitialPiece`, and `applyAtomicTurnAction`).
 * Throws `ReplayValidationError(stepIndex, message)` on any corrupt or illegal step.
 */
export function buildReplayFrames(replay: ReplayData): ReplayFrame[] {
  if (!replay || typeof replay !== 'object') {
    throw new ReplayValidationError(0, 'Replay payload must be a non-null object');
  }
  if (replay.schemaVersion !== 1) {
    throw new ReplayValidationError(
      0,
      `Unsupported replay schemaVersion: ${String((replay as { schemaVersion?: unknown }).schemaVersion)}`,
    );
  }
  if (!Array.isArray(replay.steps)) {
    throw new ReplayValidationError(0, 'Replay steps must be an array');
  }

  let prevState = createInitialStateFromReplayConfig(replay.initialConfig);
  const frames: ReplayFrame[] = [
    {
      stepIndex: 0,
      state: prevState,
      step: null,
    },
  ];

  for (let i = 0; i < replay.steps.length; i++) {
    const expectedStepIndex = i + 1;
    const step = replay.steps[i];

    if (!step || typeof step !== 'object') {
      throw new ReplayValidationError(
        expectedStepIndex,
        `Step ${expectedStepIndex} must be a non-null object`,
      );
    }
    if (step.stepIndex !== expectedStepIndex) {
      throw new ReplayValidationError(
        expectedStepIndex,
        `Expected stepIndex ${expectedStepIndex}, received ${String(step.stepIndex)}`,
      );
    }
    if (prevState.phase === 'game_over') {
      throw new ReplayValidationError(
        expectedStepIndex,
        `Cannot apply step ${expectedStepIndex} after game_over`,
      );
    }

    validateSkippedPlayerIds(step, expectedStepIndex);

    let nextState: GameState;
    if (step.kind === 'placement') {
      if (prevState.phase !== 'placement') {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: placement step received during phase "${prevState.phase}"`,
        );
      }
      const expectedPlayerId = prevState.placementQueue[prevState.placementStep];
      if (step.playerId !== expectedPlayerId) {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: expected placement playerId ${String(expectedPlayerId)}, received ${String(step.playerId)}`,
        );
      }
      if (!isCellPosLike(step.pos)) {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: invalid placement position`,
        );
      }
      if (typeof step.pieceId !== 'string' || step.pieceId.length === 0) {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: invalid placement pieceId`,
        );
      }

      const applied = placeInitialPiece(
        prevState,
        cloneCellPos(step.pos),
        step.pieceKind,
      );
      if (applied === prevState) {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: illegal piece placement at (${step.pos.row}, ${step.pos.col})`,
        );
      }
      const placedPiece = applied.pieces[applied.pieces.length - 1];
      if (
        !placedPiece ||
        placedPiece.id !== step.pieceId ||
        placedPiece.kind !== step.pieceKind
      ) {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: placed piece mismatch (expected ${step.pieceId}/${step.pieceKind}, got ${placedPiece?.id}/${placedPiece?.kind})`,
        );
      }
      assertSkippedPlayerIdsMatch(
        step.skippedPlayerIds,
        applied.lastSkippedPlayerIds,
        expectedStepIndex,
      );

      nextState =
        applied.lastActionEvent !== null
          ? {
              ...applied,
              lastActionEvent: {
                ...applied.lastActionEvent,
                timedOut: Boolean(step.timedOut),
                actorIsAI: Boolean(step.actorIsAI),
              },
            }
          : applied;
    } else if (step.kind === 'turn') {
      if (prevState.phase !== 'select_piece') {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: turn step received during phase "${prevState.phase}"`,
        );
      }
      const actor = prevState.players[prevState.currentPlayerIndex];
      if (!actor || actor.id !== step.playerId) {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: expected turn playerId ${String(actor?.id)}, received ${String(step.playerId)}`,
        );
      }
      if (
        typeof step.pieceId !== 'string' ||
        step.pieceId.length === 0 ||
        !isCellPosLike(step.from) ||
        !isCellPosLike(step.to) ||
        !isWallEdgeLike(step.placedWall)
      ) {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: malformed turn step coordinates or wall edge`,
        );
      }

      const piece = prevState.pieces.find((p) => p.id === step.pieceId);
      if (
        !piece ||
        piece.ownerId !== step.playerId ||
        piece.kind !== step.pieceKind ||
        piece.row !== step.from.row ||
        piece.col !== step.from.col
      ) {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: piece "${step.pieceId}" mismatch at (${step.from.row}, ${step.from.col})`,
        );
      }

      const computedIsStay =
        step.from.row === step.to.row && step.from.col === step.to.col;
      if (typeof step.isStay !== 'boolean' || step.isStay !== computedIsStay) {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: isStay=${String(step.isStay)} does not match from/to coordinates`,
        );
      }
      if (typeof step.usedWallBreak !== 'boolean') {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: usedWallBreak must be a boolean`,
        );
      }

      if (step.usedWallBreak) {
        if (
          step.brokenWall === null ||
          !isWallEdgeLike(step.brokenWall) ||
          typeof step.brokenWall.ownerId !== 'number' ||
          !Number.isInteger(step.brokenWall.ownerId)
        ) {
          throw new ReplayValidationError(
            expectedStepIndex,
            `Step ${expectedStepIndex}: usedWallBreak=true requires a valid brokenWall with ownerId`,
          );
        }
        if (!hasWall(prevState.walls, step.brokenWall)) {
          throw new ReplayValidationError(
            expectedStepIndex,
            `Step ${expectedStepIndex}: brokenWall ${wallKey(step.brokenWall)} does not exist on board`,
          );
        }
        const existingWall = prevState.walls[wallKey(step.brokenWall)];
        if (existingWall.ownerId !== step.brokenWall.ownerId) {
          throw new ReplayValidationError(
            expectedStepIndex,
            `Step ${expectedStepIndex}: brokenWall ownerId mismatch (expected ${existingWall.ownerId}, received ${step.brokenWall.ownerId})`,
          );
        }
      } else if (step.brokenWall !== null) {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: usedWallBreak=false requires brokenWall=null`,
        );
      }

      const atomicAction: AtomicTurnAction = {
        pieceId: step.pieceId,
        useWallBreak: step.usedWallBreak,
        breakWall: step.brokenWall !== null ? cloneWallEdge(step.brokenWall) : null,
        destination: cloneCellPos(step.to),
        placeWall: cloneWallEdge(step.placedWall),
      };

      let applied: GameState;
      try {
        applied = applyAtomicTurnAction(prevState, atomicAction);
      } catch (err) {
        throw new ReplayValidationError(
          expectedStepIndex,
          err instanceof Error
            ? `Step ${expectedStepIndex}: ${err.message}`
            : `Step ${expectedStepIndex}: illegal turn action`,
        );
      }

      if (applied.turnNumber !== step.turnNumber) {
        throw new ReplayValidationError(
          expectedStepIndex,
          `Step ${expectedStepIndex}: turnNumber mismatch (expected ${applied.turnNumber}, received ${String(step.turnNumber)})`,
        );
      }
      assertSkippedPlayerIdsMatch(
        step.skippedPlayerIds,
        applied.lastSkippedPlayerIds,
        expectedStepIndex,
      );

      nextState =
        applied.lastActionEvent !== null
          ? {
              ...applied,
              lastActionEvent: {
                ...applied.lastActionEvent,
                timedOut: Boolean(step.timedOut),
                actorIsAI: Boolean(step.actorIsAI),
              },
            }
          : applied;
    } else {
      throw new ReplayValidationError(
        expectedStepIndex,
        `Unknown replay step kind: ${String((step as { kind?: unknown }).kind)}`,
      );
    }

    frames.push({
      stepIndex: expectedStepIndex,
      state: nextState,
      step: cloneReplayStepWithIndex(step, expectedStepIndex),
    });
    prevState = nextState;
  }

  return frames;
}

/**
 * Extracts a deep-cloned final board snapshot from a `GameState`.
 */
export function extractMatchFinalBoard(state: GameState): MatchFinalBoardSnapshot {
  const pieces: Piece[] = state.pieces.map((p) => ({
    id: p.id,
    ownerId: p.ownerId,
    kind: p.kind,
    row: normalizeZero(p.row),
    col: normalizeZero(p.col),
  }));
  const walls: Record<WallKey, PlacedWall> = {};
  const keys = Object.keys(state.walls) as WallKey[];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (Object.prototype.hasOwnProperty.call(state.walls, k)) {
      walls[k] = clonePlacedWall(state.walls[k]);
    }
  }
  return {
    pieces,
    walls,
    lastPlacedWall:
      state.lastPlacedWall !== null ? cloneWallEdge(state.lastPlacedWall) : null,
  };
}

function sortScoreSummaries(scores: readonly PlayerScoreSummary[]): PlayerScoreSummary[] {
  return scores.slice().sort(
    (a, b) =>
      a.rank - b.rank ||
      b.totalTerritory - a.totalTerritory ||
      b.largestSingleTerritory - a.largestSingleTerritory ||
      a.playerId - b.playerId,
  );
}

/**
 * Builds ranked `MatchPlayerSummary[]` from a finished `GameState`, matching `ResultModal.tsx`
 * for tie detection (`isWinner` vs `isDraw`) and 3P Prison Match Round 2 qualification.
 */
export function buildMatchPlayerSummaries(
  state: GameState,
  options?: { substitutedPlayerIds?: ReadonlySet<number> },
): MatchPlayerSummary[] {
  const orderedScores = sortScoreSummaries(state.territory.scores);
  let rank1Count = 0;
  for (let i = 0; i < orderedScores.length; i++) {
    if (orderedScores[i].rank === 1) {
      rank1Count += 1;
    }
  }

  let qualification: Round2Qualification | null = null;
  if (state.format === '3p' && state.phase === 'game_over') {
    qualification = computeRound2Qualification(state);
  }

  const summaries: MatchPlayerSummary[] = [];
  for (let i = 0; i < orderedScores.length; i++) {
    const score = orderedScores[i];
    const player = state.players.find((p) => p.id === score.playerId);
    if (!player) {
      continue;
    }
    const summary: MatchPlayerSummary = {
      playerId: player.id,
      name: player.name,
      colorToken: player.colorToken,
      isAI: player.isAI,
      aiDifficulty: player.aiDifficulty,
      totalTerritory: score.totalTerritory,
      largestSingleTerritory: score.largestSingleTerritory,
      securedRegions: score.securedRegions.slice(),
      deadlockPieceCount: score.deadlockPieceCount,
      rank: score.rank,
      isWinner: score.rank === 1 && rank1Count === 1,
      isDraw: score.rank === 1 && rank1Count > 1,
    };
    if (options?.substitutedPlayerIds?.has(player.id)) {
      summary.wasSubstitutedToAI = true;
    }
    if (qualification !== null) {
      summary.advancingRound2 =
        player.id === qualification.defaultFirstPlayerId ||
        player.id === qualification.defaultSecondPlayerId;
    }
    summaries.push(summary);
  }

  return summaries;
}

/**
 * Strips the heavy `replay` payload from a `MatchRecord`, returning a clean `MatchSummary`.
 */
export function toMatchSummary(record: MatchRecord): MatchSummary {
  const { replay: _replay, ...summary } = record;
  return {
    ...summary,
    players: summary.players.map((p) => ({
      ...p,
      securedRegions: p.securedRegions.slice(),
    })),
    finalBoard: {
      pieces: summary.finalBoard.pieces.map((p) => ({ ...p })),
      walls: Object.fromEntries(
        Object.entries(summary.finalBoard.walls).map(([k, v]) => [k, clonePlacedWall(v)]),
      ) as Record<WallKey, PlacedWall>,
      lastPlacedWall:
        summary.finalBoard.lastPlacedWall !== null
          ? cloneWallEdge(summary.finalBoard.lastPlacedWall)
          : null,
    },
  };
}

interface AggregateAccumulator {
  key: string;
  displayName: string;
  latestPlayedAtMs: number;
  isAIOnly: boolean;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  sumTerritory: number;
  bestTerritory: number;
}

/**
 * Aggregates player win/draw/loss/territory statistics across local & online match summaries.
 * Groups case-insensitively by trimmed name while preserving the most recent casing by `playedAt`.
 */
export function computePlayerAggregateStats(
  matches: readonly MatchSummary[],
): PlayerAggregateStats[] {
  if (matches.length === 0) {
    return [];
  }

  const map = new Map<string, AggregateAccumulator>();

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const parsedTs = Date.parse(match.playedAt);
    const ts = Number.isFinite(parsedTs) ? parsedTs : -Infinity;

    for (let j = 0; j < match.players.length; j++) {
      const player = match.players[j];
      const trimmed = typeof player.name === 'string' ? player.name.trim() : '';
      const key = trimmed.toLowerCase();
      if (key.length === 0) {
        continue;
      }

      const actedPureAI = Boolean(player.isAI && !player.wasSubstitutedToAI);
      let acc = map.get(key);
      if (!acc) {
        acc = {
          key,
          displayName: trimmed,
          latestPlayedAtMs: ts,
          isAIOnly: actedPureAI,
          gamesPlayed: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          sumTerritory: 0,
          bestTerritory: -Infinity,
        };
        map.set(key, acc);
      } else {
        if (ts > acc.latestPlayedAtMs) {
          acc.displayName = trimmed;
          acc.latestPlayedAtMs = ts;
        }
        if (!actedPureAI) {
          acc.isAIOnly = false;
        }
      }

      acc.gamesPlayed += 1;
      if (player.isWinner) {
        acc.wins += 1;
      } else if (player.isDraw) {
        acc.draws += 1;
      } else {
        acc.losses += 1;
      }
      acc.sumTerritory += player.totalTerritory;
      if (player.totalTerritory > acc.bestTerritory) {
        acc.bestTerritory = player.totalTerritory;
      }
    }
  }

  const results: PlayerAggregateStats[] = [];
  map.forEach((acc) => {
    results.push({
      key: acc.key,
      displayName: acc.displayName,
      isAIOnly: acc.isAIOnly,
      gamesPlayed: acc.gamesPlayed,
      wins: acc.wins,
      draws: acc.draws,
      losses: acc.losses,
      winRate: Math.round((acc.wins / acc.gamesPlayed) * 100),
      avgTerritory: Number((acc.sumTerritory / acc.gamesPlayed).toFixed(1)),
      bestTerritory: acc.bestTerritory === -Infinity ? 0 : acc.bestTerritory,
    });
  });

  results.sort(
    (a, b) =>
      b.wins - a.wins ||
      b.winRate - a.winRate ||
      b.gamesPlayed - a.gamesPlayed ||
      b.avgTerritory - a.avgTerritory ||
      b.bestTerritory - a.bestTerritory ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );

  return results;
}
