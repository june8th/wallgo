import { describe, expect, it } from 'vitest';
import {
  MAX_ROOM_SESSION_CACHE,
  ROOM_CODE_ALPHABET,
  STORAGE_KEY_PROFILE,
  STORAGE_KEY_ROOM_SESSIONS,
} from '../../shared';
import {
  getOrCreateProfile,
  getRoomSession,
  getSavedNickname,
  getSavedProfile,
  listRoomSessions,
  removeRoomSession,
  saveProfileNickname,
  saveRoomSession,
} from '../profile';

function createMockStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function createThrowingStorage(): Storage {
  const fail = () => {
    throw new DOMException('Storage disabled', 'SecurityError');
  };
  return {
    get length() {
      return 0;
    },
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}

function makeValidCode(n: number): string {
  const base = ROOM_CODE_ALPHABET.length;
  let value = n + 1000;
  let out = '';
  for (let i = 0; i < 6; i++) {
    out = ROOM_CODE_ALPHABET[value % base] + out;
    value = Math.floor(value / base);
  }
  return out;
}

describe('profile storage (wallgo.profile)', () => {
  it('keeps fresh contexts unset without mutating storage', () => {
    const storage = createMockStorage();
    expect(getSavedProfile(storage)).toBeNull();
    expect(getSavedNickname(storage)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it('creates, persists, and reloads clientId + normalized nickname', () => {
    const storage = createMockStorage();
    const created = getOrCreateProfile(storage, 1000);
    expect(created.clientId).toMatch(/^c_/);
    expect(created.nickname).toBe('');
    expect(storage.getItem(STORAGE_KEY_PROFILE)).not.toBeNull();

    const reloaded = getOrCreateProfile(storage, 2000);
    expect(reloaded.clientId).toBe(created.clientId);

    const saved = saveProfileNickname('  민지\n\t  ', storage, 3000);
    expect(saved.clientId).toBe(created.clientId);
    expect(saved.nickname).toBe('민지');
    expect(saved.updatedAt).toBe(3000);
    expect(getSavedNickname(storage)).toBe('민지');

    // Unicode 12-codepoint clamp
    const longNick = saveProfileNickname('가나다라마바사아자차카타파하', storage, 4000);
    expect(Array.from(longNick.nickname)).toHaveLength(12);
    expect(longNick.nickname).toBe('가나다라마바사아자차카타');

    // Clearing nickname resets getSavedNickname() back to null while preserving clientId
    const cleared = saveProfileNickname('   ', storage, 5000);
    expect(cleared.clientId).toBe(created.clientId);
    expect(cleared.nickname).toBe('');
    expect(getSavedNickname(storage)).toBeNull();
  });

  it('recovers cleanly from corrupt JSON and missing clientId', () => {
    const corrupt = createMockStorage({ [STORAGE_KEY_PROFILE]: '{not-valid-json' });
    expect(getSavedProfile(corrupt)).toBeNull();
    expect(getSavedNickname(corrupt)).toBeNull();
    const healed = getOrCreateProfile(corrupt, 1234);
    expect(healed.clientId).toMatch(/^c_/);

    const missingId = createMockStorage({
      [STORAGE_KEY_PROFILE]: JSON.stringify({ nickname: 'Alice', updatedAt: 100 }),
    });
    expect(getSavedProfile(missingId)).toBeNull();
  });

  it('never throws under Safari Private Mode SecurityError', () => {
    const blocked = createThrowingStorage();
    expect(() => getSavedProfile(blocked)).not.toThrow();
    expect(() => getSavedNickname(blocked)).not.toThrow();
    const profile = getOrCreateProfile(blocked, 100);
    expect(profile.clientId).toMatch(/^c_/);
    const updated = saveProfileNickname('Bob', blocked, 200);
    expect(updated.nickname).toBe('Bob');
  });
});

describe('room session LRU cache (wallgo.roomSessions)', () => {
  it('normalizes room codes, rejects invalid codes, and removes entries cleanly', () => {
    const storage = createMockStorage();
    saveRoomSession(' ab3-k9m ', 'tok_1', storage, 1000);
    expect(getRoomSession('ab3k9m', storage)).toEqual({
      sessionToken: 'tok_1',
      savedAt: 1000,
    });

    // Invalid code containing ambiguous characters 0, O, 1, I is ignored
    saveRoomSession('0O1IL2', 'tok_bad', storage, 2000);
    expect(listRoomSessions(storage)).toHaveLength(1);

    removeRoomSession('AB3K9M', storage);
    expect(getRoomSession('AB3K9M', storage)).toBeNull();
    expect(listRoomSessions(storage)).toHaveLength(0);
  });

  it('enforces LRU cap of MAX_ROOM_SESSION_CACHE (20) and refreshes touched entries', () => {
    const storage = createMockStorage();
    const codes = Array.from({ length: 25 }, (_, i) => makeValidCode(i));

    for (let i = 0; i < 20; i++) {
      saveRoomSession(codes[i], `tok_${i}`, storage, 1000 + i);
    }
    expect(listRoomSessions(storage)).toHaveLength(MAX_ROOM_SESSION_CACHE);

    // Touch the oldest entry (codes[0]) so codes[1] becomes the LRU victim
    saveRoomSession(codes[0], 'tok_0_refreshed', storage, 5000);

    for (let i = 20; i < 25; i++) {
      saveRoomSession(codes[i], `tok_${i}`, storage, 2000 + i);
    }

    const retained = listRoomSessions(storage);
    expect(retained).toHaveLength(MAX_ROOM_SESSION_CACHE);
    // Touched codes[0] must survive; codes[1..5] must be evicted
    expect(getRoomSession(codes[0], storage)?.sessionToken).toBe('tok_0_refreshed');
    for (let i = 1; i <= 5; i++) {
      expect(getRoomSession(codes[i], storage)).toBeNull();
    }
    for (let i = 20; i < 25; i++) {
      expect(getRoomSession(codes[i], storage)?.sessionToken).toBe(`tok_${i}`);
    }
  });

  it('ignores prototype-pollution keys and malformed entries in persisted JSON', () => {
    const validCode = makeValidCode(42);
    const storage = createMockStorage({
      [STORAGE_KEY_ROOM_SESSIONS]: JSON.stringify({
        __proto__: { sessionToken: 'evil', savedAt: 9999 },
        constructor: { sessionToken: 'evil', savedAt: 9999 },
        INVALID: { sessionToken: 'bad', savedAt: 9999 },
        [validCode]: { sessionToken: 'good_tok', savedAt: 1234 },
      }),
    });

    const entries = listRoomSessions(storage);
    expect(entries).toEqual([
      { roomCode: validCode, sessionToken: 'good_tok', savedAt: 1234 },
    ]);
  });
});
