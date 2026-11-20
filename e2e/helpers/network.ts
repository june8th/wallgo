import {
  expect,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';

const ALLOWED_FONT_ORIGINS: ReadonlySet<string> = new Set([
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
]);

export interface RuntimeErrors {
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
  readonly failedRequests: readonly string[];
  readonly httpErrors: readonly string[];
}

export interface RuntimeErrorGuard {
  getErrors(): RuntimeErrors;
  hasErrors(): boolean;
  assertClean(): void;
  detach(): void;
}

/**
 * Strictly allowlists ONLY canonical HTTPS Google Fonts origins.
 * Rejects blob:https://fonts.googleapis.com/..., http://, non-default ports,
 * userinfo credentials, subdomain/suffix spoofing, whitespace-padded,
 * ASCII control characters (\t/\n/\r/etc.), and malformed URLs.
 */
export function isAllowedFontOrigin(rawUrl: string): boolean {
  if (rawUrl.length === 0 || rawUrl.trim() !== rawUrl || /[\u0000-\u001f\u007f]/.test(rawUrl)) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === 'https:' &&
      parsed.port === '' &&
      parsed.username === '' &&
      parsed.password === '' &&
      ALLOWED_FONT_ORIGINS.has(parsed.origin)
    );
  } catch {
    return false;
  }
}

/**
 * Attaches strict runtime hygiene listeners to a Playwright Page, collecting:
 * - uncaught `pageerror` exceptions
 * - non-font `console.error` messages (allowlisted strictly via `msg.location().url`, never `msg.text()`)
 * - non-font `requestfailed` network errors
 * - non-font HTTP >= 400 responses
 */
export function attachRuntimeErrorGuard(page: Page): RuntimeErrorGuard {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const httpErrors: string[] = [];

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
    consoleErrors.push(`${msg.text()} (${sourceUrl || 'unknown'})`);
  };

  const onRequestFailed = (req: Request): void => {
    const url = req.url();
    if (isAllowedFontOrigin(url)) {
      return;
    }
    failedRequests.push(`${url} (${req.failure()?.errorText ?? 'unknown'})`);
  };

  const onResponse = (res: Response): void => {
    if (res.status() < 400 || isAllowedFontOrigin(res.url())) {
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
  };
}
