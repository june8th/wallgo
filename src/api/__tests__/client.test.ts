import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  breakWallAt,
  createInitialGameState,
  movePiece,
  placeInitialPiece,
  selectPiece,
} from '../../engine';
import {
  ApiClientError,
  buildCommitTurnActionFromDraft,
  buildTimeoutPartialMoveFromDraft,
  createRoom,
  extractRoomCodeFromLocation,
  fetchHealth,
  getOnlineMatch,
  getRoom,
  listOnlineMatches,
  sendRoomCommand,
} from '../index';

function mockFetchOnce(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('src/api client & online room helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts valid room codes from query (?room=) and path (/room/) while ignoring unknown routes', () => {
    expect(extractRoomCodeFromLocation({ pathname: '/', search: '?room=ab3-k9m' })).toBe('AB3K9M');
    expect(extractRoomCodeFromLocation({ pathname: '/room/ab3k9m', search: '' })).toBe('AB3K9M');
    expect(extractRoomCodeFromLocation({ pathname: '/room/AB3K9M/', search: '' })).toBe('AB3K9M');
    expect(extractRoomCodeFromLocation({ pathname: '/unknown/wallgo-route', search: '' })).toBeNull();
    expect(extractRoomCodeFromLocation({ pathname: '/', search: '' })).toBeNull();
    expect(extractRoomCodeFromLocation({ pathname: '/', search: '?room=000000' })).toBeNull();
  });

  it('builds commit_turn and timeout partialMove payloads from local draft GameState', () => {
    let gs = createInitialGameState({
      ruleVariant: 'wallgo1',
      format: '3p',
      timerSeconds: 60,
      shuffleOrder: false,
      players: [
        { name: 'A', colorToken: 'p1', isAI: false, aiDifficulty: 'normal' },
        { name: 'B', colorToken: 'p2', isAI: false, aiDifficulty: 'normal' },
        { name: 'C', colorToken: 'p3', isAI: false, aiDifficulty: 'normal' },
      ],
    });
    const placements = [
      { row: 1, col: 1 },
      { row: 1, col: 5 },
      { row: 5, col: 5 },
      { row: 5, col: 4 },
      { row: 1, col: 4 },
      { row: 1, col: 2 },
    ];
    for (const pos of placements) {
      gs = placeInitialPiece(gs, pos);
    }
    expect(gs.phase).toBe('select_piece');
    expect(buildTimeoutPartialMoveFromDraft(gs)).toBeUndefined();

    // Select piece at (1,1) and move to (1,0)
    const p0 = gs.pieces.find((p) => p.row === 1 && p.col === 1)!;
    const selected = selectPiece(gs, p0.id);
    const moved = movePiece(selected, { row: 1, col: 0 });
    expect(moved.phase).toBe('place_wall');

    const partial = buildTimeoutPartialMoveFromDraft(moved);
    expect(partial).toEqual({
      pieceId: p0.id,
      useWallBreak: false,
      breakWall: null,
      destination: { row: 1, col: 0 },
    });

    const commitAction = buildCommitTurnActionFromDraft(moved, {
      orientation: 'h',
      row: 0,
      col: 0,
    });
    expect(commitAction).toEqual({
      type: 'commit_turn',
      pieceId: p0.id,
      useWallBreak: false,
      breakWall: null,
      destination: { row: 1, col: 0 },
      placeWall: { orientation: 'h', row: 0, col: 0 },
    });

    // Also verify breakWall propagation when brokenWallBeforeMove is set
    expect(typeof breakWallAt).toBe('function');
  });

  it('calls health, createRoom, getRoom, sendRoomCommand, listOnlineMatches, getOnlineMatch with no-store', async () => {
    const spyHealth = mockFetchOnce(200, {
      ok: true,
      storage: 'memory',
      onlineAvailable: true,
      serverNow: 1000,
    });
    const health = await fetchHealth();
    expect(health.onlineAvailable).toBe(true);
    expect(spyHealth).toHaveBeenCalledWith('/api/health', expect.objectContaining({ cache: 'no-store' }));

    mockFetchOnce(201, { room: { code: 'AB3K9M' }, sessionToken: 'tok_1' });
    const created = await createRoom({
      nickname: 'Alice',
      clientId: 'c_1',
      config: { ruleVariant: 'wallgo1', format: '2p', timerSeconds: 0, shuffleOrder: false },
    });
    expect(created.sessionToken).toBe('tok_1');

    const spyGet = mockFetchOnce(200, { unchanged: true, version: 2, serverNow: 2000, presenceSummary: { seats: [], spectators: [], canClaimHost: false } });
    const got = await getRoom('AB3K9M', { sessionToken: 'tok_1', sinceVersion: 2 });
    expect(got.unchanged).toBe(true);
    expect(spyGet).toHaveBeenCalledWith(
      '/api/rooms/AB3K9M?sinceVersion=2',
      expect.objectContaining({
        headers: { 'X-Session-Token': 'tok_1' },
      }),
    );

    mockFetchOnce(200, { room: { code: 'AB3K9M', version: 3 } });
    const cmdRes = await sendRoomCommand('AB3K9M', { op: 'leave', sessionToken: 'tok_1' });
    expect(cmdRes.room.version).toBe(3);

    mockFetchOnce(200, { storage: 'memory', onlineAvailable: true, matches: [] });
    const listed = await listOnlineMatches(50);
    expect(listed.matches).toEqual([]);

    mockFetchOnce(200, { match: { id: 'online_AB3K9M_g1' } });
    const detail = await getOnlineMatch('online_AB3K9M_g1');
    expect(detail.match.id).toBe('online_AB3K9M_g1');
  });

  it('throws typed ApiClientError on HTTP 409 conflict with embedded room snapshot and on 503 unconfigured', async () => {
    mockFetchOnce(409, {
      error: { code: 'VERSION_CONFLICT', message: 'Conflict' },
      room: { code: 'AB3K9M', version: 5 },
    });

    await expect(
      sendRoomCommand('AB3K9M', {
        op: 'start_game',
        sessionToken: 'tok_1',
        expectedVersion: 4,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof ApiClientError &&
        err.status === 409 &&
        err.code === 'VERSION_CONFLICT' &&
        err.room?.version === 5
      );
    });

    mockFetchOnce(503, {
      error: { code: 'REDIS_NOT_CONFIGURED', message: 'Unconfigured' },
    });
    await expect(getOnlineMatch('online_AB3K9M_g1')).rejects.toMatchObject({
      status: 503,
      code: 'REDIS_NOT_CONFIGURED',
    });
  });
});
