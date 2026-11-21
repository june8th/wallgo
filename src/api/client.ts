import type {
  ApiErrorBody,
  ApiErrorCode,
  CreateRoomRequest,
  CreateRoomResponse,
  GetRoomResponse,
  HealthResponse,
  MatchDetailResponse,
  MatchesListResponse,
  PublicRoomSnapshot,
  RoomCommand,
  RoomCommandResponse,
} from '../shared';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'NETWORK_ERROR';
  readonly room?: PublicRoomSnapshot;

  constructor(
    status: number,
    code: ApiErrorCode | 'NETWORK_ERROR',
    message: string,
    room?: PublicRoomSnapshot,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.room = room;
  }
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      cache: 'no-store',
    });
  } catch (err) {
    throw new ApiClientError(
      0,
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'Network request failed',
    );
  }

  const parsed = await parseJsonSafe(res);

  if (!res.ok) {
    const body = (parsed && typeof parsed === 'object' ? parsed : null) as
      | Partial<ApiErrorBody>
      | null;
    const code: ApiErrorCode | 'NETWORK_ERROR' =
      body?.error && typeof body.error.code === 'string'
        ? body.error.code
        : res.status === 503
          ? 'REDIS_NOT_CONFIGURED'
          : 'INTERNAL_ERROR';
    const message =
      body?.error && typeof body.error.message === 'string'
        ? body.error.message
        : `Request failed with HTTP ${res.status}`;
    throw new ApiClientError(res.status, code, message, body?.room);
  }

  return parsed as T;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/api/health', { method: 'GET' });
}

export async function createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
  return requestJson<CreateRoomResponse>('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function getRoom(
  code: string,
  options?: { sessionToken?: string; sinceVersion?: number },
): Promise<GetRoomResponse> {
  const params = new URLSearchParams();
  if (
    options?.sinceVersion !== undefined &&
    Number.isInteger(options.sinceVersion) &&
    options.sinceVersion > 0
  ) {
    params.set('sinceVersion', String(options.sinceVersion));
  }
  const query = params.toString();
  const url = `/api/rooms/${encodeURIComponent(code)}${query ? `?${query}` : ''}`;

  const headers: Record<string, string> = {};
  if (options?.sessionToken) {
    headers['X-Session-Token'] = options.sessionToken;
  }

  return requestJson<GetRoomResponse>(url, {
    method: 'GET',
    headers,
  });
}

export async function sendRoomCommand(
  code: string,
  command: RoomCommand,
): Promise<RoomCommandResponse> {
  return requestJson<RoomCommandResponse>(`/api/rooms/${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
}

export function sendPingAwayBeacon(code: string, sessionToken: string): boolean {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.sendBeacon !== 'function' ||
    !code ||
    !sessionToken
  ) {
    return false;
  }
  try {
    const payload = JSON.stringify({ op: 'ping_away', sessionToken });
    const blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
    return navigator.sendBeacon(`/api/rooms/${encodeURIComponent(code)}`, blob);
  } catch {
    return false;
  }
}

export async function listOnlineMatches(limit = 100): Promise<MatchesListResponse> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  return requestJson<MatchesListResponse>(`/api/matches?limit=${safeLimit}`, {
    method: 'GET',
  });
}

export async function getOnlineMatch(matchId: string): Promise<MatchDetailResponse> {
  return requestJson<MatchDetailResponse>(`/api/matches/${encodeURIComponent(matchId)}`, {
    method: 'GET',
  });
}
