import {
  MAX_ONLINE_MATCHES,
  type ApiErrorBody,
  type ApiErrorCode,
  type HealthResponse,
} from '../src/shared/onlineTypes.js';
import { handleGetMatch, handleListMatches } from './matchService.js';
import { defaultRoomHandlers } from './roomService.js';
import {
  RedisNotConfiguredError,
  StorageBackendError,
  getStore,
  type StorageAdapter,
} from './store/index.js';
import type { EnvMap } from './types.js';

export const NO_STORE_HEADER = 'no-store, max-age=0';
const DEFAULT_MATCHES_LIMIT = 100;

export type ExtraHeadersInit = Headers | Record<string, string> | Array<[string, string]>;

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders?: ExtraHeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', NO_STORE_HEADER);
  return new Response(JSON.stringify(data), { status, headers });
}

export function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra?: Record<string, unknown>,
  extraHeaders?: ExtraHeadersInit,
): Response {
  const body: ApiErrorBody & Record<string, unknown> = {
    ...(extra ?? {}),
    error: { code, message },
  };
  return jsonResponse(body, status, extraHeaders);
}

export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return {
      ok: false,
      response: errorResponse(400, 'INVALID_REQUEST', 'Failed to read request body'),
    };
  }
  if (raw.trim().length === 0) {
    return {
      ok: false,
      response: errorResponse(400, 'INVALID_REQUEST', 'Request body must be valid JSON'),
    };
  }
  try {
    return { ok: true, body: JSON.parse(raw) as unknown };
  } catch {
    return {
      ok: false,
      response: errorResponse(400, 'INVALID_REQUEST', 'Request body contains malformed JSON'),
    };
  }
}

function stripTrailingSlashes(pathname: string): string {
  if (pathname.length <= 1) {
    return pathname;
  }
  return pathname.replace(/\/+$/, '') || '/';
}

function isSafeQueryPath(raw: string): boolean {
  if (raw.startsWith('//')) {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(raw)) {
    return false;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    return false;
  }
  if (/(?:^|\/)\.\.(?:\/|$)/.test(raw)) {
    return false;
  }
  return true;
}

/**
 * Normalizes the incoming API pathname, including defensive fallbacks for
 * Vercel rewrite query (`?__path=`) or `x-matched-path` headers.
 */
export function normalizeApiPathname(request: Request): { url: URL; pathname: string } {
  const url = new URL(request.url, 'http://localhost');
  let pathname = stripTrailingSlashes(url.pathname);

  if (pathname === '/api' || pathname === '/api/index') {
    const queryPath = url.searchParams.get('__path')?.trim();
    if (queryPath && queryPath.length > 0) {
      if (isSafeQueryPath(queryPath)) {
        const cleaned = queryPath
          .replace(/^\/+/, '')
          .replace(/^api(?:\/+|$)/, '')
          .replace(/^\/+/, '');
        pathname = stripTrailingSlashes(cleaned.length > 0 ? `/api/${cleaned}` : '/api');
      }
    } else {
      const matchedPath = request.headers.get('x-matched-path')?.trim();
      if (matchedPath && matchedPath.startsWith('/api/')) {
        const normalizedMatched = stripTrailingSlashes(matchedPath);
        if (normalizedMatched !== '/api/index') {
          pathname = normalizedMatched;
        }
      }
    }
  }

  return { url, pathname };
}

function parseMatchesLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (raw === null || raw.trim().length === 0) {
    return DEFAULT_MATCHES_LIMIT;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MATCHES_LIMIT;
  }
  return Math.max(1, Math.min(MAX_ONLINE_MATCHES, Math.floor(parsed)));
}

function stripBodyForHead(method: string, response: Response): Response {
  if (method !== 'HEAD') {
    return response;
  }
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}

export interface ApiRouteContext {
  request: Request;
  url: URL;
  pathname: string;
  store: StorageAdapter;
  now: () => number;
  env: EnvMap;
}

export interface ApiRouteHandlers {
  createRoom?: (ctx: ApiRouteContext) => Promise<Response>;
  getRoom?: (ctx: ApiRouteContext, rawCode: string) => Promise<Response>;
  postRoomCommand?: (ctx: ApiRouteContext, rawCode: string) => Promise<Response>;
  listMatches?: (ctx: ApiRouteContext, limit: number) => Promise<Response>;
  getMatch?: (ctx: ApiRouteContext, matchId: string) => Promise<Response>;
}

export interface HandleApiRequestOptions {
  store?: StorageAdapter;
  now?: () => number;
  env?: EnvMap;
  handlers?: ApiRouteHandlers;
}

async function routeApiRequest(
  request: Request,
  method: string,
  options: HandleApiRequestOptions,
): Promise<Response> {
  try {
    const env = options.env ?? process.env;
    const store = options.store ?? getStore(env);
    const now = options.now ?? (() => Date.now());
    const { url, pathname } = normalizeApiPathname(request);
    const ctx: ApiRouteContext = { request, url, pathname, store, now, env };

    // 1. GET /api/health
    if (pathname === '/api/health') {
      if (method !== 'GET' && method !== 'HEAD') {
        return errorResponse(
          405,
          'METHOD_NOT_ALLOWED',
          `Method ${method} not allowed for /api/health`,
          undefined,
          { Allow: 'GET, HEAD' },
        );
      }
      const body: HealthResponse = {
        ok: true,
        storage: store.mode,
        onlineAvailable: store.mode !== 'unconfigured',
        serverNow: now(),
      };
      return jsonResponse(body, 200);
    }

    // 2. GET /api/matches
    if (pathname === '/api/matches') {
      if (method !== 'GET' && method !== 'HEAD') {
        return errorResponse(
          405,
          'METHOD_NOT_ALLOWED',
          `Method ${method} not allowed for /api/matches`,
          undefined,
          { Allow: 'GET, HEAD' },
        );
      }
      const limit = parseMatchesLimit(url);
      if (options.handlers?.listMatches) {
        return await options.handlers.listMatches(ctx, limit);
      }
      return await handleListMatches(ctx, limit);
    }

    // 3. GET /api/matches/:id
    if (pathname.startsWith('/api/matches/')) {
      const encodedId = pathname.slice('/api/matches/'.length);
      if (encodedId.length === 0 || encodedId.includes('/')) {
        return errorResponse(404, 'NOT_FOUND', `Unknown API endpoint: ${pathname}`);
      }
      if (method !== 'GET' && method !== 'HEAD') {
        return errorResponse(
          405,
          'METHOD_NOT_ALLOWED',
          `Method ${method} not allowed for /api/matches/:id`,
          undefined,
          { Allow: 'GET, HEAD' },
        );
      }
      let matchId: string;
      try {
        matchId = decodeURIComponent(encodedId);
      } catch {
        return errorResponse(400, 'INVALID_REQUEST', 'Invalid match ID encoding');
      }
      if (options.handlers?.getMatch) {
        return await options.handlers.getMatch(ctx, matchId);
      }
      return await handleGetMatch(ctx, matchId);
    }

    // 4. POST /api/rooms
    if (pathname === '/api/rooms') {
      if (method !== 'POST') {
        return errorResponse(
          405,
          'METHOD_NOT_ALLOWED',
          `Method ${method} not allowed for /api/rooms`,
          undefined,
          { Allow: 'POST' },
        );
      }
      if (options.handlers?.createRoom) {
        return await options.handlers.createRoom(ctx);
      }
      if (store.mode === 'unconfigured') {
        throw new RedisNotConfiguredError();
      }
      return await defaultRoomHandlers.createRoom(ctx);
    }

    // 5. GET | HEAD | POST /api/rooms/:code
    if (pathname.startsWith('/api/rooms/')) {
      const encodedCode = pathname.slice('/api/rooms/'.length);
      if (encodedCode.length === 0 || encodedCode.includes('/')) {
        return errorResponse(404, 'NOT_FOUND', `Unknown API endpoint: ${pathname}`);
      }
      if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
        return errorResponse(
          405,
          'METHOD_NOT_ALLOWED',
          `Method ${method} not allowed for /api/rooms/:code`,
          undefined,
          { Allow: 'GET, HEAD, POST' },
        );
      }
      let rawCode: string;
      try {
        rawCode = decodeURIComponent(encodedCode);
      } catch {
        return errorResponse(400, 'INVALID_REQUEST', 'Invalid room code encoding');
      }
      if (method === 'GET' || method === 'HEAD') {
        if (options.handlers?.getRoom) {
          return await options.handlers.getRoom(ctx, rawCode);
        }
        if (store.mode === 'unconfigured') {
          throw new RedisNotConfiguredError();
        }
        return await defaultRoomHandlers.getRoom(ctx, rawCode);
      }
      if (options.handlers?.postRoomCommand) {
        return await options.handlers.postRoomCommand(ctx, rawCode);
      }
      if (store.mode === 'unconfigured') {
        throw new RedisNotConfiguredError();
      }
      return await defaultRoomHandlers.postRoomCommand(ctx, rawCode);
    }

    // 6. Fallback JSON 404 for unknown /api/* paths
    return errorResponse(404, 'NOT_FOUND', `Unknown API endpoint: ${pathname}`);
  } catch (err) {
    if (err instanceof RedisNotConfiguredError) {
      return errorResponse(503, 'REDIS_NOT_CONFIGURED', err.message);
    }
    if (err instanceof StorageBackendError) {
      return errorResponse(500, 'INTERNAL_ERROR', 'Storage backend error');
    }
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

export async function handleApiRequest(
  request: Request,
  options: HandleApiRequestOptions = {},
): Promise<Response> {
  const method = request.method.toUpperCase();
  const response = await routeApiRequest(request, method, options);
  return stripBodyForHead(method, response);
}
