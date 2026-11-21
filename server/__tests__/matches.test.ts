import { afterEach, describe, expect, it } from 'vitest';
import apiEntry from '../../api/index.js';
import { chooseAiPlacement, chooseAiTurn } from '../../src/ai/index.js';
import { type GameState, type RngFn } from '../../src/engine/index.js';
import {
  MAX_ONLINE_MATCHES,
  buildReplayFrames,
  computePlayerAggregateStats,
  extractMatchFinalBoard,
  type ApiErrorBody,
  type CreateRoomResponse,
  type MatchDetailResponse,
  type MatchRecord,
  type MatchesListResponse,
  type OnlineGameAction,
  type OnlineRoomConfig,
  type PublicRoomSnapshot,
  type RoomCommandResponse,
} from '../../src/shared/index.js';
import { buildOnlineMatchId, saveOnlineMatchForRoom } from '../matchService.js';
import { createRoomHandlers } from '../roomService.js';
import { NO_STORE_HEADER, handleApiRequest, type HandleApiRequestOptions } from '../router.js';
import { MemoryStore, resetSharedMemoryStore } from '../store/index.js';

function createSeededRng(seed = 20261121): RngFn {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function buildValidActionForCurrentTurn(gs: GameState, rng: RngFn): OnlineGameAction {
  if (gs.phase === 'placement') {
    const pick = chooseAiPlacement(gs, 'easy', rng);
    return {
      type: 'commit_placement',
      pos: { row: pick.row, col: pick.col },
      kind: pick.kind,
    };
  }
  const turn = chooseAiTurn(gs, 'easy', rng);
  return {
    type: 'commit_turn',
    pieceId: turn.pieceId,
    useWallBreak: turn.useWallBreak,
    breakWall: turn.breakWall,
    destination: turn.destination,
    placeWall: turn.placeWall,
  };
}

function assertReplayMatchesFinalBoard(match: MatchRecord): void {
  expect(match.hasReplay).toBe(true);
  expect(match.replay.schemaVersion).toBe(1);
  expect(match.totalSteps).toBe(match.replay.steps.length);

  const frames = buildReplayFrames(match.replay);
  expect(frames).toHaveLength(match.replay.steps.length + 1);
  const finalState = frames[frames.length - 1].state;

  expect(finalState.phase).toBe('game_over');
  expect(finalState.turnNumber).toBe(match.totalTurns);
  expect(extractMatchFinalBoard(finalState)).toEqual(match.finalBoard);

  for (const playerSummary of match.players) {
    const score = finalState.territory.scores.find((s) => s.playerId === playerSummary.playerId);
    expect(score).toBeDefined();
    expect(score!.totalTerritory).toBe(playerSummary.totalTerritory);
    expect(score!.largestSingleTerritory).toBe(playerSummary.largestSingleTerritory);
  }
}

interface MatchHarness {
  store: MemoryStore;
  now: number;
  env: Record<string, string | undefined>;
  opts: (overrides?: Partial<HandleApiRequestOptions>) => HandleApiRequestOptions;
  createRoom: (
    nickname: string,
    clientId: string,
    config: OnlineRoomConfig,
  ) => Promise<CreateRoomResponse>;
  cmd: (code: string, payload: Record<string, unknown>) => Promise<RoomCommandResponse>;
  listMatches: (query?: string) => Promise<{ status: number; res: Response; body: MatchesListResponse }>;
  getMatch: (id: string) => Promise<{ status: number; res: Response; body: MatchDetailResponse & ApiErrorBody }>;
}

function makeHarness(seed = 1001): MatchHarness {
  let currentNow = 1_700_100_000_000;
  const rng = createSeededRng(seed);
  const store = new MemoryStore(() => currentNow);
  const env: Record<string, string | undefined> = { WALLGO_AI_STEP_MIN_DELAY_MS: '0' };
  const handlers = createRoomHandlers({ rng });

  const opts = (overrides?: Partial<HandleApiRequestOptions>): HandleApiRequestOptions => ({
    store,
    now: () => currentNow,
    env,
    handlers,
    ...overrides,
  });

  return {
    store,
    get now() {
      return currentNow;
    },
    set now(v: number) {
      currentNow = v;
    },
    env,
    opts,
    async createRoom(nickname, clientId, config) {
      const res = await handleApiRequest(
        new Request('http://localhost/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname, clientId, config }),
        }),
        opts(),
      );
      expect(res.status).toBe(201);
      return (await res.json()) as CreateRoomResponse;
    },
    async cmd(code, payload) {
      const res = await handleApiRequest(
        new Request(`http://localhost/api/rooms/${code}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        opts(),
      );
      expect(res.status).toBe(200);
      return (await res.json()) as RoomCommandResponse;
    },
    async listMatches(query = '') {
      const res = await handleApiRequest(new Request(`http://localhost/api/matches${query}`), opts());
      const body = (await res.json()) as MatchesListResponse;
      return { status: res.status, res, body };
    },
    async getMatch(id) {
      const res = await handleApiRequest(
        new Request(`http://localhost/api/matches/${encodeURIComponent(id)}`),
        opts(),
      );
      const body = (await res.json()) as MatchDetailResponse & ApiErrorBody;
      return { status: res.status, res, body };
    },
  };
}

async function playToFinish(
  h: MatchHarness,
  code: string,
  initialRoom: PublicRoomSnapshot,
  tokensBySeat: Map<number, string>,
  driverToken: string,
  rng: RngFn,
  options?: { finishByTimeoutOnLastTurns?: boolean },
): Promise<PublicRoomSnapshot> {
  let room = initialRoom;
  for (let step = 0; step < 500 && room.status === 'playing'; step++) {
    const gs = room.gameState!;
    const activePlayer = gs.players[gs.currentPlayerIndex];
    if (activePlayer.isAI) {
      if (room.nextAiStepAt !== null && h.now < room.nextAiStepAt) {
        h.now = room.nextAiStepAt;
      }
      const res = await h.cmd(code, {
        op: 'ai_step',
        sessionToken: driverToken,
        expectedVersion: room.version,
      });
      expect(res.executed).toBe(true);
      room = res.room;
    } else if (
      options?.finishByTimeoutOnLastTurns &&
      gs.phase === 'select_piece' &&
      room.turnStartedAt !== null &&
      gs.timerSeconds > 0
    ) {
      h.now = room.turnStartedAt + gs.timerSeconds * 1000;
      const seat = room.seats.find((s) => s.gamePlayerId === activePlayer.id)!;
      const actorToken = tokensBySeat.get(seat.seatIndex)!;
      const res = await h.cmd(code, {
        op: 'timeout',
        sessionToken: actorToken,
        expectedVersion: room.version,
      });
      expect(res.executed).toBe(true);
      room = res.room;
    } else {
      const seat = room.seats.find((s) => s.gamePlayerId === activePlayer.id)!;
      const actorToken = tokensBySeat.get(seat.seatIndex)!;
      const action = buildValidActionForCurrentTurn(gs, rng);
      const res = await h.cmd(code, {
        op: 'game_action',
        sessionToken: actorToken,
        expectedVersion: room.version,
        action,
      });
      room = res.room;
    }
  }
  expect(room.status).toBe('finished');
  return room;
}

describe('M7 Shared Online Match History & Full Replay Persistence', () => {
  afterEach(() => {
    resetSharedMemoryStore();
  });

  it('V2-E24(a): saves WG1 match on game_action game_over once, preserves live nickname rename, omits replay from summary list, and matches buildReplayFrames 100%', async () => {
    const rng = createSeededRng(404);
    const h = makeHarness(404);
    const created = await h.createRoom('Alice', 'c-a', {
      ruleVariant: 'wallgo1',
      format: '2p',
      timerSeconds: 0,
      shuffleOrder: false,
    });
    const code = created.room.code;
    const aTok = created.sessionToken;
    const bJoin = await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-b' });
    const bTok = bJoin.sessionToken!;

    const started = await h.cmd(code, {
      op: 'start_game',
      sessionToken: aTok,
      expectedVersion: bJoin.room.version,
    });

    // Update Alice's nickname mid-game to verify live & replay consistency!
    const renamed = await h.cmd(code, {
      op: 'update_nickname',
      sessionToken: aTok,
      expectedVersion: started.room.version,
      nickname: 'AlicePro',
    });

    const finished = await playToFinish(
      h,
      code,
      renamed.room,
      new Map([
        [0, aTok],
        [1, bTok],
      ]),
      aTok,
      rng,
    );

    const expectedId = buildOnlineMatchId(code, 1);
    expect(finished.matchSavedId).toBe(expectedId);

    // Duplicate save attempt is atomically rejected (strictly 1 match stored)
    const rawFinished = (await h.store.getRoom(code))!;
    const dupSaved = await saveOnlineMatchForRoom(h.store, rawFinished, h.now + 5000);
    expect(dupSaved).toBe(false);

    // GET /api/matches returns lightweight summary WITHOUT replay blob
    const list = await h.listMatches();
    expect(list.status).toBe(200);
    expect(list.res.headers.get('cache-control')).toBe(NO_STORE_HEADER);
    expect(list.body.storage).toBe('memory');
    expect(list.body.onlineAvailable).toBe(true);
    expect(list.body.matches).toHaveLength(1);
    expect(list.body.matches[0].id).toBe(expectedId);
    expect(list.body.matches[0].mode).toBe('online');
    expect(list.body.matches[0].roomCode).toBe(code);
    expect('replay' in list.body.matches[0]).toBe(false);

    // GET /api/matches/:id returns full MatchRecord whose replay reproduces finalBoard & updated nickname
    const detail = await h.getMatch(expectedId);
    expect(detail.status).toBe(200);
    expect(detail.body.match.players.some((p) => p.name === 'AlicePro')).toBe(true);
    expect(detail.body.match.replay.initialConfig.players[0].name).toBe('AlicePro');
    assertReplayMatchesFinalBoard(detail.body.match);
  });

  it('V2-E24(b): saves WG2 match ended via ai_step with mid-game substitute_ai, preserving wasSubstitutedToAI & exact replay parity', async () => {
    const rng = createSeededRng(808);
    const h = makeHarness(808);
    const created = await h.createRoom('Host', 'c-host', {
      ruleVariant: 'wallgo2',
      format: '2p',
      timerSeconds: 0,
      shuffleOrder: false,
    });
    const code = created.room.code;
    const hostTok = created.sessionToken;
    const guestJoin = await h.cmd(code, { op: 'join', nickname: 'Guest', clientId: 'c-guest' });
    const guestTok = guestJoin.sessionToken!;

    let room = (
      await h.cmd(code, {
        op: 'start_game',
        sessionToken: hostTok,
        expectedVersion: guestJoin.room.version,
      })
    ).room;

    // Play 1 placement as Host, then Guest explicitly leaves and Host substitutes AI for Guest!
    const firstAction = buildValidActionForCurrentTurn(room.gameState!, rng);
    room = (
      await h.cmd(code, {
        op: 'game_action',
        sessionToken: hostTok,
        expectedVersion: room.version,
        action: firstAction,
      })
    ).room;

    room = (await h.cmd(code, { op: 'leave', sessionToken: guestTok })).room;
    room = (
      await h.cmd(code, {
        op: 'substitute_ai',
        sessionToken: hostTok,
        expectedVersion: room.version,
        seatIndex: 1,
        aiDifficulty: 'easy',
      })
    ).room;

    const finished = await playToFinish(h, code, room, new Map([[0, hostTok]]), hostTok, rng);
    const expectedId = buildOnlineMatchId(code, 1);
    expect(finished.matchSavedId).toBe(expectedId);

    const detail = await h.getMatch(expectedId);
    expect(detail.status).toBe(200);
    const match = detail.body.match;
    expect(match.ruleVariant).toBe('wallgo2');

    // Substituted player has wasSubstitutedToAI: true & is NOT treated as pure AI in aggregate stats!
    const guestSummary = match.players.find((p) => p.name === 'Guest');
    expect(guestSummary).toBeDefined();
    expect(guestSummary!.isAI).toBe(true);
    expect(guestSummary!.wasSubstitutedToAI).toBe(true);

    const stats = computePlayerAggregateStats([match]);
    const guestStats = stats.find((s) => s.displayName === 'Guest');
    expect(guestStats).toBeDefined();
    expect(guestStats!.isAIOnly).toBe(false);

    // Replay preserves initial human isAI: false and post-substitution actorIsAI: true steps
    expect(match.replay.initialConfig.players[1].isAI).toBe(false);
    expect(match.replay.steps.some((s) => s.playerId === 1 && s.actorIsAI === true)).toBe(true);
    assertReplayMatchesFinalBoard(match);
  });

  it('V2-E24(c): saves timed match ended via timeout with timedOut replay steps and exact buildReplayFrames parity', async () => {
    const rng = createSeededRng(1212);
    const h = makeHarness(1212);
    const created = await h.createRoom('TimerA', 'c-ta', {
      ruleVariant: 'wallgo1',
      format: '2p',
      timerSeconds: 60,
      shuffleOrder: false,
    });
    const code = created.room.code;
    const aTok = created.sessionToken;
    const bJoin = await h.cmd(code, { op: 'join', nickname: 'TimerB', clientId: 'c-tb' });
    const bTok = bJoin.sessionToken!;

    const started = await h.cmd(code, {
      op: 'start_game',
      sessionToken: aTok,
      expectedVersion: bJoin.room.version,
    });

    const finished = await playToFinish(
      h,
      code,
      started.room,
      new Map([
        [0, aTok],
        [1, bTok],
      ]),
      aTok,
      rng,
      { finishByTimeoutOnLastTurns: true },
    );

    const expectedId = buildOnlineMatchId(code, 1);
    expect(finished.matchSavedId).toBe(expectedId);

    const detail = await h.getMatch(expectedId);
    expect(detail.status).toBe(200);
    const match = detail.body.match;
    expect(match.timerSeconds).toBe(60);
    const lastStep = match.replay.steps[match.replay.steps.length - 1];
    expect(lastStep.timedOut).toBe(true);
    assertReplayMatchesFinalBoard(match);
  });

  it('V2-E24(d): persists unique sequential matches across 3P Round 1 -> Round 2 -> Rematch -> Return to Waiting -> Game 4 with 100% replay parity', async () => {
    const rng = createSeededRng(3333);
    const h = makeHarness(3333);
    const created = await h.createRoom('P1', 'c-1', {
      ruleVariant: 'wallgo1',
      format: '3p',
      timerSeconds: 0,
      shuffleOrder: false,
    });
    const code = created.room.code;
    const tok = created.sessionToken;

    let room = (
      await h.cmd(code, {
        op: 'set_seat',
        sessionToken: tok,
        expectedVersion: 1,
        seatIndex: 1,
        kind: 'ai',
        aiDifficulty: 'easy',
      })
    ).room;
    room = (
      await h.cmd(code, {
        op: 'set_seat',
        sessionToken: tok,
        expectedVersion: room.version,
        seatIndex: 2,
        kind: 'ai',
        aiDifficulty: 'easy',
      })
    ).room;

    // Game 1: 3P Round 1
    room = (
      await h.cmd(code, { op: 'start_game', sessionToken: tok, expectedVersion: room.version })
    ).room;
    room = await playToFinish(h, code, room, new Map([[0, tok]]), tok, rng);
    expect(room.matchSavedId).toBe(buildOnlineMatchId(code, 1));

    // Game 2: Prison Match Round 2
    room = (
      await h.cmd(code, { op: 'start_round2', sessionToken: tok, expectedVersion: room.version })
    ).room;
    const r2Tokens = new Map<number, string>();
    if (room.viewer.role === 'player' && room.viewer.seatIndex !== null) {
      r2Tokens.set(room.viewer.seatIndex, tok);
    }
    room = await playToFinish(h, code, room, r2Tokens, tok, rng);
    expect(room.matchSavedId).toBe(buildOnlineMatchId(code, 2));

    // Game 3: Round 2 Rematch
    room = (
      await h.cmd(code, { op: 'rematch', sessionToken: tok, expectedVersion: room.version })
    ).room;
    room = await playToFinish(h, code, room, r2Tokens, tok, rng);
    expect(room.matchSavedId).toBe(buildOnlineMatchId(code, 3));

    // Game 4: Return to Waiting -> Start fresh 3P game (must get g4, NEVER overwrite g1!)
    room = (
      await h.cmd(code, {
        op: 'return_to_waiting',
        sessionToken: tok,
        expectedVersion: room.version,
      })
    ).room;
    room = (
      await h.cmd(code, { op: 'start_game', sessionToken: tok, expectedVersion: room.version })
    ).room;
    room = await playToFinish(h, code, room, new Map([[0, tok]]), tok, rng);
    expect(room.matchSavedId).toBe(buildOnlineMatchId(code, 4));

    const list = await h.listMatches('?limit=20');
    expect(list.body.matches.map((m) => m.id)).toEqual([
      buildOnlineMatchId(code, 4),
      buildOnlineMatchId(code, 3),
      buildOnlineMatchId(code, 2),
      buildOnlineMatchId(code, 1),
    ]);

    // Verify every single match detail and replay parity
    for (const seq of [1, 2, 3, 4]) {
      const detail = await h.getMatch(buildOnlineMatchId(code, seq));
      expect(detail.status).toBe(200);
      assertReplayMatchesFinalBoard(detail.body.match);
      if (seq === 1 || seq === 4) {
        expect(detail.body.match.format).toBe('3p');
        expect(detail.body.match.isPrisonMatchRound2).toBe(false);
        expect(detail.body.match.players.some((p) => p.advancingRound2 === true)).toBe(true);
      } else {
        expect(detail.body.match.format).toBe('2p');
        expect(detail.body.match.isPrisonMatchRound2).toBe(true);
      }
    }
  });

  it('V2-E24(e): enforces MAX_ONLINE_MATCHES = 200 cap eviction and exposes latest 200 matches', async () => {
    const rng = createSeededRng(505);
    const h = makeHarness(505);
    const created = await h.createRoom('CapHost', 'c-cap', {
      ruleVariant: 'wallgo1',
      format: '2p',
      timerSeconds: 0,
      shuffleOrder: false,
    });
    const code = created.room.code;
    const tok = created.sessionToken;
    const ai = await h.cmd(code, {
      op: 'set_seat',
      sessionToken: tok,
      expectedVersion: 1,
      seatIndex: 1,
      kind: 'ai',
      aiDifficulty: 'easy',
    });
    const st = await h.cmd(code, {
      op: 'start_game',
      sessionToken: tok,
      expectedVersion: ai.room.version,
    });
    await playToFinish(h, code, st.room, new Map([[0, tok]]), tok, rng);

    const templateDetail = await h.getMatch(buildOnlineMatchId(code, 1));
    const baseMatch = templateDetail.body.match;

    // Seed 204 additional matches (total 205 -> oldest 5 evicted)
    for (let i = 2; i <= MAX_ONLINE_MATCHES + 5; i++) {
      const id = `online_CAP200_g${i}`;
      const record: MatchRecord = { ...baseMatch, id, playedAt: new Date(h.now + i * 1000).toISOString() };
      const { replay: _omit, ...summary } = record;
      await h.store.saveMatchAtomic(record, summary, MAX_ONLINE_MATCHES);
    }

    const list = await h.listMatches('?limit=200');
    expect(list.status).toBe(200);
    expect(list.body.matches).toHaveLength(MAX_ONLINE_MATCHES);
    expect(list.body.matches[0].id).toBe(`online_CAP200_g${MAX_ONLINE_MATCHES + 5}`);

    // Original match g1 and earliest CAP matches g2..g5 were evicted -> 404 MATCH_NOT_FOUND
    const evicted = await h.getMatch(buildOnlineMatchId(code, 1));
    expect(evicted.status).toBe(404);
    expect(evicted.body.error.code).toBe('MATCH_NOT_FOUND');
  });

  it('V2-E23 & V2-E29: handles unconfigured Redis mode, invalid match IDs, HEAD, ?__path=, 405, and apiEntry.fetch', async () => {
    const h = makeHarness();

    // Unconfigured mode: /api/matches returns 200 empty; /api/matches/:id returns 503 REDIS_NOT_CONFIGURED
    const unconfList = await handleApiRequest(new Request('http://localhost/api/matches'), {
      env: { WALLGO_FORCE_UNCONFIGURED: '1' },
    });
    expect(unconfList.status).toBe(200);
    expect(unconfList.headers.get('cache-control')).toBe(NO_STORE_HEADER);
    expect(await unconfList.json()).toEqual({
      storage: 'unconfigured',
      onlineAvailable: false,
      matches: [],
    });

    const unconfDetail = await handleApiRequest(
      new Request('http://localhost/api/matches/online_AB3K9M_g1'),
      { env: { WALLGO_FORCE_UNCONFIGURED: '1' } },
    );
    expect(unconfDetail.status).toBe(503);
    expect(((await unconfDetail.json()) as ApiErrorBody).error.code).toBe('REDIS_NOT_CONFIGURED');

    // Invalid match IDs (too long, control chars) -> 400 INVALID_REQUEST
    for (const badId of ['a'.repeat(129), 'bad\nid', 'bad\u0000id']) {
      const r = await h.getMatch(badId);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_REQUEST');
    }

    // 405 Method Not Allowed on POST /api/matches
    const postMatches = await handleApiRequest(
      new Request('http://localhost/api/matches', { method: 'POST' }),
      h.opts(),
    );
    expect(postMatches.status).toBe(405);
    expect(postMatches.headers.get('allow')).toBe('GET, HEAD');

    // apiEntry.fetch + ?__path= + HEAD
    const listEntry = await apiEntry.fetch(
      new Request('http://localhost/api?__path=api/matches', { method: 'GET' }),
    );
    expect(listEntry.status).toBe(200);
    expect(listEntry.headers.get('cache-control')).toBe(NO_STORE_HEADER);

    const headEntry = await apiEntry.fetch(
      new Request('http://localhost/api/matches', { method: 'HEAD' }),
    );
    expect(headEntry.status).toBe(200);
    expect(await headEntry.text()).toBe('');
  });
});
