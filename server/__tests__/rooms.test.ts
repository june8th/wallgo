import { afterEach, describe, expect, it, vi } from 'vitest';
import apiEntry from '../../api/index.js';
import { chooseAiPlacement, chooseAiTurn } from '../../src/ai/index.js';
import {
  getLegalWallPlacements,
  getPieceValidMoves,
  getSelectablePieceIds,
  getWallGo1BreakableWalls,
  getWallGo2BreakTargets,
  isSameWallEdge,
  wallKey,
  type GameState,
  type Piece,
  type RngFn,
  type WallEdge,
} from '../../src/engine/index.js';
import {
  MAX_KICKED_TOKENS,
  type RoomRecord,
} from '../types.js';
import {
  MAX_SPECTATORS_PER_ROOM,
  ROOM_CODE_REGEX,
  type ApiErrorBody,
  type CreateRoomResponse,
  type GetRoomResponse,
  type OnlineGameAction,
  type OnlineRoomConfig,
  type PublicRoomSnapshot,
  type RoomCommandResponse,
} from '../../src/shared/index.js';
import { createRoomHandlers } from '../roomService.js';
import { NO_STORE_HEADER, handleApiRequest, type HandleApiRequestOptions } from '../router.js';
import { MemoryStore, UnconfiguredStore, resetSharedMemoryStore } from '../store/index.js';

function createSeededRng(seed = 123456789): RngFn {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const DEFAULT_3P_CONFIG: OnlineRoomConfig = {
  ruleVariant: 'wallgo1',
  format: '3p',
  timerSeconds: 0,
  shuffleOrder: false,
};

const DEFAULT_2P_CONFIG: OnlineRoomConfig = {
  ruleVariant: 'wallgo1',
  format: '2p',
  timerSeconds: 0,
  shuffleOrder: false,
};

interface TestHarness {
  store: MemoryStore;
  now: number;
  env: Record<string, string | undefined>;
  opts: (overrides?: Partial<HandleApiRequestOptions>) => HandleApiRequestOptions;
  createRoom: (
    nickname: string,
    clientId: string,
    config?: OnlineRoomConfig,
    locale?: 'ko' | 'en',
  ) => Promise<{ status: number; res: Response; body: CreateRoomResponse }>;
  getRoom: (
    code: string,
    token?: string,
    query?: string,
    method?: 'GET' | 'HEAD',
  ) => Promise<{ status: number; res: Response; body: GetRoomResponse | ApiErrorBody | null }>;
  cmd: (
    code: string,
    payload: Record<string, unknown>,
    contentType?: string,
  ) => Promise<{ status: number; res: Response; body: RoomCommandResponse & ApiErrorBody }>;
}

function makeHarness(deps?: { generateCode?: () => string; rng?: RngFn; startNow?: number }): TestHarness {
  let currentNow = deps?.startNow ?? 1_700_000_000_000;
  const store = new MemoryStore(() => currentNow);
  const env: Record<string, string | undefined> = {};
  const handlers = deps?.generateCode || deps?.rng
    ? createRoomHandlers({ generateCode: deps.generateCode, rng: deps.rng })
    : undefined;

  const opts = (overrides?: Partial<HandleApiRequestOptions>): HandleApiRequestOptions => ({
    store,
    now: () => currentNow,
    env,
    ...(handlers ? { handlers } : {}),
    ...overrides,
  });

  return {
    store,
    get now() {
      return currentNow;
    },
    set now(value: number) {
      currentNow = value;
    },
    env,
    opts,
    async createRoom(nickname, clientId, config = DEFAULT_3P_CONFIG, locale) {
      const payload: Record<string, unknown> = { nickname, clientId, config };
      if (locale !== undefined) payload.locale = locale;
      const res = await handleApiRequest(
        new Request('http://localhost/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        opts(),
      );
      const body = (await res.json()) as CreateRoomResponse;
      return { status: res.status, res, body };
    },
    async getRoom(code, token, query = '', method = 'GET') {
      const headers: Record<string, string> = {};
      if (token) headers['X-Session-Token'] = token;
      const url = `http://localhost/api/rooms/${encodeURIComponent(code)}${query}`;
      const res = await handleApiRequest(new Request(url, { method, headers }), opts());
      const body = method === 'HEAD' ? null : ((await res.json()) as GetRoomResponse | ApiErrorBody);
      return { status: res.status, res, body };
    },
    async cmd(code, payload, contentType = 'application/json') {
      const res = await handleApiRequest(
        new Request(`http://localhost/api/rooms/${encodeURIComponent(code)}`, {
          method: 'POST',
          headers: { 'Content-Type': contentType },
          body: JSON.stringify(payload),
        }),
        opts(),
      );
      const body = (await res.json()) as RoomCommandResponse & ApiErrorBody;
      return { status: res.status, res, body };
    },
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

function assertNoPrivateFields(room: PublicRoomSnapshot, secrets: string[]): void {
  const serialized = JSON.stringify(room);
  for (const forbiddenKey of [
    '"sessionToken"',
    '"clientId"',
    '"kickedTokens"',
    '"round1Roster"',
    '"replayDraft"',
    '"eventCounter"',
    '"explicitlyLeft"',
    '"joinedAt"',
    '"createdAt"',
    '"updatedAt"',
  ]) {
    expect(serialized).not.toContain(forbiddenKey);
  }
  for (const secret of secrets) {
    if (secret.length > 0) {
      expect(serialized).not.toContain(secret);
    }
  }
}

async function finishGameByAiOrHumans(
  h: TestHarness,
  code: string,
  tokensBySeat: Map<number, string>,
  driverToken: string,
  rng: RngFn,
  maxSteps = 400,
): Promise<PublicRoomSnapshot> {
  const g0 = await h.getRoom(code, driverToken);
  expect(g0.status).toBe(200);
  let room = (g0.body as { unchanged: false; room: PublicRoomSnapshot }).room;

  for (let step = 0; step < maxSteps && room.status === 'playing'; step++) {
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
      expect(res.status).toBe(200);
      expect(res.body.executed).toBe(true);
      room = res.body.room;
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
      expect(res.status).toBe(200);
      room = res.body.room;
    }
  }

  expect(room.status).toBe('finished');
  return room;
}

describe('M7 Online Multiplayer Room Service & Router', () => {
  afterEach(() => {
    resetSharedMemoryStore();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // V2-E01 & V2-E02: Room code normalization, validation & NX collision retries
  // --------------------------------------------------------------------------
  describe('V2-E01 & V2-E02: Room Code Creation, Normalization & Collision Retries', () => {
    it('normalizes mixed-case/dashed/padded codes, accepts L, and rejects invalid/missing codes', async () => {
      const h = makeHarness({ generateCode: () => 'ABCL9M' });
      const created = await h.createRoom('Alice', 'client-alice', DEFAULT_3P_CONFIG, 'en');
      expect(created.status).toBe(201);
      expect(created.res.headers.get('cache-control')).toBe(NO_STORE_HEADER);
      expect(created.body.room.code).toBe('ABCL9M');
      expect(ROOM_CODE_REGEX.test(created.body.room.code)).toBe(true);

      // GET with spaces, dashes, and lowercase normalizes to ABCL9M
      const poll = await h.getRoom(' abcl-9m ', created.body.sessionToken);
      expect(poll.status).toBe(200);
      expect((poll.body as { unchanged: false; room: PublicRoomSnapshot }).room.code).toBe('ABCL9M');

      // Join with normalized code
      const joined = await h.cmd(' ab-cl 9m ', {
        op: 'join',
        nickname: 'Bob',
        clientId: 'client-bob',
      });
      expect(joined.status).toBe(200);
      expect(joined.body.room.code).toBe('ABCL9M');
      expect(joined.body.room.viewer.seatIndex).toBe(1);

      // Invalid room codes (0, O, 1, I, wrong length, >64 chars) -> 400 INVALID_ROOM_CODE
      for (const badCode of ['0O1IL2', 'ABCDE', 'ABCDEFG', 'AB3K9!', 'A'.repeat(65)]) {
        const res = await h.getRoom(badCode);
        expect(res.status).toBe(400);
        expect((res.body as ApiErrorBody).error.code).toBe('INVALID_ROOM_CODE');
      }

      // Valid format but nonexistent -> 404 ROOM_NOT_FOUND
      const missing = await h.getRoom('ZZZZ99');
      expect(missing.status).toBe(404);
      expect((missing.body as ApiErrorBody).error.code).toBe('ROOM_NOT_FOUND');
    });

    it('retries NX code creation up to 5 times on collision and returns 500 if all 5 collide', async () => {
      let idx = 0;
      const seq = ['AAAA22', 'AAAA22', 'BBBB33', 'AAAA22', 'BBBB33', 'CCCC44'];
      const h = makeHarness({ generateCode: () => seq[idx++] ?? 'AAAA22' });

      const r1 = await h.createRoom('Host1', 'c1');
      expect(r1.status).toBe(201);
      expect(r1.body.room.code).toBe('AAAA22');

      // Collides once on AAAA22, succeeds on BBBB33
      const r2 = await h.createRoom('Host2', 'c2');
      expect(r2.status).toBe(201);
      expect(r2.body.room.code).toBe('BBBB33');

      // Collides twice (AAAA22, BBBB33), succeeds on 3rd attempt (CCCC44)
      const r3 = await h.createRoom('Host3', 'c3');
      expect(r3.status).toBe(201);
      expect(r3.body.room.code).toBe('CCCC44');

      // All 5 attempts collide with AAAA22 -> 500 INTERNAL_ERROR
      const r4 = await h.createRoom('Host4', 'c4');
      expect(r4.status).toBe(500);
      expect((r4.body as unknown as ApiErrorBody).error.code).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // V2-E03: Concurrent join race, double-click idempotency, spectator overflow & cap
  // --------------------------------------------------------------------------
  describe('V2-E03: Concurrent Join Race, Double-Click Idempotency & Spectator Cap', () => {
    it('seats strictly 1 winner and puts concurrent loser cleanly into spectators[]', async () => {
      const h = makeHarness();
      const created = await h.createRoom('Alice', 'c-alice', DEFAULT_2P_CONFIG);
      const code = created.body.room.code;

      const [j1, j2] = await Promise.all([
        h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-bob' }),
        h.cmd(code, { op: 'join', nickname: 'Carol', clientId: 'c-carol' }),
      ]);

      expect(j1.status).toBe(200);
      expect(j2.status).toBe(200);
      const roles = [j1.body.room.viewer.role, j2.body.room.viewer.role].sort();
      expect(roles).toEqual(['player', 'spectator']);

      const latest = await h.getRoom(code, created.body.sessionToken);
      const snap = (latest.body as { unchanged: false; room: PublicRoomSnapshot }).room;
      expect(snap.seats.filter((s) => s.kind === 'human')).toHaveLength(2);
      expect(snap.spectators).toHaveLength(1);
    });

    it('protects against double-click join (same clientId without sessionToken) and prevents stale-token hijack', async () => {
      const h = makeHarness();
      const created = await h.createRoom('Alice', 'c-alice', DEFAULT_3P_CONFIG);
      const code = created.body.room.code;

      // Concurrent double-click join with same clientId and no sessionToken -> takes only 1 seat
      const [b1, b2] = await Promise.all([
        h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-bob' }),
        h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-bob' }),
      ]);
      expect(b1.status).toBe(200);
      expect(b2.status).toBe(200);
      expect(b1.body.sessionToken).toBe(b2.body.sessionToken);
      expect(b1.body.room.viewer.seatIndex).toBe(1);
      expect(b2.body.room.viewer.seatIndex).toBe(1);

      // Seat 2 must still be open
      const snap = (await h.getRoom(code, created.body.sessionToken)).body as {
        unchanged: false;
        room: PublicRoomSnapshot;
      };
      expect(snap.room.seats[2].kind).toBe('open');

      // Providing a wrong/stale sessionToken alongside Alice's clientId must NOT hijack Alice!
      const stale = await h.cmd(code, {
        op: 'join',
        nickname: 'Mallory',
        clientId: 'c-alice',
        sessionToken: 'st_unknown_stale_token_12345',
      });
      expect(stale.status).toBe(200);
      expect(stale.body.sessionToken).not.toBe(created.body.sessionToken);
      expect(stale.body.room.viewer.seatIndex).toBe(2);
      expect(stale.body.room.viewer.isHost).toBe(false);
    });

    it('enforces MAX_SPECTATORS_PER_ROOM = 20 and returns 409 ROOM_SPECTATORS_FULL on 21st', async () => {
      const h = makeHarness();
      const created = await h.createRoom('Alice', 'c-alice', DEFAULT_2P_CONFIG);
      const code = created.body.room.code;
      await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-bob' });

      for (let i = 0; i < MAX_SPECTATORS_PER_ROOM; i++) {
        const res = await h.cmd(code, {
          op: 'join',
          nickname: `Spec${i}`,
          clientId: `c-spec-${i}`,
        });
        expect(res.status).toBe(200);
        expect(res.body.room.viewer.role).toBe('spectator');
      }

      const overflow = await h.cmd(code, {
        op: 'join',
        nickname: 'Spec21',
        clientId: 'c-spec-21',
      });
      expect(overflow.status).toBe(409);
      expect(overflow.body.error.code).toBe('ROOM_SPECTATORS_FULL');
    });
  });

  // --------------------------------------------------------------------------
  // V2-E04, V2-E05, V2-E06, V2-E07: CAS, double-submit, auth/role guards & undo rejection
  // --------------------------------------------------------------------------
  describe('V2-E04..E07: Optimistic Concurrency, Double-Submit, Authorization & Undo Rejection', () => {
    it('returns 409 VERSION_CONFLICT with latest sanitized snapshot on stale expectedVersion & double-submit', async () => {
      const rng = createSeededRng(42);
      const h = makeHarness({ rng });
      const created = await h.createRoom('Alice', 'c-alice', DEFAULT_2P_CONFIG);
      const code = created.body.room.code;
      const aliceToken = created.body.sessionToken;
      const bob = await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-bob' });
      const bobToken = bob.body.sessionToken!;
      const baseVer = bob.body.room.version;

      // V2-E04: two concurrent config updates with identical expectedVersion
      const [c1, c2] = await Promise.all([
        h.cmd(code, {
          op: 'update_config',
          sessionToken: aliceToken,
          expectedVersion: baseVer,
          patch: { ruleVariant: 'wallgo2' },
        }),
        h.cmd(code, {
          op: 'update_config',
          sessionToken: aliceToken,
          expectedVersion: baseVer,
          patch: { timerSeconds: 60 },
        }),
      ]);
      const statuses = [c1.status, c2.status].sort();
      expect(statuses).toEqual([200, 409]);
      const conflictRes = c1.status === 409 ? c1 : c2;
      expect(conflictRes.body.error.code).toBe('VERSION_CONFLICT');
      expect(conflictRes.body.room.version).toBe(baseVer + 1);
      assertNoPrivateFields(conflictRes.body.room, [aliceToken, bobToken, 'c-alice', 'c-bob']);

      // Start game and complete placements
      const started = await h.cmd(code, {
        op: 'start_game',
        sessionToken: aliceToken,
        expectedVersion: conflictRes.body.room.version,
      });
      expect(started.status).toBe(200);
      let room = started.body.room;
      const tokens = new Map([
        [0, aliceToken],
        [1, bobToken],
      ]);

      while (room.gameState!.phase === 'placement') {
        const activeId = room.gameState!.players[room.gameState!.currentPlayerIndex].id;
        const seat = room.seats.find((s) => s.gamePlayerId === activeId)!;
        const action = buildValidActionForCurrentTurn(room.gameState!, rng);
        const r = await h.cmd(code, {
          op: 'game_action',
          sessionToken: tokens.get(seat.seatIndex)!,
          expectedVersion: room.version,
          action,
        });
        expect(r.status).toBe(200);
        room = r.body.room;
      }

      // V2-E05: Rapid double-submit of identical commit_turn (concurrent + sequential)
      expect(room.gameState!.phase).toBe('select_piece');
      const turnVersion = room.version;
      const activeId = room.gameState!.players[room.gameState!.currentPlayerIndex].id;
      const activeSeat = room.seats.find((s) => s.gamePlayerId === activeId)!;
      const activeToken = tokens.get(activeSeat.seatIndex)!;
      const turnAction = buildValidActionForCurrentTurn(room.gameState!, rng);

      const [t1, t2] = await Promise.all([
        h.cmd(code, {
          op: 'game_action',
          sessionToken: activeToken,
          expectedVersion: turnVersion,
          action: turnAction,
        }),
        h.cmd(code, {
          op: 'game_action',
          sessionToken: activeToken,
          expectedVersion: turnVersion,
          action: turnAction,
        }),
      ]);
      expect([t1.status, t2.status].sort()).toEqual([200, 409]);
      const loser = t1.status === 409 ? t1 : t2;
      expect(loser.body.error.code).toBe('VERSION_CONFLICT');
      expect(loser.body.room.version).toBe(turnVersion + 1);
      expect(loser.body.room.gameState!.turnNumber).toBe(1);

      // Sequential replay of same stale expectedVersion also returns 409 VERSION_CONFLICT (NOT 403 NOT_YOUR_TURN!)
      const t3 = await h.cmd(code, {
        op: 'game_action',
        sessionToken: activeToken,
        expectedVersion: turnVersion,
        action: turnAction,
      });
      expect(t3.status).toBe(409);
      expect(t3.body.error.code).toBe('VERSION_CONFLICT');
      expect(t3.body.room.version).toBe(turnVersion + 1);
    });

    it('enforces 401 UNAUTHORIZED, 403 FORBIDDEN_SPECTATOR, 403 HOST_ONLY, 403 NOT_YOUR_TURN, and 400 UNDO_DISABLED_ONLINE', async () => {
      const h = makeHarness();
      const created = await h.createRoom('Alice', 'c-alice', DEFAULT_2P_CONFIG);
      const code = created.body.room.code;
      const aliceToken = created.body.sessionToken;

      // V2-E07: Undo/redo rejected at top level and inside game_action
      for (const badPayload of [
        { op: 'undo', sessionToken: aliceToken },
        { op: 'redo', sessionToken: aliceToken },
        { op: 'game_action', sessionToken: aliceToken, expectedVersion: 1, action: { type: 'undo' } },
        { op: 'game_action', sessionToken: aliceToken, expectedVersion: 1, action: { type: 'redo' } },
      ]) {
        const res = await h.cmd(code, badPayload);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('UNDO_DISABLED_ONLINE');
      }

      // Cannot start with open seats
      const notReady = await h.cmd(code, {
        op: 'start_game',
        sessionToken: aliceToken,
        expectedVersion: 1,
      });
      expect(notReady.status).toBe(400);
      expect(notReady.body.error.code).toBe('SEATS_NOT_READY');

      // Join Bob (seat 1) and Spec (spectator)
      const bob = await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-bob' });
      const bobToken = bob.body.sessionToken!;
      const spec = await h.cmd(code, { op: 'join', nickname: 'Watch', clientId: 'c-spec' });
      const specToken = spec.body.sessionToken!;
      let ver = spec.body.room.version;

      // Missing/invalid token -> 401
      const noAuth = await h.cmd(code, {
        op: 'start_game',
        sessionToken: 'st_bogus',
        expectedVersion: ver,
      });
      expect(noAuth.status).toBe(401);
      expect(noAuth.body.error.code).toBe('UNAUTHORIZED');

      // Non-host seated player calling host commands -> 403 HOST_ONLY
      for (const hostOp of [
        { op: 'update_config', patch: { timerSeconds: 60 } },
        { op: 'set_seat', seatIndex: 1, kind: 'open' },
        { op: 'kick_seat', seatIndex: 0 },
        { op: 'start_game' },
        { op: 'substitute_ai', seatIndex: 0, aiDifficulty: 'easy' },
        { op: 'start_round2' },
        { op: 'rematch' },
        { op: 'return_to_waiting' },
      ]) {
        const r = await h.cmd(code, { ...hostOp, sessionToken: bobToken, expectedVersion: ver });
        expect(r.status).toBe(403);
        expect(r.body.error.code).toBe('HOST_ONLY');
      }

      // Regular spectator calling host / gameplay / ai_step / timeout ops -> 403 FORBIDDEN_SPECTATOR
      for (const specOp of [
        { op: 'update_config', patch: { timerSeconds: 60 } },
        { op: 'set_seat', seatIndex: 1, kind: 'open' },
        { op: 'kick_seat', seatIndex: 1 },
        { op: 'start_game' },
        { op: 'substitute_ai', seatIndex: 1, aiDifficulty: 'easy' },
        { op: 'ai_step' },
        { op: 'timeout' },
        { op: 'start_round2' },
        { op: 'rematch' },
        { op: 'return_to_waiting' },
        { op: 'game_action', action: { type: 'commit_placement', pos: { row: 0, col: 0 } } },
      ]) {
        const r = await h.cmd(code, { ...specOp, sessionToken: specToken, expectedVersion: ver });
        expect(r.status).toBe(403);
        expect(r.body.error.code).toBe('FORBIDDEN_SPECTATOR');
      }

      // Host cannot set_seat or kick_seat on own seat -> 400 CANNOT_MODIFY_HOST_SEAT
      const modHost = await h.cmd(code, {
        op: 'set_seat',
        sessionToken: aliceToken,
        expectedVersion: ver,
        seatIndex: 0,
        kind: 'ai',
      });
      expect(modHost.status).toBe(400);
      expect(modHost.body.error.code).toBe('CANNOT_MODIFY_HOST_SEAT');

      const kickHost = await h.cmd(code, {
        op: 'kick_seat',
        sessionToken: aliceToken,
        expectedVersion: ver,
        seatIndex: 0,
      });
      expect(kickHost.status).toBe(400);
      expect(kickHost.body.error.code).toBe('CANNOT_MODIFY_HOST_SEAT');

      // Host cannot set_seat directly on non-host human -> 400 INVALID_REQUEST
      const overwriteHuman = await h.cmd(code, {
        op: 'set_seat',
        sessionToken: aliceToken,
        expectedVersion: ver,
        seatIndex: 1,
        kind: 'ai',
      });
      expect(overwriteHuman.status).toBe(400);
      expect(overwriteHuman.body.error.code).toBe('INVALID_REQUEST');

      // Kick Bob -> Bob sees wasKicked: true on GET and 401 UNAUTHORIZED on join with kicked token
      const kicked = await h.cmd(code, {
        op: 'kick_seat',
        sessionToken: aliceToken,
        expectedVersion: ver,
        seatIndex: 1,
      });
      expect(kicked.status).toBe(200);
      ver = kicked.body.room.version;

      const bobPoll = await h.getRoom(code, bobToken);
      expect(bobPoll.status).toBe(200);
      const bobSnap = (bobPoll.body as { unchanged: false; room: PublicRoomSnapshot }).room;
      expect(bobSnap.viewer.role).toBe('anonymous');
      expect(bobSnap.viewer.wasKicked).toBe(true);
      assertNoPrivateFields(bobSnap, [aliceToken, bobToken, specToken]);

      const bobRejoin = await h.cmd(code, {
        op: 'join',
        nickname: 'Bob',
        clientId: 'c-bob',
        sessionToken: bobToken,
      });
      expect(bobRejoin.status).toBe(401);
      expect(bobRejoin.body.error.code).toBe('UNAUTHORIZED');

      // Re-join a new player Bob2 and start game to verify 403 NOT_YOUR_TURN
      const bob2 = await h.cmd(code, { op: 'join', nickname: 'Bob2', clientId: 'c-bob2' });
      const bob2Token = bob2.body.sessionToken!;
      const start = await h.cmd(code, {
        op: 'start_game',
        sessionToken: aliceToken,
        expectedVersion: bob2.body.room.version,
      });
      expect(start.status).toBe(200);
      // Player 0 (Alice) goes first; Bob2 trying to place at current version gets 403 NOT_YOUR_TURN
      const wrongTurn = await h.cmd(code, {
        op: 'game_action',
        sessionToken: bob2Token,
        expectedVersion: start.body.room.version,
        action: { type: 'commit_placement', pos: { row: 0, col: 0 } },
      });
      expect(wrongTurn.status).toBe(403);
      expect(wrongTurn.body.error.code).toBe('NOT_YOUR_TURN');
    });

    it('caps room.kickedTokens to MAX_KICKED_TOKENS (20)', async () => {
      const h = makeHarness();
      const created = await h.createRoom('Alice', 'c-alice', DEFAULT_2P_CONFIG);
      const code = created.body.room.code;
      const aliceToken = created.body.sessionToken;
      let ver = created.body.room.version;
      const kickedTokens: string[] = [];

      for (let i = 0; i < MAX_KICKED_TOKENS + 5; i++) {
        const j = await h.cmd(code, { op: 'join', nickname: `G${i}`, clientId: `c-g-${i}` });
        expect(j.status).toBe(200);
        kickedTokens.push(j.body.sessionToken!);
        const k = await h.cmd(code, {
          op: 'kick_seat',
          sessionToken: aliceToken,
          expectedVersion: j.body.room.version,
          seatIndex: 1,
        });
        expect(k.status).toBe(200);
        ver = k.body.room.version;
      }

      const raw = (await h.store.getRoom(code)) as RoomRecord;
      expect(raw.kickedTokens).toHaveLength(MAX_KICKED_TOKENS);
      expect(raw.kickedTokens[0]).toBe(kickedTokens[5]);
      expect(raw.version).toBe(ver);
    });
  });

  // --------------------------------------------------------------------------
  // V2-E08, V2-E09, V2-E10, V2-E11, V2-E12: Presence, sendBeacon, throttle, HEAD, sinceVersion
  // --------------------------------------------------------------------------
  describe('V2-E08..E12: Presence Isolation, sendBeacon ping_away, Boundaries, Throttle & HEAD', () => {
    it('handles ping_away text/plain beacon, clears awaySince immediately inside 4s throttle on refresh, and enforces 4s/15s/0s disconnect boundaries', async () => {
      const h = makeHarness();
      const created = await h.createRoom('Alice', 'c-alice', {
        ...DEFAULT_2P_CONFIG,
        timerSeconds: 60,
      });
      const code = created.body.room.code;
      const aliceToken = created.body.sessionToken;
      const bob = await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-bob' });
      const bobToken = bob.body.sessionToken!;

      // Start game and finish placements to enter playing select_piece with timer
      const start = await h.cmd(code, {
        op: 'start_game',
        sessionToken: aliceToken,
        expectedVersion: bob.body.room.version,
      });
      let room = start.body.room;
      const rng = createSeededRng(7);
      while (room.gameState!.phase === 'placement') {
        const id = room.gameState!.players[room.gameState!.currentPlayerIndex].id;
        const tok = id === 0 ? aliceToken : bobToken;
        const res = await h.cmd(code, {
          op: 'game_action',
          sessionToken: tok,
          expectedVersion: room.version,
          action: buildValidActionForCurrentTurn(room.gameState!, rng),
        });
        room = res.body.room;
      }

      // V2-E08 & V2-E10: Playing turn starts clean at select_piece with server turnStartedAt
      const turnVersion = room.version;
      const turnStartedAt = room.turnStartedAt;
      expect(room.gameState!.phase).toBe('select_piece');
      expect(turnStartedAt).toBe(h.now);

      // V2-E09: Bob sends text/plain sendBeacon ping_away -> ZERO version bump
      const beacon = await h.cmd(
        code,
        { op: 'ping_away', sessionToken: bobToken },
        'text/plain;charset=UTF-8',
      );
      expect(beacon.status).toBe(200);
      expect(beacon.body.room.version).toBe(turnVersion);
      expect(beacon.body.room.seats[1].connectionStatus).toBe('connected');

      // 200ms later (well inside 4s heartbeat throttle!), Bob refreshes (GET) -> awaySince cleared immediately!
      h.now += 200;
      const setPresenceSpy = vi.spyOn(h.store, 'setPresence');
      const refresh = await h.getRoom(code, bobToken);
      expect(refresh.status).toBe(200);
      expect(setPresenceSpy).toHaveBeenCalledTimes(1);
      const refreshRoom = (refresh.body as { unchanged: false; room: PublicRoomSnapshot }).room;
      expect(refreshRoom.version).toBe(turnVersion);
      expect(refreshRoom.turnStartedAt).toBe(turnStartedAt);
      expect(refreshRoom.gameState!.phase).toBe('select_piece');
      expect(refreshRoom.seats[1].connectionStatus).toBe('connected');

      // Advance 4500ms: Bob stays connected because awaySince was cleared on refresh!
      h.now += 4_500;
      const checkAfterClear = await h.getRoom(code, aliceToken);
      const checkSnap = (checkAfterClear.body as { unchanged: false; room: PublicRoomSnapshot }).room;
      expect(checkSnap.seats[1].connectionStatus).toBe('connected');

      // V2-E11(a): Tab close (ping_away) -> connected at +3999ms, disconnected at +4000ms
      await h.cmd(code, { op: 'ping_away', sessionToken: bobToken }, 'text/plain');
      const awayStart = h.now;
      h.now = awayStart + 3_999;
      const beforeGrace = await h.getRoom(code, aliceToken);
      expect((beforeGrace.body as { unchanged: false; room: PublicRoomSnapshot }).room.seats[1].connectionStatus).toBe(
        'connected',
      );
      h.now = awayStart + 4_000;
      const atGrace = await h.getRoom(code, aliceToken);
      expect((atGrace.body as { unchanged: false; room: PublicRoomSnapshot }).room.seats[1].connectionStatus).toBe(
        'disconnected',
      );

      // Reconnect Bob via join -> clears awaySince
      const rejoin = await h.cmd(code, {
        op: 'join',
        nickname: 'Bob',
        clientId: 'c-bob',
        sessionToken: bobToken,
      });
      expect(rejoin.status).toBe(200);
      expect(rejoin.body.room.seats[1].connectionStatus).toBe('connected');
      const silentDropStart = h.now;

      // V2-E11(b): Silent network drop -> connected at +14999ms, disconnected at +15000ms
      h.now = silentDropStart + 14_999;
      const beforeDrop = await h.getRoom(code, aliceToken);
      expect((beforeDrop.body as { unchanged: false; room: PublicRoomSnapshot }).room.seats[1].connectionStatus).toBe(
        'connected',
      );
      h.now = silentDropStart + 15_000;
      const atDrop = await h.getRoom(code, aliceToken);
      expect((atDrop.body as { unchanged: false; room: PublicRoomSnapshot }).room.seats[1].connectionStatus).toBe(
        'disconnected',
      );

      // Dynamic env override check (WALLGO_AWAY_GRACE_MS & WALLGO_DISCONNECT_TIMEOUT_MS)
      h.env.WALLGO_DISCONNECT_TIMEOUT_MS = '20000';
      const extendedDrop = await h.getRoom(code, aliceToken);
      expect(
        (extendedDrop.body as { unchanged: false; room: PublicRoomSnapshot }).room.seats[1].connectionStatus,
      ).toBe('connected');
      delete h.env.WALLGO_DISCONNECT_TIMEOUT_MS;

      // V2-E11(c): Explicit leave in playing -> immediate 'left' at 0ms
      const left = await h.cmd(code, { op: 'leave', sessionToken: bobToken });
      expect(left.status).toBe(200);
      expect(left.body.room.seats[1].connectionStatus).toBe('left');
      // Rejoin via join clears explicitlyLeft back to 'connected'
      const back = await h.cmd(code, {
        op: 'join',
        nickname: 'Bob',
        clientId: 'c-bob',
        sessionToken: bobToken,
      });
      expect(back.status).toBe(200);
      expect(back.body.room.seats[1].connectionStatus).toBe('connected');
    });

    it('throttles presence writes to 4s, skips writes on HEAD, supports ?sessionToken= & ?sinceVersion= without bumping version', async () => {
      const h = makeHarness();
      const created = await h.createRoom('Alice', 'c-alice', DEFAULT_2P_CONFIG);
      const code = created.body.room.code;
      const aliceToken = created.body.sessionToken;
      const bob = await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-bob' });
      const bobToken = bob.body.sessionToken!;
      const ver = bob.body.room.version;

      const spy = vi.spyOn(h.store, 'setPresence');

      // Within 4s throttle: GET does NOT call setPresence
      h.now += 1_000;
      const p1 = await h.getRoom(code, aliceToken, `?sinceVersion=${ver}`);
      expect(p1.status).toBe(200);
      expect(p1.body).toMatchObject({
        unchanged: true,
        version: ver,
        serverNow: h.now,
        presenceSummary: {
          seats: [
            { seatIndex: 0, connectionStatus: 'connected' },
            { seatIndex: 1, connectionStatus: 'connected' },
          ],
          spectators: [],
          canClaimHost: false,
        },
      });
      expect(spy).not.toHaveBeenCalled();

      // Past 4s throttle: HEAD STILL must NEVER call setPresence!
      h.now += 5_000;
      const head = await h.getRoom(code, aliceToken, '', 'HEAD');
      expect(head.status).toBe(200);
      expect(await head.res.text()).toBe('');
      expect(spy).not.toHaveBeenCalled();

      // Past 4s throttle: GET via ?sessionToken= query parameter calls setPresence once and never bumps version
      const qPoll = await handleApiRequest(
        new Request(
          `http://localhost/api/rooms/${code}?sessionToken=${encodeURIComponent(bobToken)}&sinceVersion=${ver}`,
        ),
        h.opts(),
      );
      expect(qPoll.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
      const qBody = (await qPoll.json()) as GetRoomResponse;
      expect(qBody.unchanged).toBe(true);
      expect(qBody.unchanged && qBody.version).toBe(ver);
    });
  });

  // --------------------------------------------------------------------------
  // V2-E13: Host AI substitution mid-turn & late reconnect
  // --------------------------------------------------------------------------
  describe('V2-E13: Host AI Substitution Mid-Turn & Replaced Spectator Reconnect', () => {
    it('rejects connected/host targets, substitutes disconnected active seat to AI, schedules nextAiStepAt, and moves original player to replaced_spectator', async () => {
      const rng = createSeededRng(101);
      const h = makeHarness({ rng });
      const created = await h.createRoom('Alice', 'c-alice', {
        ...DEFAULT_2P_CONFIG,
        timerSeconds: 60,
      });
      const code = created.body.room.code;
      const aliceToken = created.body.sessionToken;
      const bob = await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-bob' });
      const bobToken = bob.body.sessionToken!;

      const start = await h.cmd(code, {
        op: 'start_game',
        sessionToken: aliceToken,
        expectedVersion: bob.body.room.version,
      });
      // Advance 1 placement (Alice places) so it is now Bob's active placement turn
      const p0 = await h.cmd(code, {
        op: 'game_action',
        sessionToken: aliceToken,
        expectedVersion: start.body.room.version,
        action: buildValidActionForCurrentTurn(start.body.room.gameState!, rng),
      });
      expect(p0.status).toBe(200);
      let room = p0.body.room;
      expect(room.gameState!.currentPlayerIndex).toBe(1);

      // Connected target -> 400 SEAT_NOT_DISCONNECTED
      const connectedErr = await h.cmd(code, {
        op: 'substitute_ai',
        sessionToken: aliceToken,
        expectedVersion: room.version,
        seatIndex: 1,
        aiDifficulty: 'normal',
      });
      expect(connectedErr.status).toBe(400);
      expect(connectedErr.body.error.code).toBe('SEAT_NOT_DISCONNECTED');

      // Host seat -> 400 CANNOT_MODIFY_HOST_SEAT
      const hostErr = await h.cmd(code, {
        op: 'substitute_ai',
        sessionToken: aliceToken,
        expectedVersion: room.version,
        seatIndex: 0,
        aiDifficulty: 'normal',
      });
      expect(hostErr.status).toBe(400);
      expect(hostErr.body.error.code).toBe('CANNOT_MODIFY_HOST_SEAT');

      // Bob disconnects (via ping_away + 4s grace)
      await h.cmd(code, { op: 'ping_away', sessionToken: bobToken }, 'text/plain');
      h.now += 4_000;

      // Host substitutes Bob with AI ('hard')
      const sub = await h.cmd(code, {
        op: 'substitute_ai',
        sessionToken: aliceToken,
        expectedVersion: room.version,
        seatIndex: 1,
        aiDifficulty: 'hard',
      });
      expect(sub.status).toBe(200);
      room = sub.body.room;
      expect(room.seats[1].kind).toBe('ai');
      expect(room.seats[1].nickname).toBe('Bob');
      expect(room.seats[1].substitutedFromNickname).toBe('Bob');
      expect(room.seats[1].aiDifficulty).toBe('hard');
      expect(room.gameState!.players[1].isAI).toBe(true);
      expect(room.nextAiStepAt).toBe(h.now + 450);
      expect(room.lastEvent).toMatchObject({
        type: 'ai_substituted',
        nickname: 'Bob',
        aiDifficulty: 'hard',
      });
      expect(room.spectators).toEqual([
        expect.objectContaining({
          nickname: 'Bob',
          role: 'replaced_spectator',
        }),
      ]);

      // Late Bob reconnects -> sees replaced_spectator and cannot submit game_action
      const bobLate = await h.cmd(code, {
        op: 'join',
        nickname: 'Bob',
        clientId: 'c-bob',
        sessionToken: bobToken,
      });
      expect(bobLate.status).toBe(200);
      expect(bobLate.body.room.viewer.role).toBe('spectator');
      expect(bobLate.body.room.viewer.spectatorRole).toBe('replaced_spectator');

      const bobMove = await h.cmd(code, {
        op: 'game_action',
        sessionToken: bobToken,
        expectedVersion: room.version,
        action: { type: 'commit_placement', pos: { row: 0, col: 1 } },
      });
      expect(bobMove.status).toBe(403);
      expect(bobMove.body.error.code).toBe('FORBIDDEN_SPECTATOR');

      // AI takes Bob's active turn after delay
      h.now += 450;
      const aiRes = await h.cmd(code, {
        op: 'ai_step',
        sessionToken: aliceToken,
        expectedVersion: room.version,
      });
      expect(aiRes.status).toBe(200);
      expect(aiRes.body.executed).toBe(true);
      expect(aiRes.body.room.gameState!.lastActionEvent?.actorIsAI).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // V2-E14: Host leave, waiting deletion & silent crash claim_host
  // --------------------------------------------------------------------------
  describe('V2-E14: Host Leave Auto-Transfer, Empty Waiting Room Cleanup & claim_host', () => {
    it('deletes waiting room when last human leaves (even with AI seats) and transfers host when others remain', async () => {
      const h = makeHarness();
      const created = await h.createRoom('Alice', 'c-alice', DEFAULT_2P_CONFIG);
      const code = created.body.room.code;
      const aliceToken = created.body.sessionToken;

      // Fill seat 1 with AI; Alice is sole human
      await h.cmd(code, {
        op: 'set_seat',
        sessionToken: aliceToken,
        expectedVersion: 1,
        seatIndex: 1,
        kind: 'ai',
        aiDifficulty: 'easy',
      });
      const leaveRes = await h.cmd(code, { op: 'leave', sessionToken: aliceToken });
      expect(leaveRes.status).toBe(200);
      const afterDelete = await h.getRoom(code);
      expect(afterDelete.status).toBe(404);
      expect((afterDelete.body as ApiErrorBody).error.code).toBe('ROOM_NOT_FOUND');

      // Second room: Alice + Bob + Carol -> Alice leaves -> Bob (earliest connected) becomes host
      const r2 = await h.createRoom('Alice', 'c-alice', DEFAULT_3P_CONFIG);
      const code2 = r2.body.room.code;
      const aTok = r2.body.sessionToken;
      h.now += 100;
      const bob = await h.cmd(code2, { op: 'join', nickname: 'Bob', clientId: 'c-bob' });
      h.now += 100;
      await h.cmd(code2, { op: 'join', nickname: 'Carol', clientId: 'c-carol' });

      const aliceLeaves = await h.cmd(code2, { op: 'leave', sessionToken: aTok });
      expect(aliceLeaves.status).toBe(200);
      expect(aliceLeaves.body.room.seats[0].kind).toBe('open');
      expect(aliceLeaves.body.room.seats[1].isHost).toBe(true);
      expect(aliceLeaves.body.room.lastEvent).toMatchObject({
        type: 'host_transferred',
        newHostNickname: 'Bob',
      });
      expect(aliceLeaves.body.room.hostMemberId).toBe(bob.body.room.viewer.memberId);
    });

    it('enforces claim_host eligibility when host crashes silently (409 while connected, 403 for spectator when seat connected, 200 when eligible)', async () => {
      const h = makeHarness();
      const created = await h.createRoom('Alice', 'c-alice', DEFAULT_2P_CONFIG);
      const code = created.body.room.code;
      const aliceToken = created.body.sessionToken;
      const bob = await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-bob' });
      const bobToken = bob.body.sessionToken!;
      const spec = await h.cmd(code, { op: 'join', nickname: 'Spec', clientId: 'c-spec' });
      const specToken = spec.body.sessionToken!;
      const ver = spec.body.room.version;

      // Host still connected -> 409 HOST_STILL_CONNECTED
      const tooEarly = await h.cmd(code, {
        op: 'claim_host',
        sessionToken: bobToken,
        expectedVersion: ver,
      });
      expect(tooEarly.status).toBe(409);
      expect(tooEarly.body.error.code).toBe('HOST_STILL_CONNECTED');

      // Advance 15s while keeping Bob & Spec heartbeating; Alice silently drops!
      h.now += 10_000;
      await h.getRoom(code, bobToken);
      await h.getRoom(code, specToken);
      h.now += 5_000;

      // Spectator still blocked while Bob (seated human) is connected!
      const specPoll = await h.getRoom(code, specToken);
      expect((specPoll.body as { unchanged: false; room: PublicRoomSnapshot }).room.canClaimHost).toBe(
        false,
      );
      const specClaim = await h.cmd(code, {
        op: 'claim_host',
        sessionToken: specToken,
        expectedVersion: ver,
      });
      expect(specClaim.status).toBe(403);
      expect(specClaim.body.error.code).toBe('FORBIDDEN_SPECTATOR');

      // Seated player Bob sees canClaimHost: true and claims host
      const bobPoll = await h.getRoom(code, bobToken);
      expect((bobPoll.body as { unchanged: false; room: PublicRoomSnapshot }).room.canClaimHost).toBe(
        true,
      );
      const bobClaim = await h.cmd(code, {
        op: 'claim_host',
        sessionToken: bobToken,
        expectedVersion: ver,
      });
      expect(bobClaim.status).toBe(200);
      expect(bobClaim.body.room.viewer.isHost).toBe(true);
      expect(bobClaim.body.room.lastEvent).toMatchObject({
        type: 'host_transferred',
        newHostNickname: 'Bob',
      });

      // Now if Bob ALSO drops while Spec stays alive -> Spec CAN claim host (0 seated humans connected!)
      h.now += 10_000;
      await h.getRoom(code, specToken);
      h.now += 5_000;
      const specEligible = await h.getRoom(code, specToken);
      expect(
        (specEligible.body as { unchanged: false; room: PublicRoomSnapshot }).room.canClaimHost,
      ).toBe(true);
      const specClaimOk = await h.cmd(code, {
        op: 'claim_host',
        sessionToken: specToken,
        expectedVersion: bobClaim.body.room.version,
      });
      expect(specClaimOk.status).toBe(200);
      expect(specClaimOk.body.room.viewer.isHost).toBe(true);
      expect(specClaimOk.body.room.hostMemberId).toBe(spec.body.room.viewer.memberId);

      // Old host token can no longer run host commands
      const oldHostAttempt = await h.cmd(code, {
        op: 'update_config',
        sessionToken: aliceToken,
        expectedVersion: specClaimOk.body.room.version,
        patch: { timerSeconds: 90 },
      });
      expect(oldHostAttempt.status).toBe(403);
      expect(oldHostAttempt.body.error.code).toBe('HOST_ONLY');
    });
  });

  // --------------------------------------------------------------------------
  // V2-E15: 3p -> 2p seat shrink (non-host in Seat 2 & host in Seat 2)
  // --------------------------------------------------------------------------
  describe('V2-E15: Format Shrink 3p -> 2p Seat Handling', () => {
    it('moves non-host Seat 2 human to spectators[] preserving token/nickname, and relocates Host if Host is in Seat 2', async () => {
      const h = makeHarness();
      const created = await h.createRoom('Alice', 'c-alice', DEFAULT_3P_CONFIG);
      const code = created.body.room.code;
      const aliceToken = created.body.sessionToken;
      await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-bob' });
      const carol = await h.cmd(code, { op: 'join', nickname: 'Carol', clientId: 'c-carol' });
      const carolToken = carol.body.sessionToken!;

      // Shrink 3p -> 2p: Carol moves to spectators[]
      const shrunk = await h.cmd(code, {
        op: 'update_config',
        sessionToken: aliceToken,
        expectedVersion: carol.body.room.version,
        patch: { format: '2p' },
      });
      expect(shrunk.status).toBe(200);
      expect(shrunk.body.room.seats).toHaveLength(2);
      expect(shrunk.body.room.spectators).toEqual([
        expect.objectContaining({ nickname: 'Carol', role: 'spectator' }),
      ]);

      // Carol's sessionToken still works as spectator
      const carolPoll = await h.getRoom(code, carolToken);
      const carolSnap = (carolPoll.body as { unchanged: false; room: PublicRoomSnapshot }).room;
      expect(carolSnap.viewer.role).toBe('spectator');

      // Grow back 2p -> 3p appends open Seat 2
      const grown = await h.cmd(code, {
        op: 'update_config',
        sessionToken: aliceToken,
        expectedVersion: shrunk.body.room.version,
        patch: { format: '3p' },
      });
      expect(grown.status).toBe(200);
      expect(grown.body.room.seats).toHaveLength(3);
      expect(grown.body.room.seats[2]).toMatchObject({ kind: 'open', colorToken: 'p3' });

      // Host in Seat 2 scenario: create room, join Bob(1) & Carol(2), Alice leaves(0)->Bob host, Bob leaves(1)->Carol host in Seat 2!
      const h2 = makeHarness();
      const r2 = await h2.createRoom('Alice', 'c-a', DEFAULT_3P_CONFIG);
      const c2 = r2.body.room.code;
      const b2 = await h2.cmd(c2, { op: 'join', nickname: 'Bob', clientId: 'c-b' });
      const k2 = await h2.cmd(c2, { op: 'join', nickname: 'Carol', clientId: 'c-c' });
      await h2.cmd(c2, { op: 'leave', sessionToken: r2.body.sessionToken });
      const afterBobLeft = await h2.cmd(c2, { op: 'leave', sessionToken: b2.body.sessionToken! });
      expect(afterBobLeft.body.room.seats[2].isHost).toBe(true);

      // Carol (host in Seat 2) shrinks 3p -> 2p -> relocates to open Seat 0!
      const carolShrink = await h2.cmd(c2, {
        op: 'update_config',
        sessionToken: k2.body.sessionToken!,
        expectedVersion: afterBobLeft.body.room.version,
        patch: { format: '2p' },
      });
      expect(carolShrink.status).toBe(200);
      expect(carolShrink.body.room.seats).toHaveLength(2);
      expect(carolShrink.body.room.seats[0].isHost).toBe(true);
      expect(carolShrink.body.room.seats[0].nickname).toBe('Carol');
    });
  });

  // --------------------------------------------------------------------------
  // V2-E16: shuffleOrder: true online seat authorization (incl. duplicate nicknames!)
  // --------------------------------------------------------------------------
  describe('V2-E16: Shuffled Order 1:1 Seat Authorization', () => {
    it('binds seat.gamePlayerId 1:1 even with identical nicknames and authorizes strictly the matching seat', async () => {
      // RNG returns 0.0 -> Fisher-Yates rotates [0, 1, 2] -> [1, 2, 0]
      const h = makeHarness({ rng: () => 0 });
      const created = await h.createRoom('Same', 'c-0', {
        ...DEFAULT_3P_CONFIG,
        shuffleOrder: true,
      });
      const code = created.body.room.code;
      const t0 = created.body.sessionToken;
      const j1 = await h.cmd(code, { op: 'join', nickname: 'Same', clientId: 'c-1' });
      const t1 = j1.body.sessionToken!;
      const j2 = await h.cmd(code, { op: 'join', nickname: 'Same', clientId: 'c-2' });
      const t2 = j2.body.sessionToken!;

      const start = await h.cmd(code, {
        op: 'start_game',
        sessionToken: t0,
        expectedVersion: j2.body.room.version,
      });
      expect(start.status).toBe(200);
      const room = start.body.room;
      // [0,1,2] -> i=2,j=0 => [2,1,0]; i=1,j=0 => [1,2,0]
      // So gamePlayerId 0 = Seat 1, gamePlayerId 1 = Seat 2, gamePlayerId 2 = Seat 0!
      expect(room.seats.map((s) => s.gamePlayerId)).toEqual([2, 0, 1]);
      expect(room.seats[1].gamePlayerId).toBe(0);
      expect(room.gameState!.players[0].colorToken).toBe('p2');

      // Seat 0 (t0) is NOT gamePlayerId 0 -> 403 NOT_YOUR_TURN
      const wrong = await h.cmd(code, {
        op: 'game_action',
        sessionToken: t0,
        expectedVersion: room.version,
        action: { type: 'commit_placement', pos: { row: 0, col: 0 } },
      });
      expect(wrong.status).toBe(403);
      expect(wrong.body.error.code).toBe('NOT_YOUR_TURN');

      // Seat 1 (t1) IS gamePlayerId 0 -> 200 OK
      const right = await h.cmd(code, {
        op: 'game_action',
        sessionToken: t1,
        expectedVersion: room.version,
        action: { type: 'commit_placement', pos: { row: 0, col: 0 } },
      });
      expect(right.status).toBe(200);

      // Next is gamePlayerId 1 = Seat 2 (t2)
      const right2 = await h.cmd(code, {
        op: 'game_action',
        sessionToken: t2,
        expectedVersion: right.body.room.version,
        action: { type: 'commit_placement', pos: { row: 0, col: 1 } },
      });
      expect(right2.status).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // V2-E17 & V2-E18: Concurrent ai_step idempotency & paced consecutive AI turns
  // --------------------------------------------------------------------------
  describe('V2-E17 & V2-E18: Paced Idempotent AI Steps & Consecutive AI Turns', () => {
    it('paces AI steps with retryAfterMs, executes strictly 1 concurrent trigger, and steps 1 move at a time across placement -> play', async () => {
      const rng = createSeededRng(777);
      const h = makeHarness({ rng });
      const created = await h.createRoom('Alice', 'c-alice', DEFAULT_3P_CONFIG);
      const code = created.body.room.code;
      const aliceToken = created.body.sessionToken;

      const s1 = await h.cmd(code, {
        op: 'set_seat',
        sessionToken: aliceToken,
        expectedVersion: 1,
        seatIndex: 1,
        kind: 'ai',
        aiDifficulty: 'easy',
      });
      const s2 = await h.cmd(code, {
        op: 'set_seat',
        sessionToken: aliceToken,
        expectedVersion: s1.body.room.version,
        seatIndex: 2,
        kind: 'ai',
        aiDifficulty: 'easy',
      });
      const start = await h.cmd(code, {
        op: 'start_game',
        sessionToken: aliceToken,
        expectedVersion: s2.body.room.version,
      });
      expect(start.status).toBe(200);
      let room = start.body.room;

      // Alice places piece 0 -> now AI 2 (player 1) is active with nextAiStepAt = now + 450
      const p0 = await h.cmd(code, {
        op: 'game_action',
        sessionToken: aliceToken,
        expectedVersion: room.version,
        action: { type: 'commit_placement', pos: { row: 0, col: 0 } },
      });
      room = p0.body.room;
      expect(room.nextAiStepAt).toBe(h.now + 450);

      // Too early (+100ms < 400ms tolerance) -> 200 { executed: false, retryAfterMs: 350 }
      h.now += 100;
      const early = await h.cmd(code, {
        op: 'ai_step',
        sessionToken: aliceToken,
        expectedVersion: room.version,
      });
      expect(early.status).toBe(200);
      expect(early.body.executed).toBe(false);
      expect(early.body.retryAfterMs).toBe(350);

      // V2-E17: 3 concurrent ai_step calls past nextAiStepAt -> strictly 1 executed: true, 2 executed: false (no 409!)
      h.now += 350;
      const [a1, a2, a3] = await Promise.all([
        h.cmd(code, { op: 'ai_step', sessionToken: aliceToken, expectedVersion: room.version }),
        h.cmd(code, { op: 'ai_step', sessionToken: aliceToken, expectedVersion: room.version }),
        h.cmd(code, { op: 'ai_step', sessionToken: aliceToken, expectedVersion: room.version }),
      ]);
      expect([a1.status, a2.status, a3.status]).toEqual([200, 200, 200]);
      const execFlags = [a1.body.executed, a2.body.executed, a3.body.executed];
      expect(execFlags.filter(Boolean)).toHaveLength(1);
      expect(execFlags.filter((x) => x === false)).toHaveLength(2);

      // V2-E18: Consecutive AI turns (Player 1 -> Player 2 -> Player 2 -> Player 1 -> Player 0) advance strictly 1 piece per step
      const winner = [a1, a2, a3].find((r) => r.body.executed === true)!;
      room = winner.body.room;
      expect(room.gameState!.pieces).toHaveLength(2);
      expect(room.gameState!.currentPlayerIndex).toBe(2); // AI 3 next!
      expect(room.nextAiStepAt).toBe(h.now + 450);

      // Step AI 3 (piece 3), AI 3 (piece 4), AI 2 (piece 5) with env override WALLGO_AI_STEP_MIN_DELAY_MS=0
      h.env.WALLGO_AI_STEP_MIN_DELAY_MS = '0';
      h.now += 450;
      for (const expectedPieces of [3, 4, 5]) {
        const step = await h.cmd(code, {
          op: 'ai_step',
          sessionToken: aliceToken,
          expectedVersion: room.version,
        });
        expect(step.status).toBe(200);
        expect(step.body.executed).toBe(true);
        room = step.body.room;
        expect(room.gameState!.pieces).toHaveLength(expectedPieces);
      }

      // Now Alice places piece 6 -> transitions cleanly to select_piece for Alice
      const p6 = await h.cmd(code, {
        op: 'game_action',
        sessionToken: aliceToken,
        expectedVersion: room.version,
        action: buildValidActionForCurrentTurn(room.gameState!, rng),
      });
      expect(p6.status).toBe(200);
      expect(p6.body.room.gameState!.phase).toBe('select_piece');
      expect(p6.body.room.gameState!.currentPlayerIndex).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // V2-E19: Synchronized timer & timeout (actor/opponent grace, partialMove WG1/WG2, race)
  // --------------------------------------------------------------------------
  describe('V2-E19: Turn Timer, Grace Windows, PartialMove (WG1 & WG2) & Commit-vs-Timeout Race', () => {
    it('enforces grace windows, rejects opponent partialMove (403), supports valid/invalid partialMove, and resolves commit vs timeout atomically', async () => {
      const rng = createSeededRng(2025);
      const h = makeHarness({ rng });
      const created = await h.createRoom('Alice', 'c-alice', {
        ruleVariant: 'wallgo1',
        format: '2p',
        timerSeconds: 60,
        shuffleOrder: false,
      });
      const code = created.body.room.code;
      const aliceToken = created.body.sessionToken;
      const bob = await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-bob' });
      const bobToken = bob.body.sessionToken!;
      const start = await h.cmd(code, {
        op: 'start_game',
        sessionToken: aliceToken,
        expectedVersion: bob.body.room.version,
      });
      let room = start.body.room;

      // Timeout during placement -> idempotent executed: false
      const placementTimeout = await h.cmd(code, {
        op: 'timeout',
        sessionToken: aliceToken,
        expectedVersion: room.version,
      });
      expect(placementTimeout.status).toBe(200);
      expect(placementTimeout.body.executed).toBe(false);

      // Finish 4 placements
      while (room.gameState!.phase === 'placement') {
        const id = room.gameState!.players[room.gameState!.currentPlayerIndex].id;
        const tok = id === 0 ? aliceToken : bobToken;
        const res = await h.cmd(code, {
          op: 'game_action',
          sessionToken: tok,
          expectedVersion: room.version,
          action: buildValidActionForCurrentTurn(room.gameState!, rng),
        });
        room = res.body.room;
      }

      // Alice is active in select_piece with 60s timer
      expect(room.gameState!.phase).toBe('select_piece');
      expect(room.gameState!.currentPlayerIndex).toBe(0);
      const t0 = room.turnStartedAt!;

      // Opponent sending partialMove -> 403 NOT_YOUR_TURN
      const oppPartial = await h.cmd(code, {
        op: 'timeout',
        sessionToken: bobToken,
        expectedVersion: room.version,
        partialMove: {
          pieceId: room.gameState!.pieces[0].id,
          useWallBreak: false,
          breakWall: null,
          destination: { row: room.gameState!.pieces[0].row, col: room.gameState!.pieces[0].col },
        },
      });
      expect(oppPartial.status).toBe(403);
      expect(oppPartial.body.error.code).toBe('NOT_YOUR_TURN');

      // At 59,749ms: actor is 1ms too early (actor skew is 250ms -> eligible at 59,750ms)
      h.now = t0 + 59_749;
      const actorEarly = await h.cmd(code, {
        op: 'timeout',
        sessionToken: aliceToken,
        expectedVersion: room.version,
      });
      expect(actorEarly.status).toBe(200);
      expect(actorEarly.body.executed).toBe(false);
      expect(actorEarly.body.retryAfterMs).toBe(1);

      // At 61,499ms: opponent is 1ms too early (opponent grace is +1500ms -> eligible at 61,500ms)
      h.now = t0 + 61_499;
      const oppEarly = await h.cmd(code, {
        op: 'timeout',
        sessionToken: bobToken,
        expectedVersion: room.version,
      });
      expect(oppEarly.status).toBe(200);
      expect(oppEarly.body.executed).toBe(false);
      expect(oppEarly.body.retryAfterMs).toBe(1);

      // At 59,750ms: actor submits valid partialMove (normal move to a new cell) -> completes with that exact destination!
      h.now = t0 + 59_750;
      const selectableIds = getSelectablePieceIds(room.gameState!);
      const chosenPiece = room.gameState!.pieces.find((p) => p.id === selectableIds[0])!;
      const validMoves = getPieceValidMoves(room.gameState!, chosenPiece.id).filter(
        (m) => m.row !== chosenPiece.row || m.col !== chosenPiece.col,
      );
      const targetDest = validMoves[0];
      expect(targetDest).toBeDefined();

      const actorTimeout = await h.cmd(code, {
        op: 'timeout',
        sessionToken: aliceToken,
        expectedVersion: room.version,
        partialMove: {
          pieceId: chosenPiece.id,
          useWallBreak: false,
          breakWall: null,
          destination: { row: targetDest.row, col: targetDest.col },
        },
      });
      expect(actorTimeout.status).toBe(200);
      expect(actorTimeout.body.executed).toBe(true);
      room = actorTimeout.body.room;
      expect(room.lastEvent).toMatchObject({ type: 'player_timed_out', nickname: 'Alice' });
      expect(room.gameState!.lastActionEvent).toMatchObject({
        kind: 'turn',
        pieceId: chosenPiece.id,
        to: { row: targetDest.row, col: targetDest.col },
        timedOut: true,
      });

      // Next turn (Bob): invalid partialMove falls back cleanly to room.gameState and still resolves!
      const bobT0 = room.turnStartedAt!;
      h.now = bobT0 + 59_750;
      const fallbackTimeout = await h.cmd(code, {
        op: 'timeout',
        sessionToken: bobToken,
        expectedVersion: room.version,
        partialMove: {
          pieceId: 'nonexistent_piece',
          useWallBreak: false,
          breakWall: null,
          destination: { row: 99, col: 99 },
        },
      });
      expect(fallbackTimeout.status).toBe(200);
      expect(fallbackTimeout.body.executed).toBe(true);
      room = fallbackTimeout.body.room;
      expect(room.lastEvent).toMatchObject({ type: 'player_timed_out', nickname: 'Bob' });

      // Next turn (Alice): concurrent commit_turn vs opponent timeout at +61,500ms -> strictly 1 winner!
      const raceT0 = room.turnStartedAt!;
      h.now = raceT0 + 61_500;
      const raceVer = room.version;
      const raceAction = buildValidActionForCurrentTurn(room.gameState!, rng);
      const [moveRes, toRes] = await Promise.all([
        h.cmd(code, {
          op: 'game_action',
          sessionToken: aliceToken,
          expectedVersion: raceVer,
          action: raceAction,
        }),
        h.cmd(code, {
          op: 'timeout',
          sessionToken: bobToken,
          expectedVersion: raceVer,
        }),
      ]);
      // Either move won (200) and timeout got executed:false (200), OR timeout won (executed:true) and move got 409!
      if (moveRes.status === 200) {
        expect(toRes.status).toBe(200);
        expect(toRes.body.executed).toBe(false);
      } else {
        expect(moveRes.status).toBe(409);
        expect(moveRes.body.error.code).toBe('VERSION_CONFLICT');
        expect(toRes.status).toBe(200);
        expect(toRes.body.executed).toBe(true);
      }
    });

    it('supports partialMove with wall break in both Wall Go I and Wall Go II (including 2-wall diagonal)', async () => {
      // Wall Go I 3P wall-break partialMove
      const rng = createSeededRng(314);
      const h1 = makeHarness({ rng });
      const c1 = await h1.createRoom('A', 'ca', {
        ruleVariant: 'wallgo1',
        format: '3p',
        timerSeconds: 60,
        shuffleOrder: false,
      });
      const code1 = c1.body.room.code;
      const a1 = c1.body.sessionToken;
      const b1 = (await h1.cmd(code1, { op: 'join', nickname: 'B', clientId: 'cb' })).body.sessionToken!;
      const d1 = (await h1.cmd(code1, { op: 'join', nickname: 'C', clientId: 'cc' })).body.sessionToken!;
      const st1 = await h1.cmd(code1, {
        op: 'start_game',
        sessionToken: a1,
        expectedVersion: 3,
      });
      let room1 = st1.body.room;
      const toks1 = [a1, b1, d1];
      // Place 6 pieces cleanly so Player 0 has a piece at (2,2) and Player 1 places adjacent wall
      const coords = [
        { row: 2, col: 2 },
        { row: 2, col: 3 },
        { row: 5, col: 5 },
        { row: 5, col: 6 },
        { row: 0, col: 0 },
        { row: 0, col: 6 },
      ];
      for (let i = 0; i < 6; i++) {
        const cur = room1.gameState!.players[room1.gameState!.currentPlayerIndex].id;
        const r = await h1.cmd(code1, {
          op: 'game_action',
          sessionToken: toks1[cur],
          expectedVersion: room1.version,
          action: { type: 'commit_placement', pos: coords[i] },
        });
        expect(r.status).toBe(200);
        room1 = r.body.room;
      }
      // Player 0 moves (2,2) stay and places wall v:2:2 (right of (2,2))
      const w: WallEdge = { orientation: 'v', row: 2, col: 2 };
      const p0Piece = room1.gameState!.pieces.find((p) => p.ownerId === 0 && p.row === 2 && p.col === 2)!;
      const turn0 = await h1.cmd(code1, {
        op: 'game_action',
        sessionToken: a1,
        expectedVersion: room1.version,
        action: {
          type: 'commit_turn',
          pieceId: p0Piece.id,
          useWallBreak: false,
          breakWall: null,
          destination: { row: 2, col: 2 },
          placeWall: w,
        },
      });
      expect(turn0.status).toBe(200);
      room1 = turn0.body.room;

      // Player 1 has piece at (2,3) adjacent to wall v:2:2 -> timeout with WG1 wall-break partialMove!
      const p1Piece = room1.gameState!.pieces.find((p) => p.ownerId === 1 && p.row === 2 && p.col === 3)!;
      const breakable = getWallGo1BreakableWalls(room1.gameState!, p1Piece.id);
      expect(breakable.some((bw) => isSameWallEdge(bw, w))).toBe(true);
      h1.now = room1.turnStartedAt! + 59_750;
      const wg1To = await h1.cmd(code1, {
        op: 'timeout',
        sessionToken: b1,
        expectedVersion: room1.version,
        partialMove: {
          pieceId: p1Piece.id,
          useWallBreak: true,
          breakWall: w,
          destination: { row: 2, col: 3 },
        },
      });
      expect(wg1To.status).toBe(200);
      expect(wg1To.body.executed).toBe(true);
      expect(wg1To.body.room.gameState!.lastActionEvent).toMatchObject({
        kind: 'turn',
        usedWallBreak: true,
        timedOut: true,
      });

      // Wall Go II 3P 2-wall diagonal break partialMove
      const h2 = makeHarness({ rng });
      const c2 = await h2.createRoom('A', 'ca', {
        ruleVariant: 'wallgo2',
        format: '3p',
        timerSeconds: 60,
        shuffleOrder: false,
      });
      const code2 = c2.body.room.code;
      const a2 = c2.body.sessionToken;
      const b2 = (await h2.cmd(code2, { op: 'join', nickname: 'B', clientId: 'cb' })).body.sessionToken!;
      const d2 = (await h2.cmd(code2, { op: 'join', nickname: 'C', clientId: 'cc' })).body.sessionToken!;
      const st2 = await h2.cmd(code2, { op: 'start_game', sessionToken: a2, expectedVersion: 3 });
      let room2 = st2.body.room;
      const toks2 = [a2, b2, d2];
      // Place 6 pieces: square pieces for each player first, then round
      const wg2Placements: Array<{ pos: { row: number; col: number }; kind: 'square' | 'round' }> = [
        { pos: { row: 2, col: 2 }, kind: 'round' }, // P0 round at (2,2)
        { pos: { row: 2, col: 4 }, kind: 'square' }, // P1 square
        { pos: { row: 5, col: 5 }, kind: 'square' }, // P2 square
        { pos: { row: 5, col: 6 }, kind: 'round' }, // P2 round
        { pos: { row: 0, col: 0 }, kind: 'round' }, // P1 round
        { pos: { row: 0, col: 6 }, kind: 'square' }, // P0 square
      ];
      for (let i = 0; i < 6; i++) {
        const cur = room2.gameState!.players[room2.gameState!.currentPlayerIndex].id;
        const r = await h2.cmd(code2, {
          op: 'game_action',
          sessionToken: toks2[cur],
          expectedVersion: room2.version,
          action: {
            type: 'commit_placement',
            pos: wg2Placements[i].pos,
            kind: wg2Placements[i].kind,
          },
        });
        expect(r.status).toBe(200);
        room2 = r.body.room;
      }

      // Inject two walls forming a 2-wall diagonal corner around (2,2) -> (3,3) into store for exact WG2 E13 test
      const rawRoom2 = (await h2.store.getRoom(code2))!;
      const wallA: WallEdge = { orientation: 'h', row: 2, col: 2 }; // between (2,2)-(3,2)
      const wallB: WallEdge = { orientation: 'v', row: 2, col: 2 }; // between (2,2)-(2,3)
      rawRoom2.gameState!.walls[wallKey(wallA)] = { ...wallA, ownerId: 1 };
      rawRoom2.gameState!.walls[wallKey(wallB)] = { ...wallB, ownerId: 2 };
      const casWall = await h2.store.casUpdateRoom(code2, rawRoom2.version, rawRoom2, 21_600);
      expect(casWall.ok).toBe(true);
      if (!casWall.ok) throw new Error('expected cas ok');

      const sqPiece = casWall.room.gameState!.pieces.find(
        (p: Piece) => p.ownerId === 0 && p.kind === 'round',
      )!;
      const targets = getWallGo2BreakTargets(casWall.room.gameState!, sqPiece.id);
      const diagTarget = targets.find((t) => t.row === 3 && t.col === 3);
      expect(diagTarget).toBeDefined();
      expect(diagTarget!.breakableWalls).toHaveLength(2);

      // Timeout with WG2 2-wall diagonal partialMove confirming wallB!
      h2.now = casWall.room.turnStartedAt! + 59_750;
      const wg2To = await h2.cmd(code2, {
        op: 'timeout',
        sessionToken: a2,
        expectedVersion: casWall.room.version,
        partialMove: {
          pieceId: sqPiece.id,
          useWallBreak: true,
          breakWall: wallB,
          destination: { row: 3, col: 3 },
        },
      });
      expect(wg2To.status).toBe(200);
      expect(wg2To.body.executed).toBe(true);
      expect(wg2To.body.room.gameState!.lastActionEvent).toMatchObject({
        kind: 'turn',
        usedWallBreak: true,
        to: { row: 3, col: 3 },
        timedOut: true,
      });
      expect(
        isSameWallEdge(
          (wg2To.body.room.gameState!.lastActionEvent as { brokenWall: WallEdge }).brokenWall,
          wallB,
        ),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // V2-E20 & V2-E21: Same-Room Round 2 (Host survivor_spectator, AI-vs-AI, ties, rematch, return_to_waiting)
  // --------------------------------------------------------------------------
  describe('V2-E20 & V2-E21: Same-Room 3P -> Prison Match Round 2, Ties, Rematch & Return to Waiting', () => {
    it('moves Host 1st-place survivor into survivor_spectator preserving host powers, supports AI-vs-AI Round 2, rematch, and return_to_waiting without resetting gameSequence', async () => {
      const rng = createSeededRng(999);
      const h = makeHarness({ rng });
      h.env.WALLGO_AI_STEP_MIN_DELAY_MS = '0';

      // Create 3P room with Host (Alice) + 2 AI bots, shuffleOrder: true
      const created = await h.createRoom('Alice', 'c-alice', {
        ruleVariant: 'wallgo1',
        format: '3p',
        timerSeconds: 0,
        shuffleOrder: true,
      });
      const code = created.body.room.code;
      const aliceToken = created.body.sessionToken;
      const s1 = await h.cmd(code, {
        op: 'set_seat',
        sessionToken: aliceToken,
        expectedVersion: 1,
        seatIndex: 1,
        kind: 'ai',
        aiDifficulty: 'easy',
      });
      const s2 = await h.cmd(code, {
        op: 'set_seat',
        sessionToken: aliceToken,
        expectedVersion: s1.body.room.version,
        seatIndex: 2,
        kind: 'ai',
        aiDifficulty: 'easy',
      });
      const started = await h.cmd(code, {
        op: 'start_game',
        sessionToken: aliceToken,
        expectedVersion: s2.body.room.version,
      });
      let room = started.body.room;
      const aliceGamePlayerId = room.seats[0].gamePlayerId!;

      // Play Round 1 to completion
      room = await finishGameByAiOrHumans(
        h,
        code,
        new Map([[0, aliceToken]]),
        aliceToken,
        rng,
      );
      expect(room.gameSequence).toBe(1);

      // Validate invalid overridePair rejections (V2-E21)
      for (const badPair of [[0, 0], [0, 3], [0, 1.5], [0], '01']) {
        const err = await h.cmd(code, {
          op: 'start_round2',
          sessionToken: aliceToken,
          expectedVersion: room.version,
          overridePair: badPair,
        });
        expect(err.status).toBe(400);
        expect(err.body.error.code).toBe('INVALID_REQUEST');
      }

      // Use overridePair so the 2 AI players advance and Host (Alice) is explicitly the 1st-place survivor!
      const aiIds = [0, 1, 2].filter((id) => id !== aliceGamePlayerId) as [number, number];
      const r2Start = await h.cmd(code, {
        op: 'start_round2',
        sessionToken: aliceToken,
        expectedVersion: room.version,
        overridePair: aiIds,
      });
      expect(r2Start.status).toBe(200);
      room = r2Start.body.room;
      expect(room.roundNumber).toBe(2);
      expect(room.gameSequence).toBe(2);
      expect(room.gameState!.isPrisonMatchRound2).toBe(true);
      expect(room.gameState!.format).toBe('2p');
      expect(room.gameState!.players.every((p) => p.wallBreaksRemaining === 0)).toBe(true);
      expect(room.seats).toHaveLength(2);
      expect(room.seats.every((s) => s.kind === 'ai')).toBe(true);
      expect(room.viewer.role).toBe('spectator');
      expect(room.viewer.spectatorRole).toBe('survivor_spectator');
      expect(room.viewer.isHost).toBe(true);
      expect(room.lastEvent).toMatchObject({
        type: 'round2_started',
        survivorNickname: 'Alice',
      });

      // Survivor host CANNOT submit game_action -> 403 FORBIDDEN_SPECTATOR
      const forbidMove = await h.cmd(code, {
        op: 'game_action',
        sessionToken: aliceToken,
        expectedVersion: room.version,
        action: { type: 'commit_placement', pos: { row: 0, col: 0 } },
      });
      expect(forbidMove.status).toBe(403);
      expect(forbidMove.body.error.code).toBe('FORBIDDEN_SPECTATOR');

      // Survivor host CAN drive AI-vs-AI Round 2 via ai_step to completion!
      room = await finishGameByAiOrHumans(h, code, new Map(), aliceToken, rng);
      expect(room.status).toBe('finished');
      expect(room.roundNumber).toBe(2);

      // Cannot start_round2 again on an already-Round-2 room -> 400 INVALID_ROOM_STATUS
      const doubleR2 = await h.cmd(code, {
        op: 'start_round2',
        sessionToken: aliceToken,
        expectedVersion: room.version,
      });
      expect(doubleR2.status).toBe(400);
      expect(doubleR2.body.error.code).toBe('INVALID_ROOM_STATUS');

      // Survivor host updates nickname during Round 2 finished, then runs rematch (preserves Round 2!)
      const renamed = await h.cmd(code, {
        op: 'update_nickname',
        sessionToken: aliceToken,
        expectedVersion: room.version,
        nickname: 'AliceWin',
      });
      expect(renamed.status).toBe(200);
      room = renamed.body.room;

      const rematch = await h.cmd(code, {
        op: 'rematch',
        sessionToken: aliceToken,
        expectedVersion: room.version,
      });
      expect(rematch.status).toBe(200);
      room = rematch.body.room;
      expect(room.roundNumber).toBe(2);
      expect(room.gameSequence).toBe(3);
      expect(room.gameState!.isPrisonMatchRound2).toBe(true);
      expect(room.viewer.spectatorRole).toBe('survivor_spectator');

      // Finish Round 2 rematch, then return_to_waiting -> restores 3 Round 1 seats & Alice re-seated with 'AliceWin' & gameSequence preserved!
      room = await finishGameByAiOrHumans(h, code, new Map(), aliceToken, rng);
      const back = await h.cmd(code, {
        op: 'return_to_waiting',
        sessionToken: aliceToken,
        expectedVersion: room.version,
      });
      expect(back.status).toBe(200);
      room = back.body.room;
      expect(room.status).toBe('waiting');
      expect(room.roundNumber).toBe(1);
      expect(room.gameSequence).toBe(3); // NEVER reset!
      expect(room.seats).toHaveLength(3);
      expect(room.seats[0]).toMatchObject({ kind: 'human', nickname: 'AliceWin', isHost: true });
      expect(room.seats[1]).toMatchObject({ kind: 'ai', nickname: 'AI 2' });
      expect(room.seats[2]).toMatchObject({ kind: 'ai', nickname: 'AI 3' });
      expect(room.spectators).toHaveLength(0);
    });

    it('does NOT add an AI 1st-place survivor to spectators[] and re-seats returning humans skipping departed ones', async () => {
      const rng = createSeededRng(515);
      const h = makeHarness({ rng });
      h.env.WALLGO_AI_STEP_MIN_DELAY_MS = '0';

      const created = await h.createRoom('Alice', 'c-a', DEFAULT_3P_CONFIG);
      const code = created.body.room.code;
      const aTok = created.body.sessionToken;
      const bJoin = await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c-b' });
      const bTok = bJoin.body.sessionToken!;
      const aiSeat = await h.cmd(code, {
        op: 'set_seat',
        sessionToken: aTok,
        expectedVersion: bJoin.body.room.version,
        seatIndex: 2,
        kind: 'ai',
        aiDifficulty: 'easy',
      });
      const st = await h.cmd(code, {
        op: 'start_game',
        sessionToken: aTok,
        expectedVersion: aiSeat.body.room.version,
      });
      expect(st.status).toBe(200);
      let room = await finishGameByAiOrHumans(
        h,
        code,
        new Map([
          [0, aTok],
          [1, bTok],
        ]),
        aTok,
        rng,
      );

      // Force AI (gamePlayerId 2) as survivor -> Alice (0) & Bob (1) advance
      const r2 = await h.cmd(code, {
        op: 'start_round2',
        sessionToken: aTok,
        expectedVersion: room.version,
        overridePair: [0, 1],
      });
      expect(r2.status).toBe(200);
      room = r2.body.room;
      expect(room.spectators).toHaveLength(0); // AI survivor NOT added!

      // Bob explicitly leaves during Round 2, then game finishes via AI sub
      const bobLeave = await h.cmd(code, { op: 'leave', sessionToken: bTok });
      expect(bobLeave.status).toBe(200);
      const subBob = await h.cmd(code, {
        op: 'substitute_ai',
        sessionToken: aTok,
        expectedVersion: bobLeave.body.room.version,
        seatIndex: 1,
        aiDifficulty: 'easy',
      });
      expect(subBob.status).toBe(200);
      room = await finishGameByAiOrHumans(h, code, new Map([[0, aTok]]), aTok, rng);

      // Return to waiting: Bob (who left) becomes 'open', Alice restored in Seat 0, AI restored in Seat 2
      const back = await h.cmd(code, {
        op: 'return_to_waiting',
        sessionToken: aTok,
        expectedVersion: room.version,
      });
      expect(back.status).toBe(200);
      expect(back.body.room.seats[0]).toMatchObject({ kind: 'human', nickname: 'Alice' });
      expect(back.body.room.seats[1]).toMatchObject({ kind: 'open' });
      expect(back.body.room.seats[2]).toMatchObject({ kind: 'ai', nickname: 'AI 3' });
    });
  });

  // --------------------------------------------------------------------------
  // V2-E22, V2-E23, V2-E29, V2-E30 & Prototype Pollution / Adversarial Payloads
  // --------------------------------------------------------------------------
  describe('V2-E22, V2-E23, V2-E29, V2-E30 & Security Hardening', () => {
    it('normalizes edge-case nicknames across create, join (ko/en), and update_nickname (incl. live playing sync)', async () => {
      const h = makeHarness();
      // Blank -> localized default
      const rEn = await h.createRoom('   \u200B\u202E  ', 'c-1', DEFAULT_2P_CONFIG, 'en');
      expect(rEn.status).toBe(201);
      expect(rEn.body.room.seats[0].nickname).toBe('Player 1');

      // 20 Hangul chars -> truncated to 12 codepoints; control chars stripped
      const j = await h.cmd(rEn.body.room.code, {
        op: 'join',
        nickname: '\u0000가나다라마바사아자차카타파하가나다라마바',
        clientId: 'c-2',
        locale: 'ko',
      });
      expect(j.status).toBe(200);
      expect(Array.from(j.body.room.seats[1].nickname)).toHaveLength(12);
      expect(j.body.room.seats[1].nickname).toBe('가나다라마바사아자차카타');

      // Spectator blank in EN -> 'Spectator'
      const sp = await h.cmd(rEn.body.room.code, {
        op: 'join',
        nickname: '   ',
        clientId: 'c-3',
        locale: 'en',
      });
      expect(sp.status).toBe(200);
      expect(sp.body.room.spectators[0].nickname).toBe('Spectator');

      // Start game and update_nickname mid-playing -> syncs seat, gameState.players, and replayDraft!
      const started = await h.cmd(rEn.body.room.code, {
        op: 'start_game',
        sessionToken: rEn.body.sessionToken,
        expectedVersion: sp.body.room.version,
      });
      const updated = await h.cmd(rEn.body.room.code, {
        op: 'update_nickname',
        sessionToken: rEn.body.sessionToken,
        expectedVersion: started.body.room.version,
        nickname: '  <script>alert(1)</script>  ',
      });
      expect(updated.status).toBe(200);
      expect(updated.body.room.seats[0].nickname).toBe('<script>aler');
      expect(updated.body.room.gameState!.players[0].name).toBe('<script>aler');
      const raw = await h.store.getRoom(rEn.body.room.code);
      expect(raw!.replayDraft!.initialConfig.players[0].name).toBe('<script>aler');
    });

    it('rejects prototype pollution, deep nesting, malformed types, and returns 503 REDIS_NOT_CONFIGURED when unconfigured', async () => {
      const h = makeHarness();
      const created = await h.createRoom('Alice', 'c-alice', DEFAULT_2P_CONFIG);
      const code = created.body.room.code;
      const aliceToken = created.body.sessionToken;

      // Raw JSON with __proto__, constructor, prototype, deep nesting, non-object bodies
      const hostileBodies = [
        '{"__proto__":{"polluted":true},"nickname":"A","clientId":"c","config":{"ruleVariant":"wallgo1","format":"2p","timerSeconds":0,"shuffleOrder":false}}',
        '{"op":"update_config","sessionToken":"t","expectedVersion":1,"patch":{"constructor":{"x":1}}}',
        '{"op":"update_config","sessionToken":"t","expectedVersion":1,"patch":{"prototype":{"x":1}}}',
        '{"op":"join","a":{"b":{"c":{"d":{"e":{"f":{"g":1}}}}}}}',
        'null',
        '[]',
        '"string"',
        '123',
        '',
        '{broken',
      ];
      for (const rawBody of hostileBodies) {
        const res = await handleApiRequest(
          new Request(`http://localhost/api/rooms/${code}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: rawBody,
          }),
          h.opts(),
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as ApiErrorBody;
        expect(body.error.code).toBe('INVALID_REQUEST');
      }

      // Unknown patch key, invalid expectedVersion, out-of-bounds seatIndex, invalid aiDifficulty -> 400
      for (const badCmd of [
        { op: 'update_config', sessionToken: aliceToken, expectedVersion: 1, patch: { unknownKey: true } },
        { op: 'update_config', sessionToken: aliceToken, expectedVersion: 0, patch: {} },
        { op: 'update_config', sessionToken: aliceToken, expectedVersion: 1.5, patch: {} },
        { op: 'update_config', sessionToken: aliceToken, expectedVersion: '1', patch: {} },
        { op: 'set_seat', sessionToken: aliceToken, expectedVersion: 1, seatIndex: 5, kind: 'ai' },
        { op: 'set_seat', sessionToken: aliceToken, expectedVersion: 1, seatIndex: -1, kind: 'ai' },
        { op: 'set_seat', sessionToken: aliceToken, expectedVersion: 1, seatIndex: 1, kind: 'ai', aiDifficulty: 'godmode' },
      ]) {
        const res = await h.cmd(code, badCmd);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_REQUEST');
      }

      // V2-E23: Unconfigured mode (WALLGO_FORCE_UNCONFIGURED=1 and VERCEL=1) returns 503 BEFORE body parse!
      for (const envCase of [{ WALLGO_FORCE_UNCONFIGURED: '1' }, { VERCEL: '1' }]) {
        const rPost = await handleApiRequest(
          new Request('http://localhost/api/rooms', { method: 'POST', body: '' }),
          { env: envCase },
        );
        expect(rPost.status).toBe(503);
        expect(((await rPost.json()) as ApiErrorBody).error.code).toBe('REDIS_NOT_CONFIGURED');

        const rGet = await handleApiRequest(
          new Request(`http://localhost/api/rooms/${code}`, { method: 'GET' }),
          { store: new UnconfiguredStore(), env: envCase },
        );
        expect(rGet.status).toBe(503);
        expect(((await rGet.json()) as ApiErrorBody).error.code).toBe('REDIS_NOT_CONFIGURED');

        const rCmd = await handleApiRequest(
          new Request(`http://localhost/api/rooms/${code}`, { method: 'POST', body: '' }),
          { env: envCase },
        );
        expect(rCmd.status).toBe(503);
        expect(((await rCmd.json()) as ApiErrorBody).error.code).toBe('REDIS_NOT_CONFIGURED');
      }

      // V2-E29: Vercel entrypoint apiEntry.fetch + ?__path= rewrite + HEAD
      const createViaEntry = await apiEntry.fetch(
        new Request('http://localhost/api?__path=api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nickname: 'EntryHost',
            clientId: 'c-entry',
            config: DEFAULT_2P_CONFIG,
          }),
        }),
      );
      expect(createViaEntry.status).toBe(201);
      expect(createViaEntry.headers.get('cache-control')).toBe(NO_STORE_HEADER);
      const entryData = (await createViaEntry.json()) as CreateRoomResponse;
      assertNoPrivateFields(entryData.room, [entryData.sessionToken, 'c-entry']);

      const headViaEntry = await apiEntry.fetch(
        new Request(`http://localhost/api?__path=rooms/${entryData.room.code}`, {
          method: 'HEAD',
        }),
      );
      expect(headViaEntry.status).toBe(200);
      expect(headViaEntry.headers.get('cache-control')).toBe(NO_STORE_HEADER);
      expect(await headViaEntry.text()).toBe('');

      // Ensure legal wall helper import stays verified on wall placement edge
      const rawSnap = (await h.store.getRoom(code))!;
      expect(rawSnap.version).toBe(1);
      expect(getLegalWallPlacements.length).toBeGreaterThan(0);
    });

    it('V2-E22: never leaks sessionToken, clientId, kickedTokens, or internal fields across create, join, GET, kick, substitute_ai, start_round2, and 409 conflict', async () => {
      const rng = createSeededRng(2222);
      const h = makeHarness({ rng });
      h.env.WALLGO_AI_STEP_MIN_DELAY_MS = '0';

      const c = await h.createRoom('Alice', 'secret-cid-alice', DEFAULT_3P_CONFIG);
      const code = c.body.room.code;
      const aTok = c.body.sessionToken;
      const b = await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'secret-cid-bob' });
      const bTok = b.body.sessionToken!;
      const k = await h.cmd(code, { op: 'join', nickname: 'Kicked', clientId: 'secret-cid-kicked' });
      const kTok = k.body.sessionToken!;

      const secrets = [
        aTok,
        bTok,
        kTok,
        'secret-cid-alice',
        'secret-cid-bob',
        'secret-cid-kicked',
      ];
      assertNoPrivateFields(c.body.room, secrets);
      assertNoPrivateFields(b.body.room, secrets);
      assertNoPrivateFields(k.body.room, secrets);

      // Kick Kicked, join Carol, verify GET & kick response leak nothing
      const kicked = await h.cmd(code, {
        op: 'kick_seat',
        sessionToken: aTok,
        expectedVersion: k.body.room.version,
        seatIndex: 2,
      });
      assertNoPrivateFields(kicked.body.room, secrets);

      const carol = await h.cmd(code, { op: 'join', nickname: 'Carol', clientId: 'secret-cid-carol' });
      const cTok = carol.body.sessionToken!;
      secrets.push(cTok, 'secret-cid-carol');
      assertNoPrivateFields(carol.body.room, secrets);

      const anonGet = await h.getRoom(code);
      assertNoPrivateFields(
        (anonGet.body as { unchanged: false; room: PublicRoomSnapshot }).room,
        secrets,
      );

      // Stale conflict response leaks nothing
      const conflict = await h.cmd(code, {
        op: 'update_config',
        sessionToken: aTok,
        expectedVersion: 1,
        patch: { timerSeconds: 60 },
      });
      expect(conflict.status).toBe(409);
      assertNoPrivateFields(conflict.body.room, secrets);

      // Start game, Bob leaves, Host substitutes AI, finish game, start Round 2 -> scan every snapshot!
      const started = await h.cmd(code, {
        op: 'start_game',
        sessionToken: aTok,
        expectedVersion: carol.body.room.version,
      });
      assertNoPrivateFields(started.body.room, secrets);

      const bobLeft = await h.cmd(code, { op: 'leave', sessionToken: bTok });
      const sub = await h.cmd(code, {
        op: 'substitute_ai',
        sessionToken: aTok,
        expectedVersion: bobLeft.body.room.version,
        seatIndex: 1,
        aiDifficulty: 'easy',
      });
      assertNoPrivateFields(sub.body.room, secrets);

      const finished = await finishGameByAiOrHumans(
        h,
        code,
        new Map([
          [0, aTok],
          [2, cTok],
        ]),
        aTok,
        rng,
      );
      assertNoPrivateFields(finished, secrets);

      const r2 = await h.cmd(code, {
        op: 'start_round2',
        sessionToken: aTok,
        expectedVersion: finished.version,
        overridePair: [1, 2],
      });
      expect(r2.status).toBe(200);
      assertNoPrivateFields(r2.body.room, secrets);
    });
  });

  describe('M7 Hardening Regressions (BUG-1..4)', () => {
    it('BUG-1: closing empty waiting room tombstone rejects concurrent joiner cleanly instead of phantom delete', async () => {
      const h = makeHarness();
      let holdDeleteResolve: (() => void) | null = null;
      const deleteStarted = new Promise<void>((resolve) => {
        const origDelete = h.store.deleteRoom.bind(h.store);
        h.store.deleteRoom = async (roomCode: string) => {
          resolve();
          await new Promise<void>((r) => {
            holdDeleteResolve = r;
          });
          return origDelete(roomCode);
        };
      });

      const created = await h.createRoom('Alice', 'c_a', DEFAULT_2P_CONFIG);
      const code = created.body.room.code;
      const aTok = created.body.sessionToken;

      const leavePromise = h.cmd(code, { op: 'leave', sessionToken: aTok });
      await deleteStarted;

      // Room tombstone exists between CAS and deleteRoom; both GET and join MUST return 404
      const getDuringClose = await h.getRoom(code);
      expect(getDuringClose.status).toBe(404);

      const joinDuringClose = await h.cmd(code, {
        op: 'join',
        nickname: 'Bob',
        clientId: 'c_b',
      });
      expect(joinDuringClose.status).toBe(404);

      holdDeleteResolve!();
      const leaveRes = await leavePromise;
      expect(leaveRes.status).toBe(200);
    });

    it('BUG-2: explicitlyLeft members are rejected with 401 on mutating ops until they rejoin, and repeat leave is idempotent', async () => {
      const h = makeHarness();
      const created = await h.createRoom('Alice', 'c_a', DEFAULT_2P_CONFIG);
      const code = created.body.room.code;
      const aTok = created.body.sessionToken;
      const bob = await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c_b' });
      const bTok = bob.body.sessionToken!;

      const started = await h.cmd(code, {
        op: 'start_game',
        sessionToken: aTok,
        expectedVersion: bob.body.room.version,
      });
      expect(started.status).toBe(200);

      // Alice explicitly leaves during playing
      const left1 = await h.cmd(code, { op: 'leave', sessionToken: aTok });
      expect(left1.status).toBe(200);
      const vAfterLeave = left1.body.room.version;

      // Repeated leave is idempotent and does not bump version
      const left2 = await h.cmd(code, { op: 'leave', sessionToken: aTok });
      expect(left2.status).toBe(200);
      expect(left2.body.room.version).toBe(vAfterLeave);

      // Mutating ops while explicitlyLeft MUST fail with 401
      const moveWhileLeft = await h.cmd(code, {
        op: 'game_action',
        sessionToken: aTok,
        expectedVersion: vAfterLeave,
        action: { type: 'commit_placement', pos: { row: 0, col: 0 } },
      });
      expect(moveWhileLeft.status).toBe(401);

      const renameWhileLeft = await h.cmd(code, {
        op: 'update_nickname',
        sessionToken: aTok,
        expectedVersion: vAfterLeave,
        nickname: 'Ghost',
      });
      expect(renameWhileLeft.status).toBe(401);

      // Rejoining clears explicitlyLeft and allows game_action
      const rejoined = await h.cmd(code, {
        op: 'join',
        sessionToken: aTok,
        clientId: 'c_a',
        nickname: 'Alice',
      });
      expect(rejoined.status).toBe(200);
      expect(bTok.length).toBeGreaterThan(0);

      const moveAfterRejoin = await h.cmd(code, {
        op: 'game_action',
        sessionToken: aTok,
        expectedVersion: rejoined.body.room.version,
        action: { type: 'commit_placement', pos: { row: 0, col: 0 } },
      });
      expect(moveAfterRejoin.status).toBe(200);
    });

    it('BUG-3: 10 simultaneous joiners on 1 open seat succeed cleanly without spurious 409 VERSION_CONFLICT', async () => {
      const h = makeHarness();
      const created = await h.createRoom('Host', 'c_host', DEFAULT_3P_CONFIG);
      const code = created.body.room.code;
      const hostTok = created.body.sessionToken;

      // Fill Seat 1 with AI, leaving strictly 1 open seat (Seat 2)
      const aiRes = await h.cmd(code, {
        op: 'set_seat',
        sessionToken: hostTok,
        expectedVersion: created.body.room.version,
        seatIndex: 1,
        kind: 'ai',
        aiDifficulty: 'easy',
      });
      expect(aiRes.status).toBe(200);

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, idx) =>
          h.cmd(code, {
            op: 'join',
            nickname: `Joiner${idx}`,
            clientId: `c_burst_${idx}`,
          }),
        ),
      );

      expect(results.every((r) => r.status === 200)).toBe(true);
      const seatWinners = results.filter((r) => r.body.room.viewer.role === 'player');
      const specWinners = results.filter((r) => r.body.room.viewer.role === 'spectator');
      expect(seatWinners.length).toBe(1);
      expect(specWinners.length).toBe(9);
    });

    it('BUG-4: short WALLGO_DISCONNECT_TIMEOUT_MS clamps heartbeat throttle and claim_host forces presence refresh', async () => {
      const h = makeHarness();
      h.env.WALLGO_DISCONNECT_TIMEOUT_MS = '1500';
      const created = await h.createRoom('Host', 'c_host', DEFAULT_2P_CONFIG);
      const code = created.body.room.code;
      const hostTok = created.body.sessionToken;
      const bob = await h.cmd(code, { op: 'join', nickname: 'Bob', clientId: 'c_bob' });
      const bobTok = bob.body.sessionToken!;

      // Advance 2000ms (> 1500ms disconnect timeout, < 4000ms default throttle)
      // Bob polls actively and MUST stay connected
      h.now += 2000;
      const bobPoll = await h.getRoom(code, bobTok);
      expect(bobPoll.status).toBe(200);
      const bobSnap = (bobPoll.body as { unchanged: false; room: PublicRoomSnapshot }).room;
      expect(bobSnap.seats[1].connectionStatus).toBe('connected');
      expect(bobSnap.seats[0].connectionStatus).toBe('disconnected');

      // Host did not poll, so Bob can claim host and immediately appear connected
      const claimed = await h.cmd(code, {
        op: 'claim_host',
        sessionToken: bobTok,
        expectedVersion: bobSnap.version,
      });
      expect(claimed.status).toBe(200);
      expect(claimed.body.room.seats[1].isHost).toBe(true);
      expect(claimed.body.room.seats[1].connectionStatus).toBe('connected');
      expect(hostTok.length).toBeGreaterThan(0);
    });
  });
});
