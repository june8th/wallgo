import type { AIDifficulty, GameFormat, PieceKind, RuleVariant, TimerSeconds, WallGo2PieceKind, WallOrientation } from '../engine';
import type { ApiErrorCode, Locale, SpectatorRole } from '../shared';

export type { Locale };

export type ReplaySpeed = 0.5 | 1 | 2;
export type OnlineConnectionStatusLabel = 'connected' | 'reconnecting' | 'disconnected';
export type OnlineSeatStatusLabel = 'online' | 'offline' | 'ai';

export interface RuleBullet {
  readonly lead: string;
  readonly body: string;
  readonly emphasis?: string;
  readonly bodyAfter?: string;
}

export interface Messages {
  readonly meta: {
    readonly title: string;
  };
  readonly common: {
    readonly switchLanguageAria: string;
    readonly close: string;
    readonly back: string;
    readonly copied: string;
    readonly loading: string;
    readonly aiDifficulty: Readonly<Record<AIDifficulty, string>>;
    readonly pieceKindShort: Readonly<Record<PieceKind, string>>;
    readonly pieceKindFull: Readonly<Record<PieceKind, string>>;
    readonly variantShort: Readonly<Record<RuleVariant, string>>;
    readonly variantWithSeason: Readonly<Record<RuleVariant, string>>;
    readonly formatShort: Readonly<Record<GameFormat, string>>;
    readonly defaultPlayerName: (index: number) => string;
  };
  readonly nav: {
    readonly ariaLabel: string;
    readonly localTab: string;
    readonly onlineTab: string;
    readonly historyTab: string;
    readonly historyAria: string;
  };
  readonly lobby: {
    readonly title: string;
    readonly tagline: string;
    readonly rulesButton: string;
    readonly rulesButtonAria: string;
    readonly ruleSectionAria: string;
    readonly ruleLabel: string;
    readonly wg1Name: string;
    readonly wg1Sub: string;
    readonly wg1Desc: string;
    readonly wg2Name: string;
    readonly wg2Sub: string;
    readonly wg2Desc: string;
    readonly formatSectionAria: string;
    readonly formatLabel: string;
    readonly format3p: string;
    readonly format2p: string;
    readonly timerSectionAria: string;
    readonly timerLabel: string;
    readonly timerUnlimited: string;
    readonly timerSeconds: (seconds: 60 | 90) => string;
    readonly shuffleTitle: string;
    readonly shuffleDesc: string;
    readonly shuffleAria: string;
    readonly seatsSectionAria: string;
    readonly seatsLabel3p: string;
    readonly seatsLabel2p: string;
    readonly seatNameAria: (seatNum: number) => string;
    readonly seatNamePlaceholder: (seatNum: number) => string;
    readonly seatControllerAria: (seatNum: number) => string;
    readonly controllers: Readonly<{
      readonly human: string;
      readonly 'ai-easy': string;
      readonly 'ai-normal': string;
      readonly 'ai-hard': string;
    }>;
    readonly footerSummary: (variant: RuleVariant, format: GameFormat, timerSeconds: TimerSeconds) => string;
    readonly startGame: string;
  };
  readonly board: {
    readonly regionAria: string;
    readonly gridAria: string;
    readonly stayTag: string;
    readonly pausedOverlay: string;
    readonly cellLabel: (coord: string) => string;
    readonly movePlacementAria: string;
    readonly moveStayAria: string;
    readonly moveNormalAria: string;
    readonly moveWallBreakAria: string;
    readonly wallAria: (
      c1: string,
      c2: string,
      orientation: WallOrientation,
      isPlaceable: boolean,
    ) => string;
  };
  readonly hud: {
    readonly round2Badge: string;
    readonly pause: string;
    readonly resume: string;
    readonly pieceKindPickerAria: string;
    readonly pickSquare: string;
    readonly pickRound: string;
    readonly scoreBoardAria: string;
    readonly securedBadge: string;
    readonly cellsCount: (count: number) => string;
    readonly largestArea: (count: number) => string;
    readonly wallBreakAvailable: string;
    readonly wallBreakUsed: string;
    readonly reopenResult: string;
    readonly wallBreakButton: string;
    readonly cancelMoveButton: string;
    readonly undoButton: string;
    readonly redoButton: string;
    readonly rulesButton: string;
    readonly lobbyButton: string;
    readonly guidance: {
      readonly gameOver: string;
      readonly aiThinking: (name: string) => string;
      readonly placementWg2: (
        name: string,
        kind: WallGo2PieceKind,
        placed: number,
        total: number,
      ) => string;
      readonly placement: (name: string, placed: number, total: number) => string;
      readonly selectPiece: (name: string) => string;
      readonly wallBreakSelectWall: (name: string) => string;
      readonly wallBreakMove: (name: string) => string;
      readonly chooseBreakWall: (name: string) => string;
      readonly movePieceStay: (name: string) => string;
      readonly movePiece: (name: string) => string;
      readonly placeWall: (name: string) => string;
      readonly waitingForOnlineTurn: (name: string) => string;
    };
  };
  readonly result: {
    readonly titleRound1: string;
    readonly titleRound2: string;
    readonly titleGameOver: string;
    readonly endReasonDeadlock: string;
    readonly endReasonSeparated: string;
    readonly rank: (rank: number, isTied: boolean) => string;
    readonly statusSurvivor: string;
    readonly statusRound2: string;
    readonly cellsCount: (count: number) => string;
    readonly largestSingle: (count: number) => string;
    readonly tiebreakerCaption: string;
    readonly round2PreviewTitle: (p1Name: string, p2Name: string) => string;
    readonly round2FirstTurnPrefix: string;
    readonly round2ReasonThreeWayTie: string;
    readonly round2ReasonTiedForFirst: string;
    readonly round2ReasonOrderTied: string;
    readonly round2ReasonClear: string;
    readonly round2PreviewRule: string;
    readonly startRound2Button: string;
    readonly rematchButton: string;
    readonly inspectBoardButton: string;
    readonly backToLobbyButton: string;
  };
  readonly rules: {
    readonly title: string;
    readonly subtitle: string;
    readonly closeAria: string;
    readonly tabsAria: string;
    readonly tabWallGo1: string;
    readonly tabWallGo2: string;
    readonly tabScoring: string;
    readonly wg1Items: readonly RuleBullet[];
    readonly wg2DiagramSquareSvgTitle: string;
    readonly wg2DiagramSquareAria: string;
    readonly wg2DiagramSquareTitle: string;
    readonly wg2DiagramSquareDesc: string;
    readonly wg2DiagramRoundSvgTitle: string;
    readonly wg2DiagramRoundAria: string;
    readonly wg2DiagramRoundTitle: string;
    readonly wg2DiagramRoundDesc: string;
    readonly wg2Items: readonly RuleBullet[];
    readonly scoringItems: readonly RuleBullet[];
  };
  readonly toast: {
    readonly autoSkip: (names: readonly string[]) => string;
    readonly timeoutWall: (name: string) => string;
    readonly timeoutPlacement: (name: string, coord: string) => string;
    readonly timeoutFallback: string;
    readonly aiSubstituted: (name: string, difficulty: AIDifficulty) => string;
    readonly hostTransferred: (name: string) => string;
    readonly round2Started: (survivorName: string | null) => string;
  };
  readonly history: {
    readonly title: string;
    readonly subtitle: string;
    readonly backButton: string;
    readonly filterGroupAria: string;
    readonly filterAll: string;
    readonly filterOnline: string;
    readonly filterLocal: string;
    readonly searchPlaceholder: string;
    readonly searchAria: string;
    readonly clearFiltersButton: string;
    readonly statsTitle: string;
    readonly statsTableAria: string;
    readonly statsColPlayer: string;
    readonly statsColGames: string;
    readonly statsColWdl: string;
    readonly statsColWinRate: string;
    readonly statsColAvgCells: string;
    readonly statsColBest: string;
    readonly statsAiBadge: string;
    readonly statsEmpty: string;
    readonly matchListTitle: string;
    readonly sourceOnline: string;
    readonly sourceLocal: string;
    readonly roomCodeLabel: (code: string) => string;
    readonly round1Badge: string;
    readonly round2Badge: string;
    readonly turnsSummary: (turns: number, steps: number) => string;
    readonly winnerBadge: string;
    readonly drawBadge: string;
    readonly substitutedBadge: string;
    readonly watchReplayButton: string;
    readonly loadingReplayButton: string;
    readonly emptyTitle: string;
    readonly emptyDesc: string;
    readonly emptyFilteredTitle: string;
    readonly emptyFilteredDesc: string;
    readonly onlineUnavailableNotice: string;
    readonly loadingOnline: string;
    readonly loadReplayError: string;
    readonly miniBoardAria: string;
  };
  readonly replay: {
    readonly title: string;
    readonly closeButton: string;
    readonly stepIndicator: (step: number, total: number) => string;
    readonly initialBoardDescription: string;
    readonly initialBoardFixedDescription: string;
    readonly controlsAria: string;
    readonly firstButton: string;
    readonly prevButton: string;
    readonly playButton: string;
    readonly pauseButton: string;
    readonly nextButton: string;
    readonly lastButton: string;
    readonly speedLabel: (speed: ReplaySpeed) => string;
    readonly speedAria: (speed: ReplaySpeed) => string;
    readonly scrubberAria: string;
    readonly moveListTitle: string;
    readonly moveListInitial: string;
    readonly playersTitle: string;
    readonly validationErrorTitle: string;
    readonly validationErrorDesc: (stepIndex: number) => string;
    readonly fallbackFinalBoardNotice: string;
    readonly timeoutTag: string;
    readonly aiTag: string;
    readonly keyboardHint: string;
    readonly stepPlacement: (name: string, pieceLabel: string, coord: string) => string;
    readonly stepPlacementTimeout: (name: string, pieceLabel: string, coord: string) => string;
    readonly stepTurnStay: (name: string, coord: string, wallLabel: string) => string;
    readonly stepTurnMove: (name: string, from: string, to: string, wallLabel: string) => string;
    readonly stepTurnBreak: (
      name: string,
      from: string,
      to: string,
      brokenLabel: string,
      wallLabel: string,
      resealed: boolean,
    ) => string;
    readonly stepTurnStayBreak: (
      name: string,
      coord: string,
      brokenLabel: string,
      wallLabel: string,
      resealed: boolean,
    ) => string;
    readonly stepSkipSuffix: (names: readonly string[]) => string;
    readonly stepTimeoutSuffix: string;
  };
  readonly online: {
    readonly panelTitle: string;
    readonly panelSubtitle: string;
    readonly nicknameLabel: string;
    readonly nicknamePlaceholder: string;
    readonly nicknameHint: string;
    readonly createTitle: string;
    readonly createButton: string;
    readonly creatingButton: string;
    readonly joinTitle: string;
    readonly joinCodeLabel: string;
    readonly joinCodePlaceholder: string;
    readonly joinButton: string;
    readonly joiningButton: string;
    readonly checkingStatus: string;
    readonly redisUnconfiguredTitle: string;
    readonly redisUnconfiguredDesc: string;
    readonly redisUnconfiguredSteps: readonly [string, string, string];
    readonly redisUnconfiguredLocalNote: string;
    readonly comingSoonFallback: string;
    readonly waitingTitle: string;
    readonly roomCodeLabel: string;
    readonly copyCodeButton: string;
    readonly copyLinkButton: string;
    readonly inviteShortButton: string;
    readonly copiedLabel: string;
    readonly editNicknameLabel: string;
    readonly saveNicknameButton: string;
    readonly configTitle: string;
    readonly seatsTitle: string;
    readonly seatOpen: string;
    readonly seatRoleAria: (seatNum: number) => string;
    readonly seatRoleOpen: string;
    readonly kickButton: string;
    readonly kickAria: (name: string) => string;
    readonly hostBadge: string;
    readonly meBadge: string;
    readonly spectatorsTitle: (count: number) => string;
    readonly spectatorsEmpty: string;
    readonly spectatorRoleLabels: Readonly<Record<SpectatorRole, string>>;
    readonly spectatorBanners: Readonly<Record<SpectatorRole, string>>;
    readonly startGameButton: string;
    readonly seatsNotReadyHint: string;
    readonly waitingForHostHint: string;
    readonly claimHostButton: string;
    readonly leaveRoomButton: string;
    readonly kickedNotice: string;
    readonly connectionStatus: Readonly<Record<OnlineConnectionStatusLabel, string>>;
    readonly seatStatus: Readonly<Record<OnlineSeatStatusLabel, string>>;
    readonly substituteAiButton: string;
    readonly undoDisabledHint: string;
    readonly returnWaitingButton: string;
    readonly waitingForHostResult: string;
    readonly networkError: string;
    readonly errors: Readonly<Record<ApiErrorCode, string>>;
  };
}
