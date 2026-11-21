import { STORAGE_KEY_LOCALE } from '../shared';
import type { Locale } from '../shared';

export interface ResolveLocaleInput {
  savedLocale?: string | null;
  languages?: readonly string[] | null;
  language?: string | null;
}

/**
 * Pure locale resolver:
 * 1. Explicit saved user override (`'ko' | 'en'`) always wins.
 * 2. Otherwise inspect browser language list (`languages` falling back to `language`).
 *    Korean tags (`ko`, `ko-KR`, `ko_KR`, case-insensitive) resolve to `'ko'`;
 *    all other languages (including `'kok'` Konkani) resolve to `'en'`.
 */
export function resolveLocale(input: ResolveLocaleInput): Locale {
  if (input.savedLocale === 'ko' || input.savedLocale === 'en') {
    return input.savedLocale;
  }

  const nonBlankLanguages = Array.isArray(input.languages)
    ? input.languages.filter(
        (tag): tag is string => typeof tag === 'string' && tag.trim().length > 0,
      )
    : [];

  const primary =
    nonBlankLanguages[0] ??
    (typeof input.language === 'string' && input.language.trim().length > 0
      ? input.language
      : undefined);

  if (primary && /^ko(?=$|[-_])/i.test(primary.trim())) {
    return 'ko';
  }
  return 'en';
}

/**
 * Detects initial locale safely in both browser and Node 24 SSR/Vitest environments.
 */
export function detectInitialLocale(): Locale {
  // CRITICAL: Node 24 exposes globalThis.navigator.language === 'en-US' even when
  // typeof window === 'undefined'. Returning 'ko' aligns SSR & Vitest smoke tests
  // with index.html (<html lang="ko">) while browsers auto-detect normally.
  if (typeof window === 'undefined') {
    return 'ko';
  }

  let savedLocale: string | null = null;
  try {
    savedLocale = window.localStorage.getItem(STORAGE_KEY_LOCALE);
  } catch {
    savedLocale = null;
  }

  return resolveLocale({
    savedLocale,
    languages: window.navigator?.languages,
    language: window.navigator?.language,
  });
}

/**
 * Persists selected locale to localStorage (no-op in SSR or Safari Private Mode).
 */
export function saveLocale(locale: Locale): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY_LOCALE, locale);
  } catch {
    // Ignore SecurityError / disabled storage
  }
}
