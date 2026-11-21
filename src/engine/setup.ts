import { BOARD_SIZE, DEFAULT_PLAYER_NAMES } from './types.js';
import type {
  AIDifficulty,
  CellPos,
  GameState,
  LobbyConfig,
  Piece,
  PieceKind,
  PlayerColorToken,
  PlayerConfig,
  PlayerScoreSummary,
  PlayerState,
  RngFn,
  Round2Qualification,
  Round2QualificationStatus,
  TerritoryAnalysis,
  TurnSubState,
  WallGo2PieceKind,
} from './types.js';
import { analyzeTerritory } from './territory.js';

const PLACEMENT_QUEUE_3P: readonly number[] = [0, 1, 2, 2, 1, 0];
const PLACEMENT_QUEUE_2P: readonly number[] = [0, 1, 1, 0];

const FIXED_2P_POSITIONS: readonly (readonly [CellPos, CellPos])[] = [
  [
    { row: 1, col: 1 }, // B2
    { row: 5, col: 5 }, // F6
  ],
  [
    { row: 1, col: 5 }, // F2
    { row: 5, col: 1 }, // B6
  ],
];

const EMPTY_TERRITORY_PLACEHOLDER: TerritoryAnalysis = {
  components: [],
  cellToComponentId: [],
  scores: [],
  isGameOver: false,
  endReason: null,
};

const VALID_COLOR_TOKENS: ReadonlySet<PlayerColorToken> = new Set(['p1', 'p2', 'p3']);
const VALID_AI_DIFFICULTIES: ReadonlySet<AIDifficulty> = new Set(['easy', 'normal', 'hard']);

export function createFreshTurnSubState(
  selectedPlacementKind: WallGo2PieceKind = 'square',
): TurnSubState {
  return {
    selectedPieceId: null,
    originPos: null,
    wallBreakActive: false,
    brokenWallBeforeMove: null,
    pendingBreakChoice: null,
    selectedPlacementKind,
  };
}

function validateLobbyConfig(config: LobbyConfig): void {
  if (config.ruleVariant !== 'wallgo1' && config.ruleVariant !== 'wallgo2') {
    throw new Error(`Invalid ruleVariant: "${String(config.ruleVariant)}"`);
  }
  if (config.format !== '3p' && config.format !== '2p') {
    throw new Error(`Invalid format: "${String(config.format)}"`);
  }
  if (config.timerSeconds !== 0 && config.timerSeconds !== 90 && config.timerSeconds !== 60) {
    throw new Error(`Invalid timerSeconds: "${String(config.timerSeconds)}"`);
  }
  const expectedPlayers = config.format === '3p' ? 3 : 2;
  if (!Array.isArray(config.players) || config.players.length !== expectedPlayers) {
    throw new Error(
      `Format "${config.format}" requires exactly ${expectedPlayers} players, received ${
        Array.isArray(config.players) ? config.players.length : 0
      }`,
    );
  }
  for (let i = 0; i < config.players.length; i++) {
    const p = config.players[i];
    if (!VALID_COLOR_TOKENS.has(p.colorToken)) {
      throw new Error(`Invalid colorToken "${String(p.colorToken)}" for player index ${i}`);
    }
    if (!VALID_AI_DIFFICULTIES.has(p.aiDifficulty)) {
      throw new Error(`Invalid aiDifficulty "${String(p.aiDifficulty)}" for player index ${i}`);
    }
    if (typeof p.isAI !== 'boolean') {
      throw new Error(`Invalid isAI flag for player index ${i}`);
    }
    if (typeof p.name !== 'string') {
      throw new Error(`Invalid name for player index ${i}`);
    }
  }
}

export function createInitialGameState(
  config: LobbyConfig,
  rng: RngFn = Math.random,
): GameState {
  validateLobbyConfig(config);

  // Normalize blank/whitespace names BEFORE shuffle so each player keeps seat identity.
  const normalizedPlayers: PlayerConfig[] = config.players.map((playerCfg, i) => {
    const trimmed = playerCfg.name.trim();
    return {
      name: trimmed.length > 0 ? trimmed : DEFAULT_PLAYER_NAMES[i],
      colorToken: playerCfg.colorToken,
      isAI: playerCfg.isAI,
      aiDifficulty: playerCfg.aiDifficulty,
    };
  });

  const ordered = normalizedPlayers.slice();
  if (config.shuffleOrder) {
    for (let i = ordered.length - 1; i > 0; i--) {
      const raw = rng();
      const safe = Number.isFinite(raw) ? raw : 0;
      const j = Math.min(i, Math.max(0, Math.floor(safe * (i + 1))));
      const tmp = ordered[i];
      ordered[i] = ordered[j];
      ordered[j] = tmp;
    }
  }

  const wallBreaksRemaining = config.format === '3p' ? 1 : 0;
  const players: PlayerState[] = ordered.map((p, index) => ({
    id: index,
    name: p.name,
    colorToken: p.colorToken,
    isAI: p.isAI,
    aiDifficulty: p.aiDifficulty,
    wallBreaksRemaining,
  }));

  const pieces: Piece[] = [];
  let placementQueue: number[];

  if (config.format === '3p') {
    placementQueue = PLACEMENT_QUEUE_3P.slice();
  } else {
    const fixedKind: PieceKind = config.ruleVariant === 'wallgo2' ? 'round' : 'standard';
    for (let ownerId = 0; ownerId < 2; ownerId++) {
      const fixedPair = FIXED_2P_POSITIONS[ownerId];
      for (let idx = 0; idx < fixedPair.length; idx++) {
        pieces.push({
          id: `p${ownerId}_${idx}`,
          ownerId,
          kind: fixedKind,
          row: fixedPair[idx].row,
          col: fixedPair[idx].col,
        });
      }
    }
    placementQueue = PLACEMENT_QUEUE_2P.slice();
  }

  const draftState: GameState = {
    boardSize: BOARD_SIZE,
    ruleVariant: config.ruleVariant,
    format: config.format,
    isPrisonMatchRound2: false,
    players,
    pieces,
    walls: {},
    lastPlacedWall: null,
    phase: 'placement',
    currentPlayerIndex: placementQueue[0],
    placementQueue,
    placementStep: 0,
    turnNumber: 0,
    turnSubState: createFreshTurnSubState('square'),
    timerSeconds: config.timerSeconds,
    lastSkippedPlayerIds: [],
    lastActionSummary: null,
    lastActionEvent: null,
    territory: EMPTY_TERRITORY_PLACEHOLDER,
  };

  return {
    ...draftState,
    territory: analyzeTerritory(draftState),
  };
}

export function getRemainingPlacementKinds(
  state: GameState,
  playerId: number,
): WallGo2PieceKind[] {
  if (state.ruleVariant !== 'wallgo2' || state.phase !== 'placement') {
    return [];
  }
  if (!Number.isInteger(playerId) || playerId < 0 || playerId >= state.players.length) {
    return [];
  }

  if (state.format === '3p') {
    let hasSquare = false;
    let hasRound = false;
    for (let i = 0; i < state.pieces.length; i++) {
      const piece = state.pieces[i];
      if (piece.ownerId !== playerId) {
        continue;
      }
      if (piece.kind === 'square') {
        hasSquare = true;
      } else if (piece.kind === 'round') {
        hasRound = true;
      }
    }
    const remaining: WallGo2PieceKind[] = [];
    if (!hasSquare) {
      remaining.push('square');
    }
    if (!hasRound) {
      remaining.push('round');
    }
    return remaining;
  }

  // 2P Wall Go II: both 'round' pieces are fixed; each player places 2 'square' pieces.
  let squareCount = 0;
  for (let i = 0; i < state.pieces.length; i++) {
    const piece = state.pieces[i];
    if (piece.ownerId === playerId && piece.kind === 'square') {
      squareCount += 1;
    }
  }
  return squareCount < 2 ? ['square'] : [];
}

function isSameScoreTuple(a: PlayerScoreSummary, b: PlayerScoreSummary): boolean {
  return (
    a.totalTerritory === b.totalTerritory &&
    a.largestSingleTerritory === b.largestSingleTerritory
  );
}

function compareStanding(a: PlayerScoreSummary, b: PlayerScoreSummary): number {
  return (
    b.totalTerritory - a.totalTerritory ||
    b.largestSingleTerritory - a.largestSingleTerritory ||
    a.playerId - b.playerId
  );
}

export function computeRound2Qualification(state: GameState): Round2Qualification {
  if (state.format !== '3p' || state.players.length !== 3) {
    throw new Error('Round 2 qualification requires a 3-player game');
  }
  if (state.phase !== 'game_over') {
    throw new Error('Round 2 qualification requires a finished game (phase === "game_over")');
  }
  if (state.territory.scores.length !== 3) {
    throw new Error('Round 2 qualification requires score summaries for all 3 players');
  }

  // Read state.territory.scores directly and sort a shallow copy by standing.
  const ordered = state.territory.scores.slice().sort(compareStanding);
  const first = ordered[0];
  const second = ordered[1];
  const third = ordered[2];

  const tiedFirstSecond = isSameScoreTuple(first, second);
  const tiedSecondThird = isSameScoreTuple(second, third);

  let status: Round2QualificationStatus;
  let survivorId: number | null;
  let tiedLeaderIds: number[];

  if (tiedFirstSecond && tiedSecondThird) {
    status = 'three_way_tie';
    survivorId = null;
    tiedLeaderIds = [first.playerId, second.playerId, third.playerId];
  } else if (tiedFirstSecond) {
    status = 'tied_for_first';
    survivorId = null;
    tiedLeaderIds = [first.playerId, second.playerId];
  } else {
    status = 'clear';
    survivorId = first.playerId;
    tiedLeaderIds = [];
  }

  return {
    status,
    survivorId,
    tiedLeaderIds,
    defaultFirstPlayerId: second.playerId,
    defaultSecondPlayerId: third.playerId,
    isFirstPlayerOrderTied: tiedSecondThird,
  };
}

function toPlayerConfig(player: PlayerState): PlayerConfig {
  return {
    name: player.name,
    colorToken: player.colorToken,
    isAI: player.isAI,
    aiDifficulty: player.aiDifficulty,
  };
}

export function createPrisonMatchRound2State(
  finished3pState: GameState,
  overridePair?: [number, number],
): GameState {
  if (finished3pState.format !== '3p' || finished3pState.players.length !== 3) {
    throw new Error('Prison Match Round 2 requires a 3-player source game');
  }
  if (finished3pState.phase !== 'game_over') {
    throw new Error('Prison Match Round 2 requires a finished source game (phase === "game_over")');
  }

  let firstId: number;
  let secondId: number;

  if (overridePair !== undefined) {
    if (!Array.isArray(overridePair) || overridePair.length !== 2) {
      throw new Error('overridePair must contain exactly 2 player IDs');
    }
    const [p1Id, p2Id] = overridePair;
    if (!Number.isInteger(p1Id) || !Number.isInteger(p2Id)) {
      throw new Error('overridePair player IDs must be integers');
    }
    if (p1Id === p2Id) {
      throw new Error(`overridePair player IDs must be distinct, received [${p1Id}, ${p2Id}]`);
    }
    const hasFirst = finished3pState.players.some((p) => p.id === p1Id);
    const hasSecond = finished3pState.players.some((p) => p.id === p2Id);
    if (!hasFirst || !hasSecond) {
      throw new Error(`overridePair [${p1Id}, ${p2Id}] references unknown player ID(s)`);
    }
    firstId = p1Id;
    secondId = p2Id;
  } else {
    const qualification = computeRound2Qualification(finished3pState);
    firstId = qualification.defaultFirstPlayerId;
    secondId = qualification.defaultSecondPlayerId;
  }

  const r1First = finished3pState.players.find((p) => p.id === firstId);
  const r1Second = finished3pState.players.find((p) => p.id === secondId);
  if (!r1First || !r1Second) {
    throw new Error(`Failed to resolve Round 2 players [${firstId}, ${secondId}]`);
  }

  const round2Base = createInitialGameState({
    ruleVariant: finished3pState.ruleVariant,
    format: '2p',
    players: [toPlayerConfig(r1First), toPlayerConfig(r1Second)],
    shuffleOrder: false,
    timerSeconds: finished3pState.timerSeconds,
  });

  return {
    ...round2Base,
    isPrisonMatchRound2: true,
  };
}
