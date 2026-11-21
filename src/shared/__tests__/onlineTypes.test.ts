import { describe, expect, it } from 'vitest';
import {
  NICKNAME_MAX_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_CODE_REGEX,
  ROOM_TTL_ACTIVE_SECONDS,
  ROOM_TTL_FINISHED_SECONDS,
  STORAGE_KEY_LOCAL_MATCHES,
  STORAGE_KEY_LOCALE,
  STORAGE_KEY_PROFILE,
  STORAGE_KEY_ROOM_SESSIONS,
  isValidRoomCode,
  normalizeNickname,
  normalizeRoomCode,
  parseRoomCode,
} from '../index.js';

describe('src/shared/onlineTypes contracts & helpers', () => {
  it('freezes authoritative dotted localStorage keys from PROJECT.md §1', () => {
    expect(STORAGE_KEY_LOCALE).toBe('wallgo.locale');
    expect(STORAGE_KEY_PROFILE).toBe('wallgo.profile');
    expect(STORAGE_KEY_ROOM_SESSIONS).toBe('wallgo.roomSessions');
    expect(STORAGE_KEY_LOCAL_MATCHES).toBe('wallgo.localMatches');
  });

  it('defines an unbiased 32-char unambiguous room code alphabet (no 0/O/1/I)', () => {
    expect(ROOM_CODE_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    expect(ROOM_CODE_ALPHABET.length).toBe(32);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(32);
    expect(ROOM_CODE_LENGTH).toBe(6);
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[0O1I]/);
    expect(ROOM_TTL_ACTIVE_SECONDS).toBe(21_600);
    expect(ROOM_TTL_FINISHED_SECONDS).toBe(7_200);
  });

  it('normalizes and validates room codes strictly (V2-E01)', () => {
    expect(normalizeRoomCode(' ab3-k9m ')).toBe('AB3K9M');
    expect(parseRoomCode(' ab3-k9m ')).toBe('AB3K9M');
    expect(parseRoomCode('a b 3 - k 9 m')).toBe('AB3K9M');
    expect(isValidRoomCode('AB3K9M')).toBe(true);
    expect(ROOM_CODE_REGEX.test('L23456')).toBe(true);

    // Invalid codes rejected
    expect(parseRoomCode('0O1IL2')).toBeNull();
    expect(parseRoomCode('ABCDE')).toBeNull();
    expect(parseRoomCode('ABCDEFG')).toBeNull();
    expect(parseRoomCode('')).toBeNull();
    expect(parseRoomCode('AB!234')).toBeNull();
    expect(isValidRoomCode('ab3k9m')).toBe(false);
    expect(normalizeRoomCode(null as unknown as string)).toBe('');
  });

  it('normalizes nicknames safely with control stripping and Unicode codepoint truncation (V2-E30)', () => {
    expect(NICKNAME_MAX_LENGTH).toBe(12);
    expect(normalizeNickname('', 'Guest')).toBe('Guest');
    expect(normalizeNickname('   ', 'Guest')).toBe('Guest');
    expect(normalizeNickname('\t\n\r', 'Guest')).toBe('Guest');
    expect(normalizeNickname(null as unknown as string, 'Guest')).toBe('Guest');

    // Control chars stripped, whitespace/newlines collapsed
    expect(normalizeNickname('a\u0000\u0007\n\t b')).toBe('a b');
    expect(normalizeNickname('  Alice\u007F  ')).toBe('Alice');

    // Korean Hangul truncation to 12 chars
    const twentyKorean = '가나다라마바사아자차카타파하가나다라마바';
    expect(normalizeNickname(twentyKorean)).toBe('가나다라마바사아자차카타');
    expect(Array.from(normalizeNickname(twentyKorean)).length).toBe(12);

    // Surrogate pair safety (15 emoji -> 12 complete codepoints, zero lone surrogates)
    const fifteenEmoji = '😀'.repeat(15);
    const normalizedEmoji = normalizeNickname(fifteenEmoji);
    expect(Array.from(normalizedEmoji).length).toBe(12);
    expect(normalizedEmoji).toBe('😀'.repeat(12));

    // Trailing space exposed by 12-char boundary slicing is trimmed, and multi-spaces collapse
    expect(normalizeNickname('12345678901 XX')).toBe('12345678901');
    expect(normalizeNickname('Player   1')).toBe('Player 1');
  });

  it('strips BiDi/RTL, C1, zero-width, and orphaned ZWJ controls while preserving intact ZWJ emoji clusters', () => {
    // BiDi/RTL, zero-width spaces, BOM, and standalone/whitespace-separated ZWJ fall back cleanly
    expect(normalizeNickname('\u200F\u200E', 'Fallback')).toBe('Fallback');
    expect(normalizeNickname('\u200B\u200B', 'Fallback')).toBe('Fallback');
    expect(normalizeNickname('\uFEFF', 'Fallback')).toBe('Fallback');
    expect(normalizeNickname('\u200D\u200D', 'Fallback')).toBe('Fallback');
    expect(normalizeNickname('\u200D \u200D \u200D', 'Fallback')).toBe('Fallback');
    expect(normalizeNickname('\u061C\u2060', 'Fallback')).toBe('Fallback');

    // BiDi override/isolate and C1 control stripping preserves visible text
    expect(normalizeNickname('\u202Eevil', 'Fallback')).toBe('evil');
    expect(normalizeNickname('\u2066Alice\u2069', 'Fallback')).toBe('Alice');
    expect(normalizeNickname('A\u0080\u009FB', 'Fallback')).toBe('AB');
    expect(normalizeNickname('a \u200D b', 'Fallback')).toBe('a b');
    expect(normalizeNickname('a\u200D b', 'Fallback')).toBe('a b');
    expect(normalizeNickname('a \u200Db', 'Fallback')).toBe('a b');

    // Consecutive ZWJs collapse to a single ZWJ
    const collapsedZwj = normalizeNickname('a\u200D\u200D\u200D\u200D\u200Db', 'Fallback');
    expect(collapsedZwj).toBe('a\u200Db');
    expect(Array.from(collapsedZwj).length).toBe(3);

    // Intact ZWJ emoji clusters stay intact when within NICKNAME_MAX_LENGTH
    const familyEmoji = '👨‍👩‍👧‍👦';
    expect(normalizeNickname(familyEmoji, 'Fallback')).toBe(familyEmoji);
    const rainbowFlag = '🏳️‍🌈';
    expect(normalizeNickname(rainbowFlag, 'Fallback')).toBe(rainbowFlag);

    // Slicing mid-ZWJ cluster or before a trailing ZWJ strips dangling trailing ZWJ
    const slicedFamily = normalizeNickname('a'.repeat(10) + familyEmoji, 'Fallback');
    expect(slicedFamily.endsWith('\u200D')).toBe(false);
    expect(slicedFamily).toBe('aaaaaaaaaa👨');

    const slicedDanglingZwj = normalizeNickname('a'.repeat(11) + '\u200D' + 'b', 'Fallback');
    expect(slicedDanglingZwj).toBe('aaaaaaaaaaa');
  });

  it('normalizes adversarial repeated-ZWJ inputs in linear O(n) time without ReDoS backtracking', () => {
    const t0 = performance.now();
    const bounded = normalizeNickname('a' + '\u200D'.repeat(20_000) + 'b', 'Fallback');
    const dtBounded = performance.now() - t0;
    expect(bounded).toBe('a\u200Db');
    expect(Array.from(bounded).length).toBe(3);
    expect(dtBounded).toBeLessThan(50);

    const t1 = performance.now();
    const onlyZwj = normalizeNickname('\u200D'.repeat(20_000), 'Fallback');
    const dtOnlyZwj = performance.now() - t1;
    expect(onlyZwj).toBe('Fallback');
    expect(dtOnlyZwj).toBeLessThan(50);

    const t2 = performance.now();
    const spacedZwj = normalizeNickname('\u200D '.repeat(10_000), 'Fallback');
    const dtSpacedZwj = performance.now() - t2;
    expect(spacedZwj).toBe('Fallback');
    expect(dtSpacedZwj).toBeLessThan(50);
  });
});
