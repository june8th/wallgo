import { expect, test } from '@playwright/test';
import { PROJECT_EXPECTED_VIEWPORTS, assertZeroOverflow } from './helpers/layout.ts';
import { attachRuntimeErrorGuard } from './helpers/network.ts';

test(
  'boots Wall Go cleanly on iPad viewport with zero app errors and zero overflow',
  { tag: '@smoke' },
  async ({ page }, testInfo) => {
    const expectedViewport = PROJECT_EXPECTED_VIEWPORTS[testInfo.project.name];
    expect(
      expectedViewport,
      `Unexpected Playwright project name: ${testInfo.project.name}`,
    ).toBeDefined();
    if (!expectedViewport) {
      return;
    }

    const guard = attachRuntimeErrorGuard(page);

    try {
      const response = await page.goto('/', { waitUntil: 'load' });
      expect(response?.ok()).toBe(true);

      await expect(page).toHaveTitle('벽바둑 | Wall Go');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ko');

      const root = page.locator('#root');
      await expect(root).toBeAttached();
      await expect(root.getByRole('main')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: '벽바둑' })).toBeVisible();

      await assertZeroOverflow(page, expectedViewport);

      guard.assertClean();
    } finally {
      guard.detach();
    }
  },
);
