import { expect, test } from '@playwright/test';
import { attachRuntimeErrorGuard } from './helpers/network.ts';
import { assertNoDuplicateVisibleTestIds, type ViewportSize } from './helpers/layout.ts';
import {
  completePlacement,
  configureLobby,
  inspectBoardFromResult,
  moveSelectedTo,
  openLobby,
  returnToLobby,
  runScriptD,
  selectCell,
  startConfiguredGame,
  startGame,
  type E2EPlacementStep,
} from './helpers/game.ts';
import { complete2PWallGo1Fast } from './helpers/scripts.ts';
import {
  V2_STORAGE_KEYS,
  V2_VIEWPORTS,
  assertCardHasMiniBoardPreview,
  assertElementsWithinHorizontalViewport,
  assertNoUninterpolatedTemplates,
  assertReplayLayoutClean,
  assertV2InteractiveWallHitTargets,
  assertV2ScreenLayout,
  assertZeroStrayHangul,
  closeReplayViewer,
  completeOnline2PWallGo1Fast,
  createGuardedContext,
  createOnlineRoom,
  createOnlineSessionPool,
  createScopedMatchNicknames,
  ensureLocale,
  joinRoomViaInviteUrl,
  jumpReplayToMoveItem,
  leaveOnlineRoom,
  openHistoryScreen,
  openLocalTab,
  openOnlineTab,
  openReplayForMatch,
  readBoardCompleteSnapshot,
  readHistoryMatchCards,
  readHistoryStatsTable,
  readReplayState,
  scrubReplayTo,
  searchHistory,
  setHistoryFilter,
  startOnlineGame,
  stepThroughFullReplay,
  toggleLanguage,
  waitForHistoryMatchCard,
  type V2ReplaySpeed,
} from './helpers/v2.ts';

const RESPONSIVE_TEST_PLACEMENTS: readonly E2EPlacementStep[] = [
  { row: 3, col: 3 },
  { row: 0, col: 6 },
  { row: 6, col: 0 },
  { row: 6, col: 6 },
  { row: 6, col: 3 },
  { row: 0, col: 0 },
];

// =============================================================================
// V2-FA-05 — Match History (Online Deduplicated + Local) & Full Replay Viewer (6)
// =============================================================================

test.describe(
  'Wall Go v2 Tier 1 — Match History & Full Replay Viewer (V2-FA-05)',
  { tag: ['@v2', '@tier1'] },
  () => {
    test('V2-T1-25: Local match auto-records in wallgo.localMatches, displays in history-screen with mini board preview & stats table, and persists across reload', async ({
      page,
    }, testInfo) => {
      const guard = attachRuntimeErrorGuard(page);
      const { tag, names } = createScopedMatchNicknames(['L1', 'L2', 'L3'] as const, testInfo);
      const [l1, l2, l3] = names;

      try {
        await runScriptD(page, {
          seats: [{ name: l1 }, { name: l2 }, { name: l3 }],
        });

        // Verify localStorage['wallgo.localMatches'] contains 1 valid 13-step record
        const storedMatches = await page.evaluate((key) => {
          const raw = window.localStorage.getItem(key);
          return raw ? (JSON.parse(raw) as unknown[]) : [];
        }, V2_STORAGE_KEYS.localMatches);
        expect(Array.isArray(storedMatches)).toBe(true);
        expect(storedMatches.length).toBe(1);
        const firstRecord = storedMatches[0] as {
          mode?: string;
          replay?: { steps?: unknown[] };
        };
        expect(firstRecord.mode).toBe('local');
        expect(firstRecord.replay?.steps?.length).toBe(13);

        await page.getByTestId('result-lobby-button').click();
        await expect(page.getByTestId('lobby-screen')).toBeVisible();

        // Open Match History, filter local + unique tag
        await openHistoryScreen(page);
        await setHistoryFilter(page, 'local');
        await searchHistory(page, tag);

        const cardSummary = await waitForHistoryMatchCard(page, {
          source: 'local',
          variant: 'wallgo1',
          format: '3p',
          round: 1,
          textContains: l1,
        });
        expect(cardSummary.text).toContain(l1);
        expect(cardSummary.text).toContain(l2);
        expect(cardSummary.text).toContain(l3);
        expect(cardSummary.text).toContain('43');
        expect(cardSummary.text).toContain('4');
        expect(cardSummary.text).toContain('2');

        const cardLocator = page.getByTestId(`history-match-card-${cardSummary.id}`);
        await assertCardHasMiniBoardPreview(cardLocator);
        await expect(page.getByTestId(`history-replay-button-${cardSummary.id}`)).toBeVisible();

        // Verify player aggregate win/loss stats table
        const stats = await readHistoryStatsTable(page);
        expect(stats.playerCount).toBeGreaterThanOrEqual(3);
        const l1Row = stats.rows.find((row) => row.text.includes(l1));
        const l2Row = stats.rows.find((row) => row.text.includes(l2));
        const l3Row = stats.rows.find((row) => row.text.includes(l3));
        expect(l1Row, `Expected stats row for winner ${l1}`).toBeDefined();
        expect(l2Row, `Expected stats row for ${l2}`).toBeDefined();
        expect(l3Row, `Expected stats row for ${l3}`).toBeDefined();
        expect(l1Row?.text).toContain('43');

        await assertNoDuplicateVisibleTestIds(page);

        // Reload and confirm persistence
        const reloaded = await page.reload({ waitUntil: 'load' });
        expect(reloaded?.ok()).toBe(true);
        await expect(page.getByTestId('lobby-screen')).toBeVisible();
        await openHistoryScreen(page);
        await setHistoryFilter(page, 'local');
        await searchHistory(page, tag);
        const persisted = await waitForHistoryMatchCard(page, {
          source: 'local',
          textContains: l1,
        });
        expect(persisted.id).toBe(cardSummary.id);

        guard.assertClean();
      } finally {
        guard.detach();
      }
    });

    test('V2-T1-26: Online match auto-records strictly ONCE (deduplicated with 2 clients), merges with local, filters by source & search, and loads online replay', async ({
      page,
      browser,
    }, testInfo) => {
      test.setTimeout(60_000);
      const { tag, names } = createScopedMatchNicknames(
        ['L1', 'L2', 'L3', 'O1', 'O2'] as const,
        testInfo,
      );
      const [l1, l2, l3, o1, o2] = names;
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, o1, { label: 'host' });

      try {
        // 1. Context A completes 1 local 3P match
        await runScriptD(host.page, {
          seats: [{ name: l1 }, { name: l2 }, { name: l3 }],
        });
        await host.page.getByTestId('result-lobby-button').click();
        await expect(host.page.getByTestId('lobby-screen')).toBeVisible();

        // 2. Context A & Context B complete 1 online 2P match
        await openOnlineTab(host.page, { expectConfigured: true });
        const roomCode = await createOnlineRoom(host.page, {
          nickname: o1,
          variant: 'wallgo1',
          format: '2p',
          timerSeconds: 0,
          shuffleOrder: false,
        });

        const guest = await pool.createClient(o2, { label: 'guest' });
        await joinRoomViaInviteUrl(guest.page, roomCode, { nickname: o2, pathStyle: 'query' });
        await startOnlineGame(host.page, [host.page, guest.page]);
        await completeOnline2PWallGo1Fast([host, guest]);

        await leaveOnlineRoom(host.page);
        await leaveOnlineRoom(guest.page);

        // 3. Context A verifies deduplication, merging & all filters
        await openHistoryScreen(host.page);

        // Online search -> strictly 1 deduplicated online match (V2-E24)
        await searchHistory(host.page, o1);
        await setHistoryFilter(host.page, 'all');
        const onlineCard = await waitForHistoryMatchCard(host.page, {
          source: 'online',
          variant: 'wallgo1',
          format: '2p',
          textContains: o1,
        });
        await expect
          .poll(async () => (await readHistoryMatchCards(host.page)).length)
          .toBe(1);

        await setHistoryFilter(host.page, 'online');
        await expect
          .poll(async () => (await readHistoryMatchCards(host.page)).length)
          .toBe(1);
        const onlineOnlyCards = await readHistoryMatchCards(host.page);
        expect(onlineOnlyCards[0]?.id).toBe(onlineCard.id);

        await setHistoryFilter(host.page, 'local');
        await expect(host.page.getByTestId('history-empty-state')).toBeVisible();
        await expect
          .poll(async () => (await readHistoryMatchCards(host.page)).length)
          .toBe(0);

        // Local search -> strictly 1 local match, 0 online
        await searchHistory(host.page, l1);
        await setHistoryFilter(host.page, 'local');
        await waitForHistoryMatchCard(host.page, { source: 'local', textContains: l1 });
        await expect
          .poll(async () => (await readHistoryMatchCards(host.page)).length)
          .toBe(1);

        await setHistoryFilter(host.page, 'online');
        await expect(host.page.getByTestId('history-empty-state')).toBeVisible();
        await expect
          .poll(async () => (await readHistoryMatchCards(host.page)).length)
          .toBe(0);

        // Shared tag search + All filter -> strictly 2 merged cards (1 online + 1 local)
        await searchHistory(host.page, tag);
        await setHistoryFilter(host.page, 'all');
        await expect
          .poll(async () => (await readHistoryMatchCards(host.page)).length)
          .toBe(2);
        const mergedCards = await readHistoryMatchCards(host.page);
        expect(mergedCards.filter((c) => c.source === 'online').length).toBe(1);
        expect(mergedCards.filter((c) => c.source === 'local').length).toBe(1);
        await assertNoDuplicateVisibleTestIds(host.page);

        // 4. Context B (fresh localStorage, 0 local matches) fetches shared online match & opens Replay via /api/matches/:id
        await openHistoryScreen(guest.page);
        await setHistoryFilter(guest.page, 'online');
        await searchHistory(guest.page, o1);
        const guestOnlineCard = await waitForHistoryMatchCard(guest.page, {
          source: 'online',
          textContains: o1,
        });
        expect(guestOnlineCard.id).toBe(onlineCard.id);

        const replayInit = await openReplayForMatch(guest.page, onlineCard.id);
        expect(replayInit.step).toBe(0);
        expect(replayInit.totalSteps).toBe(10);

        const step0Board = await readBoardCompleteSnapshot(
          guest.page,
          guest.page.getByTestId('replay-board'),
        );
        expect(step0Board.pieces.length).toBe(4);
        expect(step0Board.walls.length).toBe(0);

        await guest.page.getByTestId('replay-last-button').click();
        await expect(guest.page.getByTestId('replay-screen')).toHaveAttribute('data-step', '10');
        const step10Board = await readBoardCompleteSnapshot(
          guest.page,
          guest.page.getByTestId('replay-board'),
        );
        expect(step10Board.pieces.length).toBe(8);
        expect(step10Board.walls.length).toBe(6);

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-27: Full Replay Viewer on 3P match steps 0..13 verifying Step 0 (0 pieces), intermediate territory wash (Step 12), backward step & exact final DOM equality', async ({
      page,
    }, testInfo) => {
      const guard = attachRuntimeErrorGuard(page);
      const { tag, names } = createScopedMatchNicknames(['L1', 'L2', 'L3'] as const, testInfo);
      const [l1, l2, l3] = names;

      try {
        await runScriptD(page, {
          seats: [{ name: l1 }, { name: l2 }, { name: l3 }],
        });
        await inspectBoardFromResult(page);
        const liveFinalSnapshot = await readBoardCompleteSnapshot(
          page,
          page.getByTestId('game-screen'),
        );

        await returnToLobby(page);
        await openHistoryScreen(page);
        await setHistoryFilter(page, 'local');
        await searchHistory(page, tag);
        const card = await waitForHistoryMatchCard(page, { source: 'local', textContains: l1 });

        const initState = await openReplayForMatch(page, card.id);
        expect(initState.step).toBe(0);
        expect(initState.totalSteps).toBe(13);
        expect(initState.playing).toBe(false);
        expect(initState.moveCount).toBeGreaterThanOrEqual(13);
        expect(
          await page.getByTestId('replay-move-list').locator('[data-testid^="replay-move-item-"]').count(),
        ).toBe(initState.moveCount);

        await expect(page.getByTestId('game-screen')).toHaveCount(0);
        await expect(page.locator('[data-wall-interactive="true"]')).toHaveCount(0);
        await assertNoDuplicateVisibleTestIds(page);

        const frames = await stepThroughFullReplay(page, (step, _state, board) => {
          if (step === 0) {
            expect(board.pieces.length).toBe(0);
            expect(board.walls.length).toBe(0);
            expect(board.territories.length).toBe(0);
          } else if (step <= 6) {
            expect(board.pieces.length).toBe(step);
            expect(board.walls.length).toBe(0);
          } else if (step === 12) {
            expect(board.walls.length).toBe(6);
            expect(board.territories).toContainEqual({ row: 0, col: 0, owner: 2, size: 2 });
            expect(board.territories).toContainEqual({ row: 0, col: 1, owner: 2, size: 2 });
          }
        });

        expect(frames.length).toBe(14);
        const finalFrame = frames[13];
        expect(finalFrame?.board).toEqual(liveFinalSnapshot);

        // Step backward 13 -> 12 verifies wall removal & piece restoration
        await page.getByTestId('replay-prev-button').click();
        await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-step', '12');
        const replayBoard = page.getByTestId('replay-board');
        await expect(replayBoard.getByTestId('placed-wall-v-6-1')).toHaveCount(0);
        await expect(replayBoard.getByTestId('cell-5-2')).toHaveAttribute('data-occupied-by', '0');

        await closeReplayViewer(page);
        guard.assertClean();
      } finally {
        guard.detach();
      }
    });

    test('V2-T1-28: Full Replay Viewer on 2P match verifies Step 0 renders 4 fixed diagonal pieces and Step 10 matches final 2P board identically', async ({
      page,
    }, testInfo) => {
      const guard = attachRuntimeErrorGuard(page);
      const { tag, names } = createScopedMatchNicknames(['L1', 'L2'] as const, testInfo);
      const [l1, l2] = names;

      try {
        await startConfiguredGame(page, {
          variant: 'wallgo1',
          format: '2p',
          timerSeconds: 0,
          shuffleOrder: false,
          seats: [{ name: l1 }, { name: l2 }],
        });
        await complete2PWallGo1Fast(page);
        await inspectBoardFromResult(page);
        const liveFinalSnapshot = await readBoardCompleteSnapshot(
          page,
          page.getByTestId('game-screen'),
        );

        await returnToLobby(page);
        await openHistoryScreen(page);
        await setHistoryFilter(page, 'local');
        await searchHistory(page, tag);
        const card = await waitForHistoryMatchCard(page, {
          source: 'local',
          format: '2p',
          textContains: l1,
        });

        const initState = await openReplayForMatch(page, card.id);
        expect(initState.step).toBe(0);
        expect(initState.totalSteps).toBe(10);

        const replayBoard = page.getByTestId('replay-board');
        const step0Board = await readBoardCompleteSnapshot(page, replayBoard);
        expect(step0Board.walls.length).toBe(0);
        expect(step0Board.territories.length).toBe(0);
        expect(step0Board.pieces).toEqual([
          { owner: 0, kind: 'standard', row: 1, col: 1 },
          { owner: 0, kind: 'standard', row: 5, col: 5 },
          { owner: 1, kind: 'standard', row: 1, col: 5 },
          { owner: 1, kind: 'standard', row: 5, col: 1 },
        ]);

        // Jump to Step 4 (end of placement) via move list
        await jumpReplayToMoveItem(page, 4);
        const step4Board = await readBoardCompleteSnapshot(page, replayBoard);
        expect(step4Board.pieces.length).toBe(8);
        expect(step4Board.walls.length).toBe(0);

        // Jump to Step 10 (final) via Last button -> exact DOM snapshot equality
        await page.getByTestId('replay-last-button').click();
        await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-step', '10');
        const step10Board = await readBoardCompleteSnapshot(page, replayBoard);
        expect(step10Board).toEqual(liveFinalSnapshot);

        // Jump back to Step 0 via First button -> restores 4 fixed diagonal pieces
        await page.getByTestId('replay-first-button').click();
        await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-step', '0');
        const resetBoard = await readBoardCompleteSnapshot(page, replayBoard);
        expect(resetBoard).toEqual(step0Board);

        guard.assertClean();
      } finally {
        guard.detach();
      }
    });

    test('V2-T1-29: Replay transport controls: Speed toggle (0.5|1|2), Play/Pause auto-advance, Range Scrubber, clickable Move List & Keyboard Navigation', async ({
      page,
    }, testInfo) => {
      const guard = attachRuntimeErrorGuard(page);
      const { tag, names } = createScopedMatchNicknames(['L1', 'L2', 'L3'] as const, testInfo);
      const [l1, l2, l3] = names;

      try {
        await runScriptD(page, {
          seats: [{ name: l1 }, { name: l2 }, { name: l3 }],
        });
        await page.getByTestId('result-lobby-button').click();
        await expect(page.getByTestId('lobby-screen')).toBeVisible();

        await openHistoryScreen(page);
        await setHistoryFilter(page, 'local');
        await searchHistory(page, tag);
        const card = await waitForHistoryMatchCard(page, { source: 'local', textContains: l1 });
        await openReplayForMatch(page, card.id);

        // 1. Speed toggle cycles through all 3 speeds {'0.5', '1', '2'}; leave at '2'
        const speedBtn = page.getByTestId('replay-speed-button');
        const observedSpeeds = new Set<V2ReplaySpeed>();
        for (let i = 0; i < 4; i += 1) {
          const s = (await speedBtn.getAttribute('data-speed')) as V2ReplaySpeed | null;
          if (s === '0.5' || s === '1' || s === '2') {
            observedSpeeds.add(s);
          }
          if (i < 3) {
            await speedBtn.click();
          }
        }
        expect([...observedSpeeds].sort()).toEqual(['0.5', '1', '2']);
        while ((await speedBtn.getAttribute('data-speed')) !== '2') {
          await speedBtn.click();
        }
        await expect(speedBtn).toHaveAttribute('data-speed', '2');

        // 2. Play/Pause auto-advance using web-first polling (zero fixed sleeps)
        const playBtn = page.getByTestId('replay-play-pause-button');
        await playBtn.click();
        await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-playing', 'true');
        await expect(playBtn).toHaveAttribute('aria-pressed', 'true');
        await expect
          .poll(async () => (await readReplayState(page)).step, { timeout: 10_000 })
          .toBeGreaterThanOrEqual(2);

        await playBtn.click();
        await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-playing', 'false');
        await expect(playBtn).toHaveAttribute('aria-pressed', 'false');

        // 3. Range scrubber -> Step 9 (3 placed walls)
        await scrubReplayTo(page, 9);
        const replayBoard = page.getByTestId('replay-board');
        await expect(replayBoard.locator('[data-testid^="placed-wall-"]')).toHaveCount(3);

        // 4. Clickable move list -> Step 12 (6 placed walls)
        await jumpReplayToMoveItem(page, 12);
        await expect(replayBoard.locator('[data-testid^="placed-wall-"]')).toHaveCount(6);

        // 5. Keyboard navigation (click non-interactive step indicator first to avoid button/range focus collision)
        await page.getByTestId('replay-step-indicator').click();

        await page.keyboard.press('ArrowRight');
        await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-step', '13');

        await page.keyboard.press('ArrowLeft');
        await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-step', '12');

        await page.keyboard.press('Home');
        await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-step', '0');

        await page.keyboard.press('End');
        await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-step', '13');

        await page.keyboard.press('Home');
        await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-step', '0');

        await page.keyboard.press('Space');
        await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-playing', 'true');

        await page.keyboard.press('Space');
        await expect(page.getByTestId('replay-screen')).toHaveAttribute('data-playing', 'false');

        await page.keyboard.press('Escape');
        await expect(page.getByTestId('replay-screen')).toHaveCount(0);
        await expect(page.getByTestId('history-screen')).toBeVisible();

        guard.assertClean();
      } finally {
        guard.detach();
      }
    });

    test('V2-T1-30: Toggling language-toggle mid-replay translates replay-step-description and replay-move-item-{n} instantly without resetting data-step', async ({
      browser,
    }, testInfo) => {
      const ctx = await createGuardedContext(browser, { testInfo, locale: 'ko-KR' });
      const { tag, names } = createScopedMatchNicknames(['L1', 'L2', 'L3'] as const, testInfo);
      const [l1, l2, l3] = names;

      try {
        await runScriptD(ctx.page, {
          seats: [{ name: l1 }, { name: l2 }, { name: l3 }],
        });
        await ctx.page.getByTestId('result-lobby-button').click();
        await expect(ctx.page.getByTestId('lobby-screen')).toBeVisible();

        await openHistoryScreen(ctx.page);
        await setHistoryFilter(ctx.page, 'local');
        await searchHistory(ctx.page, tag);
        const card = await waitForHistoryMatchCard(ctx.page, { source: 'local', textContains: l1 });
        await openReplayForMatch(ctx.page, card.id);

        // Jump to Step 7 (Turn 1 by l1) in KO
        await jumpReplayToMoveItem(ctx.page, 7);
        const koDesc = (
          (await ctx.page.getByTestId('replay-step-description').textContent()) ?? ''
        ).trim();
        const koItem7 = (
          (await ctx.page.getByTestId('replay-move-item-7').textContent()) ?? ''
        ).trim();
        expect(koDesc).toContain(l1);
        expect(koDesc).toMatch(/[가-힣]/);
        expect(koItem7).toContain(l1);
        expect(koItem7).toMatch(/[가-힣]/);

        // Toggle KO -> EN: data-step="7" strictly preserved, copy translates to English
        await toggleLanguage(ctx.page, 'en');
        await expect(ctx.page.getByTestId('replay-screen')).toHaveAttribute('data-step', '7');
        const enDesc = (
          (await ctx.page.getByTestId('replay-step-description').textContent()) ?? ''
        ).trim();
        const enItem7 = (
          (await ctx.page.getByTestId('replay-move-item-7').textContent()) ?? ''
        ).trim();
        expect(enDesc).not.toBe(koDesc);
        expect(enDesc).toContain(l1);
        expect(enItem7).not.toBe(koItem7);
        expect(enItem7).toContain(l1);
        await assertZeroStrayHangul(ctx.page);
        await assertNoUninterpolatedTemplates(ctx.page);

        // Toggle EN -> KO: data-step="7" still preserved, copy returns to Korean
        await toggleLanguage(ctx.page, 'ko');
        await expect(ctx.page.getByTestId('replay-screen')).toHaveAttribute('data-step', '7');
        const koDescAgain = (
          (await ctx.page.getByTestId('replay-step-description').textContent()) ?? ''
        ).trim();
        expect(koDescAgain).toMatch(/[가-힣]/);

        ctx.assertClean();
      } finally {
        await ctx.close();
      }
    });
  },
);

// =============================================================================
// V2-FA-06 — Multi-Device Responsive Matrix (Desktop + iPad + Mobile) (4)
// =============================================================================

test.describe(
  'Wall Go v2 Tier 1 — Multi-Device Responsive Matrix (V2-FA-06)',
  { tag: ['@v2', '@tier1'] },
  () => {
    test('V2-T1-31: Desktop (1440x900, 1280x800) zero overflow, 5-landmark non-overlap, 1:1 board & >=47.95px wall hitboxes on Lobby and Game Screen in KO & EN', async ({
      browser,
    }, testInfo) => {
      const ctx = await createGuardedContext(browser, {
        testInfo,
        locale: 'ko-KR',
        viewport: V2_VIEWPORTS.desktop1440,
        hasTouch: false,
        isMobile: false,
      });

      const viewports: readonly ViewportSize[] = [
        V2_VIEWPORTS.desktop1440,
        V2_VIEWPORTS.desktop1280,
      ];

      try {
        await openLobby(ctx.page);

        // Lobby checks across Desktop viewports x KO/EN
        for (const vp of viewports) {
          await ctx.page.setViewportSize(vp);
          for (const locale of ['ko', 'en'] as const) {
            await ensureLocale(ctx.page, locale);
            await assertV2ScreenLayout(ctx.page, 'lobby', vp);
            await assertElementsWithinHorizontalViewport(ctx.page, [
              'start-game-button',
              'language-toggle',
            ]);
            if (locale === 'en') {
              await assertZeroStrayHangul(ctx.page);
              await assertNoUninterpolatedTemplates(ctx.page);
            }
          }
        }

        // Start 3P WG1 (90s timer, ASCII names) -> enter place_wall with 4 interactive walls
        await ensureLocale(ctx.page, 'ko');
        await configureLobby(ctx.page, {
          variant: 'wallgo1',
          format: '3p',
          timerSeconds: 90,
          shuffleOrder: false,
          seats: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Cara' }],
        });
        await startGame(ctx.page);
        await completePlacement(ctx.page, RESPONSIVE_TEST_PLACEMENTS);
        await selectCell(ctx.page, 3, 3);
        await moveSelectedTo(ctx.page, 3, 4);

        for (const vp of viewports) {
          await ctx.page.setViewportSize(vp);
          for (const locale of ['ko', 'en'] as const) {
            await ensureLocale(ctx.page, locale);
            await assertV2ScreenLayout(ctx.page, 'game', vp);
            await assertV2InteractiveWallHitTargets(ctx.page);
            if (locale === 'en') {
              await assertZeroStrayHangul(ctx.page);
              await assertNoUninterpolatedTemplates(ctx.page);
            }
          }
        }

        ctx.assertClean();
      } finally {
        await ctx.close();
      }
    });

    test('V2-T1-32: iPad 5-viewport matrix (1180x820, 1024x768, 820x1180, 768x1024, 820x820) strict zero-overflow, 5-landmark non-overlap & >=47.95px wall hitboxes in KO & EN', async ({
      browser,
    }, testInfo) => {
      test.setTimeout(60_000);
      const ctx = await createGuardedContext(browser, {
        testInfo,
        locale: 'ko-KR',
        viewport: V2_VIEWPORTS.ipadAirLandscape,
        hasTouch: true,
        isMobile: false,
      });

      const viewports: readonly ViewportSize[] = [
        V2_VIEWPORTS.ipadAirLandscape,
        V2_VIEWPORTS.ipadGen10Landscape,
        V2_VIEWPORTS.ipadAirPortrait,
        V2_VIEWPORTS.ipadGen10Portrait,
        V2_VIEWPORTS.ipadSplitSquare,
      ];

      try {
        await openLobby(ctx.page);

        for (const vp of viewports) {
          await ctx.page.setViewportSize(vp);
          for (const locale of ['ko', 'en'] as const) {
            await ensureLocale(ctx.page, locale);
            await assertV2ScreenLayout(ctx.page, 'lobby', vp);
            const startBox = await ctx.page.getByTestId('start-game-button').boundingBox();
            expect(startBox, `start-game-button bounding box at ${vp.width}x${vp.height}`).not.toBeNull();
            if (startBox) {
              expect(startBox.y + startBox.height).toBeLessThanOrEqual(vp.height + 0.5);
            }
            if (locale === 'en') {
              await assertZeroStrayHangul(ctx.page);
            }
          }
        }

        await ensureLocale(ctx.page, 'ko');
        await configureLobby(ctx.page, {
          variant: 'wallgo1',
          format: '3p',
          timerSeconds: 90,
          shuffleOrder: false,
          seats: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Cara' }],
        });
        await startGame(ctx.page);
        await completePlacement(ctx.page, RESPONSIVE_TEST_PLACEMENTS);
        await selectCell(ctx.page, 3, 3);
        await moveSelectedTo(ctx.page, 3, 4);

        for (const vp of viewports) {
          await ctx.page.setViewportSize(vp);
          for (const locale of ['ko', 'en'] as const) {
            await ensureLocale(ctx.page, locale);
            await assertV2ScreenLayout(ctx.page, 'game', vp);
            await assertV2InteractiveWallHitTargets(ctx.page);
            if (locale === 'en') {
              await assertZeroStrayHangul(ctx.page);
            }
          }
        }

        ctx.assertClean();
      } finally {
        await ctx.close();
      }
    });

    test('V2-T1-33: Mobile matrix (390x844, 412x915, 375x667) horizontal zero overflow, non-overlapping regions & >=39.95px center-clickable wall hitboxes in KO & EN', async ({
      browser,
    }, testInfo) => {
      test.setTimeout(60_000);
      const ctx = await createGuardedContext(browser, {
        testInfo,
        locale: 'ko-KR',
        viewport: V2_VIEWPORTS.mobileIphone14,
        hasTouch: true,
        isMobile: true,
      });

      const viewports: readonly ViewportSize[] = [
        V2_VIEWPORTS.mobileIphone14,
        V2_VIEWPORTS.mobilePixel7,
        V2_VIEWPORTS.mobileIphoneSe,
      ];

      try {
        await openLobby(ctx.page);

        for (const vp of viewports) {
          await ctx.page.setViewportSize(vp);
          for (const locale of ['ko', 'en'] as const) {
            await ensureLocale(ctx.page, locale);
            await assertV2ScreenLayout(ctx.page, 'lobby', vp);
            const startBtn = ctx.page.getByTestId('start-game-button');
            await startBtn.scrollIntoViewIfNeeded();
            await expect(startBtn).toBeVisible();
            await expect(startBtn).toBeEnabled();
            await assertElementsWithinHorizontalViewport(ctx.page, [
              'start-game-button',
              'language-toggle',
            ]);
            if (locale === 'en') {
              await assertZeroStrayHangul(ctx.page);
            }
          }
        }

        await ensureLocale(ctx.page, 'ko');
        await configureLobby(ctx.page, {
          variant: 'wallgo1',
          format: '3p',
          timerSeconds: 90,
          shuffleOrder: false,
          seats: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Cara' }],
        });
        await startGame(ctx.page);
        await completePlacement(ctx.page, RESPONSIVE_TEST_PLACEMENTS);
        await selectCell(ctx.page, 3, 3);
        await moveSelectedTo(ctx.page, 3, 4);

        for (const vp of viewports) {
          await ctx.page.setViewportSize(vp);
          for (const locale of ['ko', 'en'] as const) {
            await ensureLocale(ctx.page, locale);
            await assertV2ScreenLayout(ctx.page, 'game', vp);
            await assertV2InteractiveWallHitTargets(ctx.page, {
              allowVerticalScroll: vp.height <= 700,
            });
            if (locale === 'en') {
              await assertZeroStrayHangul(ctx.page);
            }
          }
        }

        ctx.assertClean();
      } finally {
        await ctx.close();
      }
    });

    test('V2-T1-34: Multi-device responsive invariants on Online Waiting Room, Match History & Replay Viewer across Desktop, iPad & Mobile in KO & EN', async ({
      browser,
    }, testInfo) => {
      test.setTimeout(60_000);

      const runPass = async (
        deviceOpts: { readonly hasTouch: boolean; readonly isMobile: boolean },
        viewports: readonly ViewportSize[],
        prefix: string,
      ): Promise<void> => {
        const firstVp = viewports[0];
        if (!firstVp) {
          throw new Error('At least one viewport is required');
        }
        const { tag, names } = createScopedMatchNicknames(
          [`${prefix}1`, `${prefix}2`, `${prefix}3`] as const,
          testInfo,
        );
        const [p1, p2, p3] = names;
        const ctx = await createGuardedContext(browser, {
          testInfo,
          locale: 'ko-KR',
          viewport: firstVp,
          hasTouch: deviceOpts.hasTouch,
          isMobile: deviceOpts.isMobile,
        });

        try {
          // Create a completed local match for Match History & Replay checks
          await runScriptD(ctx.page, {
            seats: [{ name: p1 }, { name: p2 }, { name: p3 }],
          });
          await ctx.page.getByTestId('result-lobby-button').click();
          await expect(ctx.page.getByTestId('lobby-screen')).toBeVisible();

          // 1. Online Waiting Room across viewports x KO/EN
          await openOnlineTab(ctx.page, { expectConfigured: true });
          await createOnlineRoom(ctx.page, {
            nickname: p1,
            variant: 'wallgo1',
            format: '3p',
            timerSeconds: 0,
            shuffleOrder: false,
          });
          for (const vp of viewports) {
            await ctx.page.setViewportSize(vp);
            for (const locale of ['ko', 'en'] as const) {
              await ensureLocale(ctx.page, locale);
              await assertV2ScreenLayout(ctx.page, 'online-room', vp);
              await assertElementsWithinHorizontalViewport(ctx.page, [
                'room-code-display',
                'copy-invite-link-button',
                'room-seat-0',
                'room-start-game-button',
                'room-leave-button',
                'language-toggle',
              ]);
              if (locale === 'en') {
                await assertZeroStrayHangul(ctx.page);
              }
            }
          }
          await leaveOnlineRoom(ctx.page);
          await openLocalTab(ctx.page);

          // 2. Match History across viewports x KO/EN
          await openHistoryScreen(ctx.page);
          await setHistoryFilter(ctx.page, 'local');
          await searchHistory(ctx.page, tag);
          const card = await waitForHistoryMatchCard(ctx.page, {
            source: 'local',
            textContains: p1,
          });

          for (const vp of viewports) {
            await ctx.page.setViewportSize(vp);
            for (const locale of ['ko', 'en'] as const) {
              await ensureLocale(ctx.page, locale);
              await assertV2ScreenLayout(ctx.page, 'history', vp);
              await assertElementsWithinHorizontalViewport(ctx.page, [
                'history-back-button',
                'history-filter-all',
                'history-filter-online',
                'history-filter-local',
                'history-search-input',
                'language-toggle',
                `history-match-card-${card.id}`,
                `history-replay-button-${card.id}`,
              ]);
              if (locale === 'en') {
                await assertZeroStrayHangul(ctx.page);
              }
            }
          }

          // 3. Replay Viewer at Step 12 (pieces + 6 walls + territory wash + badge) across viewports x KO/EN
          await openReplayForMatch(ctx.page, card.id);
          await jumpReplayToMoveItem(ctx.page, 12);

          for (const vp of viewports) {
            await ctx.page.setViewportSize(vp);
            for (const locale of ['ko', 'en'] as const) {
              await ensureLocale(ctx.page, locale);
              await assertReplayLayoutClean(ctx.page, vp);
              if (locale === 'en') {
                await assertZeroStrayHangul(ctx.page);
              }
            }
          }

          ctx.assertClean();
        } finally {
          await ctx.close();
        }
      };

      // Pass A: Desktop & iPad (non-mobile emulation)
      await runPass(
        { hasTouch: false, isMobile: false },
        [V2_VIEWPORTS.desktop1440, V2_VIEWPORTS.ipadAirLandscape, V2_VIEWPORTS.ipadAirPortrait],
        'D',
      );

      // Pass B: Mobile smartphone (authentic mobile touch emulation)
      await runPass(
        { hasTouch: true, isMobile: true },
        [V2_VIEWPORTS.mobileIphone14, V2_VIEWPORTS.mobileIphoneSe],
        'M',
      );
    });
  },
);
