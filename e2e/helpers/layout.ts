import { expect, type Page } from '@playwright/test';

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export const IPAD_VIEWPORTS = {
  airLandscape: { width: 1180, height: 820 },
  airPortrait: { width: 820, height: 1180 },
  gen10Landscape: { width: 1024, height: 768 },
  gen10Portrait: { width: 768, height: 1024 },
} as const satisfies Record<string, ViewportSize>;

export const ALL_IPAD_VIEWPORTS: readonly (readonly [string, ViewportSize])[] = [
  ['iPad Air Landscape (1180x820)', IPAD_VIEWPORTS.airLandscape],
  ['iPad Air Portrait (820x1180)', IPAD_VIEWPORTS.airPortrait],
  ['iPad 10th Landscape (1024x768)', IPAD_VIEWPORTS.gen10Landscape],
  ['iPad 10th Portrait (768x1024)', IPAD_VIEWPORTS.gen10Portrait],
];

export const PROJECT_EXPECTED_VIEWPORTS: Readonly<Record<string, ViewportSize>> = {
  'ipad-landscape': IPAD_VIEWPORTS.airLandscape,
  'ipad-portrait': IPAD_VIEWPORTS.airPortrait,
};

/**
 * The 5 painted game layout regions frozen in PROJECT.md § 3.
 * NEVER measure `.side-panel` (it uses `display: contents` in portrait mode).
 */
export const GAME_PAINTED_REGION_TESTIDS = [
  'board-frame',
  'game-topbar',
  'score-board',
  'turn-banner',
  'action-dock',
] as const;

const VIEWPORT_SUBPIXEL_TOLERANCE_PX = 0.5;
const OVERLAP_SUBPIXEL_TOLERANCE_PX = 0.5;
const BOARD_SQUARENESS_TOLERANCE_PX = 1.5;
/**
 * Blink rounds CSS layout in fixed-point 1/64px (0.015625px) LayoutUnits,
 * so a 48px button centered on a fractional track may report 47.984375px.
 * 47.95px accepts Blink rounding on exact 48px targets while rejecting <= 47.9px.
 */
const MIN_WALL_HIT_TARGET_PX = 47.95;

interface MeasuredRegion {
  readonly testId: (typeof GAME_PAINTED_REGION_TESTIDS)[number];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export async function assertZeroOverflow(
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
    const docScrollHeight = doc.scrollHeight;
    const bodyScrollWidth = body?.scrollWidth ?? 0;
    const bodyScrollHeight = body?.scrollHeight ?? 0;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: Math.max(docScrollWidth, bodyScrollWidth),
      scrollHeight: Math.max(docScrollHeight, bodyScrollHeight),
      docScrollWidth,
      docScrollHeight,
      bodyScrollWidth,
      bodyScrollHeight,
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
  expect(
    metrics.scrollHeight,
    `Vertical overflow detected: scrollHeight=${metrics.scrollHeight}px (doc=${metrics.docScrollHeight}px, body=${metrics.bodyScrollHeight}px) > innerHeight=${metrics.innerHeight}px (delta=${metrics.scrollHeight - metrics.innerHeight}px)`,
  ).toBeLessThanOrEqual(metrics.innerHeight);
}

/**
 * Verifies all 5 painted game landmarks are visible, non-zero, contained inside
 * the viewport, mutually non-overlapping on both axes, and that `board-frame`
 * maintains a 1:1 square aspect ratio.
 */
export async function assertGameRegionsNoOverlap(page: Page): Promise<void> {
  const { innerWidth, innerHeight } = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));

  const measured: MeasuredRegion[] = [];

  for (const testId of GAME_PAINTED_REGION_TESTIDS) {
    const locator = page.getByTestId(testId);
    await expect(locator, `Painted game region "${testId}" must be visible`).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `Painted game region "${testId}" must have a bounding box`).not.toBeNull();
    if (!box) {
      throw new Error(`Missing bounding box for "${testId}"`);
    }

    expect(box.width, `Region "${testId}" width must be > 0`).toBeGreaterThan(0);
    expect(box.height, `Region "${testId}" height must be > 0`).toBeGreaterThan(0);

    expect(
      box.x,
      `Region "${testId}" left edge (${box.x.toFixed(2)}px) clipped past viewport left`,
    ).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    expect(
      box.y,
      `Region "${testId}" top edge (${box.y.toFixed(2)}px) clipped past viewport top`,
    ).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    expect(
      box.x + box.width,
      `Region "${testId}" right edge (${(box.x + box.width).toFixed(2)}px) overflows viewport width (${innerWidth}px)`,
    ).toBeLessThanOrEqual(innerWidth + VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    expect(
      box.y + box.height,
      `Region "${testId}" bottom edge (${(box.y + box.height).toFixed(2)}px) overflows viewport height (${innerHeight}px)`,
    ).toBeLessThanOrEqual(innerHeight + VIEWPORT_SUBPIXEL_TOLERANCE_PX);

    measured.push({
      testId,
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
      const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      const overlaps =
        overlapX > OVERLAP_SUBPIXEL_TOLERANCE_PX && overlapY > OVERLAP_SUBPIXEL_TOLERANCE_PX;
      expect(
        overlaps,
        `Painted regions "${a.testId}" and "${b.testId}" overlap by ${overlapX.toFixed(2)}px x ${overlapY.toFixed(2)}px`,
      ).toBe(false);
    }
  }

  const board = measured.find((region) => region.testId === 'board-frame');
  expect(board, 'board-frame must be measured').toBeDefined();
  if (board) {
    const delta = Math.abs(board.width - board.height);
    expect(
      delta,
      `board-frame must be 1:1 square (got ${board.width.toFixed(2)}px x ${board.height.toFixed(2)}px, delta=${delta.toFixed(2)}px)`,
    ).toBeLessThanOrEqual(BOARD_SQUARENESS_TOLERANCE_PX);
  }
}

/**
 * Verifies every currently mounted interactive wall slot (`[data-wall-interactive="true"]`)
 * is visible, enabled, >= 48x48px (within Blink 1/64px LayoutUnit rounding), inside viewport
 * bounds, and reachable at its center via `document.elementFromPoint`.
 */
export async function assertInteractiveWallHitTargets(page: Page): Promise<void> {
  const walls = page.locator('[data-wall-interactive="true"]');
  const count = await walls.count();
  expect(count, 'Expected at least 1 interactive wall target mounted').toBeGreaterThan(0);

  const { innerWidth, innerHeight } = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));

  for (let i = 0; i < count; i += 1) {
    const wall = walls.nth(i);
    const testId = (await wall.getAttribute('data-testid')) ?? `wall#${i}`;
    await expect(wall, `Interactive wall "${testId}" must be visible`).toBeVisible();
    await expect(wall, `Interactive wall "${testId}" must be enabled`).toBeEnabled();

    const box = await wall.boundingBox();
    expect(box, `Interactive wall "${testId}" must have a bounding box`).not.toBeNull();
    if (!box) {
      throw new Error(`Missing bounding box for "${testId}"`);
    }

    expect(
      box.width,
      `Interactive wall "${testId}" width (${box.width.toFixed(2)}px) must be >= 48px`,
    ).toBeGreaterThanOrEqual(MIN_WALL_HIT_TARGET_PX);
    expect(
      box.height,
      `Interactive wall "${testId}" height (${box.height.toFixed(2)}px) must be >= 48px`,
    ).toBeGreaterThanOrEqual(MIN_WALL_HIT_TARGET_PX);

    expect(
      box.x,
      `Interactive wall "${testId}" left edge (${box.x.toFixed(2)}px) clipped past viewport left`,
    ).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    expect(
      box.y,
      `Interactive wall "${testId}" top edge (${box.y.toFixed(2)}px) clipped past viewport top`,
    ).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    expect(
      box.x + box.width,
      `Interactive wall "${testId}" right edge (${(box.x + box.width).toFixed(2)}px) overflows viewport width (${innerWidth}px)`,
    ).toBeLessThanOrEqual(innerWidth + VIEWPORT_SUBPIXEL_TOLERANCE_PX);
    expect(
      box.y + box.height,
      `Interactive wall "${testId}" bottom edge (${(box.y + box.height).toFixed(2)}px) overflows viewport height (${innerHeight}px)`,
    ).toBeLessThanOrEqual(innerHeight + VIEWPORT_SUBPIXEL_TOLERANCE_PX);

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
        hitTag: hit?.tagName.toLowerCase() ?? 'null',
        hitTestId: hit?.getAttribute('data-testid') ?? 'none',
      };
    });

    expect(
      hitResult.reachable,
      `Interactive wall "${testId}" center (${hitResult.cx.toFixed(1)}, ${hitResult.cy.toFixed(1)}) is occluded by <${hitResult.hitTag} data-testid="${hitResult.hitTestId}">`,
    ).toBe(true);
  }
}

/**
 * Verifies Single-DOM strict-mode compliance: every visible `[data-testid]`
 * appears at most once in the DOM.
 */
export async function assertNoDuplicateVisibleTestIds(
  page: Page,
  options?: { readonly includeHidden?: boolean },
): Promise<void> {
  const includeHidden = options?.includeHidden ?? false;

  const duplicates = await page.evaluate((countHidden) => {
    const counts = new Map<string, number>();
    const nodes = document.querySelectorAll('[data-testid]');

    const hasVisibleDirectText = (node: Element): boolean => {
      for (const childNode of node.childNodes) {
        if (childNode.nodeType === Node.TEXT_NODE && (childNode.textContent ?? '').trim().length > 0) {
          const range = document.createRange();
          range.selectNodeContents(childNode);
          const textRect = range.getBoundingClientRect();
          if (textRect.width > 0 || textRect.height > 0) {
            return true;
          }
        }
      }
      return false;
    };

    const isVisibleNode = (el: Element): boolean => {
      if (el.hasAttribute('hidden')) {
        return false;
      }
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
      ) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        return true;
      }
      if (style.display === 'contents') {
        if (hasVisibleDirectText(el)) {
          return true;
        }
        for (const desc of el.querySelectorAll('*')) {
          if (desc.hasAttribute('hidden')) {
            continue;
          }
          const descStyle = window.getComputedStyle(desc);
          if (
            descStyle.display === 'none' ||
            descStyle.visibility === 'hidden' ||
            descStyle.visibility === 'collapse'
          ) {
            continue;
          }
          const descRect = desc.getBoundingClientRect();
          if (descRect.width > 0 || descRect.height > 0) {
            return true;
          }
          if (descStyle.display === 'contents' && hasVisibleDirectText(desc)) {
            return true;
          }
        }
      }
      return false;
    };

    for (const el of nodes) {
      const id = el.getAttribute('data-testid');
      if (!id) {
        continue;
      }
      if (!countHidden && !isVisibleNode(el)) {
        continue;
      }
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    const dupes: string[] = [];
    for (const [id, count] of counts.entries()) {
      if (count > 1) {
        dupes.push(`${id} (x${count})`);
      }
    }
    return dupes.sort();
  }, includeHidden);

  expect(
    duplicates,
    `Duplicate ${includeHidden ? '' : 'visible '}data-testid attributes found: ${duplicates.join(', ')}`,
  ).toEqual([]);
}
