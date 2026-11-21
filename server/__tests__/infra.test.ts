import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewServer, ViteDevServer } from 'vite';
import apiEntry from '../../api/index.js';
import type { MatchRecord, MatchSummary } from '../../src/shared/historyTypes.js';
import {
  ROOM_TTL_ACTIVE_SECONDS,
  ROOM_TTL_FINISHED_SECONDS,
} from '../../src/shared/onlineTypes.js';
import {
  getAiStepDelayMs,
  getAwayGraceMs,
  getDisconnectTimeoutMs,
  getHeartbeatWriteThrottleMs,
  getRoomTtlSeconds,
  matchKey,
  presenceKey,
  roomKey,
  type RoomRecord,
} from '../types.js';
import {
  CAS_UPDATE_ROOM_SCRIPT,
  CREATE_ROOM_NX_SCRIPT,
  MemoryStore,
  RedisNotConfiguredError,
  SAVE_MATCH_ATOMIC_SCRIPT,
  StorageBackendError,
  UnconfiguredStore,
  UpstashRedisStore,
  createStore,
  getSharedMemoryStore,
  getStore,
  resetSharedMemoryStore,
  resolveStorageConfig,
} from '../store/index.js';
import {
  NO_STORE_HEADER,
  handleApiRequest,
  jsonResponse,
  normalizeApiPathname,
  readJsonBody,
} from '../router.js';
import { createNodeApiMiddleware, isApiRequestUrl } from '../node-adapter.js';
import { wallgoApiPlugin } from '../vite-plugin.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function makeSampleRoom(code = 'AB3K9M', version = 1): RoomRecord {
  return {
    code,
    version,
    status: 'waiting',
    roundNumber: 1,
    gameSequence: 0,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    config: {
      ruleVariant: 'wallgo1',
      format: '3p',
      timerSeconds: 0,
      shuffleOrder: false,
    },
    hostMemberId: 'm_host',
    seats: [],
    spectators: [],
    kickedTokens: [],
    gameState: null,
    turnStartedAt: null,
    nextAiStepAt: null,
    matchSavedId: null,
    lastEvent: null,
    eventCounter: 0,
    round1Roster: null,
    replayDraft: null,
  };
}

function makeSampleMatch(id: string): { record: MatchRecord; summary: MatchSummary } {
  const summary: MatchSummary = {
    id,
    schemaVersion: 1,
    mode: 'online',
    roomCode: 'AB3K9M',
    playedAt: '2026-11-20T12:00:00.000Z',
    ruleVariant: 'wallgo1',
    format: '2p',
    isPrisonMatchRound2: false,
    timerSeconds: 0,
    endReason: 'all_separated',
    totalTurns: 5,
    totalSteps: 9,
    players: [],
    finalBoard: { pieces: [], walls: {}, lastPlacedWall: null },
    hasReplay: true,
  };
  const record: MatchRecord = {
    ...summary,
    replay: {
      schemaVersion: 1,
      initialConfig: {
        ruleVariant: 'wallgo1',
        format: '2p',
        isPrisonMatchRound2: false,
        timerSeconds: 0,
        players: [
          { name: 'Alice', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
          { name: 'Bob', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
        ],
      },
      steps: [],
    },
  };
  return { record, summary };
}

function collectTsFiles(dir: string, skipTests: boolean): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipTests && entry.name === '__tests__') {
        continue;
      }
      out.push(...collectTsFiles(full, skipTests));
    } else if (entry.isFile() && /\.(?:ts|tsx|mts)$/.test(entry.name)) {
      if (skipTests && /\.test\.tsx?$/.test(entry.name)) {
        continue;
      }
      out.push(full);
    }
  }
  return out;
}

afterEach(() => {
  resetSharedMemoryStore();
  vi.restoreAllMocks();
});

describe('M6 Backend & Deployment Infrastructure (INFRA-01..05)', () => {
  describe('Vercel Function Cap, Entrypoint Shape, vercel.json & Node 24 ESM Guardrails', () => {
    it('enforces strictly 1 deployable file inside api/ (index.ts) with Web-Standard { fetch } export', async () => {
      const apiDir = path.join(REPO_ROOT, 'api');
      const entries = fs.readdirSync(apiDir, { recursive: true, withFileTypes: true });
      const deployable = entries
        .filter(
          (e) =>
            e.isFile() &&
            !e.name.startsWith('_') &&
            !e.name.startsWith('.') &&
            !e.name.endsWith('.d.ts'),
        )
        .map((e) => e.name);

      expect(deployable).toEqual(['index.ts']);
      expect(typeof apiEntry).toBe('object');
      expect(typeof apiEntry.fetch).toBe('function');

      const res = await apiEntry.fetch(new Request('http://localhost/api/health'));
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe(NO_STORE_HEADER);
      const body = (await res.json()) as { ok: boolean; storage: string };
      expect(body.ok).toBe(true);
      expect(['memory', 'redis', 'unconfigured']).toContain(body.storage);
    });

    it('validates vercel.json headers and ordered API-safe rewrites', () => {
      const raw = fs.readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8');
      const config = JSON.parse(raw) as {
        headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
        rewrites: Array<{ source: string; destination: string }>;
      };

      expect(config.headers).toEqual([
        {
          source: '/api/(.*)',
          headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
        },
      ]);
      expect(config.rewrites).toEqual([
        { source: '/api/(.*)', destination: '/api' },
        { source: '/((?!api(?:/|$)).*)', destination: '/index.html' },
      ]);

      const spaRegex = new RegExp(`^${config.rewrites[1].source}$`);
      expect(spaRegex.test('/api')).toBe(false);
      expect(spaRegex.test('/api/health')).toBe(false);
      expect(spaRegex.test('/api/rooms/AB3K9M')).toBe(false);
      expect(spaRegex.test('/')).toBe(true);
      expect(spaRegex.test('/room/AB3K9M')).toBe(true);
      expect(spaRegex.test('/history')).toBe(true);
      expect(spaRegex.test('/api-docs')).toBe(true);
    });

    it('verifies zero extensionless relative imports across api/, server/, src/shared/, src/engine/, src/ai/', () => {
      const roots = [
        { dir: path.join(REPO_ROOT, 'api'), skipTests: false },
        { dir: path.join(REPO_ROOT, 'server'), skipTests: false },
        { dir: path.join(REPO_ROOT, 'src/shared'), skipTests: true },
        { dir: path.join(REPO_ROOT, 'src/engine'), skipTests: true },
        { dir: path.join(REPO_ROOT, 'src/ai'), skipTests: true },
      ];
      const importRegex = /(?:from|import)\s+['"](\.\.?\/[^'"]+)['"]/g;
      const offenders: string[] = [];

      for (const { dir, skipTests } of roots) {
        for (const file of collectTsFiles(dir, skipTests)) {
          const content = fs.readFileSync(file, 'utf8');
          let match: RegExpExecArray | null;
          while ((match = importRegex.exec(content)) !== null) {
            const spec = match[1];
            if (!spec.endsWith('.js') && !spec.endsWith('.json')) {
              offenders.push(`${path.relative(REPO_ROOT, file)}: ${spec}`);
            }
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  });

  describe('Env Precedence & Server Timing Helpers', () => {
    it('enforces exact storage env resolution order', () => {
      // 1. WALLGO_FORCE_UNCONFIGURED=1 beats both UPSTASH & KV
      expect(
        resolveStorageConfig({
          WALLGO_FORCE_UNCONFIGURED: '1',
          UPSTASH_REDIS_REST_URL: 'https://upstash.example',
          UPSTASH_REDIS_REST_TOKEN: 'tok',
          KV_REST_API_URL: 'https://kv.example',
          KV_REST_API_TOKEN: 'kvtok',
        }),
      ).toEqual({ mode: 'unconfigured', reason: 'forced' });

      // 2. UPSTASH beats KV
      expect(
        resolveStorageConfig({
          UPSTASH_REDIS_REST_URL: ' https://upstash.example ',
          UPSTASH_REDIS_REST_TOKEN: ' tok ',
          KV_REST_API_URL: 'https://kv.example',
          KV_REST_API_TOKEN: 'kvtok',
        }),
      ).toEqual({
        mode: 'redis',
        source: 'upstash',
        url: 'https://upstash.example',
        token: 'tok',
      });

      // 3. Partial/whitespace UPSTASH falls through to KV
      expect(
        resolveStorageConfig({
          UPSTASH_REDIS_REST_URL: 'https://upstash.example',
          UPSTASH_REDIS_REST_TOKEN: '   ',
          KV_REST_API_URL: 'https://kv.example',
          KV_REST_API_TOKEN: 'kvtok',
        }),
      ).toEqual({
        mode: 'redis',
        source: 'kv',
        url: 'https://kv.example',
        token: 'kvtok',
      });

      // 4. VERCEL=1 or VERCEL_ENV without Redis -> unconfigured
      expect(resolveStorageConfig({ VERCEL: '1' })).toEqual({
        mode: 'unconfigured',
        reason: 'vercel_missing_redis',
      });
      expect(resolveStorageConfig({ VERCEL_ENV: 'preview' })).toEqual({
        mode: 'unconfigured',
        reason: 'vercel_missing_redis',
      });

      // 5. Local fallback -> memory singleton on globalThis
      expect(resolveStorageConfig({})).toEqual({
        mode: 'memory',
        reason: 'local_fallback',
      });
      const s1 = getStore({});
      const s2 = getSharedMemoryStore();
      expect(s1).toBe(s2);
      expect(globalThis.__wallgoMemoryStore).toBe(s2);
      expect(createStore({}, { useSharedMemory: false })).not.toBe(s2);
    });

    it('reads env-overrideable timing constants including 0 and falls back safely on invalid values', () => {
      expect(getAwayGraceMs({})).toBe(4_000);
      expect(getDisconnectTimeoutMs({})).toBe(15_000);
      expect(getAiStepDelayMs({})).toBe(450);
      expect(getHeartbeatWriteThrottleMs({})).toBe(4_000);

      expect(
        getAwayGraceMs({ WALLGO_AWAY_GRACE_MS: '0' }),
      ).toBe(0);
      expect(
        getDisconnectTimeoutMs({ WALLGO_DISCONNECT_TIMEOUT_MS: ' 250.9 ' }),
      ).toBe(250);
      expect(
        getAiStepDelayMs({ WALLGO_AI_STEP_MIN_DELAY_MS: '-10' }),
      ).toBe(450);
      expect(
        getHeartbeatWriteThrottleMs({ WALLGO_HEARTBEAT_WRITE_THROTTLE_MS: 'abc' }),
      ).toBe(4_000);

      expect(getRoomTtlSeconds('waiting')).toBe(ROOM_TTL_ACTIVE_SECONDS);
      expect(getRoomTtlSeconds('playing')).toBe(ROOM_TTL_ACTIVE_SECONDS);
      expect(getRoomTtlSeconds('finished')).toBe(ROOM_TTL_FINISHED_SECONDS);
    });
  });

  describe('MemoryStore full-parity semantics', () => {
    it('supports NX creation, deep-clone isolation, CAS conflict/missing, TTL expiry, and decoupled presence', async () => {
      let nowMs = 1_000_000;
      const store = new MemoryStore(() => nowMs);
      const room = makeSampleRoom('AB3K9M', 99); // version normalized to 1 on create

      expect(await store.createRoomNx(room, 60)).toBe(true);
      expect(await store.createRoomNx(room, 60)).toBe(false);

      // Deep-clone isolation
      const fetched = await store.getRoom('AB3K9M');
      expect(fetched?.version).toBe(1);
      fetched!.hostMemberId = 'MUTATED';
      expect((await store.getRoom('AB3K9M'))?.hostMemberId).toBe('m_host');

      // Decoupled presence NEVER bumps room.version
      await store.setPresence('AB3K9M', 'm_host', { lastSeenAt: nowMs, awaySince: null }, 60);
      expect((await store.getRoom('AB3K9M'))?.version).toBe(1);
      expect(await store.getPresenceMap('AB3K9M')).toEqual({
        m_host: { lastSeenAt: nowMs, awaySince: null },
      });

      // CAS success
      const okRes = await store.casUpdateRoom(
        'AB3K9M',
        1,
        { ...room, status: 'playing' },
        60,
      );
      expect(okRes.ok).toBe(true);
      if (okRes.ok) {
        expect(okRes.version).toBe(2);
        expect(okRes.room.status).toBe('playing');
      }

      // CAS conflict returns latest without overwriting
      const conflictRes = await store.casUpdateRoom(
        'AB3K9M',
        1,
        { ...room, status: 'finished' },
        60,
      );
      expect(conflictRes).toMatchObject({
        ok: false,
        reason: 'CONFLICT',
        currentVersion: 2,
      });
      expect((await store.getRoom('AB3K9M'))?.status).toBe('playing');

      // CAS missing
      expect(await store.casUpdateRoom('ZZZZZZ', 1, room, 60)).toEqual({
        ok: false,
        reason: 'NOT_FOUND',
      });

      // Deterministic TTL expiry allows NX re-creation & clears presence
      nowMs += 60_000;
      expect(await store.getRoom('AB3K9M')).toBeNull();
      expect(await store.getPresenceMap('AB3K9M')).toEqual({});
      expect(await store.casUpdateRoom('AB3K9M', 2, room, 60)).toEqual({
        ok: false,
        reason: 'NOT_FOUND',
      });
      expect(await store.createRoomNx(room, 60)).toBe(true);

      // deleteRoom removes both room and presence
      await store.setPresence('AB3K9M', 'm_host', { lastSeenAt: nowMs, awaySince: null }, 60);
      await store.deleteRoom('AB3K9M');
      expect(await store.getRoom('AB3K9M')).toBeNull();
      expect(await store.getPresenceMap('AB3K9M')).toEqual({});
    });

    it('deduplicates matches, preserves newest-first order, and evicts oldest beyond cap', async () => {
      const store = new MemoryStore();
      const m1 = makeSampleMatch('online_AB3K9M_g1');
      const m2 = makeSampleMatch('online_AB3K9M_g2');
      const m3 = makeSampleMatch('online_AB3K9M_g3');
      const m4 = makeSampleMatch('online_AB3K9M_g4');

      expect(await store.saveMatchAtomic(m1.record, m1.summary, 3)).toBe(true);
      expect(await store.saveMatchAtomic(m1.record, m1.summary, 3)).toBe(false); // dedup
      expect(await store.saveMatchAtomic(m2.record, m2.summary, 3)).toBe(true);
      expect(await store.saveMatchAtomic(m3.record, m3.summary, 3)).toBe(true);
      expect(await store.saveMatchAtomic(m4.record, m4.summary, 3)).toBe(true);

      const list = await store.listMatchSummaries(10);
      expect(list.map((m) => m.id)).toEqual([
        'online_AB3K9M_g4',
        'online_AB3K9M_g3',
        'online_AB3K9M_g2',
      ]);
      expect(await store.getMatchRecord('online_AB3K9M_g1')).toBeNull();
      expect((await store.getMatchRecord('online_AB3K9M_g4'))?.id).toBe('online_AB3K9M_g4');
      expect(await store.listMatchSummaries(0)).toEqual([]);
    });

    it('guards non-finite maxMatches and prevents prototype tampering in getPresenceMap', async () => {
      const store = new MemoryStore();
      // Non-finite maxMatches (NaN / Infinity) falls back to MAX_ONLINE_MATCHES (200)
      for (let i = 1; i <= 205; i++) {
        const { record, summary } = makeSampleMatch(`mem_nonfinite_${i}`);
        expect(
          await store.saveMatchAtomic(record, summary, i % 2 === 0 ? Infinity : Number.NaN),
        ).toBe(true);
      }
      expect(await store.getMatchRecord('mem_nonfinite_1')).toBeNull();
      expect(await store.getMatchRecord('mem_nonfinite_5')).toBeNull();
      expect((await store.getMatchRecord('mem_nonfinite_6'))?.id).toBe('mem_nonfinite_6');
      expect((await store.listMatchSummaries(200)).length).toBe(200);

      // Prototype-polluting presence keys are ignored cleanly
      await store.setPresence('AB3K9M', '__proto__', { lastSeenAt: 1000, awaySince: null }, 60);
      await store.setPresence('AB3K9M', 'constructor', { lastSeenAt: 1000, awaySince: null }, 60);
      await store.setPresence('AB3K9M', 'prototype', { lastSeenAt: 1000, awaySince: null }, 60);
      await store.setPresence('AB3K9M', 'm_safe', { lastSeenAt: 2000, awaySince: null }, 60);

      const presence = await store.getPresenceMap('AB3K9M');
      expect(Object.getPrototypeOf(presence)).toBe(Object.prototype);
      expect('lastSeenAt' in presence).toBe(false);
      expect(Object.keys(presence)).toEqual(['m_safe']);
      expect(presence.m_safe).toEqual({ lastSeenAt: 2000, awaySince: null });
    });
  });

  describe('UpstashRedisStore REST & Lua CAS Contract (Mocked fetch)', () => {
    it('sends normalized URL, Bearer token, Lua CAS scripts, and handles Upstash quirks cleanly', async () => {
      const calls: Array<{ url: string; auth: string | null; args: unknown[] }> = [];
      const queue: Array<() => Response> = [];

      const mockFetch: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url: String(input),
          auth: headers.get('authorization'),
          args: JSON.parse(String(init?.body)) as unknown[],
        });
        const next = queue.shift();
        if (!next) {
          throw new Error('Unexpected fetch call');
        }
        return next();
      };

      const respond = (result: unknown) => () =>
        new Response(JSON.stringify({ result }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      const store = new UpstashRedisStore('https://demo.upstash.io///', 'SECRET_TOKEN_XYZ', mockFetch);
      const room = makeSampleRoom('AB3K9M');

      // 1. createRoomNx (1 -> true, 0 -> false)
      queue.push(respond(1), respond(0));
      expect(await store.createRoomNx(room, 21_600)).toBe(true);
      expect(await store.createRoomNx(room, 21_600)).toBe(false);
      expect(calls[0].url).toBe('https://demo.upstash.io');
      expect(calls[0].auth).toBe('Bearer SECRET_TOKEN_XYZ');
      expect(calls[0].args[0]).toBe('EVAL');
      expect(calls[0].args[1]).toBe(CREATE_ROOM_NX_SCRIPT);
      expect(calls[0].args[2]).toBe(1);
      expect(calls[0].args[3]).toBe(roomKey('AB3K9M'));

      // 2. casUpdateRoom: ok, NOT_FOUND, CONFLICT
      const conflictRoom = makeSampleRoom('AB3K9M', 4);
      queue.push(
        respond([1, '2']),
        respond([0, 'NOT_FOUND']),
        respond([0, 'CONFLICT', '4', JSON.stringify(conflictRoom)]),
      );
      const casOk = await store.casUpdateRoom('AB3K9M', 1, room, 21_600);
      expect(casOk.ok).toBe(true);
      expect(calls[2].args[1]).toBe(CAS_UPDATE_ROOM_SCRIPT);
      expect(await store.casUpdateRoom('AB3K9M', 1, room, 21_600)).toEqual({
        ok: false,
        reason: 'NOT_FOUND',
      });
      const casConflict = await store.casUpdateRoom('AB3K9M', 1, room, 21_600);
      expect(casConflict).toEqual({
        ok: false,
        reason: 'CONFLICT',
        currentVersion: 4,
        currentRoom: conflictRoom,
      });

      // 3. setPresence & getPresenceMap (flat array + corrupt entry skipped + empty)
      queue.push(
        respond(1),
        respond(1),
        respond([
          'm1',
          JSON.stringify({ lastSeenAt: 1000, awaySince: null }),
          'm_corrupt',
          '{not-json',
          'm2',
          JSON.stringify({ lastSeenAt: 2000, awaySince: 1500 }),
        ]),
        respond([]),
      );
      await store.setPresence('AB3K9M', 'm1', { lastSeenAt: 1000, awaySince: null }, 60);
      expect(calls[5].args).toEqual([
        'HSET',
        presenceKey('AB3K9M'),
        'm1',
        JSON.stringify({ lastSeenAt: 1000, awaySince: null }),
      ]);
      expect(calls[6].args).toEqual(['EXPIRE', presenceKey('AB3K9M'), 60]);
      expect(await store.getPresenceMap('AB3K9M')).toEqual({
        m1: { lastSeenAt: 1000, awaySince: null },
        m2: { lastSeenAt: 2000, awaySince: 1500 },
      });
      expect(await store.getPresenceMap('AB3K9M')).toEqual({});

      // 4. deleteRoom removes both room & presence in 1 call
      queue.push(respond(2));
      await store.deleteRoom('AB3K9M');
      expect(calls[9].args).toEqual(['DEL', roomKey('AB3K9M'), presenceKey('AB3K9M')]);

      // 5. saveMatchAtomic (3 keys + prefix)
      const { record, summary } = makeSampleMatch('online_AB3K9M_g1');
      queue.push(respond(1), respond(0));
      expect(await store.saveMatchAtomic(record, summary, 200)).toBe(true);
      expect(await store.saveMatchAtomic(record, summary, 200)).toBe(false);
      expect(calls[10].args[1]).toBe(SAVE_MATCH_ATOMIC_SCRIPT);
      expect(calls[10].args[2]).toBe(3);
      expect(calls[10].args[3]).toBe(matchKey('online_AB3K9M_g1'));
      expect(calls[10].args[10]).toBe('wallgo:match:');

      // 6. listMatchSummaries: empty LRANGE makes strictly 1 call (NEVER invokes HMGET!)
      const beforeEmptyCalls = calls.length;
      queue.push(respond([]));
      expect(await store.listMatchSummaries(50)).toEqual([]);
      expect(calls.length).toBe(beforeEmptyCalls + 1);
      expect(calls[calls.length - 1].args[0]).toBe('LRANGE');

      // Non-empty LRANGE -> HMGET skipping null/corrupt items
      queue.push(
        respond(['m_new', 'm_missing', 'm_corrupt']),
        respond([JSON.stringify(summary), null, '{broken']),
      );
      const summaries = await store.listMatchSummaries(50);
      expect(summaries).toEqual([summary]);

      // 7. getMatchRecord
      queue.push(respond(JSON.stringify(record)), respond(null));
      expect(await store.getMatchRecord(record.id)).toEqual(record);
      expect(await store.getMatchRecord('missing')).toBeNull();

      // 8. Error handling: HTTP 401, HTTP 500 redaction (strict FIFO order), Redis error envelope, network error
      queue.push(() => new Response('Unauthorized SECRET_TOKEN_XYZ', { status: 401 }));
      try {
        await store.getRoom('AB3K9M');
        expect.unreachable('Expected StorageBackendError for HTTP 401');
      } catch (err) {
        expect(err).toBeInstanceOf(StorageBackendError);
        expect((err as Error).message).toBe('Upstash HTTP 401: Unauthorized [REDACTED]');
      }

      queue.push(() => new Response('Leaked SECRET_TOKEN_XYZ', { status: 500 }));
      try {
        await store.getRoom('AB3K9M');
        expect.unreachable('Expected StorageBackendError for HTTP 500');
      } catch (err) {
        expect(err).toBeInstanceOf(StorageBackendError);
        expect((err as Error).message).toBe('Upstash HTTP 500: Leaked [REDACTED]');
        expect((err as Error).message).not.toContain('SECRET_TOKEN_XYZ');
      }

      queue.push(() => new Response(JSON.stringify({ error: 'ERR script error' }), { status: 200 }));
      try {
        await store.getRoom('AB3K9M');
        expect.unreachable('Expected StorageBackendError for Redis error envelope');
      } catch (err) {
        expect(err).toBeInstanceOf(StorageBackendError);
        expect((err as Error).message).toBe('Upstash command error: ERR script error');
      }

      const failingStore = new UpstashRedisStore('https://demo.upstash.io', 'tok', async () => {
        throw new TypeError('network down');
      });
      await expect(failingStore.getRoom('AB3K9M')).rejects.toThrow(StorageBackendError);
    });

    it('redacts tokens straddling byte 160, HTTP 200 error envelopes, and handles empty tokens safely', async () => {
      const TOKEN = 'SECRET_BEARER_TOKEN_9876543210ABCDEF';

      // Token crossing 160-char slice boundary on HTTP 500
      const boundaryStore = new UpstashRedisStore(
        'https://demo.upstash.io',
        TOKEN,
        async () => new Response('E'.repeat(145) + TOKEN, { status: 500 }),
      );
      try {
        await boundaryStore.getRoom('AB3K9M');
        expect.unreachable('Expected StorageBackendError for boundary HTTP 500');
      } catch (err) {
        expect(err).toBeInstanceOf(StorageBackendError);
        const msg = (err as Error).message;
        expect(msg).not.toContain('SECRET_BEARER');
        expect(msg).toContain('[REDACTED]');
      }

      // Token inside HTTP 200 { error } envelope
      const envelopeStore = new UpstashRedisStore(
        'https://demo.upstash.io',
        TOKEN,
        async () =>
          new Response(JSON.stringify({ error: `WRONGPASS invalid token ${TOKEN}` }), {
            status: 200,
          }),
      );
      try {
        await envelopeStore.getRoom('AB3K9M');
        expect.unreachable('Expected StorageBackendError for 200 error envelope');
      } catch (err) {
        expect(err).toBeInstanceOf(StorageBackendError);
        const msg = (err as Error).message;
        expect(msg).not.toContain(TOKEN);
        expect(msg).toBe('Upstash command error: WRONGPASS invalid token [REDACTED]');
      }

      // Empty token does NOT corrupt error snippet
      const emptyTokenStore = new UpstashRedisStore(
        'https://demo.upstash.io',
        '',
        async () => new Response('Bad Request', { status: 500 }),
      );
      try {
        await emptyTokenStore.getRoom('AB3K9M');
        expect.unreachable('Expected StorageBackendError for empty token HTTP 500');
      } catch (err) {
        expect(err).toBeInstanceOf(StorageBackendError);
        expect((err as Error).message).toBe('Upstash HTTP 500: Bad Request');
      }
    });

    it('strictly validates CAS versions, rejects non-object JSON payloads, guards non-finite maxMatches, and blocks __proto__ presence keys', async () => {
      const sampleRoom = makeSampleRoom('AB3K9M', 2);
      const roomJson = JSON.stringify(sampleRoom);

      const makeResultStore = (result: unknown) =>
        new UpstashRedisStore(
          'https://demo.upstash.io',
          'tok',
          async () => new Response(JSON.stringify({ result }), { status: 200 }),
        );

      // Invalid CAS success versions
      for (const badVersion of ['', '   ', null, undefined, 0, '0', -1, 1.5, 'NaN', true]) {
        await expect(
          makeResultStore([1, badVersion]).casUpdateRoom('AB3K9M', 1, sampleRoom, 60),
        ).rejects.toThrow(StorageBackendError);
      }

      // Invalid CAS conflict versions & non-object conflict room JSON
      for (const badVersion of ['', null, 0, -2, 1.5, 'NaN']) {
        await expect(
          makeResultStore([0, 'CONFLICT', badVersion, roomJson]).casUpdateRoom(
            'AB3K9M',
            1,
            sampleRoom,
            60,
          ),
        ).rejects.toThrow(StorageBackendError);
      }
      for (const badJson of ['null', '123', '[]', '"hello"']) {
        await expect(
          makeResultStore([0, 'CONFLICT', '5', badJson]).casUpdateRoom(
            'AB3K9M',
            1,
            sampleRoom,
            60,
          ),
        ).rejects.toThrow(StorageBackendError);
        await expect(makeResultStore(badJson).getRoom('AB3K9M')).rejects.toThrow(
          StorageBackendError,
        );
        await expect(makeResultStore(badJson).getMatchRecord('m1')).rejects.toThrow(
          StorageBackendError,
        );
      }

      // saveMatchAtomic guards NaN / Infinity maxMatches to MAX_ONLINE_MATCHES ('200')
      const sentCaps: unknown[] = [];
      const capStore = new UpstashRedisStore('https://demo.upstash.io', 'tok', async (_u, init) => {
        const args = JSON.parse(String(init?.body)) as unknown[];
        sentCaps.push(args[9]);
        return new Response(JSON.stringify({ result: 1 }), { status: 200 });
      });
      const { record, summary } = makeSampleMatch('online_AB3K9M_g99');
      expect(await capStore.saveMatchAtomic(record, summary, Number.NaN)).toBe(true);
      expect(await capStore.saveMatchAtomic(record, summary, Number.POSITIVE_INFINITY)).toBe(true);
      expect(await capStore.saveMatchAtomic(record, summary, Number.NEGATIVE_INFINITY)).toBe(true);
      expect(sentCaps).toEqual(['200', '200', '200']);

      // getPresenceMap blocks __proto__, constructor, prototype in both array & object HGETALL replies
      const validEntry = JSON.stringify({ lastSeenAt: 1000, awaySince: null });
      const arrayPresence = await makeResultStore([
        '__proto__',
        validEntry,
        'constructor',
        validEntry,
        'prototype',
        validEntry,
        'm1',
        validEntry,
      ]).getPresenceMap('AB3K9M');
      expect(Object.getPrototypeOf(arrayPresence)).toBe(Object.prototype);
      expect('lastSeenAt' in arrayPresence).toBe(false);
      expect(Object.keys(arrayPresence)).toEqual(['m1']);
      expect(arrayPresence.m1).toEqual({ lastSeenAt: 1000, awaySince: null });

      const objRaw = JSON.parse(
        `{"__proto__":${JSON.stringify(validEntry)},"constructor":${JSON.stringify(validEntry)},"m2":${JSON.stringify(validEntry)}}`,
      ) as Record<string, unknown>;
      const objPresence = await makeResultStore(objRaw).getPresenceMap('AB3K9M');
      expect(Object.getPrototypeOf(objPresence)).toBe(Object.prototype);
      expect('lastSeenAt' in objPresence).toBe(false);
      expect(Object.keys(objPresence)).toEqual(['m2']);
      expect(objPresence.m2).toEqual({ lastSeenAt: 1000, awaySince: null });
    });

    it('throws StorageBackendError when Upstash REST returns an HTTP 200 JSON array envelope', async () => {
      const arrayEnvelopeStore = new UpstashRedisStore(
        'https://demo.upstash.io',
        'tok',
        async () =>
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      );
      await expect(arrayEnvelopeStore.getRoom('AB3K9M')).rejects.toThrow(StorageBackendError);
      await expect(arrayEnvelopeStore.getRoom('AB3K9M')).rejects.toThrow(
        'Upstash Redis returned invalid envelope',
      );
    });
  });

  describe('UnconfiguredStore & Router Contract', () => {
    it('enforces UnconfiguredStore graceful behavior', async () => {
      const store = new UnconfiguredStore();
      expect(store.mode).toBe('unconfigured');
      expect(await store.listMatchSummaries(100)).toEqual([]);
      await expect(store.createRoomNx(makeSampleRoom(), 60)).rejects.toThrow(
        RedisNotConfiguredError,
      );
      await expect(store.getRoom('AB3K9M')).rejects.toThrow(RedisNotConfiguredError);
      await expect(store.getMatchRecord('m1')).rejects.toThrow(RedisNotConfiguredError);
    });

    it('routes health, matches, match detail, unknown 404, unconfigured 503, and M7 extension hooks', async () => {
      const mem = new MemoryStore();
      const { record, summary } = makeSampleMatch('online_AB3K9M_g1');
      await mem.saveMatchAtomic(record, summary);

      // Health in memory mode
      const hMem = await handleApiRequest(new Request('http://localhost/api/health'), {
        store: mem,
        now: () => 123_456,
      });
      expect(hMem.status).toBe(200);
      expect(hMem.headers.get('cache-control')).toBe(NO_STORE_HEADER);
      expect(await hMem.json()).toEqual({
        ok: true,
        storage: 'memory',
        onlineAvailable: true,
        serverNow: 123_456,
      });

      // Health in unconfigured mode
      const unconf = new UnconfiguredStore();
      const hUnconf = await handleApiRequest(new Request('http://localhost/api/health'), {
        store: unconf,
        now: () => 999,
      });
      expect(hUnconf.status).toBe(200);
      expect(await hUnconf.json()).toEqual({
        ok: true,
        storage: 'unconfigured',
        onlineAvailable: false,
        serverNow: 999,
      });

      // Matches in unconfigured mode returns 200 empty list (no noisy >=400 errors)
      const mUnconf = await handleApiRequest(new Request('http://localhost/api/matches'), {
        store: unconf,
      });
      expect(mUnconf.status).toBe(200);
      expect(await mUnconf.json()).toEqual({
        storage: 'unconfigured',
        onlineAvailable: false,
        matches: [],
      });

      // Match detail in unconfigured mode returns 503 REDIS_NOT_CONFIGURED
      const dUnconf = await handleApiRequest(
        new Request('http://localhost/api/matches/online_AB3K9M_g1'),
        { store: unconf },
      );
      expect(dUnconf.status).toBe(503);
      expect(await dUnconf.json()).toMatchObject({
        error: { code: 'REDIS_NOT_CONFIGURED' },
      });

      // Matches limit clamping
      const listSpy = vi.spyOn(mem, 'listMatchSummaries');
      for (const [query, expected] of [
        ['', 100],
        ['?limit=0', 1],
        ['?limit=-5', 1],
        ['?limit=500', 200],
        ['?limit=abc', 100],
      ] as const) {
        const res = await handleApiRequest(
          new Request(`http://localhost/api/matches${query}`),
          { store: mem },
        );
        expect(res.status).toBe(200);
        expect(listSpy).toHaveBeenLastCalledWith(expected);
      }

      // Match detail 200, 404, and 400 invalid URI encoding
      const dOk = await handleApiRequest(
        new Request('http://localhost/api/matches/online_AB3K9M_g1'),
        { store: mem },
      );
      expect(dOk.status).toBe(200);
      expect((await dOk.json()) as { match: MatchRecord }).toEqual({ match: record });

      const d404 = await handleApiRequest(
        new Request('http://localhost/api/matches/does_not_exist'),
        { store: mem },
      );
      expect(d404.status).toBe(404);
      expect(await d404.json()).toMatchObject({ error: { code: 'MATCH_NOT_FOUND' } });

      const d400 = await handleApiRequest(
        new Request('http://localhost/api/matches/%E0%A4%A'),
        { store: mem },
      );
      expect(d400.status).toBe(400);
      expect(await d400.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });

      // Unknown API endpoint returns JSON 404 (not HTML)
      const unknown = await handleApiRequest(new Request('http://localhost/api/unknown'), {
        store: mem,
      });
      expect(unknown.status).toBe(404);
      expect(unknown.headers.get('cache-control')).toBe(NO_STORE_HEADER);
      expect(await unknown.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });

      // Method not allowed returns 405
      const m405 = await handleApiRequest(
        new Request('http://localhost/api/health', { method: 'POST' }),
        { store: mem },
      );
      expect(m405.status).toBe(405);
      expect(await m405.json()).toMatchObject({ error: { code: 'METHOD_NOT_ALLOWED' } });

      // Defensive pathname normalization (including __path=api/health without leading slash and unsafe guards)
      expect(
        normalizeApiPathname(new Request('http://localhost/api?__path=health')).pathname,
      ).toBe('/api/health');
      expect(
        normalizeApiPathname(new Request('http://localhost/api?__path=api/health')).pathname,
      ).toBe('/api/health');
      expect(
        normalizeApiPathname(new Request('http://localhost/api?__path=/api/health')).pathname,
      ).toBe('/api/health');
      expect(
        normalizeApiPathname(new Request('http://localhost/api?__path=api/rooms/AB3K9M')).pathname,
      ).toBe('/api/rooms/AB3K9M');
      expect(
        normalizeApiPathname(new Request('http://localhost/api/health/')).pathname,
      ).toBe('/api/health');
      expect(
        normalizeApiPathname(
          new Request('http://localhost/api/index', {
            headers: { 'x-matched-path': '/api/matches' },
          }),
        ).pathname,
      ).toBe('/api/matches');

      // Malicious __path values stay 404 NOT_FOUND
      for (const badPath of ['//evil.com', '../../etc/passwd', 'http://evil.com/api/health', 'api/health\r\nx']) {
        const res = await handleApiRequest(
          new Request(`http://localhost/api?__path=${encodeURIComponent(badPath)}`),
          { store: mem },
        );
        expect(res.status).toBe(404);
      }

      // HEAD responses strip body uniformly across 200, 400, 404, 405, 500, and 503
      const brokenStore = new UpstashRedisStore('https://demo.upstash.io', 'tok', async () => {
        throw new TypeError('boom');
      });
      const headCases: Array<{ res: Response; status: number; allow?: string }> = [
        {
          res: await apiEntry.fetch(new Request('http://localhost/api/health', { method: 'HEAD' })),
          status: 200,
        },
        {
          res: await handleApiRequest(
            new Request('http://localhost/api/matches/%E0%A4%A', { method: 'HEAD' }),
            { store: mem },
          ),
          status: 400,
        },
        {
          res: await apiEntry.fetch(
            new Request('http://localhost/api/nonexistent', { method: 'HEAD' }),
          ),
          status: 404,
        },
        {
          res: await handleApiRequest(new Request('http://localhost/api/rooms', { method: 'HEAD' }), {
            store: mem,
          }),
          status: 405,
          allow: 'POST',
        },
        {
          res: await handleApiRequest(
            new Request('http://localhost/api/matches/m1', { method: 'HEAD' }),
            { store: brokenStore },
          ),
          status: 500,
        },
        {
          res: await handleApiRequest(
            new Request('http://localhost/api/matches/m1', { method: 'HEAD' }),
            { store: unconf },
          ),
          status: 503,
        },
      ];
      for (const tc of headCases) {
        expect(tc.res.status).toBe(tc.status);
        expect(tc.res.headers.get('cache-control')).toBe(NO_STORE_HEADER);
        if (tc.allow) {
          expect(tc.res.headers.get('allow')).toBe(tc.allow);
        }
        expect(await tc.res.text()).toBe('');
      }

      // readJsonBody supports text/plain (sendBeacon) & rejects malformed JSON
      const beaconOk = await readJsonBody(
        new Request('http://localhost/api/rooms/AB3K9M', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ op: 'ping_away', sessionToken: 't1' }),
        }),
      );
      expect(beaconOk.ok).toBe(true);

      const badJson = await readJsonBody(
        new Request('http://localhost/api/rooms/AB3K9M', {
          method: 'POST',
          body: '{broken',
        }),
      );
      expect(badJson.ok).toBe(false);
      if (!badJson.ok) {
        expect(badJson.response.status).toBe(400);
      }

      // M7 custom handler dispatch extension point
      const customRoomRes = await handleApiRequest(
        new Request('http://localhost/api/rooms/AB3K9M', { method: 'GET' }),
        {
          store: mem,
          handlers: {
            getRoom: async (_ctx, code) => jsonResponse({ interceptedCode: code }, 200),
          },
        },
      );
      expect(customRoomRes.status).toBe(200);
      expect(await customRoomRes.json()).toEqual({ interceptedCode: 'AB3K9M' });
    });
  });

  describe('Node Adapter & Vite Dev/Preview Plugin', () => {
    it('handles GET, HEAD, non-API passthrough, JSON & text/plain POST, 413 cap, and multi-Set-Cookie over real HTTP', async () => {
      expect(isApiRequestUrl('/api')).toBe(true);
      expect(isApiRequestUrl('/api/health')).toBe(true);
      expect(isApiRequestUrl('/api?__path=health')).toBe(true);
      expect(isApiRequestUrl('/api-docs')).toBe(false);
      expect(isApiRequestUrl('/')).toBe(false);

      const middleware = createNodeApiMiddleware(
        async (req) => {
          const url = new URL(req.url);
          if (url.pathname === '/api/echo' && req.method === 'POST') {
            const text = await req.text();
            const headers = new Headers({
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': NO_STORE_HEADER,
            });
            headers.append('Set-Cookie', 'a=1; Path=/');
            headers.append('Set-Cookie', 'b=2; Path=/');
            return new Response(
              JSON.stringify({
                contentType: req.headers.get('content-type'),
                parsed: JSON.parse(text),
              }),
              { status: 200, headers },
            );
          }
          return handleApiRequest(req);
        },
        { maxBodyBytes: 64 },
      );

      const server = http.createServer((req, res) => {
        middleware(req, res, () => {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end('<html>SPA_FALLBACK</html>');
        });
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind ephemeral port');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // GET /api/health
        const rHealth = await fetch(`${baseUrl}/api/health`);
        expect(rHealth.status).toBe(200);
        expect(rHealth.headers.get('cache-control')).toBe(NO_STORE_HEADER);
        expect(((await rHealth.json()) as { ok: boolean }).ok).toBe(true);

        // HEAD /api/health
        const rHead = await fetch(`${baseUrl}/api/health`, { method: 'HEAD' });
        expect(rHead.status).toBe(200);
        expect(await rHead.text()).toBe('');

        // Non-API passthrough (/ and /api-docs)
        const rRoot = await fetch(`${baseUrl}/`);
        expect(rRoot.status).toBe(200);
        expect(await rRoot.text()).toContain('SPA_FALLBACK');
        const rDocs = await fetch(`${baseUrl}/api-docs`);
        expect(rDocs.status).toBe(200);
        expect(await rDocs.text()).toContain('SPA_FALLBACK');

        // POST text/plain (sendBeacon) + multi-value Set-Cookie forwarding
        const rBeacon = await fetch(`${baseUrl}/api/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ op: 'ping_away' }),
        });
        expect(rBeacon.status).toBe(200);
        expect(rBeacon.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
        expect(await rBeacon.json()).toEqual({
          contentType: 'text/plain',
          parsed: { op: 'ping_away' },
        });

        // Oversized body -> 413
        const rTooLarge = await fetch(`${baseUrl}/api/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: 'x'.repeat(200) }),
        });
        expect(rTooLarge.status).toBe(413);
        expect(rTooLarge.headers.get('cache-control')).toBe(NO_STORE_HEADER);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve())),
        );
      }
    });

    it('mounts middleware on BOTH configureServer and configurePreviewServer in wallgoApiPlugin', () => {
      const plugin = wallgoApiPlugin();
      expect(plugin.name).toBe('wallgo-api-middleware');
      expect(typeof plugin.configureServer).toBe('function');
      expect(typeof plugin.configurePreviewServer).toBe('function');

      const devUse = vi.fn();
      const previewUse = vi.fn();

      const devHook = plugin.configureServer;
      if (typeof devHook === 'function') {
        devHook({ middlewares: { use: devUse } } as unknown as ViteDevServer);
      }
      const previewHook = plugin.configurePreviewServer;
      if (typeof previewHook === 'function') {
        previewHook({ middlewares: { use: previewUse } } as unknown as PreviewServer);
      }

      expect(devUse).toHaveBeenCalledTimes(1);
      expect(previewUse).toHaveBeenCalledTimes(1);
    });
  });
});
