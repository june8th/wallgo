import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';
const SYSTEM_CHROMIUM_PATH = '/usr/lib/chromium/chromium';

function resolveChromiumExecutablePath(): string | undefined {
  const envOverride = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (envOverride) {
    return envOverride;
  }
  if (existsSync(SYSTEM_CHROMIUM_PATH)) {
    return SYSTEM_CHROMIUM_PATH;
  }
  return undefined;
}

const chromiumExecutablePath = resolveChromiumExecutablePath();
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : 2,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    locale: 'ko-KR',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  },
  projects: [
    {
      name: 'ipad-landscape',
      use: {
        browserName: 'chromium',
        viewport: { width: 1180, height: 820 },
        hasTouch: true,
        isMobile: false,
      },
    },
    {
      name: 'ipad-portrait',
      use: {
        browserName: 'chromium',
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
        isMobile: false,
      },
    },
    {
      name: 'desktop-chromium',
      testMatch: /v2-.*\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        hasTouch: false,
        isMobile: false,
        locale: 'ko-KR',
      },
    },
    {
      name: 'mobile-chromium',
      testMatch: /v2-.*\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        locale: 'ko-KR',
      },
    },
  ],
  webServer: {
    command: 'pnpm preview --host 127.0.0.1 --port 4173 --strictPort',
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 30_000,
  },
});
