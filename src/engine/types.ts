export const BOARD_SIZE = 7;

export const COL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

export const ROW_LABELS = ['1', '2', '3', '4', '5', '6', '7'] as const;

export const DEFAULT_PLAYER_NAMES = ['플레이어 1', '플레이어 2', '플레이어 3'] as const;

export const DEFAULT_PLAYER_NAMES_BY_LOCALE: Record<
  'ko' | 'en',
  readonly [string, string, string]
> = {
  ko: DEFAULT_PLAYER_NAMES,
  en: ['Player 1', 'Player 2', 'Player 3'] as const,
};

export type RuleVariant = 'wallgo1' | 'wallgo2';

export type GameFormat = '3p' | '2p';

export type PieceKind = 'standard' | 'square' | 'round';

export type WallGo2PieceKind = 'square' | 'round';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export type TimerSeconds = 0 | 90 | 60;

export type PlayerColorToken = 'p1' | 'p2' | 'p3';

export type Direction = 'N' | 'S' | 'W' | 'E';

export type WallOrientation = 'h' | 'v';

export type RngFn = () => number;

export interface CellPos {
  row: number;
  col: number;
}

export interface WallEdge {
  orientation: WallOrientation;
  row: number;
  col: number;
}

export type WallKey = `${WallOrientation}:${number}:${number}`;

export interface PlacedWall extends WallEdge {
  ownerId: number;
}

export interface Piece {
  id: string;
  ownerId: number;
  kind: PieceKind;
  row: number;
  col: number;
}

export interface PlayerConfig {
  name: string;
  colorToken: PlayerColorToken;
  isAI: boolean;
  aiDifficulty: AIDifficulty;
}

export interface PlayerState extends PlayerConfig {
  id: number;
  wallBreaksRemaining: number;
}

export interface LobbyConfig {
  ruleVariant: RuleVariant;
  format: GameFormat;
  players: PlayerConfig[];
  shuffleOrder: boolean;
  timerSeconds: TimerSeconds;
}

export type GamePhase =
  | 'placement'
  | 'select_piece'
  | 'move_piece'
  | 'place_wall'
  | 'game_over';

export type PhaseSubstate =
  | 'idle'
  | 'wall_break_select_wall'
  | 'wall_break_move'
  | 'choose_break_wall';

export interface WallGo2BreakChoice {
  destination: CellPos;
  breakableWalls: [WallEdge, WallEdge];
}

export interface TurnSubState {
  selectedPieceId: string | null;
  originPos: CellPos | null;
  wallBreakActive: boolean;
  brokenWallBeforeMove: PlacedWall | null;
  pendingBreakChoice: WallGo2BreakChoice | null;
  selectedPlacementKind: WallGo2PieceKind;
}

export type ComponentKind = 'neutral' | 'secured' | 'contested';

export interface TerritoryComponent {
  id: number;
  cells: CellPos[];
  anchorCell: CellPos;
  pieceIds: string[];
  ownerIds: number[];
  kind: ComponentKind;
  ownerId: number | null;
  size: number;
}

export interface PlayerScoreSummary {
  playerId: number;
  totalTerritory: number;
  largestSingleTerritory: number;
  securedRegions: number[];
  deadlockPieceCount: number;
  rank: number;
}

export type GameEndReason = 'all_separated' | 'deadlock';

export interface GameEndResult {
  isGameOver: boolean;
  endReason: GameEndReason | null;
}

export interface BoardComponentResult {
  components: TerritoryComponent[];
  cellToComponentId: number[][];
}

export interface TerritoryAnalysis {
  components: TerritoryComponent[];
  cellToComponentId: number[][];
  scores: PlayerScoreSummary[];
  isGameOver: boolean;
  endReason: GameEndReason | null;
}

export type Round2QualificationStatus = 'clear' | 'tied_for_first' | 'three_way_tie';

export interface Round2Qualification {
  status: Round2QualificationStatus;
  survivorId: number | null;
  tiedLeaderIds: number[];
  defaultFirstPlayerId: number;
  defaultSecondPlayerId: number;
  isFirstPlayerOrderTied: boolean;
}

export interface PlacementActionEvent {
  kind: 'placement';
  playerId: number;
  actorIsAI: boolean;
  pieceId: string;
  pieceKind: PieceKind;
  pos: CellPos;
  timedOut: boolean;
  skippedPlayerIds: number[];
}

export interface TurnActionEvent {
  kind: 'turn';
  turnNumber: number;
  playerId: number;
  actorIsAI: boolean;
  pieceId: string;
  pieceKind: PieceKind;
  from: CellPos;
  to: CellPos;
  isStay: boolean;
  usedWallBreak: boolean;
  brokenWall: PlacedWall | null;
  placedWall: WallEdge;
  timedOut: boolean;
  skippedPlayerIds: number[];
}

export type ActionEvent = PlacementActionEvent | TurnActionEvent;

export interface AtomicTurnAction {
  pieceId: string;
  useWallBreak: boolean;
  breakWall: WallEdge | null;
  destination: CellPos;
  placeWall: WallEdge;
}

export interface GameState {
  boardSize: 7;
  ruleVariant: RuleVariant;
  format: GameFormat;
  isPrisonMatchRound2: boolean;
  players: PlayerState[];
  pieces: Piece[];
  walls: Record<WallKey, PlacedWall>;
  lastPlacedWall: WallEdge | null;
  phase: GamePhase;
  currentPlayerIndex: number;
  placementQueue: number[];
  placementStep: number;
  turnNumber: number;
  turnSubState: TurnSubState;
  timerSeconds: TimerSeconds;
  lastSkippedPlayerIds: number[];
  lastActionSummary: string | null;
  lastActionEvent: ActionEvent | null;
  territory: TerritoryAnalysis;
}

export interface TurnTimeoutResolution {
  state: GameState;
  event: ActionEvent | null;
}

export type MoveType = 'normal' | 'stay' | 'wall-break';

export interface ValidMoveOption {
  row: number;
  col: number;
  moveType: MoveType;
  breakableWalls?: WallEdge[];
}

export type PieceValidMove = ValidMoveOption;

export interface WallGo2BreakTarget {
  row: number;
  col: number;
  breakableWalls: WallEdge[];
}

export type InteractiveWallState = 'placeable' | 'breakable' | 'breakable-choice';

export interface InteractiveWallSlot extends WallEdge {
  state: InteractiveWallState;
}

export interface HistorySnapshot {
  state: GameState;
  actorPlayerId: number;
  actorIsAI: boolean;
}

export interface GameHistoryState {
  past: HistorySnapshot[];
  turnEntryState: GameState;
  present: GameState;
  future: HistorySnapshot[];
}
