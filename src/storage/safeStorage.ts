/**
 * Resilient localStorage accessors safe under:
 * - Node 24 SSR / Vitest (`typeof window === 'undefined'`)
 * - Safari Private Mode / blocked third-party iframes (`SecurityError` on property access or read/write)
 * - Full storage quotas (`QuotaExceededError` / `NS_ERROR_DOM_QUOTA_REACHED` / legacy codes 22 & 1014)
 */

export function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { name?: unknown; code?: unknown };
  if (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  ) {
    return true;
  }
  if (err.code === 22 || err.code === 1014) {
    return true;
  }
  return false;
}

export function safeGetItem(
  key: string,
  storage?: Storage | null,
): string | null {
  const target = storage === undefined ? getBrowserStorage() : storage;
  if (!target) {
    return null;
  }
  try {
    return target.getItem(key);
  } catch {
    return null;
  }
}

export type SafeSetItemResult =
  | { ok: true }
  | { ok: false; quotaExceeded: boolean };

export function safeSetItem(
  key: string,
  value: string,
  storage?: Storage | null,
): SafeSetItemResult {
  const target = storage === undefined ? getBrowserStorage() : storage;
  if (!target) {
    return { ok: false, quotaExceeded: false };
  }
  try {
    target.setItem(key, value);
    return { ok: true };
  } catch (error) {
    return { ok: false, quotaExceeded: isQuotaExceededError(error) };
  }
}

export function safeRemoveItem(
  key: string,
  storage?: Storage | null,
): void {
  const target = storage === undefined ? getBrowserStorage() : storage;
  if (!target) {
    return;
  }
  try {
    target.removeItem(key);
  } catch {
    // Ignore SecurityError / disabled storage
  }
}
