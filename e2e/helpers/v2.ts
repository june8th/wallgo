import {
  expect,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Locator,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from '@playwright/test';
import {
  attachRuntimeErrorGuard,
  isAllowedFontOrigin,
  type RuntimeErrorGuard,
  type RuntimeErrors,
} from './network.ts';
import {
  GAME_PAINTED_REGION_TESTIDS,
  IPAD_VIEWPORTS,
  assertGameRegionsNoOverlap,
  assertInteractiveWallHitTargets,
  assertNoDuplicateVisibleTestIds,
  assertZeroOverflow,
  type ViewportSize,
} from './layout.ts';
import {
  SCRIPT_D_PLACEMENTS,
  boardPiecesLocator,
  cancelTurnMove,
  cellLocator,
  hWall,
  moveSelectedTo,
  openLobby,
  placePiece,
  playHumanTurn,
  playerCardLocator,
  readGameScreenState,
  selectCell,
  vWall,
  waitForGameOver,
  type E2ECellPos,
  type E2EGameFormat,
  type E2EPieceKind,
  type E2EPlacementStep,
  type E2ERuleVariant,
  type E2ETimerSeconds,
  type E2EWallEdge,
  type E2EWallOrientation,
  type GameScreenState,
} from './game.ts';
import {
  SCRIPT_2P_WG1_FAST_PLACEMENTS,
  SCRIPT_3P_TIE_PLACEMENTS,
  SCRIPT_D2_PLACEMENTS,
} from './scripts.ts';

// --- Authoritative PROJECT.md Constants & Types ---

export const V2_BASE_URL = 'http://127.0.0.1:4173';

export const V2_STORAGE_KEYS = {
  locale: 'wallgo.locale',
  profile: 'wallgo.profile',
  roomSessions: 'wallgo.roomSessions',
  localMatches: 'wallgo.localMatches',
} as const;

export const V2_ROOM_CODE_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

/**
 * Blink rounds CSS layout in fixed-point 1/64px LayoutUnits:
 * - Desktop & iPad (`> 640px`): 48px hit targets -> 47.95px tolerance floor.
 * - Mobile (`<= 640px`): 40px hit targets -> 39.95px tolerance floor.
 */
export const V2_DESKTOP_IPAD_MIN_WALL_HIT_PX = 47.95;
export const V2_MOBILE_MIN_WALL_HIT_PX = 39.95;

const VIEWPORT_SUBPIXEL_TOLERANCE_PX = 0.5;
const OVERLAP_SUBPIXEL_TOLERANCE_PX = 0.5;
const BOARD_SQUARENESS_TOLERANCE_PX = 1.5;
const DEFAULT_ACTION_TIMEOUT_MS = 10_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000;
const MAX_NICKNAME_CODEPOINTS = 12;

export type V2Locale = 'ko' | 'en';
export type V2OnlineSeatRole = 'open' | 'ai-easy' | 'ai-normal' | 'ai-hard';
export type V2HistoryFilter = 'all' | 'online' | 'local';
export type V2ReplaySpeed = '0.5' | '1' | '2';
export type V2ScreenKind =
  | 'lobby'
  | 'online-lobby'
  | 'online-room'
  | 'game'
  | 'history'
  | 'replay';

export const V2_VIEWPORTS = {
  desktop1920: { width: 1920, height: 1080 },
  desktop1440: { width: 1440, height: 900 },
  desktop1280: { width: 1280, height: 800 },
  ipadAirLandscape: IPAD_VIEWPORTS.airLandscape,
  ipadGen10Landscape: IPAD_VIEWPORTS.gen10Landscape,
  ipadAirPortrait: IPAD_VIEWPORTS.airPortrait,
  ipadGen10Portrait: IPAD_VIEWPORTS.gen10Portrait,
  ipadSplitSquare: { width: 820, height: 820 },
  mobileIphone14: { width: 390, height: 844 },
  mobilePixel7: { width: 412, height: 915 },
  mobileIphoneSe: { width: 375, height: 667 },
  mobileCompactAndroid: { width: 360, height: 740 },
} as const satisfies Record<string, ViewportSize>;

export const V2_PROJECT_EXPECTED_VIEWPORTS: Readonly<Record<string, ViewportSize>> = {
  'ipad-landscape': V2_VIEWPORTS.ipadAirLandscape,
  'ipad-portrait': V2_VIEWPORTS.ipadAirPortrait,
  'desktop-chromium': V2_VIEWPORTS.desktop1440,
  'mobile-chromium': V2_VIEWPORTS.mobileIphone14,
};

export const V2_RESPONSIVE_MATRIX_VIEWPORTS: readonly (readonly [string, ViewportSize])[] = [
  ['Desktop 1440x900', V2_VIEWPORTS.desktop1440],
  ['Desktop 1280x800', V2_VIEWPORTS.desktop1280],
  ['iPad Air Landscape 1180x820', V2_VIEWPORTS.ipadAirLandscape],
  ['iPad 10th Landscape 1024x768', V2_VIEWPORTS.ipadGen10Landscape],
  ['iPad Air Portrait 820x1180', V2_VIEWPORTS.ipadAirPortrait],
  ['iPad 10th Portrait 768x1024', V2_VIEWPORTS.ipadGen10Portrait],
  ['iPad Split View 820x820', V2_VIEWPORTS.ipadSplitSquare],
  ['Mobile iPhone 14 390x844', V2_VIEWPORTS.mobileIphone14],
  ['Mobile Pixel 7 412x915', V2_VIEWPORTS.mobilePixel7],
  ['Mobile iPhone SE 375x667', V2_VIEWPORTS.mobileIphoneSe],
];

// --- Parallel-Worker-Safe Unique Tag & Nickname Generators ---

let uniqueSequenceCounter = 0;

function randomBase36Chars(length: number): string {
  let out = '';
  while (out.length < length) {
    out += Math.floor(Math.random() * 36).toString(36);
  }
  return out.slice(0, length);
}

/**
 * Generates a unique 4-character lowercase ASCII tag (`[0-9a-z]{4}`) combining
 * Playwright `workerIndex` (1 char), 2-char monotonic per-process sequence (`% 1296`),
 * and 1 random base36 char so concurrent Playwright workers sharing one `MemoryStore`
 * achieve 0.00% collision across 1,296 consecutive calls per worker.
 */
export function makeUniqueRunTag(testInfo?: TestInfo): string {
  const workerChar = (Math.abs(Math.trunc(testInfo?.workerIndex ?? 0)) % 36).toString(36);
  const seq2 = (uniqueSequenceCounter % 1296).toString(36).padStart(2, '0');
  uniqueSequenceCounter += 1;
  return `${workerChar}${seq2}${randomBase36Chars(1)}`;
}

function sanitizeNicknamePrefix(prefix: string): string {
  const cleaned = prefix.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'P';
}

function truncateToUtf16Budget(input: string, maxUtf16: number): string {
  if (maxUtf16 <= 0) {
    return '';
  }
  let acc = '';
  for (const cp of Array.from(input)) {
    if (acc.length + cp.length > maxUtf16) {
      break;
    }
    acc += cp;
  }
  return acc.trim();
}

function assertValidNicknameBounds(nickname: string): void {
  const cpLen = Array.from(nickname).length;
  const utf16Len = nickname.length;
  if (
    cpLen < 1 ||
    cpLen > MAX_NICKNAME_CODEPOINTS ||
    utf16Len < 1 ||
    utf16Len > MAX_NICKNAME_CODEPOINTS
  ) {
    throw new Error(
      `Generated nickname "${nickname}" violated 1..${MAX_NICKNAME_CODEPOINTS} bound (codepoints=${cpLen}, utf16=${utf16Len})`,
    );
  }
}

function buildTaggedNickname(prefix: string, tag: string): string {
  const cleanPrefix = sanitizeNicknamePrefix(prefix);
  const maxPrefixUtf16 = MAX_NICKNAME_CODEPOINTS - 1 - tag.length;
  if (maxPrefixUtf16 < 1) {
    throw new Error(
      `Tag "${tag}" leaves insufficient UTF-16 budget for ${MAX_NICKNAME_CODEPOINTS}-char nickname`,
    );
  }
  const truncated = truncateToUtf16Budget(cleanPrefix, maxPrefixUtf16) || 'P';
  const nickname = `${truncated}_${tag}`;
  assertValidNicknameBounds(nickname);
  return nickname;
}

/**
 * Generates a parallel-worker-safe unique nickname strictly 1..12 Unicode codepoints
 * AND 1..12 UTF-16 code units long (safe for HTML `<input maxlength="12">`).
 */
export function makeUniqueNickname(prefix: string, testInfo?: TestInfo): string {
  return buildTaggedNickname(prefix, makeUniqueRunTag(testInfo));
}

/**
 * Generates ONE shared 4-char `tag` and N strictly unique scoped nicknames
 * (`<= 12` codepoints and `<= 12` UTF-16 code units each) all containing `_${tag}`,
 * enabling `searchHistory(page, tag)` to isolate strictly the current test's matches
 * under parallel Playwright workers.
 */
export function createScopedMatchNicknames<const T extends readonly string[]>(
  prefixes: T,
  testInfo?: TestInfo,
): { readonly tag: string; readonly names: { readonly [K in keyof T]: string } } {
  const tag = makeUniqueRunTag(testInfo);
  const maxPrefixUtf16 = MAX_NICKNAME_CODEPOINTS - 1 - tag.length;
  const used = new Set<string>();
  const resolved: string[] = [];

  for (let i = 0; i < prefixes.length; i += 1) {
    const rawPrefix = prefixes[i] ?? 'P';
    const initial = buildTaggedNickname(rawPrefix, tag);
    if (!used.has(initial)) {
      used.add(initial);
      resolved.push(initial);
      continue;
    }

    const cleanPrefix = sanitizeNicknamePrefix(rawPrefix);
    let disambiguated: string | null = null;
    for (let slot = i; slot < i + 1296; slot += 1) {
      const slotSuffix = slot.toString(36);
      if (slotSuffix.length > maxPrefixUtf16) {
        break;
      }
      const headBudget = maxPrefixUtf16 - slotSuffix.length;
      const head = headBudget > 0 ? truncateToUtf16Budget(cleanPrefix, headBudget) : '';
      const candidate = `${head}${slotSuffix}_${tag}`;
      if (!used.has(candidate)) {
        assertValidNicknameBounds(candidate);
        disambiguated = candidate;
        break;
      }
    }

    if (!disambiguated) {
      throw new Error(
        `Failed to disambiguate scoped nickname at index ${i} for prefix "${rawPrefix}" with tag "${tag}"`,
      );
    }
    used.add(disambiguated);
    resolved.push(disambiguated);
  }

  return {
    tag,
    names: resolved as unknown as { readonly [K in keyof T]: string },
  };
}

// --- Runtime Hygiene, API Tracker & Multi-Context Pool ---

export interface ApiRequestTracker {
  getRequests(): readonly string[];
  assertZeroApiRequests(contextLabel?: string): void;
  detach(): void;
}

/**
 * Tracks all `/api/*` HTTP requests initiated by a Page so Local Lobby & SPA fallback
 * tests can strictly verify zero unsolicited backend traffic.
 */
export function attachApiRequestTracker(page: Page): ApiRequestTracker {
  const requests: string[] = [];

  const onRequest = (req: Request): void => {
    try {
      const parsed = new URL(req.url());
      if (parsed.pathname.startsWith('/api/')) {
        requests.push(`${req.method()} ${parsed.pathname}${parsed.search}`);
      }
    } catch {
      // Ignore non-URL schemes (e.g., data:, about:)
    }
  };

  page.on('request', onRequest);

  return {
    getRequests: () => [...requests],
    assertZeroApiRequests: (contextLabel = 'page') => {
      expect(
        requests,
        `Expected zero /api/* requests on ${contextLabel}, but observed: ${requests.join(', ')}`,
      ).toEqual([]);
    },
    detach: () => {
      page.off('request', onRequest);
    },
  };
}

export interface ExpectedApiErrorRule {
  readonly status: number;
  readonly pathPattern: RegExp;
  readonly required?: boolean;
}

function isLocalTestOrigin(parsed: URL): boolean {
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
  );
}

const CHROMIUM_RESOURCE_STATUS_RE =
  /^Failed to load resource: the server responded with a status of (\d{3})\b.*\((https?:\/\/[^)\s]+)\)$/;

/**
 * Strict wrapper over v1 `RuntimeErrorGuard.getErrors()` for intentional UI-driven
 * negative API tests (e.g., 404 invalid room code, 400 malformed code, 503 unconfigured).
 * - `pageErrors` and `failedRequests` remain strictly empty (`[]`).
 * - Only HTTP errors and Chromium's matching automatic resource console errors whose
 *   `(status, local pathname)` match an explicit rule are allowlisted.
 * - Any real JS/React `console.error` or unexpected status STILL fails.
 */
export function assertCleanWithExpectedApiErrors(
  guard: RuntimeErrorGuard,
  allowed: readonly ExpectedApiErrorRule[],
): void {
  const errors = guard.getErrors();

  expect(errors.pageErrors, 'Uncaught pageerror events').toEqual([]);
  expect(errors.failedRequests, 'Non-font failed network requests').toEqual([]);

  const matchedCounts = allowed.map(() => 0);
  const unexpectedHttpErrors: string[] = [];

  for (const entry of errors.httpErrors) {
    const match = /^(\d{3})\s+(.+)$/.exec(entry);
    if (!match) {
      unexpectedHttpErrors.push(entry);
      continue;
    }
    const status = Number(match[1]);
    const rawUrl = match[2] ?? '';
    let matchedRule = false;
    try {
      const parsed = new URL(rawUrl);
      if (isLocalTestOrigin(parsed)) {
        for (let i = 0; i < allowed.length; i += 1) {
          const rule = allowed[i];
          if (rule && rule.status === status && rule.pathPattern.test(parsed.pathname)) {
            matchedCounts[i] = (matchedCounts[i] ?? 0) + 1;
            matchedRule = true;
            break;
          }
        }
      }
    } catch {
      // Unparseable URL stays unexpected
    }
    if (!matchedRule) {
      unexpectedHttpErrors.push(entry);
    }
  }

  expect(unexpectedHttpErrors, 'Unexpected non-font HTTP >= 400 responses').toEqual([]);

  const unexpectedConsoleErrors: string[] = [];
  for (const entry of errors.consoleErrors) {
    const match = CHROMIUM_RESOURCE_STATUS_RE.exec(entry);
    if (!match) {
      unexpectedConsoleErrors.push(entry);
      continue;
    }
    const status = Number(match[1]);
    const rawUrl = match[2] ?? '';
    let matchedRule = false;
    try {
      const parsed = new URL(rawUrl);
      if (isLocalTestOrigin(parsed)) {
        matchedRule = allowed.some(
          (rule) => rule.status === status && rule.pathPattern.test(parsed.pathname),
        );
      }
    } catch {
      // Unparseable URL stays unexpected
    }
    if (!matchedRule) {
      unexpectedConsoleErrors.push(entry);
    }
  }

  expect(unexpectedConsoleErrors, 'App-origin or unexpected console errors').toEqual([]);

  for (let i = 0; i < allowed.length; i += 1) {
    const rule = allowed[i];
    if (rule && rule.required !== false) {
      expect(
        matchedCounts[i] ?? 0,
        `Expected at least 1 HTTP ${rule.status} matching ${String(rule.pathPattern)}`,
      ).toBeGreaterThanOrEqual(1);
    }
  }
}

export interface AllowedApiErrorRule {
  readonly pathPrefix: string;
  readonly statuses: readonly number[];
}

export interface V2RuntimeGuardOptions {
  /** Narrow opt-in allowlist ONLY for intentional negative UI tests (e.g. 404 invalid room). */
  readonly allowedApiErrors?: readonly AllowedApiErrorRule[];
  /** Narrow opt-in ONLY for `page.reload()` / drop tests where an in-flight `/api/rooms/` poll aborts. */
  readonly allowAbortedRoomPolls?: boolean;
}

export interface V2RuntimeErrorGuard extends RuntimeErrorGuard {
  getObservedAllowedApiErrors(): readonly string[];
}

/**
 * Attaches runtime hygiene guard to a Page.
 * - When `options` has no allowlists, delegates directly to v1 `attachRuntimeErrorGuard(page)`.
 * - When narrow allowlists are specified: `pageerror` and app `console.error` are NEVER allowlisted.
 */
export function attachV2RuntimeErrorGuard(
  page: Page,
  options?: V2RuntimeGuardOptions,
): V2RuntimeErrorGuard {
  const allowedApiErrors = options?.allowedApiErrors ?? [];
  const allowAbortedRoomPolls = options?.allowAbortedRoomPolls ?? false;

  if (allowedApiErrors.length === 0 && !allowAbortedRoomPolls) {
    const baseGuard = attachRuntimeErrorGuard(page);
    return {
      ...baseGuard,
      getObservedAllowedApiErrors: () => [],
    };
  }

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const httpErrors: string[] = [];
  const observedAllowedApiErrors: string[] = [];

  const matchesAllowedApiRule = (status: number, rawUrl: string): boolean => {
    try {
      const parsed = new URL(rawUrl);
      if (!isLocalTestOrigin(parsed)) {
        return false;
      }
      return allowedApiErrors.some(
        (rule) => parsed.pathname.startsWith(rule.pathPrefix) && rule.statuses.includes(status),
      );
    } catch {
      return false;
    }
  };

  const onPageError = (error: Error): void => {
    pageErrors.push(error.message);
  };

  const onConsole = (msg: ConsoleMessage): void => {
    if (msg.type() !== 'error') {
      return;
    }
    const sourceUrl = msg.location().url;
    if (isAllowedFontOrigin(sourceUrl)) {
      return;
    }
    const text = msg.text();
    const statusMatch = /^Failed to load resource: the server responded with a status of (\d{3})\b/.exec(
      text,
    );
    if (statusMatch && sourceUrl && matchesAllowedApiRule(Number(statusMatch[1]), sourceUrl)) {
      return;
    }
    consoleErrors.push(`${text} (${sourceUrl || 'unknown'})`);
  };

  const onRequestFailed = (req: Request): void => {
    const url = req.url();
    if (isAllowedFontOrigin(url)) {
      return;
    }
    const errorText = req.failure()?.errorText ?? 'unknown';
    if (allowAbortedRoomPolls && errorText === 'net::ERR_ABORTED') {
      try {
        const parsed = new URL(url);
        if (isLocalTestOrigin(parsed) && parsed.pathname.startsWith('/api/rooms/')) {
          return;
        }
      } catch {
        // Fall through and record failure
      }
    }
    failedRequests.push(`${url} (${errorText})`);
  };

  const onResponse = (res: Response): void => {
    if (res.status() < 400 || isAllowedFontOrigin(res.url())) {
      return;
    }
    if (matchesAllowedApiRule(res.status(), res.url())) {
      observedAllowedApiErrors.push(`${res.status()} ${res.url()}`);
      return;
    }
    httpErrors.push(`${res.status()} ${res.url()}`);
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  const getErrors = (): RuntimeErrors => ({
    pageErrors: [...pageErrors],
    consoleErrors: [...consoleErrors],
    failedRequests: [...failedRequests],
    httpErrors: [...httpErrors],
  });

  const hasErrors = (): boolean =>
    pageErrors.length > 0 ||
    consoleErrors.length > 0 ||
    failedRequests.length > 0 ||
    httpErrors.length > 0;

  const assertClean = (): void => {
    expect(pageErrors, 'Uncaught pageerror events').toEqual([]);
    expect(consoleErrors, 'App-origin or unexpected console errors').toEqual([]);
    expect(failedRequests, 'Non-font failed network requests').toEqual([]);
    expect(httpErrors, 'Non-font HTTP >= 400 responses').toEqual([]);
  };

  const detach = (): void => {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
  };

  return {
    getErrors,
    hasErrors,
    assertClean,
    detach,
    getObservedAllowedApiErrors: () => [...observedAllowedApiErrors],
  };
}

export interface CreateGuardedContextOptions {
  readonly locale?: string;
  readonly viewport?: ViewportSize;
  readonly hasTouch?: boolean;
  readonly isMobile?: boolean;
  readonly baseURL?: string;
  readonly testInfo?: TestInfo;
  readonly guardOptions?: V2RuntimeGuardOptions;
}

export interface GuardedContextHandle {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly guard: V2RuntimeErrorGuard;
  isClosed(): boolean;
  assertClean(): void;
  /** Safe teardown: detaches guard BEFORE closing context (prevents teardown ERR_ABORTED). */
  close(): Promise<void>;
  /** Enforces strict `assertClean -> detach -> close` order. */
  assertCleanAndClose(): Promise<void>;
}

/**
 * Spawns an isolated BrowserContext forwarding `baseURL`, `viewport`, `hasTouch`,
 * `isMobile`, `locale`, and timeouts from `testInfo.project.use`, with a runtime error guard.
 */
export async function createGuardedContext(
  browser: Browser,
  options?: CreateGuardedContextOptions,
): Promise<GuardedContextHandle> {
  const projectUse = options?.testInfo?.project.use;
  const baseURL = options?.baseURL ?? projectUse?.baseURL ?? V2_BASE_URL;
  const viewport = options?.viewport ?? projectUse?.viewport ?? V2_VIEWPORTS.ipadAirLandscape;
  const hasTouch = options?.hasTouch ?? projectUse?.hasTouch ?? false;
  const isMobile = options?.isMobile ?? projectUse?.isMobile ?? false;
  const locale = options?.locale ?? projectUse?.locale ?? 'ko-KR';
  const actionTimeout = projectUse?.actionTimeout ?? DEFAULT_ACTION_TIMEOUT_MS;
  const navigationTimeout = projectUse?.navigationTimeout ?? DEFAULT_NAVIGATION_TIMEOUT_MS;

  const context = await browser.newContext({
    baseURL,
    viewport,
    hasTouch,
    isMobile,
    locale,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(actionTimeout);
  page.setDefaultNavigationTimeout(navigationTimeout);

  const guard = attachV2RuntimeErrorGuard(page, options?.guardOptions);
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    guard.detach();
    await context.close();
  };

  const assertCleanAndClose = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      guard.assertClean();
    } finally {
      guard.detach();
      await context.close();
    }
  };

  return {
    context,
    page,
    guard,
    isClosed: () => closed,
    assertClean: () => guard.assertClean(),
    close,
    assertCleanAndClose,
  };
}

export interface OnlineClient {
  readonly context: BrowserContext | null;
  readonly page: Page;
  readonly guard: V2RuntimeErrorGuard;
  nickname: string;
  readonly label: string;
  isClosed(): boolean;
  assertClean(): void;
  close(): Promise<void>;
  assertCleanAndClose(): Promise<void>;
}

export interface OnlineSessionPool {
  readonly clients: readonly OnlineClient[];
  attachPrimaryClient(
    page: Page,
    nickname: string,
    options?: { readonly label?: string; readonly guardOptions?: V2RuntimeGuardOptions },
  ): OnlineClient;
  createClient(
    nickname: string,
    options?: CreateGuardedContextOptions & { readonly label?: string },
  ): Promise<OnlineClient>;
  /** Asserts every active (non-closed) client's runtime error guard is clean. */
  assertAllClean(): void;
  /** Detaches all guards and closes every owned context safely (use inside `finally`). */
  closeAll(): Promise<void>;
}

/**
 * Manages primary + secondary guarded online browser contexts with strict
 * `assertClean -> detach -> close` lifecycle guarantees.
 */
export function createOnlineSessionPool(
  browser: Browser,
  testInfo?: TestInfo,
): OnlineSessionPool {
  const clients: OnlineClient[] = [];

  const attachPrimaryClient = (
    page: Page,
    nickname: string,
    options?: { readonly label?: string; readonly guardOptions?: V2RuntimeGuardOptions },
  ): OnlineClient => {
    const guard = attachV2RuntimeErrorGuard(page, options?.guardOptions);
    let closed = false;
    const client: OnlineClient = {
      context: null,
      page,
      guard,
      nickname,
      label: options?.label ?? `primary-${clients.length}`,
      isClosed: () => closed,
      assertClean: () => guard.assertClean(),
      close: async () => {
        if (closed) {
          return;
        }
        closed = true;
        guard.detach();
      },
      assertCleanAndClose: async () => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          guard.assertClean();
        } finally {
          guard.detach();
        }
      },
    };
    clients.push(client);
    return client;
  };

  const createClient = async (
    nickname: string,
    options?: CreateGuardedContextOptions & { readonly label?: string },
  ): Promise<OnlineClient> => {
    const handle = await createGuardedContext(browser, {
      testInfo,
      ...options,
    });
    const client: OnlineClient = {
      context: handle.context,
      page: handle.page,
      guard: handle.guard,
      nickname,
      label: options?.label ?? `client-${clients.length}`,
      isClosed: handle.isClosed,
      assertClean: handle.assertClean,
      close: handle.close,
      assertCleanAndClose: handle.assertCleanAndClose,
    };
    clients.push(client);
    return client;
  };

  const assertAllClean = (): void => {
    for (const client of clients) {
      if (!client.isClosed()) {
        client.assertClean();
      }
    }
  };

  const closeAll = async (): Promise<void> => {
    for (let i = clients.length - 1; i >= 0; i -= 1) {
      const client = clients[i];
      if (client && !client.isClosed()) {
        await client.close();
      }
    }
  };

  return {
    clients,
    attachPrimaryClient,
    createClient,
    assertAllClean,
    closeAll,
  };
}

// --- i18n Helpers ---

export async function readActiveLocale(page: Page): Promise<V2Locale> {
  const toggle = page.getByTestId('language-toggle');
  await expect(toggle, 'Single visible language-toggle must exist').toHaveCount(1);
  await expect(toggle).toBeVisible();
  const locale = await toggle.getAttribute('data-locale');
  expect(locale === 'ko' || locale === 'en', `Unexpected data-locale="${locale}"`).toBe(true);
  return locale as V2Locale;
}

/**
 * Clicks `language-toggle`, verifies `data-locale`, `<html lang>`, and `<title>` update live.
 */
export async function toggleLanguage(
  page: Page,
  expectedLocale?: V2Locale,
): Promise<V2Locale> {
  const current = await readActiveLocale(page);
  const target: V2Locale = expectedLocale ?? (current === 'ko' ? 'en' : 'ko');
  const toggle = page.getByTestId('language-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-locale', target);
  await expect(page.locator('html')).toHaveAttribute('lang', target);
  await expect(page).toHaveTitle(target === 'en' ? 'Wall Go' : '벽바둑 | Wall Go');
  return target;
}

/**
 * Ensures active locale equals `targetLocale` (clicking `language-toggle` only if needed)
 * and verifies `<html lang>` and `<title>` synchronization.
 */
export async function ensureLocale(page: Page, targetLocale: V2Locale): Promise<V2Locale> {
  const current = await readActiveLocale(page);
  if (current !== targetLocale) {
    return toggleLanguage(page, targetLocale);
  }
  await expect(page.locator('html')).toHaveAttribute('lang', targetLocale);
  await expect(page).toHaveTitle(targetLocale === 'en' ? 'Wall Go' : '벽바둑 | Wall Go');
  return targetLocale;
}

export interface ZeroHangulOptions {
  readonly root?: Locator;
  readonly scopeTestId?: string;
  readonly excludeTestIds?: readonly string[];
  readonly ignoreSubstrings?: readonly string[];
  /** By default `language-toggle` is excluded since a KO/EN switcher may display autonym "한국어". */
  readonly includeLanguageToggle?: boolean;
}

/**
 * Walks visible DOM text nodes via TreeWalker AND visible text `<input>`/`<textarea>`
 * values/placeholders, failing if any Hangul syllable or Jamo
 * (`[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]`) is visibly rendered.
 */
export async function assertZeroStrayHangul(
  page: Page,
  options?: ZeroHangulOptions,
): Promise<void> {
  const scope =
    options?.root ??
    (options?.scopeTestId ? page.getByTestId(options.scopeTestId) : page.locator('body'));
  const excludeList = [...(options?.excludeTestIds ?? [])];
  if (!options?.includeLanguageToggle) {
    excludeList.push('language-toggle');
  }
  const ignoreSubstrings = [...(options?.ignoreSubstrings ?? [])];

  const violations = await scope.evaluate(
    (rootEl, params) => {
      const hangulRe = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/;
      const excluded = new Set(params.excludeList);
      const ignoredTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
      const excludedInputTypes = new Set(['hidden', 'range', 'checkbox', 'radio']);

      const isVisibleTextParent = (parent: Element | null): boolean => {
        if (!parent || ignoredTags.has(parent.tagName)) {
          return false;
        }
        const selfStyle = window.getComputedStyle(parent);
        if (selfStyle.visibility === 'hidden' || selfStyle.visibility === 'collapse') {
          return false;
        }
        let curr: Element | null = parent;
        while (curr) {
          if (ignoredTags.has(curr.tagName) || curr.hasAttribute('hidden')) {
            return false;
          }
          const testId = curr.getAttribute('data-testid');
          if (testId && excluded.has(testId)) {
            return false;
          }
          const style = window.getComputedStyle(curr);
          if (style.display === 'none' || Number.parseFloat(style.opacity || '1') === 0) {
            return false;
          }
          curr = curr.parentElement;
        }
        return true;
      };

      const findNearestTestId = (el: Element | null): string => {
        let curr: Element | null = el;
        while (curr) {
          const id = curr.getAttribute('data-testid');
          if (id) {
            return id;
          }
          curr = curr.parentElement;
        }
        return el?.tagName.toLowerCase() ?? 'root';
      };

      const stripIgnored = (raw: string): string => {
        let text = raw;
        for (const sub of params.ignoreSubstrings) {
          if (sub.length > 0) {
            text = text.split(sub).join('');
          }
        }
        return text;
      };

      const found: string[] = [];
      const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const rawText = (node.textContent ?? '').trim();
        if (rawText.length > 0 && isVisibleTextParent(node.parentElement)) {
          const text = stripIgnored(rawText);
          if (hangulRe.test(text)) {
            const label = findNearestTestId(node.parentElement);
            found.push(`[${label}]: "${text.slice(0, 80)}"`);
          }
        }
        node = walker.nextNode();
      }

      const fieldSelector =
        'input:not([type="hidden"]):not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea';
      const fields: Element[] = [];
      if (rootEl.matches(fieldSelector)) {
        fields.push(rootEl);
      }
      fields.push(...Array.from(rootEl.querySelectorAll(fieldSelector)));

      for (const field of fields) {
        if (
          field.tagName === 'INPUT' &&
          excludedInputTypes.has((field as HTMLInputElement).type.toLowerCase())
        ) {
          continue;
        }
        if (!isVisibleTextParent(field)) {
          continue;
        }
        const control = field as HTMLInputElement | HTMLTextAreaElement;
        const rawValue = control.value;
        const trimmedValue = rawValue.trim();
        if (trimmedValue.length > 0) {
          const text = stripIgnored(trimmedValue);
          if (hangulRe.test(text)) {
            const label = findNearestTestId(field);
            found.push(`[${label} value]: "${text.slice(0, 80)}"`);
          }
        } else if (rawValue.length === 0) {
          const placeholder = (control.placeholder ?? '').trim();
          if (placeholder.length > 0) {
            const text = stripIgnored(placeholder);
            if (hangulRe.test(text)) {
              const label = findNearestTestId(field);
              found.push(`[${label} placeholder]: "${text.slice(0, 80)}"`);
            }
          }
        }
      }

      return found;
    },
    { excludeList, ignoreSubstrings },
  );

  expect(
    violations,
    `Stray visible Hangul detected in English UI:\n${violations.join('\n')}`,
  ).toEqual([]);
}

/**
 * Walks visible DOM text nodes AND visible text `<input>`/`<textarea>` values/placeholders,
 * rejecting unresolved `{token}` placeholders, raw dotted i18n keys (`lobby.title`,
 * `toast.timeout`, etc.), or literal `undefined`/`NaN`.
 */
export async function assertNoUninterpolatedTemplates(
  page: Page,
  root?: Locator,
): Promise<void> {
  const scope = root ?? page.locator('body');
  const violations = await scope.evaluate((rootEl) => {
    const tokenRe = /\{[a-zA-Z0-9_]+\}/;
    const rawKeyRe =
      /\b(?:meta|lobby|game|board|side|hud|rules|result|online|waiting|room|history|replay|toast|action|common|error)(?:\.[a-z0-9_]+)+\b/i;
    const badLiteralRe = /\b(?:undefined|NaN)\b/;
    const ignoredTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
    const excludedInputTypes = new Set(['hidden', 'range', 'checkbox', 'radio']);

    const isVisibleTextParent = (parent: Element | null): boolean => {
      if (!parent || ignoredTags.has(parent.tagName)) {
        return false;
      }
      const selfStyle = window.getComputedStyle(parent);
      if (selfStyle.visibility === 'hidden' || selfStyle.visibility === 'collapse') {
        return false;
      }
      let curr: Element | null = parent;
      while (curr) {
        if (ignoredTags.has(curr.tagName) || curr.hasAttribute('hidden')) {
          return false;
        }
        const style = window.getComputedStyle(curr);
        if (style.display === 'none' || Number.parseFloat(style.opacity || '1') === 0) {
          return false;
        }
        curr = curr.parentElement;
      }
      return true;
    };

    const findNearestTestId = (el: Element | null): string => {
      let curr: Element | null = el;
      while (curr) {
        const id = curr.getAttribute('data-testid');
        if (id) {
          return id;
        }
        curr = curr.parentElement;
      }
      return el?.tagName.toLowerCase() ?? 'root';
    };

    const hasTemplateLeak = (text: string): boolean =>
      tokenRe.test(text) || rawKeyRe.test(text) || badLiteralRe.test(text);

    const found: string[] = [];
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = (node.textContent ?? '').trim();
      if (text.length > 0 && isVisibleTextParent(node.parentElement) && hasTemplateLeak(text)) {
        const label = findNearestTestId(node.parentElement);
        found.push(`[${label}]: "${text.slice(0, 80)}"`);
      }
      node = walker.nextNode();
    }

    const fieldSelector =
      'input:not([type="hidden"]):not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea';
    const fields: Element[] = [];
    if (rootEl.matches(fieldSelector)) {
      fields.push(rootEl);
    }
    fields.push(...Array.from(rootEl.querySelectorAll(fieldSelector)));

    for (const field of fields) {
      if (
        field.tagName === 'INPUT' &&
        excludedInputTypes.has((field as HTMLInputElement).type.toLowerCase())
      ) {
        continue;
      }
      if (!isVisibleTextParent(field)) {
        continue;
      }
      const control = field as HTMLInputElement | HTMLTextAreaElement;
      const rawValue = control.value;
      const trimmedValue = rawValue.trim();
      if (trimmedValue.length > 0) {
        if (hasTemplateLeak(trimmedValue)) {
          const label = findNearestTestId(field);
          found.push(`[${label} value]: "${trimmedValue.slice(0, 80)}"`);
        }
      } else if (rawValue.length === 0) {
        const placeholder = (control.placeholder ?? '').trim();
        if (placeholder.length > 0 && hasTemplateLeak(placeholder)) {
          const label = findNearestTestId(field);
          found.push(`[${label} placeholder]: "${placeholder.slice(0, 80)}"`);
        }
      }
    }

    return found;
  });

  expect(
    violations,
    `Uninterpolated i18n template, raw key, or undefined/NaN leaked into visible UI:\n${violations.join('\n')}`,
  ).toEqual([]);
}

// --- Graceful Unconfigured Redis Mock ---

/**
 * Intercepts `/api/health`, `/api/matches`, `/api/rooms*`, and `/api/matches/*` using
 * URL pathname predicates (handling `?limit=100` query params accurately) to simulate
 * Vercel deployment without linked Upstash Redis env vars.
 */
export async function mockRedisUnconfigured(page: Page): Promise<void> {
  const noStoreHeaders = { 'cache-control': 'no-store, max-age=0' };

  await page.route(
    (url) => url.pathname === '/api/health',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: noStoreHeaders,
        body: JSON.stringify({
          ok: true,
          storage: 'unconfigured',
          onlineAvailable: false,
          serverNow: Date.now(),
        }),
      });
    },
  );

  await page.route(
    (url) => url.pathname === '/api/matches',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: noStoreHeaders,
        body: JSON.stringify({
          storage: 'unconfigured',
          onlineAvailable: false,
          matches: [],
        }),
      });
    },
  );

  await page.route(
    (url) =>
      url.pathname === '/api/rooms' ||
      url.pathname.startsWith('/api/rooms/') ||
      url.pathname.startsWith('/api/matches/'),
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: noStoreHeaders,
        body: JSON.stringify({
          error: {
            code: 'REDIS_NOT_CONFIGURED',
            message: 'Online storage (Upstash Redis) is not configured.',
          },
        }),
      });
    },
  );
}

// --- Online Lobby, Waiting Room & Multi-Context Gameplay Helpers ---

export interface OnlineRoomOptions {
  readonly nickname?: string;
  readonly variant?: E2ERuleVariant;
  readonly format?: E2EGameFormat;
  readonly timerSeconds?: E2ETimerSeconds;
  readonly shuffleOrder?: boolean;
}

export interface WaitingRoomSeatSnapshot {
  readonly seatIndex: number;
  readonly seatType: 'open' | 'human' | 'ai';
  readonly isMe: boolean;
  readonly isHost: boolean;
  readonly connected: boolean;
  readonly playerColor: string;
  readonly text: string;
}

export interface WaitingRoomSnapshot {
  readonly code: string;
  readonly isHost: boolean;
  readonly mySeat: string;
  readonly roomStatus: 'waiting' | 'playing' | 'finished';
  readonly spectatorCount: number;
  readonly seats: readonly WaitingRoomSeatSnapshot[];
}

export interface OnlineGameMeta {
  readonly mode: 'local' | 'online';
  readonly roomCode: string | null;
  readonly mySeat: string | null;
  readonly isHost: boolean;
  readonly connectionStatus: 'connected' | 'reconnecting' | 'disconnected' | null;
}

export async function openOnlineTab(
  page: Page,
  options?: { readonly expectConfigured?: boolean },
): Promise<void> {
  const tab = page.getByTestId('nav-online-tab');
  await expect(tab).toBeVisible();
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click();
  }
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByTestId('online-panel');
  await expect(panel).toBeVisible();

  if (options?.expectConfigured === true) {
    await expect(panel).toHaveAttribute('data-redis-configured', 'true');
    await expect(page.getByTestId('create-room-button')).toBeEnabled();
  } else if (options?.expectConfigured === false) {
    await expect(panel).toHaveAttribute('data-redis-configured', 'false');
  } else {
    await expect(panel).toHaveAttribute('data-redis-configured', /^(true|false)$/);
  }
}

export async function openLocalTab(page: Page): Promise<void> {
  const tab = page.getByTestId('nav-local-tab');
  await expect(tab).toBeVisible();
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click();
  }
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('start-game-button')).toBeVisible();
}

export async function openHistoryScreen(page: Page): Promise<void> {
  const tab = page.getByTestId('nav-history-tab');
  await expect(tab).toBeVisible();
  await tab.click();
  const screen = page.getByTestId('history-screen');
  await expect(screen).toBeVisible();
  await expect(screen).toHaveAttribute('role', 'main');
}

export async function configureOnlineLobby(
  page: Page,
  options: OnlineRoomOptions = {},
): Promise<void> {
  if (options.nickname !== undefined) {
    const input = page.getByTestId('nickname-input');
    await input.fill(options.nickname);
    await expect(input).toHaveValue(options.nickname);
  }
  if (options.variant) {
    const btn = page.getByTestId(`online-variant-${options.variant}`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }
  if (options.format) {
    const btn = page.getByTestId(`online-format-${options.format}`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }
  if (options.timerSeconds !== undefined) {
    const btn = page.getByTestId(`online-timer-${options.timerSeconds}`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }
  if (options.shuffleOrder !== undefined) {
    const toggle = page.getByTestId('online-shuffle-toggle');
    const desired = String(options.shuffleOrder);
    if ((await toggle.getAttribute('aria-checked')) !== desired) {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-checked', desired);
  }
}

export async function createOnlineRoom(
  page: Page,
  options: OnlineRoomOptions = {},
): Promise<string> {
  const panel = page.getByTestId('online-panel');
  if (!(await panel.isVisible())) {
    const lobby = page.getByTestId('lobby-screen');
    if (!(await lobby.isVisible())) {
      await openLobby(page);
    }
    await openOnlineTab(page, { expectConfigured: true });
  } else {
    await expect(panel).toHaveAttribute('data-redis-configured', 'true');
  }

  await configureOnlineLobby(page, options);
  const createBtn = page.getByTestId('create-room-button');
  await expect(createBtn).toBeEnabled();
  await createBtn.click();

  const roomScreen = page.getByTestId('online-room-screen');
  await expect(roomScreen).toBeVisible();
  await expect(roomScreen).toHaveAttribute('data-room-status', 'waiting');

  const code = (await roomScreen.getAttribute('data-room-code')) ?? '';
  expect(code, `Created room code "${code}" must match 6-char alphabet`).toMatch(V2_ROOM_CODE_REGEX);
  return code;
}

async function waitForEnteredOnlineRoomOrGame(page: Page, expectedCode: string): Promise<'room' | 'game'> {
  let screen: 'room' | 'game' = 'room';
  await expect
    .poll(async () => {
      const roomScreen = page.getByTestId('online-room-screen');
      if (await roomScreen.isVisible()) {
        const roomCode = await roomScreen.getAttribute('data-room-code');
        if (roomCode === expectedCode) {
          screen = 'room';
          return 'entered';
        }
      }
      const gameScreen = page.getByTestId('game-screen');
      if (await gameScreen.isVisible()) {
        const mode = await gameScreen.getAttribute('data-mode');
        const roomCode = await gameScreen.getAttribute('data-room-code');
        if (mode === 'online' && roomCode === expectedCode) {
          screen = 'game';
          return 'entered';
        }
      }
      return 'pending';
    })
    .toBe('entered');
  return screen;
}

export async function joinRoomByCode(
  page: Page,
  code: string,
  nickname?: string,
): Promise<'room' | 'game'> {
  const panel = page.getByTestId('online-panel');
  if (!(await panel.isVisible())) {
    const lobby = page.getByTestId('lobby-screen');
    if (!(await lobby.isVisible())) {
      await openLobby(page);
    }
    await openOnlineTab(page, { expectConfigured: true });
  } else {
    await expect(panel).toHaveAttribute('data-redis-configured', 'true');
  }

  if (nickname !== undefined) {
    const nickInput = page.getByTestId('nickname-input');
    await nickInput.fill(nickname);
    await expect(nickInput).toHaveValue(nickname);
  }

  const codeInput = page.getByTestId('join-room-code-input');
  await codeInput.fill(code);
  const joinBtn = page.getByTestId('join-room-button');
  await expect(joinBtn).toBeEnabled();
  await joinBtn.click();

  return waitForEnteredOnlineRoomOrGame(page, code);
}

/**
 * Joins an online room via direct invite URL (`/?room=CODE` or `/room/CODE`).
 * Supports BOTH auto-join (landing straight on `online-room-screen`/`game-screen`)
 * and pre-filled confirmation UX (`online-panel` with `join-room-code-input` pre-populated).
 */
export async function joinRoomViaInviteUrl(
  page: Page,
  code: string,
  options?: {
    readonly nickname?: string;
    readonly pathStyle?: 'query' | 'path';
  },
): Promise<'room' | 'game'> {
  const pathStyle = options?.pathStyle ?? 'query';
  const targetUrl = pathStyle === 'path' ? `/room/${code}` : `/?room=${code}`;
  const response = await page.goto(targetUrl, { waitUntil: 'load' });
  expect(response?.ok(), `Invite navigation to ${targetUrl} must return HTTP 2xx`).toBe(true);

  const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const codeRegex = new RegExp(`^${escapedCode}$`, 'i');

  const hasEnteredTarget = async (): Promise<boolean> => {
    if (await page.getByTestId('online-room-screen').isVisible()) {
      return true;
    }
    const game = page.getByTestId('game-screen');
    if (await game.isVisible()) {
      try {
        return (await game.getAttribute('data-mode', { timeout: 250 })) === 'online';
      } catch {
        return false;
      }
    }
    return false;
  };

  let initialLanding: 'room' | 'game' | 'join-form' = 'join-form';
  await expect
    .poll(async () => {
      const roomScreen = page.getByTestId('online-room-screen');
      if (await roomScreen.isVisible()) {
        initialLanding = 'room';
        return 'ready';
      }
      const gameScreen = page.getByTestId('game-screen');
      if (await gameScreen.isVisible()) {
        try {
          if ((await gameScreen.getAttribute('data-mode', { timeout: 250 })) === 'online') {
            initialLanding = 'game';
            return 'ready';
          }
        } catch {
          return 'waiting';
        }
      }
      const panel = page.getByTestId('online-panel');
      if (await panel.isVisible()) {
        try {
          const configured = await panel.getAttribute('data-redis-configured', { timeout: 250 });
          if (configured === 'true') {
            const codeInput = page.getByTestId('join-room-code-input');
            const joinBtn = page.getByTestId('join-room-button');
            if (
              (await codeInput.isVisible()) &&
              (await joinBtn.isVisible()) &&
              (await joinBtn.isEnabled({ timeout: 250 }))
            ) {
              const currentCode = (await codeInput.inputValue({ timeout: 250 })).trim();
              if (codeRegex.test(currentCode)) {
                initialLanding = 'join-form';
                return 'ready';
              }
            }
          }
        } catch {
          // online-panel can unmount mid-poll if an in-flight auto-join completes; re-poll
          return 'waiting';
        }
      }
      return 'waiting';
    })
    .toBe('ready');

  if (initialLanding === 'join-form' && !(await hasEnteredTarget())) {
    let transitionedMidForm = false;
    try {
      const codeInput = page.getByTestId('join-room-code-input');
      const currentCode = (await codeInput.inputValue({ timeout: 2_000 })).trim();
      expect(currentCode).toMatch(codeRegex);

      if (options?.nickname !== undefined && !(await hasEnteredTarget())) {
        const nickInput = page.getByTestId('nickname-input');
        await nickInput.fill(options.nickname, { timeout: 2_000 });
        if (!(await hasEnteredTarget())) {
          await expect(nickInput).toHaveValue(options.nickname, { timeout: 2_000 });
        }
      }

      if (await hasEnteredTarget()) {
        transitionedMidForm = true;
      } else {
        const joinBtn = page.getByTestId('join-room-button');
        await expect(joinBtn).toBeEnabled({ timeout: 2_000 });
        await joinBtn.click({ timeout: 2_000 });
      }
    } catch (err) {
      if (await hasEnteredTarget()) {
        transitionedMidForm = true;
      } else {
        throw err;
      }
    }

    if (!transitionedMidForm) {
      return waitForEnteredOnlineRoomOrGame(page, code);
    }
  }

  const entered = await waitForEnteredOnlineRoomOrGame(page, code);
  if (entered === 'room' && options?.nickname !== undefined) {
    const nickInput = page.getByTestId('room-nickname-input');
    if ((await nickInput.isVisible()) && (await nickInput.inputValue()) !== options.nickname) {
      await updateWaitingRoomNickname(page, options.nickname);
    }
  }
  return entered;
}

export async function readWaitingRoomSnapshot(page: Page): Promise<WaitingRoomSnapshot> {
  const screen = page.getByTestId('online-room-screen');
  await expect(screen).toBeVisible();

  const meta = await screen.evaluate((el) => ({
    code: el.getAttribute('data-room-code') ?? '',
    isHost: el.getAttribute('data-is-host') === 'true',
    mySeat: el.getAttribute('data-my-seat') ?? 'spectator',
    roomStatus: (el.getAttribute('data-room-status') ?? 'waiting') as
      | 'waiting'
      | 'playing'
      | 'finished',
  }));

  const specList = page.getByTestId('room-spectator-list');
  const spectatorCount =
    (await specList.count()) > 0
      ? Number((await specList.getAttribute('data-spectator-count')) ?? '0')
      : 0;

  const seats: WaitingRoomSeatSnapshot[] = [];
  for (const seatIndex of [0, 1, 2] as const) {
    const seat = page.getByTestId(`room-seat-${seatIndex}`);
    if ((await seat.count()) === 0) {
      continue;
    }
    const attrs = await seat.evaluate((el) => ({
      seatIndex: Number(el.getAttribute('data-seat-index') ?? '0'),
      seatType: (el.getAttribute('data-seat-type') ?? 'open') as 'open' | 'human' | 'ai',
      isMe: el.getAttribute('data-is-me') === 'true',
      isHost: el.getAttribute('data-is-host') === 'true',
      connected: el.getAttribute('data-connected') === 'true',
      playerColor: el.getAttribute('data-player-color') ?? '',
      text: (el.textContent ?? '').trim(),
    }));
    seats.push(attrs);
  }

  return {
    ...meta,
    spectatorCount,
    seats,
  };
}

export async function copyRoomCode(page: Page): Promise<string> {
  const display = page.getByTestId('room-code-display');
  await expect(display).toBeVisible();
  const code = (await display.getAttribute('data-room-code')) ?? '';
  expect(code).toMatch(V2_ROOM_CODE_REGEX);

  const btn = page.getByTestId('copy-room-code-button');
  await btn.click();
  await expect(btn).toHaveAttribute('data-copied', 'true');
  return code;
}

export async function copyInviteLink(page: Page): Promise<void> {
  const btn = page.getByTestId('copy-invite-link-button');
  await btn.click();
  await expect(btn).toHaveAttribute('data-copied', 'true');
}

function isRoomPostResponse(res: Response): boolean {
  if (res.request().method() !== 'POST') {
    return false;
  }
  try {
    return new URL(res.url()).pathname.startsWith('/api/rooms/');
  } catch {
    return false;
  }
}

export async function updateWaitingRoomNickname(page: Page, nickname: string): Promise<void> {
  const input = page.getByTestId('room-nickname-input');
  await expect(input).toBeVisible();
  if ((await input.inputValue()) === nickname) {
    await expect(input).toHaveValue(nickname);
    return;
  }

  await input.fill(nickname);
  const enterPostPromise = page
    .waitForResponse(isRoomPostResponse, { timeout: 1_500 })
    .catch(() => null);
  await input.press('Enter');
  const enterResponse = await enterPostPromise;

  if (enterResponse === null) {
    const blurPostPromise = page
      .waitForResponse(isRoomPostResponse, { timeout: 5_000 })
      .catch(() => null);
    await input.blur();
    await blurPostPromise;
  }

  await expect(input).toHaveValue(nickname);
}

export async function configureWaitingRoom(
  page: Page,
  options: Omit<OnlineRoomOptions, 'nickname'>,
): Promise<void> {
  if (options.variant) {
    const btn = page.getByTestId(`room-variant-${options.variant}`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }
  if (options.format) {
    const btn = page.getByTestId(`room-format-${options.format}`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }
  if (options.timerSeconds !== undefined) {
    const btn = page.getByTestId(`room-timer-${options.timerSeconds}`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }
  if (options.shuffleOrder !== undefined) {
    const toggle = page.getByTestId('room-shuffle-toggle');
    const desired = String(options.shuffleOrder);
    if ((await toggle.getAttribute('aria-checked')) !== desired) {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-checked', desired);
  }
}

export async function setWaitingRoomSeatRole(
  page: Page,
  seatIndex: 0 | 1 | 2,
  role: V2OnlineSeatRole,
): Promise<void> {
  const select = page.getByTestId(`room-seat-role-${seatIndex}`);
  await expect(select).toBeEnabled();

  if ((await select.inputValue()) !== role) {
    await Promise.all([
      page.waitForResponse((res) => isRoomPostResponse(res) && res.status() === 200),
      select.selectOption(role),
    ]);
  }

  await expect(select).toHaveValue(role);
  const expectedType = role === 'open' ? 'open' : 'ai';
  await expect(page.getByTestId(`room-seat-${seatIndex}`)).toHaveAttribute(
    'data-seat-type',
    expectedType,
  );
}

export async function kickRoomSeat(page: Page, seatIndex: 0 | 1 | 2): Promise<void> {
  const btn = page.getByTestId(`room-seat-kick-${seatIndex}`);
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.getByTestId(`room-seat-${seatIndex}`)).toHaveAttribute('data-seat-type', 'open');
}

export async function startOnlineGame(
  hostPage: Page,
  allPages: readonly Page[] = [hostPage],
): Promise<void> {
  const startBtn = hostPage.getByTestId('room-start-game-button');
  await expect(startBtn).toBeEnabled();
  await startBtn.click();

  for (const p of allPages) {
    const game = p.getByTestId('game-screen');
    await expect(game).toBeVisible();
    await expect(game).toHaveAttribute('data-mode', 'online');
  }
}

async function waitForRoomPollBoundary(page: Page, pollWaitTimeout: number): Promise<void> {
  try {
    await page.waitForResponse(
      (res) => {
        if (res.request().method() !== 'GET' || res.status() !== 200) {
          return false;
        }
        try {
          return new URL(res.url()).pathname.startsWith('/api/rooms/');
        } catch {
          return false;
        }
      },
      { timeout: pollWaitTimeout },
    );
  } catch {
    // Proceed cleanly even if polling cadence was slower (e.g. finished room)
  }
}

export async function leaveOnlineRoom(page: Page): Promise<void> {
  // Align room exit with a quiet GET /api/rooms/ 200 poll boundary so unmounting
  // avoids aborting an in-flight poll via AbortController.abort() (net::ERR_ABORTED).
  await waitForRoomPollBoundary(page, 2_000);

  const roomLeave = page.getByTestId('room-leave-button');
  if (await roomLeave.isVisible()) {
    await roomLeave.click();
  } else {
    const resultLobby = page.getByTestId('result-lobby-button');
    if (await resultLobby.isVisible()) {
      await resultLobby.click();
    } else {
      await page.getByTestId('lobby-button').click();
    }
  }
  await expect(page.getByTestId('lobby-screen')).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.has('room'))
    .toBe(false);
}

/**
 * Reloads an active online page right after a `GET /api/rooms/` `200` poll boundary
 * so reload executes during the ~1.45s quiet window before the next scheduled poll.
 */
export async function reloadOnlinePage(page: Page, pollWaitTimeout = 6_000): Promise<void> {
  await waitForRoomPollBoundary(page, pollWaitTimeout);

  const response = await page.reload({ waitUntil: 'load' });
  expect(response?.ok(), 'Reload of online room page must return HTTP 2xx').toBe(true);
}

/**
 * Opaque-box coordinate tap at the visual center of a locator.
 * Safe for probing non-interactive/disabled boards (non-active online seat, spectator, AI turn)
 * without triggering Playwright actionability timeouts or using `{ force: true }`.
 */
export async function tapLocatorCenter(page: Page, locator: Locator): Promise<void> {
  await expect(locator, 'Target element must be visible for pointer tap').toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, 'Target element must have a bounding box for pointer tap').not.toBeNull();
  if (!box) {
    throw new Error('Target element bounding box is null');
  }
  expect(box.width, 'Target element width must be > 0').toBeGreaterThan(0);
  expect(box.height, 'Target element height must be > 0').toBeGreaterThan(0);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

export async function readOnlineGameMeta(page: Page): Promise<OnlineGameMeta> {
  const game = page.getByTestId('game-screen');
  await expect(game).toBeVisible();

  const attrs = await game.evaluate((el) => ({
    mode: (el.getAttribute('data-mode') ?? 'local') as 'local' | 'online',
    roomCode: el.getAttribute('data-room-code'),
    mySeat: el.getAttribute('data-my-seat'),
    isHost: el.getAttribute('data-is-host') === 'true',
  }));

  const badge = page.getByTestId('online-connection-badge');
  const connectionStatus =
    (await badge.count()) > 0
      ? ((await badge.getAttribute('data-status')) as
          | 'connected'
          | 'reconnecting'
          | 'disconnected'
          | null)
      : null;

  return {
    ...attrs,
    connectionStatus,
  };
}

export interface ResolveActiveOnlineClientOptions {
  readonly expectedPlayerId?: number;
  readonly expectedPhase?: GameScreenState['phase'];
  readonly minTurnNumber?: number;
  readonly expectedPieceCount?: number;
  readonly timeout?: number;
}

/**
 * Resolves the active human `OnlineClient` safely for BOTH `shuffleOrder: false`
 * AND `shuffleOrder: true` (plus Round 2 where seat indices remap):
 * - Cross-checks `data-my-seat` AND `player-card-{currentPlayer}` text containing `client.nickname`,
 *   and waits until the owning client itself has synced to the required phase/turn/piece count.
 */
export async function resolveActiveOnlineClient(
  clients: readonly OnlineClient[],
  options: ResolveActiveOnlineClientOptions = {},
): Promise<{ readonly client: OnlineClient; readonly state: GameScreenState }> {
  const activeClients = clients.filter((c) => !c.isClosed());
  expect(activeClients.length, 'At least one active OnlineClient is required').toBeGreaterThan(0);

  const timeout = options.timeout ?? 15_000;
  let resolved: { readonly client: OnlineClient; readonly state: GameScreenState } | null = null;

  await expect
    .poll(
      async () => {
        for (const candidate of activeClients) {
          const game = candidate.page.getByTestId('game-screen');
          if (!(await game.isVisible())) {
            continue;
          }
          const state = await readGameScreenState(candidate.page);
          if (state.phase === 'game_over') {
            continue;
          }
          if (options.expectedPhase !== undefined && state.phase !== options.expectedPhase) {
            continue;
          }
          if (
            options.expectedPlayerId !== undefined &&
            state.currentPlayer !== options.expectedPlayerId
          ) {
            continue;
          }
          if (options.minTurnNumber !== undefined && state.turnNumber < options.minTurnNumber) {
            continue;
          }
          if (options.expectedPieceCount !== undefined) {
            const count = await boardPiecesLocator(candidate.page).count();
            if (count !== options.expectedPieceCount) {
              continue;
            }
          }

          const mySeat = await game.getAttribute('data-my-seat');
          if (mySeat === 'spectator') {
            continue;
          }

          const currentCard = playerCardLocator(candidate.page, state.currentPlayer);
          const hasCurrentCard = (await currentCard.count()) > 0;
          if (
            state.aiThinking ||
            (hasCurrentCard && (await currentCard.getAttribute('data-is-ai')) === 'true')
          ) {
            continue;
          }

          const cardText = hasCurrentCard ? ((await currentCard.textContent()) ?? '') : '';
          const matchedByNickname =
            candidate.nickname.length > 0 && cardText.includes(candidate.nickname);
          const matchedBySeat = mySeat === String(state.currentPlayer);

          // When nicknames uniquely identify a player, prefer nickname match (shuffleOrder-safe);
          // otherwise fall back to `data-my-seat === String(currentPlayer)`.
          const anyNicknameMatches =
            activeClients.some((c) => c.nickname.length > 0 && cardText.includes(c.nickname));
          const isOwner = anyNicknameMatches ? matchedByNickname : matchedBySeat;
          if (!isOwner) {
            continue;
          }

          if (state.phase === 'placement') {
            const validCount = await candidate.page
              .locator('[data-valid-move="true"][data-move-type="placement"]')
              .count();
            if (validCount === 0) {
              continue;
            }
          }

          resolved = { client: candidate, state };
          return 'found';
        }
        return 'waiting';
      },
      { timeout },
    )
    .toBe('found');

  if (!resolved) {
    throw new Error('Failed to resolve active online client');
  }
  return resolved;
}

/**
 * Race-free multi-context snake placement runner with exact piece-count & active-owner gating.
 */
export async function completeOnlinePlacement(
  clients: readonly OnlineClient[],
  steps: readonly E2EPlacementStep[],
  initialFixedCount = 0,
): Promise<void> {
  const activeClients = clients.filter((c) => !c.isClosed());

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step) {
      continue;
    }
    const expectedPieces = initialFixedCount + i;
    const { client } = await resolveActiveOnlineClient(activeClients, {
      expectedPhase: 'placement',
      expectedPieceCount: expectedPieces,
    });

    const targetCell = cellLocator(client.page, step.row, step.col);
    await expect(targetCell).toHaveAttribute('data-valid-move', 'true');
    await expect(targetCell).toHaveAttribute('data-move-type', 'placement');

    await placePiece(client.page, step.row, step.col, step.kind);
    await expect(boardPiecesLocator(client.page)).toHaveCount(expectedPieces + 1);
  }

  for (const client of activeClients) {
    await expect(client.page.getByTestId('game-screen')).toHaveAttribute(
      'data-phase',
      'select_piece',
      { timeout: 15_000 },
    );
    await expect(boardPiecesLocator(client.page)).toHaveCount(initialFixedCount + steps.length);
  }
}

export interface OnlineTurnStepInput {
  readonly from: E2ECellPos;
  readonly to: E2ECellPos;
  readonly wall: E2EWallEdge;
  readonly expectedPlayerId?: number;
  readonly minTurnNumber?: number;
}

export interface OnlineTurnStepResult {
  readonly client: OnlineClient;
  readonly turnBefore: number;
  readonly turnAfter: number;
  readonly phaseAfter: GameScreenState['phase'];
}

/**
 * Executes a single synchronized online turn on the active owning client,
 * verifying pre-turn piece ownership & post-commit server turn advancement.
 */
export async function playOnlineTurnStep(
  clients: readonly OnlineClient[],
  turn: OnlineTurnStepInput,
): Promise<OnlineTurnStepResult> {
  const { client, state } = await resolveActiveOnlineClient(clients, {
    expectedPhase: 'select_piece',
    expectedPlayerId: turn.expectedPlayerId,
    minTurnNumber: turn.minTurnNumber,
  });

  const fromCell = cellLocator(client.page, turn.from.row, turn.from.col);
  await expect(fromCell).toHaveAttribute('data-occupied-by', String(state.currentPlayer));

  const turnBefore = state.turnNumber;
  await playHumanTurn(client.page, turn.from, turn.to, turn.wall);

  let after = await readGameScreenState(client.page);
  await expect
    .poll(
      async () => {
        after = await readGameScreenState(client.page);
        return after.phase === 'game_over' || after.turnNumber > turnBefore;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  return {
    client,
    turnBefore,
    turnAfter: after.turnNumber,
    phaseAfter: after.phase,
  };
}

export async function performOnlineIntraTurnCancel(
  activePage: Page,
  from: E2ECellPos,
  to: E2ECellPos,
): Promise<void> {
  const ownerBefore = await cellLocator(activePage, from.row, from.col).getAttribute(
    'data-occupied-by',
  );
  expect(ownerBefore).not.toBe('none');

  await selectCell(activePage, from.row, from.col);
  await moveSelectedTo(activePage, to.row, to.col);
  await cancelTurnMove(activePage);

  await expect(cellLocator(activePage, from.row, from.col)).toHaveAttribute(
    'data-occupied-by',
    ownerBefore ?? '0',
  );
  if (from.row !== to.row || from.col !== to.col) {
    await expect(cellLocator(activePage, to.row, to.col)).toHaveAttribute(
      'data-occupied-by',
      'none',
    );
  }
}

export async function substituteDisconnectedSeatWithAi(
  hostPage: Page,
  playerId: number,
  allPages: readonly Page[] = [hostPage],
  timeout = 15_000,
): Promise<void> {
  await expect(hostPage.getByTestId(`online-seat-status-${playerId}`)).toHaveAttribute(
    'data-status',
    'offline',
    { timeout },
  );
  const subBtn = hostPage.getByTestId(`substitute-ai-button-${playerId}`);
  await expect(subBtn).toBeVisible({ timeout });
  await expect(subBtn).toBeEnabled();
  await subBtn.click();

  await expect(subBtn).toHaveCount(0);
  for (const p of allPages) {
    await expect(p.getByTestId(`online-seat-status-${playerId}`)).toHaveAttribute(
      'data-status',
      'ai',
      { timeout: 15_000 },
    );
    await expect(playerCardLocator(p, playerId)).toHaveAttribute('data-is-ai', 'true');
  }
}

export async function startOnlineRound2(
  hostPage: Page,
  allPages: readonly Page[] = [hostPage],
): Promise<void> {
  const btn = hostPage.getByTestId('online-round2-button');
  await expect(btn).toBeVisible();
  await expect(btn).toBeEnabled();
  await btn.click();

  for (const p of allPages) {
    await expect(p.getByTestId('result-modal')).toHaveCount(0, { timeout: 15_000 });
    const game = p.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-mode', 'online');
    await expect(game).toHaveAttribute('data-format', '2p');
    await expect(game).toHaveAttribute('data-round', '2');
    await expect(game).toHaveAttribute('data-phase', 'placement');
  }
}

export async function triggerOnlineRematch(
  hostPage: Page,
  allPages: readonly Page[] = [hostPage],
): Promise<void> {
  const btn = hostPage.getByTestId('online-rematch-button');
  await expect(btn).toBeVisible();
  await expect(btn).toBeEnabled();
  await btn.click();

  for (const p of allPages) {
    await expect(p.getByTestId('result-modal')).toHaveCount(0, { timeout: 15_000 });
    const game = p.getByTestId('game-screen');
    await expect(game).toHaveAttribute('data-mode', 'online');
    await expect(game).toHaveAttribute('data-phase', 'placement');
    await expect(game).toHaveAttribute('data-round', '1');
    await expect(p.locator('[data-testid^="placed-wall-"]')).toHaveCount(0);
  }
}

export async function returnOnlineToWaiting(
  hostPage: Page,
  allPages: readonly Page[] = [hostPage],
): Promise<void> {
  const btn = hostPage.getByTestId('online-return-waiting-button');
  await expect(btn).toBeVisible();
  await expect(btn).toBeEnabled();
  await btn.click();

  for (const p of allPages) {
    const waiting = p.getByTestId('online-room-screen');
    await expect(waiting).toBeVisible({ timeout: 15_000 });
    await expect(waiting).toHaveAttribute('data-room-status', 'waiting');
  }
}

async function runOnlineTurnSequence(
  clients: readonly OnlineClient[],
  turns: readonly OnlineTurnStepInput[],
  observerPages: readonly Page[] = [],
): Promise<void> {
  const activeClients = clients.filter((c) => !c.isClosed());
  const firstClient = activeClients[0];
  if (!firstClient) {
    throw new Error('At least one active OnlineClient is required');
  }

  let nextMinTurn = (await readGameScreenState(firstClient.page)).turnNumber;
  for (const turn of turns) {
    const res = await playOnlineTurnStep(activeClients, {
      ...turn,
      minTurnNumber: nextMinTurn,
    });
    nextMinTurn = res.turnAfter;
  }

  const allPages = [...activeClients.map((c) => c.page), ...observerPages];
  for (const p of allPages) {
    await waitForGameOver(p, 15_000);
  }
}

/**
 * Oracle-verified 6-turn 2P Wall Go I completion across 2 online human clients (`P0=45, P1=4`).
 * Works identically for Standalone 2P and Prison Match Round 2 (1:1).
 */
export async function completeOnline2PWallGo1Fast(
  clients: readonly OnlineClient[],
  observerPages: readonly Page[] = [],
): Promise<void> {
  await completeOnlinePlacement(clients, SCRIPT_2P_WG1_FAST_PLACEMENTS, 4);
  await runOnlineTurnSequence(
    clients,
    [
      { expectedPlayerId: 0, from: { row: 1, col: 6 }, to: { row: 1, col: 6 }, wall: hWall(0, 6) },
      { expectedPlayerId: 1, from: { row: 1, col: 5 }, to: { row: 0, col: 5 }, wall: vWall(0, 4) },
      { expectedPlayerId: 0, from: { row: 1, col: 6 }, to: { row: 1, col: 5 }, wall: hWall(0, 5) },
      { expectedPlayerId: 1, from: { row: 5, col: 1 }, to: { row: 6, col: 1 }, wall: hWall(5, 1) },
      { expectedPlayerId: 0, from: { row: 6, col: 2 }, to: { row: 6, col: 2 }, wall: vWall(6, 1) },
      { expectedPlayerId: 1, from: { row: 6, col: 0 }, to: { row: 6, col: 0 }, wall: hWall(5, 0) },
    ],
    observerPages,
  );
}

/**
 * Oracle-verified 7-turn 3P Wall Go I completion across 3 online human clients
 * (`P0=43 [1st survivor], P1=4 [2nd -> R2], P2=2 [3rd -> R2]`).
 */
export async function completeOnline3PWallGo1ScriptD(
  clients: readonly OnlineClient[],
  observerPages: readonly Page[] = [],
): Promise<void> {
  await completeOnlinePlacement(clients, SCRIPT_D_PLACEMENTS, 0);
  await runOnlineTurnSequence(
    clients,
    [
      { expectedPlayerId: 0, from: { row: 1, col: 0 }, to: { row: 1, col: 0 }, wall: hWall(0, 0) },
      { expectedPlayerId: 1, from: { row: 5, col: 0 }, to: { row: 5, col: 0 }, wall: hWall(4, 0) },
      { expectedPlayerId: 2, from: { row: 0, col: 1 }, to: { row: 0, col: 1 }, wall: hWall(0, 1) },
      { expectedPlayerId: 0, from: { row: 5, col: 2 }, to: { row: 5, col: 2 }, wall: vWall(5, 1) },
      { expectedPlayerId: 1, from: { row: 5, col: 1 }, to: { row: 5, col: 1 }, wall: hWall(4, 1) },
      { expectedPlayerId: 2, from: { row: 0, col: 1 }, to: { row: 0, col: 1 }, wall: vWall(0, 1) },
      { expectedPlayerId: 0, from: { row: 5, col: 2 }, to: { row: 6, col: 2 }, wall: vWall(6, 1) },
    ],
    observerPages,
  );
}

/**
 * Oracle-verified 7-turn 3P Wall Go II completion across 3 online human clients (`P0=43, P1=4, P2=2`).
 */
export async function completeOnline3PWallGo2ScriptD2(
  clients: readonly OnlineClient[],
  observerPages: readonly Page[] = [],
): Promise<void> {
  await completeOnlinePlacement(clients, SCRIPT_D2_PLACEMENTS, 0);
  await runOnlineTurnSequence(
    clients,
    [
      { expectedPlayerId: 0, from: { row: 4, col: 2 }, to: { row: 5, col: 2 }, wall: vWall(5, 1) },
      { expectedPlayerId: 1, from: { row: 6, col: 0 }, to: { row: 5, col: 0 }, wall: hWall(4, 0) },
      { expectedPlayerId: 2, from: { row: 1, col: 0 }, to: { row: 0, col: 0 }, wall: hWall(0, 0) },
      { expectedPlayerId: 0, from: { row: 5, col: 2 }, to: { row: 6, col: 2 }, wall: vWall(6, 1) },
      { expectedPlayerId: 1, from: { row: 6, col: 1 }, to: { row: 5, col: 1 }, wall: hWall(4, 1) },
      { expectedPlayerId: 2, from: { row: 0, col: 2 }, to: { row: 0, col: 1 }, wall: hWall(0, 1) },
      { expectedPlayerId: 0, from: { row: 1, col: 3 }, to: { row: 0, col: 2 }, wall: vWall(0, 1) },
    ],
    observerPages,
  );
}

/**
 * Oracle-verified 12-turn 3P Wall Go I tie scenario across 3 online human clients:
 * - `'tied_for_first'`: P0=3, P1=3, P2=2 -> ranks `[1, 1, 3]`
 * - `'three_way_tie'`: P0=3, P1=3, P2=3 -> ranks `[1, 1, 1]`
 */
export async function completeOnline3PTieScenario(
  clients: readonly OnlineClient[],
  kind: 'tied_for_first' | 'three_way_tie',
  observerPages: readonly Page[] = [],
): Promise<void> {
  await completeOnlinePlacement(clients, SCRIPT_3P_TIE_PLACEMENTS, 0);
  await runOnlineTurnSequence(
    clients,
    [
      { expectedPlayerId: 0, from: { row: 1, col: 0 }, to: { row: 0, col: 0 }, wall: vWall(0, 0) },
      {
        expectedPlayerId: 1,
        from: { row: 0, col: 2 },
        to: { row: 0, col: 2 },
        wall: kind === 'tied_for_first' ? hWall(0, 2) : vWall(0, 2),
      },
      { expectedPlayerId: 2, from: { row: 1, col: 2 }, to: { row: 1, col: 2 }, wall: vWall(1, 2) },
      { expectedPlayerId: 0, from: { row: 2, col: 0 }, to: { row: 1, col: 0 }, wall: vWall(1, 0) },
      { expectedPlayerId: 1, from: { row: 0, col: 2 }, to: { row: 0, col: 1 }, wall: vWall(0, 1) },
      { expectedPlayerId: 2, from: { row: 2, col: 2 }, to: { row: 2, col: 2 }, wall: vWall(2, 2) },
      { expectedPlayerId: 0, from: { row: 1, col: 0 }, to: { row: 2, col: 0 }, wall: hWall(2, 0) },
      { expectedPlayerId: 1, from: { row: 2, col: 1 }, to: { row: 2, col: 1 }, wall: hWall(2, 1) },
      { expectedPlayerId: 2, from: { row: 2, col: 2 }, to: { row: 2, col: 2 }, wall: hWall(2, 2) },
      { expectedPlayerId: 0, from: { row: 2, col: 0 }, to: { row: 2, col: 0 }, wall: vWall(2, 0) },
      { expectedPlayerId: 1, from: { row: 2, col: 1 }, to: { row: 1, col: 1 }, wall: vWall(1, 1) },
      { expectedPlayerId: 2, from: { row: 2, col: 2 }, to: { row: 2, col: 2 }, wall: vWall(2, 1) },
    ],
    observerPages,
  );
}

// --- Match History & Full Replay Helpers ---

export interface CompleteBoardPiece {
  readonly owner: number;
  readonly kind: E2EPieceKind;
  readonly row: number;
  readonly col: number;
}

export interface CompleteBoardWall extends E2EWallEdge {
  readonly owner: number;
  readonly lastWall: boolean;
}

export interface CompleteBoardTerritoryCell {
  readonly row: number;
  readonly col: number;
  readonly owner: number;
  readonly size: number;
}

export interface CompleteBoardTerritoryBadge {
  readonly row: number;
  readonly col: number;
  readonly owner: number;
  readonly count: number;
}

export interface CompleteBoardSnapshot {
  readonly pieces: readonly CompleteBoardPiece[];
  readonly walls: readonly CompleteBoardWall[];
  readonly territories: readonly CompleteBoardTerritoryCell[];
  readonly badges: readonly CompleteBoardTerritoryBadge[];
}

/**
 * Reads complete board state (pieces, walls + lastWall, territory washes, and badges)
 * strictly via frozen `<Board>` attributes inside `scope ?? page`.
 * Identical structure on live `game-screen` and `replay-board` for exact equality assertions.
 */
export async function readBoardCompleteSnapshot(
  page: Page,
  scope?: Locator,
): Promise<CompleteBoardSnapshot> {
  const container = scope ?? page.locator('body');
  return container.evaluate((rootEl) => {
    const pieces = Array.from(
      rootEl.querySelectorAll(
        '[data-testid^="cell-"][data-occupied-by]:not([data-occupied-by="none"])',
      ),
    )
      .map((el) => ({
        owner: Number(el.getAttribute('data-occupied-by') ?? '-1'),
        kind: (el.getAttribute('data-piece-kind') ?? 'standard') as E2EPieceKind,
        row: Number(el.getAttribute('data-row') ?? '-1'),
        col: Number(el.getAttribute('data-col') ?? '-1'),
      }))
      .sort((a, b) =>
        a.owner !== b.owner
          ? a.owner - b.owner
          : a.row !== b.row
            ? a.row - b.row
            : a.col - b.col,
      );

    const walls = Array.from(rootEl.querySelectorAll('[data-testid^="placed-wall-"]'))
      .map((el) => ({
        orientation: (el.getAttribute('data-orientation') ?? 'h') as E2EWallOrientation,
        row: Number(el.getAttribute('data-row') ?? '-1'),
        col: Number(el.getAttribute('data-col') ?? '-1'),
        owner: Number(el.getAttribute('data-owner') ?? '-1'),
        lastWall: el.getAttribute('data-last-wall') === 'true',
      }))
      .sort((a, b) => {
        if (a.orientation !== b.orientation) {
          return a.orientation.localeCompare(b.orientation);
        }
        return a.row !== b.row ? a.row - b.row : a.col - b.col;
      });

    const territories = Array.from(
      rootEl.querySelectorAll(
        '[data-testid^="cell-"][data-territory-owner]:not([data-territory-owner="none"])',
      ),
    )
      .map((el) => ({
        row: Number(el.getAttribute('data-row') ?? '-1'),
        col: Number(el.getAttribute('data-col') ?? '-1'),
        owner: Number(el.getAttribute('data-territory-owner') ?? '-1'),
        size: Number(el.getAttribute('data-territory-size') ?? '0'),
      }))
      .sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));

    const badges = Array.from(rootEl.querySelectorAll('[data-testid^="territory-badge-"]'))
      .map((el) => {
        const testId = el.getAttribute('data-testid') ?? '';
        const match = /^territory-badge-(\d+)-(\d+)$/.exec(testId);
        return {
          row: match ? Number(match[1]) : -1,
          col: match ? Number(match[2]) : -1,
          owner: Number(el.getAttribute('data-owner') ?? '-1'),
          count: Number(el.getAttribute('data-count') ?? '0'),
        };
      })
      .sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));

    return { pieces, walls, territories, badges };
  });
}

/**
 * Waits for all connected clients/spectators to converge on matching `phase` and `turnNumber`,
 * then asserts exact deep equality of `readBoardCompleteSnapshot` across all pages.
 */
export async function assertAllClientsBoardSynced(
  pages: readonly Page[],
  timeout = 15_000,
): Promise<CompleteBoardSnapshot> {
  expect(pages.length, 'Expected at least 2 pages to compare sync').toBeGreaterThanOrEqual(2);

  await expect
    .poll(
      async () => {
        const states = await Promise.all(pages.map((p) => readGameScreenState(p)));
        const ref = states[0];
        if (!ref) {
          return false;
        }
        return states.every(
          (s) =>
            s.phase === ref.phase &&
            s.turnNumber === ref.turnNumber &&
            s.currentPlayer === ref.currentPlayer,
        );
      },
      { timeout },
    )
    .toBe(true);

  const snapshots = await Promise.all(
    pages.map((p) => readBoardCompleteSnapshot(p, p.getByTestId('game-screen'))),
  );
  const reference = snapshots[0];
  if (!reference) {
    throw new Error('Missing reference board snapshot');
  }
  for (let i = 1; i < snapshots.length; i += 1) {
    expect(snapshots[i], `Client #${i} board snapshot diverged from Client #0`).toEqual(reference);
  }
  return reference;
}

/**
 * Purely opaque-box verification that a `history-match-card-{id}` renders a visible
 * mini 7x7 board preview (`svg`/`canvas`/`[role="img"]` >= 32x32 OR roughly-square >= 49-child grid).
 */
export async function assertCardHasMiniBoardPreview(card: Locator): Promise<void> {
  await expect(card, 'History match card must be visible').toBeVisible();
  const result = await card.evaluate((root) => {
    const isVisibleWithMinSize = (el: Element): boolean => {
      let curr: Element | null = el;
      while (curr) {
        if (curr.hasAttribute('hidden')) {
          return false;
        }
        const style = window.getComputedStyle(curr);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse' ||
          Number.parseFloat(style.opacity || '1') === 0
        ) {
          return false;
        }
        if (curr === root) {
          break;
        }
        curr = curr.parentElement;
      }
      const rect = el.getBoundingClientRect();
      return rect.width >= 32 && rect.height >= 32;
    };

    for (const node of root.querySelectorAll('svg, canvas, [role="img"]')) {
      if (isVisibleWithMinSize(node)) {
        const rect = node.getBoundingClientRect();
        return {
          found: true,
          kind: node.tagName.toLowerCase(),
          width: rect.width,
          height: rect.height,
        };
      }
    }

    for (const node of root.querySelectorAll('*')) {
      if (node.children.length >= 49 && isVisibleWithMinSize(node)) {
        const rect = node.getBoundingClientRect();
        if (Math.abs(rect.width - rect.height) <= 8) {
          return {
            found: true,
            kind: 'grid-49',
            width: rect.width,
            height: rect.height,
          };
        }
      }
    }

    return { found: false, kind: 'none', width: 0, height: 0 };
  });

  expect(
    result.found,
    `Expected history card to render a visible MiniBoardPreview (got kind=${result.kind}, ${result.width.toFixed(1)}x${result.height.toFixed(1)})`,
  ).toBe(true);
}

export interface HistoryMatchCardSummary {
  readonly id: string;
  readonly source: 'online' | 'local';
  readonly variant: E2ERuleVariant;
  readonly format: E2EGameFormat;
  readonly round: number;
  readonly text: string;
}

export interface HistoryStatsRow {
  readonly cells: readonly string[];
  readonly text: string;
}

export interface ReplayScreenState {
  readonly matchId: string;
  readonly step: number;
  readonly totalSteps: number;
  readonly playing: boolean;
  readonly speed: V2ReplaySpeed | null;
  readonly moveCount: number;
  readonly description: string;
}

export async function setHistoryFilter(page: Page, filter: V2HistoryFilter): Promise<void> {
  const btn = page.getByTestId(`history-filter-${filter}`);
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.getByTestId('history-screen')).toHaveAttribute('data-active-filter', filter);
}

export async function searchHistory(page: Page, query: string): Promise<void> {
  const input = page.getByTestId('history-search-input');
  await expect(input).toBeVisible();
  await input.fill(query);
  await expect(input).toHaveValue(query);
}

export async function readHistoryMatchCards(page: Page): Promise<readonly HistoryMatchCardSummary[]> {
  const list = page.getByTestId('history-match-list');
  if ((await list.count()) === 0) {
    return [];
  }
  return list.locator('[data-testid^="history-match-card-"]').evaluateAll((nodes) =>
    nodes.map((el) => ({
      id: el.getAttribute('data-match-id') ?? '',
      source: (el.getAttribute('data-source') ?? 'local') as 'online' | 'local',
      variant: (el.getAttribute('data-variant') ?? 'wallgo1') as E2ERuleVariant,
      format: (el.getAttribute('data-format') ?? '3p') as E2EGameFormat,
      round: Number(el.getAttribute('data-round') ?? '1'),
      text: (el.textContent ?? '').trim(),
    })),
  );
}

export async function readHistoryStatsTable(page: Page): Promise<{
  readonly playerCount: number;
  readonly rows: readonly HistoryStatsRow[];
}> {
  const table = page.getByTestId('history-stats-table');
  await expect(table).toBeVisible();
  const playerCount = Number((await table.getAttribute('data-player-count')) ?? '0');

  const rows = await table.evaluate((el) => {
    const bodyRows = Array.from(el.querySelectorAll('tbody tr'));
    const allRows =
      bodyRows.length > 0
        ? bodyRows
        : Array.from(el.querySelectorAll('tr')).filter((tr) => tr.querySelectorAll('td').length > 0);
    return allRows.map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td, th')).map((cell) =>
        (cell.textContent ?? '').trim(),
      );
      return {
        cells,
        text: (tr.textContent ?? '').trim(),
      };
    });
  });

  return { playerCount, rows };
}

export interface WaitForHistoryCardCriteria {
  readonly source?: 'online' | 'local';
  readonly variant?: E2ERuleVariant;
  readonly format?: E2EGameFormat;
  readonly round?: 1 | 2;
  readonly textContains?: string;
}

export async function waitForHistoryMatchCard(
  page: Page,
  criteria: WaitForHistoryCardCriteria = {},
  timeout = 10_000,
): Promise<HistoryMatchCardSummary> {
  let matched: HistoryMatchCardSummary | undefined;

  await expect
    .poll(
      async () => {
        const cards = await readHistoryMatchCards(page);
        matched = cards.find(
          (c) =>
            (criteria.source === undefined || c.source === criteria.source) &&
            (criteria.variant === undefined || c.variant === criteria.variant) &&
            (criteria.format === undefined || c.format === criteria.format) &&
            (criteria.round === undefined || c.round === criteria.round) &&
            (criteria.textContains === undefined || c.text.includes(criteria.textContains)),
        );
        return Boolean(matched);
      },
      { timeout },
    )
    .toBe(true);

  if (!matched) {
    throw new Error(`No history match card matched criteria: ${JSON.stringify(criteria)}`);
  }
  return matched;
}

export async function readReplayState(page: Page): Promise<ReplayScreenState> {
  const screen = page.getByTestId('replay-screen');
  await expect(screen).toBeVisible();

  const attrs = await screen.evaluate((el) => ({
    matchId: el.getAttribute('data-match-id') ?? '',
    step: Number(el.getAttribute('data-step') ?? '0'),
    totalSteps: Number(el.getAttribute('data-total-steps') ?? '0'),
    playing: el.getAttribute('data-playing') === 'true',
  }));

  const speedBtn = page.getByTestId('replay-speed-button');
  const speedAttr = (await speedBtn.count()) > 0 ? await speedBtn.getAttribute('data-speed') : null;
  const speed: V2ReplaySpeed | null =
    speedAttr === '0.5' || speedAttr === '1' || speedAttr === '2' ? speedAttr : null;

  const moveList = page.getByTestId('replay-move-list');
  const moveCount =
    (await moveList.count()) > 0
      ? Number((await moveList.getAttribute('data-move-count')) ?? '0')
      : 0;

  const description = ((await page.getByTestId('replay-step-description').textContent()) ?? '').trim();

  return {
    ...attrs,
    speed,
    moveCount,
    description,
  };
}

export async function openReplayForMatch(
  page: Page,
  matchId: string,
  options?: { readonly expectSteps?: boolean },
): Promise<ReplayScreenState> {
  const btn = page.getByTestId(`history-replay-button-${matchId}`);
  await expect(btn).toBeVisible();
  await btn.click();

  const screen = page.getByTestId('replay-screen');
  await expect(screen).toBeVisible();
  await expect(screen).toHaveAttribute('data-match-id', matchId);
  if (options?.expectSteps !== false) {
    await expect(screen).toHaveAttribute('data-total-steps', /^[1-9]\d*$/);
  }
  await expect(page.getByTestId('replay-board')).toBeVisible();
  return readReplayState(page);
}

export async function scrubReplayTo(page: Page, step: number): Promise<ReplayScreenState> {
  const scrubber = page.getByTestId('replay-scrubber');
  await expect(scrubber).toBeVisible();
  await scrubber.fill(String(step));
  await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-step', String(step));
  await expect(page.getByTestId('replay-step-indicator')).toHaveAttribute('data-step', String(step));
  return readReplayState(page);
}

export async function jumpReplayToMoveItem(page: Page, step: number): Promise<ReplayScreenState> {
  const item = page.getByTestId(`replay-move-item-${step}`);
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-step', String(step));
  await expect(page.getByTestId('replay-step-indicator')).toHaveAttribute('data-step', String(step));
  await expect(item).toHaveAttribute('aria-current', 'step');
  return readReplayState(page);
}

export async function closeReplayViewer(page: Page): Promise<void> {
  await page.getByTestId('replay-close-button').click();
  await expect(page.getByTestId('replay-screen')).toHaveCount(0);
  await expect(page.getByTestId('history-screen')).toBeVisible();
}

export interface ReplayStepFrame {
  readonly state: ReplayScreenState;
  readonly board: CompleteBoardSnapshot;
}

/**
 * Steps sequentially through an entire replay from Step `0` to `totalSteps`,
 * verifying monotonic `data-step`, `replay-step-indicator`, `aria-current="step"`,
 * boundary button disablement, and capturing complete board snapshots at every step.
 */
export async function stepThroughFullReplay(
  page: Page,
  onStep?: (step: number, state: ReplayScreenState, board: CompleteBoardSnapshot) => Promise<void> | void,
): Promise<readonly ReplayStepFrame[]> {
  const initial = await readReplayState(page);
  if (initial.step !== 0) {
    await page.getByTestId('replay-first-button').click();
    await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-step', '0');
  }

  await expect(page.getByTestId('replay-first-button')).toBeDisabled();
  await expect(page.getByTestId('replay-prev-button')).toBeDisabled();

  const replayBoard = page.getByTestId('replay-board');
  const frames: ReplayStepFrame[] = [];

  const step0State = await readReplayState(page);
  const step0Board = await readBoardCompleteSnapshot(page, replayBoard);
  frames.push({ state: step0State, board: step0Board });
  if (onStep) {
    await onStep(0, step0State, step0Board);
  }

  for (let s = 1; s <= step0State.totalSteps; s += 1) {
    await page.getByTestId('replay-next-button').click();
    await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-step', String(s));
    await expect(page.getByTestId('replay-step-indicator')).toHaveAttribute('data-step', String(s));
    await expect(page.getByTestId(`replay-move-item-${s}`)).toHaveAttribute('aria-current', 'step');

    const state = await readReplayState(page);
    expect(state.description.length, `Step ${s} description must be non-empty`).toBeGreaterThan(0);
    const board = await readBoardCompleteSnapshot(page, replayBoard);
    frames.push({ state, board });
    if (onStep) {
      await onStep(s, state, board);
    }
  }

  await expect(page.getByTestId('replay-next-button')).toBeDisabled();
  await expect(page.getByTestId('replay-last-button')).toBeDisabled();

  return frames;
}

// --- Multi-Device Responsive Helpers ---

interface MeasuredBox {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function boxesOverlapBothAxes(a: MeasuredBox, b: MeasuredBox): {
  readonly overlaps: boolean;
  readonly overlapX: number;
  readonly overlapY: number;
} {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return {
    overlaps: overlapX > OVERLAP_SUBPIXEL_TOLERANCE_PX && overlapY > OVERLAP_SUBPIXEL_TOLERANCE_PX,
    overlapX,
    overlapY,
  };
}

/**
 * Verifies strict zero horizontal overflow (`scrollWidth <= innerWidth`) across
 * `documentElement`, `body`, `#root`, and every visible `main, [role="main"]`
 * (catching container clipping even under `tokens.css` `html, body, #root { overflow: hidden }`),
 * plus optional exact viewport matching.
 */
export async function assertHorizontalZeroOverflow(
  page: Page,
  expectedViewport?: ViewportSize,
): Promise<void> {
  if (expectedViewport) {
    expect(page.viewportSize()).toEqual(expectedViewport);
  }

  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const docScrollWidth = doc.scrollWidth;
    const bodyScrollWidth = body?.scrollWidth ?? 0;

    const containers: {
      readonly label: string;
      readonly scrollWidth: number;
      readonly clientWidth: number;
    }[] = [];
    const seen = new Set<Element>();
    const root = document.getElementById('root');
    if (root) {
      seen.add(root);
    }
    for (const el of document.querySelectorAll('main, [role="main"]')) {
      seen.add(el);
    }

    for (const el of seen) {
      if (el.hasAttribute('hidden')) {
        continue;
      }
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
      ) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || el.clientWidth <= 0) {
        continue;
      }
      const testId = el.getAttribute('data-testid');
      const label = testId
        ? `[data-testid="${testId}"]`
        : el.id
          ? `#${el.id}`
          : el.tagName.toLowerCase();
      containers.push({
        label,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      });
    }

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: Math.max(docScrollWidth, bodyScrollWidth),
      docScrollWidth,
      bodyScrollWidth,
      containers,
    };
  });

  if (expectedViewport) {
    expect(metrics.innerWidth, 'window.innerWidth matches expected viewport').toBe(
      expectedViewport.width,
    );
    expect(metrics.innerHeight, 'window.innerHeight matches expected viewport').toBe(
      expectedViewport.height,
    );
  }

  expect(
    metrics.scrollWidth,
    `Horizontal overflow detected: scrollWidth=${metrics.scrollWidth}px (doc=${metrics.docScrollWidth}px, body=${metrics.bodyScrollWidth}px) > innerWidth=${metrics.innerWidth}px (delta=${metrics.scrollWidth - metrics.innerWidth}px)`,
  ).toBeLessThanOrEqual(metrics.innerWidth);

  for (const container of metrics.containers) {
    expect(
      container.scrollWidth,
      `Container ${container.label} horizontal overflow: scrollWidth=${container.scrollWidth}px > clientWidth=${container.clientWidth}px + 1`,
    ).toBeLessThanOrEqual(container.clientWidth + 1);
    expect(
      container.scrollWidth,
      `Container ${container.label} horizontal overflow past viewport: scrollWidth=${container.scrollWidth}px > innerWidth=${metrics.innerWidth}px + 1`,
    ).toBeLessThanOrEqual(metrics.innerWidth + 1);
  }
}

/**
 * Verifies every listed `data-testid` is visible, non-zero, and fits horizontally
 * within `[-0.5, innerWidth + 0.5]`.
 */
export async function assertElementsWithinHorizontalViewport(
  page: Page,
  testIds: readonly string[],
): Promise<void> {
  const innerWidth = await page.evaluate(() => window.innerWidth);

  for (const testId of testIds) {
    const locator = page.getByTestId(testId);
    await expect(locator, `Element "${testId}" must be visible`).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `Element "${testId}" must have a bounding box`).not.toBeNull();
    if (!box) {
      throw new Error(`Missing bounding box for "${testId}"`);
    }
    expect(box.width, `Element "${testId}" width must be > 0`).toBeGreaterThan(0);
    expect(box.height, `Element "${testId}" height must be > 0`).toBeGreaterThan(0);
    expect(
      box.x,
      `Element "${testId}" left edge (${box.x.toFixed(2)}px) clipped past left edge`,
    ).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    expect(
      box.x + box.width,
      `Element "${testId}" right edge (${(box.x + box.width).toFixed(2)}px) overflows viewport width (${innerWidth}px)`,
    ).toBeLessThanOrEqual(innerWidth + VIEWPORT_SUBPIXEL_TOLERANCE_PX);
  }
}

/**
 * Mobile Game Screen 5-landmark layout check:
 * - All 5 painted landmarks (`GAME_PAINTED_REGION_TESTIDS`) visible, non-zero, horizontally
 *   contained, mutually non-overlapping, `board-frame` 1:1 square (`<= 1.5px`) & `>= 300px`.
 * - When `requireVerticalViewportFit` is true (`390x844`, `412x915`), also verifies full
 *   vertical viewport fit & `assertZeroOverflow`.
 * - When `requireVerticalViewportFit` is false (`375x667`, `360x740`), verifies horizontal
 *   zero overflow & every visible button inside `action-dock` fits horizontally within viewport.
 */
export async function assertMobileGameRegionsNoOverlap(
  page: Page,
  options: { readonly requireVerticalViewportFit: boolean },
): Promise<void> {
  if (options.requireVerticalViewportFit) {
    await assertZeroOverflow(page);
  } else {
    await assertHorizontalZeroOverflow(page);
  }

  const { innerWidth, innerHeight } = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));

  const measured: MeasuredBox[] = [];
  for (const testId of GAME_PAINTED_REGION_TESTIDS) {
    const locator = page.getByTestId(testId);
    await expect(locator, `Painted region "${testId}" must be visible`).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `Painted region "${testId}" must have a bounding box`).not.toBeNull();
    if (!box) {
      throw new Error(`Missing bounding box for "${testId}"`);
    }

    expect(box.width, `Region "${testId}" width must be > 0`).toBeGreaterThan(0);
    expect(box.height, `Region "${testId}" height must be > 0`).toBeGreaterThan(0);
    expect(
      box.x,
      `Region "${testId}" left edge (${box.x.toFixed(2)}px) clipped past left edge`,
    ).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    expect(
      box.x + box.width,
      `Region "${testId}" right edge (${(box.x + box.width).toFixed(2)}px) overflows viewport width (${innerWidth}px)`,
    ).toBeLessThanOrEqual(innerWidth + VIEWPORT_SUBPIXEL_TOLERANCE_PX);

    if (options.requireVerticalViewportFit) {
      expect(
        box.y,
        `Region "${testId}" top edge (${box.y.toFixed(2)}px) clipped past viewport top`,
      ).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE_PX);
      expect(
        box.y + box.height,
        `Region "${testId}" bottom edge (${(box.y + box.height).toFixed(2)}px) overflows viewport height (${innerHeight}px)`,
      ).toBeLessThanOrEqual(innerHeight + VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    }

    measured.push({
      label: testId,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });
  }

  for (let i = 0; i < measured.length; i += 1) {
    const a = measured[i];
    if (!a) {
      continue;
    }
    for (let j = i + 1; j < measured.length; j += 1) {
      const b = measured[j];
      if (!b) {
        continue;
      }
      const { overlaps, overlapX, overlapY } = boxesOverlapBothAxes(a, b);
      expect(
        overlaps,
        `Painted regions "${a.label}" and "${b.label}" overlap by ${overlapX.toFixed(2)}px x ${overlapY.toFixed(2)}px`,
      ).toBe(false);
    }
  }

  const board = measured.find((m) => m.label === 'board-frame');
  expect(board, 'board-frame must be measured').toBeDefined();
  if (board) {
    const delta = Math.abs(board.width - board.height);
    expect(
      delta,
      `Mobile board-frame must be 1:1 square (got ${board.width.toFixed(2)}x${board.height.toFixed(2)}, delta=${delta.toFixed(2)}px)`,
    ).toBeLessThanOrEqual(BOARD_SQUARENESS_TOLERANCE_PX);
    expect(
      board.width,
      `Mobile board-frame width (${board.width.toFixed(2)}px) must be >= 300px`,
    ).toBeGreaterThanOrEqual(300);
  }

  // Verify every visible button inside action-dock fits within horizontal viewport
  const dockButtons = page.getByTestId('action-dock').locator('button');
  const btnCount = await dockButtons.count();
  for (let i = 0; i < btnCount; i += 1) {
    const btn = dockButtons.nth(i);
    if (!(await btn.isVisible())) {
      continue;
    }
    const box = await btn.boundingBox();
    if (!box) {
      continue;
    }
    const label = (await btn.getAttribute('data-testid')) ?? `action-dock-btn#${i}`;
    expect(
      box.x,
      `action-dock button "${label}" clipped past left edge (${box.x.toFixed(2)}px)`,
    ).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    expect(
      box.x + box.width,
      `action-dock button "${label}" overflows right edge (${(box.x + box.width).toFixed(2)}px > ${innerWidth}px)`,
    ).toBeLessThanOrEqual(innerWidth + VIEWPORT_SUBPIXEL_TOLERANCE_PX);
  }
}

/**
 * Verifies Replay Viewer layout cleanly across Desktop, iPad, and Mobile:
 * zero horizontal overflow, zero duplicate visible testids, 1:1 square `board-frame` (>= 280px),
 * transport & header controls horizontally inside viewport, and zero overlap between
 * `replay-board`'s `board-frame` and step/move panels.
 */
export async function assertReplayLayoutClean(
  page: Page,
  expectedViewport?: ViewportSize,
): Promise<void> {
  await assertHorizontalZeroOverflow(page, expectedViewport);
  await assertNoDuplicateVisibleTestIds(page);

  const innerWidth = await page.evaluate(() => window.innerWidth);
  const replayBoardFrame = page.getByTestId('replay-board').getByTestId('board-frame');
  await expect(replayBoardFrame, 'replay-board must contain visible board-frame').toBeVisible();
  const boardBox = await replayBoardFrame.boundingBox();
  expect(boardBox, 'replay board-frame must have bounding box').not.toBeNull();
  if (!boardBox) {
    throw new Error('Missing replay board-frame bounding box');
  }

  expect(
    Math.abs(boardBox.width - boardBox.height),
    `Replay board-frame must be 1:1 square (got ${boardBox.width.toFixed(2)}x${boardBox.height.toFixed(2)})`,
  ).toBeLessThanOrEqual(BOARD_SQUARENESS_TOLERANCE_PX);
  expect(
    boardBox.width,
    `Replay board-frame width (${boardBox.width.toFixed(2)}px) must be >= 280px`,
  ).toBeGreaterThanOrEqual(280);
  expect(boardBox.x).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE_PX);
  expect(boardBox.x + boardBox.width).toBeLessThanOrEqual(
    innerWidth + VIEWPORT_SUBPIXEL_TOLERANCE_PX,
  );

  await assertElementsWithinHorizontalViewport(page, [
    'replay-first-button',
    'replay-prev-button',
    'replay-play-pause-button',
    'replay-speed-button',
    'replay-next-button',
    'replay-last-button',
    'replay-scrubber',
    'replay-close-button',
    'language-toggle',
  ]);

  const boardMeasured: MeasuredBox = {
    label: 'replay-board/board-frame',
    x: boardBox.x,
    y: boardBox.y,
    width: boardBox.width,
    height: boardBox.height,
  };

  for (const siblingId of [
    'replay-step-indicator',
    'replay-step-description',
    'replay-move-list',
  ] as const) {
    const sibling = page.getByTestId(siblingId);
    await expect(sibling).toBeVisible();
    const sibBox = await sibling.boundingBox();
    expect(sibBox, `Replay panel "${siblingId}" must have bounding box`).not.toBeNull();
    if (!sibBox) {
      continue;
    }
    expect(
      sibBox.x,
      `Replay panel "${siblingId}" left edge (${sibBox.x.toFixed(2)}px) clipped past left edge`,
    ).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    expect(
      sibBox.x + sibBox.width,
      `Replay panel "${siblingId}" right edge (${(sibBox.x + sibBox.width).toFixed(2)}px) overflows viewport width (${innerWidth}px)`,
    ).toBeLessThanOrEqual(innerWidth + VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    const { overlaps, overlapX, overlapY } = boxesOverlapBothAxes(boardMeasured, {
      label: siblingId,
      x: sibBox.x,
      y: sibBox.y,
      width: sibBox.width,
      height: sibBox.height,
    });
    expect(
      overlaps,
      `Replay board overlaps "${siblingId}" by ${overlapX.toFixed(2)}px x ${overlapY.toFixed(2)}px`,
    ).toBe(false);
  }
}

async function assertMainContainersVerticalNoOverflow(page: Page): Promise<void> {
  const containers = await page.evaluate(() => {
    const out: {
      readonly label: string;
      readonly scrollHeight: number;
      readonly clientHeight: number;
    }[] = [];
    const seen = new Set<Element>();
    const root = document.getElementById('root');
    if (root) {
      seen.add(root);
    }
    for (const el of document.querySelectorAll('main, [role="main"]')) {
      seen.add(el);
    }

    for (const el of seen) {
      if (el.hasAttribute('hidden')) {
        continue;
      }
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
      ) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || el.clientHeight <= 0) {
        continue;
      }
      const testId = el.getAttribute('data-testid');
      const label = testId
        ? `[data-testid="${testId}"]`
        : el.id
          ? `#${el.id}`
          : el.tagName.toLowerCase();
      out.push({
        label,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      });
    }
    return out;
  });

  for (const container of containers) {
    expect(
      container.scrollHeight,
      `Container ${container.label} vertical overflow/clipping: scrollHeight=${container.scrollHeight}px > clientHeight=${container.clientHeight}px + 1`,
    ).toBeLessThanOrEqual(container.clientHeight + 1);
  }
}

/**
 * Unified multi-device screen layout assertion across Desktop (`>= 1200`), iPad (`641..1199`),
 * and Mobile (`<= 640`). Safe for cross-project v2 tests executing on all 4 Playwright projects.
 */
export async function assertV2ScreenLayout(
  page: Page,
  screen: V2ScreenKind,
  expectedViewport?: ViewportSize,
): Promise<void> {
  if (screen === 'replay') {
    await assertReplayLayoutClean(page, expectedViewport);
    return;
  }

  await assertNoDuplicateVisibleTestIds(page);
  await assertHorizontalZeroOverflow(page, expectedViewport);

  const { innerWidth, innerHeight } = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));
  const isMobileViewport = innerWidth <= 640;

  if (!isMobileViewport) {
    if (screen === 'lobby' || screen === 'online-lobby') {
      await assertZeroOverflow(page, expectedViewport);
      await assertMainContainersVerticalNoOverflow(page);
    } else if (screen === 'game') {
      await assertZeroOverflow(page, expectedViewport);
      await assertMainContainersVerticalNoOverflow(page);
      await assertGameRegionsNoOverlap(page);
    }
    return;
  }

  if (screen === 'game') {
    await assertMobileGameRegionsNoOverlap(page, {
      requireVerticalViewportFit: innerHeight > 700,
    });
  }
}

/**
 * Multi-device interactive wall hitbox check:
 * - Desktop & iPad (`innerWidth > 640`): enforces `>= 47.95px` + center `elementFromPoint`.
 * - Mobile (`innerWidth <= 640`): enforces `>= 39.95px` + center `elementFromPoint`
 *   (optionally scrolling vertically on short viewports like `375x667`).
 */
export async function assertV2InteractiveWallHitTargets(
  page: Page,
  options?: { readonly minSizePx?: number; readonly allowVerticalScroll?: boolean },
): Promise<void> {
  const { innerWidth, innerHeight } = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));

  const isMobileViewport = innerWidth <= 640;
  const minPx =
    options?.minSizePx ??
    (isMobileViewport ? V2_MOBILE_MIN_WALL_HIT_PX : V2_DESKTOP_IPAD_MIN_WALL_HIT_PX);
  const allowVerticalScroll = options?.allowVerticalScroll ?? (isMobileViewport && innerHeight <= 700);

  if (!isMobileViewport && options?.minSizePx === undefined && !allowVerticalScroll) {
    await assertInteractiveWallHitTargets(page);
    return;
  }

  const walls = page.locator('[data-wall-interactive="true"]');
  const count = await walls.count();
  expect(count, 'Expected at least 1 interactive wall target mounted').toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const wall = walls.nth(i);
    const testId = (await wall.getAttribute('data-testid')) ?? `wall#${i}`;
    if (allowVerticalScroll) {
      await wall.scrollIntoViewIfNeeded();
    }
    await expect(wall, `Interactive wall "${testId}" must be visible`).toBeVisible();
    await expect(wall, `Interactive wall "${testId}" must be enabled`).toBeEnabled();

    const box = await wall.boundingBox();
    expect(box, `Interactive wall "${testId}" must have a bounding box`).not.toBeNull();
    if (!box) {
      throw new Error(`Missing bounding box for "${testId}"`);
    }

    expect(
      box.width,
      `Interactive wall "${testId}" width (${box.width.toFixed(2)}px) must be >= ${minPx}px`,
    ).toBeGreaterThanOrEqual(minPx);
    expect(
      box.height,
      `Interactive wall "${testId}" height (${box.height.toFixed(2)}px) must be >= ${minPx}px`,
    ).toBeGreaterThanOrEqual(minPx);

    expect(
      box.x,
      `Interactive wall "${testId}" left edge (${box.x.toFixed(2)}px) clipped past left edge`,
    ).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    expect(
      box.x + box.width,
      `Interactive wall "${testId}" right edge (${(box.x + box.width).toFixed(2)}px) overflows viewport width (${innerWidth}px)`,
    ).toBeLessThanOrEqual(innerWidth + VIEWPORT_SUBPIXEL_TOLERANCE_PX);

    const hitResult = await wall.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const reachable = hit !== null && (hit === el || el.contains(hit));
      return {
        reachable,
        cx,
        cy,
        top: rect.top,
        bottom: rect.bottom,
        hitTag: hit?.tagName.toLowerCase() ?? 'null',
        hitTestId: hit?.getAttribute('data-testid') ?? 'none',
      };
    });

    expect(
      hitResult.top,
      `Interactive wall "${testId}" top (${hitResult.top.toFixed(2)}px) clipped past viewport top`,
    ).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    expect(
      hitResult.bottom,
      `Interactive wall "${testId}" bottom (${hitResult.bottom.toFixed(2)}px) overflows viewport height (${innerHeight}px)`,
    ).toBeLessThanOrEqual(innerHeight + VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    expect(
      hitResult.reachable,
      `Interactive wall "${testId}" center (${hitResult.cx.toFixed(1)}, ${hitResult.cy.toFixed(1)}) is occluded by <${hitResult.hitTag} data-testid="${hitResult.hitTestId}">`,
    ).toBe(true);
  }
}
