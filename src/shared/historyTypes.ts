import type {
  AIDifficulty,
  GameEndReason,
  GameFormat,
  GameState,
  Piece,
  PlacedWall,
  PlacementActionEvent,
  PlayerColorToken,
  PlayerConfig,
  RuleVariant,
  TimerSeconds,
  TurnActionEvent,
  WallEdge,
  WallKey,
} from '../engine/index.js';
import type { StorageMode } from './onlineTypes.js';

export type MatchSource = 'local' | 'online';

export interface ReplayInitialConfig {
  ruleVariant: RuleVariant;
  format: GameFormat;
  isPrisonMatchRound2: boolean;
  timerSeconds: TimerSeconds;
  /** Exact post-shuffle player order (players[i] corresponds to GameState.players[i]) */
  players: PlayerConfig[];
}

/**
 * Structurally compatible with `ActionEvent & { stepIndex: number }` (PROJECT.md §2).
 * Extending `PlacementActionEvent` / `TurnActionEvent` enforces compile-time lockstep with `src/engine/types.ts`.
 */
export interface ReplayPlacementStep extends PlacementActionEvent {
  /** 1-based step index (0 = initial board before placements) */
  stepIndex: number;
}

export interface ReplayTurnStep extends TurnActionEvent {
  /** 1-based continuous step index after placements */
  stepIndex: number;
}

export type ReplayStep = ReplayPlacementStep | ReplayTurnStep;

export interface ReplayData {
  schemaVersion: 1;
  initialConfig: ReplayInitialConfig;
  steps: ReplayStep[];
}

export interface MatchPlayerSummary {
  playerId: number;
  name: string;
  colorToken: PlayerColorToken;
  isAI: boolean;
  aiDifficulty: AIDifficulty;
  wasSubstitutedToAI?: boolean;
  totalTerritory: number;
  largestSingleTerritory: number;
  securedRegions: number[];
  deadlockPieceCount: number;
  rank: number;
  /** true iff rank === 1 and unique winner (not a draw) */
  isWinner: boolean;
  /** true iff rank === 1 and >= 2 players share rank 1 */
  isDraw: boolean;
  /** 3P only: true if player is in the default advancing Round 2 pair */
  advancingRound2?: boolean;
}

export interface MatchFinalBoardSnapshot {
  pieces: Piece[];
  walls: Record<WallKey, PlacedWall>;
  lastPlacedWall: WallEdge | null;
}

export interface MatchSummary {
  /** 'local_<uuid>' | 'online_<CODE>_g<seq>' */
  id: string;
  schemaVersion: 1;
  mode: MatchSource;
  roomCode?: string;
  /** ISO-8601 UTC timestamp */
  playedAt: string;
  ruleVariant: RuleVariant;
  format: GameFormat;
  isPrisonMatchRound2: boolean;
  timerSeconds: TimerSeconds;
  endReason: GameEndReason;
  totalTurns: number;
  totalSteps: number;
  players: MatchPlayerSummary[];
  finalBoard: MatchFinalBoardSnapshot;
  hasReplay: boolean;
}

export interface MatchRecord extends MatchSummary {
  replay: ReplayData;
}

export interface ReplayFrame {
  /** 0..steps.length */
  stepIndex: number;
  /** Full reconstructed GameState with live territory analysis & scores */
  state: GameState;
  /** null for Step 0 (initial board) */
  step: ReplayStep | null;
}

export interface PlayerAggregateStats {
  /** Normalized grouping key: name.trim().toLowerCase() */
  key: string;
  /** Most recent trimmed casing observed by match playedAt timestamp */
  displayName: string;
  /** true iff every recorded game for this key was pure AI (isAI && !wasSubstitutedToAI) */
  isAIOnly: boolean;
  gamesPlayed: number;
  /** Unique rank === 1 count */
  wins: number;
  /** Shared rank === 1 count */
  draws: number;
  /** rank > 1 count (invariant: wins + draws + losses === gamesPlayed) */
  losses: number;
  /** Integer percentage: Math.round((wins / gamesPlayed) * 100) */
  winRate: number;
  /** 1-decimal rounded average: Number((sumTerritory / gamesPlayed).toFixed(1)) */
  avgTerritory: number;
  bestTerritory: number;
}

export interface MatchesListResponse {
  storage: StorageMode;
  onlineAvailable: boolean;
  matches: MatchSummary[];
}

export interface MatchDetailResponse {
  match: MatchRecord;
}
