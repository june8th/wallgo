import { expect, test } from '@playwright/test';
import { attachRuntimeErrorGuard } from './helpers/network.ts';
import { assertNoDuplicateVisibleTestIds } from './helpers/layout.ts';
import {
  CLOCK_T0,
  DEFAULT_2P_PLACEMENTS,
  SCRIPT_A1_PLACEMENTS,
  SCRIPT_D_PLACEMENTS,
  boardPiecesLocator,
  cancelTurnMove,
  cellLocator,
  closeRulesModal,
  completePlacement,
  configureLobby,
  hWall,
  moveSelectedTo,
  openLobby,
  openLobbyWithPausedClock,
  openRulesModal,
  placeFirstAvailableEmptyCell,
  placedWallLocator,
  playFirstLegalHumanTurn,
  playHumanTurn,
  playerCardLocator,
  readGameScreenState,
  runScriptD,
  selectCell,
  startGame,
  startPrisonMatchRound2,
  switchRulesTab,
  territoryBadgeLocator,
  toggleTimerPause,
  triggerCurrentTurnTimeout,
  vWall,
  waitForGameOver,
  wallSlotLocator,
} from './helpers/game.ts';
import {
  V2_ROOM_CODE_REGEX,
  V2_STORAGE_KEYS,
  assertAllClientsBoardSynced,
  assertNoUninterpolatedTemplates,
  assertV2ScreenLayout,
  assertZeroStrayHangul,
  attachApiRequestTracker,
  completeOnline2PWallGo1Fast,
  completeOnlinePlacement,
  completeOnline3PWallGo1ScriptD,
  configureWaitingRoom,
  copyInviteLink,
  copyRoomCode,
  createGuardedContext,
  createOnlineRoom,
  createOnlineSessionPool,
  createScopedMatchNicknames,
  joinRoomByCode,
  joinRoomViaInviteUrl,
  kickRoomSeat,
  leaveOnlineRoom,
  makeUniqueNickname,
  mockRedisUnconfigured,
  openHistoryScreen,
  openLocalTab,
  openOnlineTab,
  openReplayForMatch,
  playOnlineTurnStep,
  reloadOnlinePage,
  returnOnlineToWaiting,
  searchHistory,
  setHistoryFilter,
  setWaitingRoomSeatRole,
  startOnlineGame,
  startOnlineRound2,
  substituteDisconnectedSeatWithAi,
  tapLocatorCenter,
  toggleLanguage,
  triggerOnlineRematch,
  updateWaitingRoomNickname,
  waitForHistoryMatchCard,
} from './helpers/v2.ts';

// =============================================================================
// V2-FA-01 — i18n KO/EN Auto-Detect, Instant Toggle & 100% Bilingual Copy (6)
// =============================================================================

test.describe('Wall Go v2 Tier 1 — i18n KO/EN (V2-FA-01)', { tag: ['@v2', '@tier1'] }, () => {
  test('V2-T1-01: Fresh en-US context auto-detects English on / with zero stray Hangul and zero unsolicited /api/* requests', async ({
    browser,
  }, testInfo) => {
    const ctx = await createGuardedContext(browser, { testInfo, locale: 'en-US' });
    const apiTracker = attachApiRequestTracker(ctx.page);

    try {
      await openLobby(ctx.page);

      // Perform local lobby interaction so any deferred mount effects settle
      await ctx.page.getByTestId('variant-wallgo2').click();
      await expect(ctx.page.getByTestId('variant-wallgo2')).toHaveAttribute('aria-pressed', 'true');
      await ctx.page.getByTestId('variant-wallgo1').click();
      await expect(ctx.page.getByTestId('variant-wallgo1')).toHaveAttribute('aria-pressed', 'true');

      await expect(ctx.page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(ctx.page).toHaveTitle('Wall Go');
      await expect(ctx.page.getByTestId('lobby-title')).toHaveText('Wall Go');

      const toggle = ctx.page.getByTestId('language-toggle');
      await expect(toggle).toHaveCount(1);
      await expect(toggle).toHaveAttribute('data-locale', 'en');
      await expect(ctx.page.getByTestId('nav-local-tab')).toHaveAttribute('aria-selected', 'true');

      await expect(ctx.page.getByTestId('seat-name-0')).toHaveValue('Player 1');
      await expect(ctx.page.getByTestId('seat-name-1')).toHaveValue('Player 2');
      await expect(ctx.page.getByTestId('seat-name-2')).toHaveValue('Player 3');

      await assertZeroStrayHangul(ctx.page);
      await assertNoUninterpolatedTemplates(ctx.page);
      await assertNoDuplicateVisibleTestIds(ctx.page);
      apiTracker.assertZeroApiRequests('en-US Local Lobby');

      ctx.assertClean();
    } finally {
      apiTracker.detach();
      await ctx.close();
    }
  });

  test('V2-T1-02: Fresh ko-KR context auto-detects Korean on / with zero unsolicited /api/* requests', async ({
    browser,
  }, testInfo) => {
    const ctx = await createGuardedContext(browser, { testInfo, locale: 'ko-KR' });
    const apiTracker = attachApiRequestTracker(ctx.page);

    try {
      await openLobby(ctx.page);

      await ctx.page.getByTestId('format-2p').click();
      await expect(ctx.page.getByTestId('format-2p')).toHaveAttribute('aria-pressed', 'true');
      await ctx.page.getByTestId('format-3p').click();
      await expect(ctx.page.getByTestId('format-3p')).toHaveAttribute('aria-pressed', 'true');

      await expect(ctx.page.locator('html')).toHaveAttribute('lang', 'ko');
      await expect(ctx.page).toHaveTitle('벽바둑 | Wall Go');
      await expect(ctx.page.getByTestId('lobby-title')).toHaveText('벽바둑');

      const toggle = ctx.page.getByTestId('language-toggle');
      await expect(toggle).toHaveCount(1);
      await expect(toggle).toHaveAttribute('data-locale', 'ko');
      await expect(ctx.page.getByTestId('nav-local-tab')).toHaveAttribute('aria-selected', 'true');

      await expect(ctx.page.getByTestId('seat-name-0')).toHaveValue('플레이어 1');
      await expect(ctx.page.getByTestId('seat-name-1')).toHaveValue('플레이어 2');
      await expect(ctx.page.getByTestId('seat-name-2')).toHaveValue('플레이어 3');

      await assertNoUninterpolatedTemplates(ctx.page);
      await assertNoDuplicateVisibleTestIds(ctx.page);
      apiTracker.assertZeroApiRequests('ko-KR Local Lobby');

      ctx.assertClean();
    } finally {
      apiTracker.detach();
      await ctx.close();
    }
  });

  test('V2-T1-03: Lobby language-toggle switches instantly, syncs untouched defaults while preserving custom names, and persists across reload overriding en-US', async ({
    browser,
  }, testInfo) => {
    const ctx = await createGuardedContext(browser, { testInfo, locale: 'en-US' });

    try {
      await openLobby(ctx.page);
      await expect(ctx.page.getByTestId('seat-name-0')).toHaveValue('Player 1');
      await expect(ctx.page.getByTestId('seat-name-1')).toHaveValue('Player 2');
      await expect(ctx.page.getByTestId('seat-name-2')).toHaveValue('Player 3');

      // Customize Seat 1 only; leave Seats 0 and 2 untouched defaults
      await ctx.page.getByTestId('seat-name-1').fill('Alex');
      await expect(ctx.page.getByTestId('seat-name-1')).toHaveValue('Alex');

      // Switch EN -> KO
      await toggleLanguage(ctx.page, 'ko');
      await expect(ctx.page.getByTestId('lobby-title')).toHaveText('벽바둑');
      await expect(ctx.page.getByTestId('seat-name-0')).toHaveValue('플레이어 1');
      await expect(ctx.page.getByTestId('seat-name-1')).toHaveValue('Alex');
      await expect(ctx.page.getByTestId('seat-name-2')).toHaveValue('플레이어 3');

      const storedKo = await ctx.page.evaluate(
        (key) => window.localStorage.getItem(key),
        V2_STORAGE_KEYS.locale,
      );
      expect(storedKo).toBe('ko');

      // Reload inside en-US context: saved wallgo.locale='ko' MUST override browser en-US
      const reloadKo = await ctx.page.reload({ waitUntil: 'load' });
      expect(reloadKo?.ok()).toBe(true);
      await expect(ctx.page.getByTestId('lobby-screen')).toBeVisible();
      await expect(ctx.page.getByTestId('language-toggle')).toHaveAttribute('data-locale', 'ko');
      await expect(ctx.page.locator('html')).toHaveAttribute('lang', 'ko');
      await expect(ctx.page.getByTestId('lobby-title')).toHaveText('벽바둑');

      // Switch back KO -> EN and reload again
      await toggleLanguage(ctx.page, 'en');
      const storedEn = await ctx.page.evaluate(
        (key) => window.localStorage.getItem(key),
        V2_STORAGE_KEYS.locale,
      );
      expect(storedEn).toBe('en');
      await assertZeroStrayHangul(ctx.page);

      const reloadEn = await ctx.page.reload({ waitUntil: 'load' });
      expect(reloadEn?.ok()).toBe(true);
      await expect(ctx.page.getByTestId('lobby-screen')).toBeVisible();
      await expect(ctx.page.getByTestId('language-toggle')).toHaveAttribute('data-locale', 'en');
      await expect(ctx.page.locator('html')).toHaveAttribute('lang', 'en');
      await assertZeroStrayHangul(ctx.page);

      ctx.assertClean();
    } finally {
      await ctx.close();
    }
  });

  test('V2-T1-04: Instant language-toggle works across all 5 screens (Lobby, Waiting Room, Game, History, Replay) without losing state', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(60_000);
    const { tag, names } = createScopedMatchNicknames(['I1', 'I2', 'I3'] as const, testInfo);
    const [p1, p2, p3] = names;
    const ctx = await createGuardedContext(browser, { testInfo, locale: 'ko-KR' });

    try {
      // 1. Lobby
      await openLobby(ctx.page);
      await toggleLanguage(ctx.page, 'en');
      await assertZeroStrayHangul(ctx.page);
      await assertNoUninterpolatedTemplates(ctx.page);
      await assertNoDuplicateVisibleTestIds(ctx.page);
      await toggleLanguage(ctx.page, 'ko');

      // 2. Online Waiting Room
      await openOnlineTab(ctx.page, { expectConfigured: true });
      const roomCode = await createOnlineRoom(ctx.page, {
        nickname: p1,
        variant: 'wallgo1',
        format: '3p',
        timerSeconds: 0,
        shuffleOrder: false,
      });
      await toggleLanguage(ctx.page, 'en');
      await expect(ctx.page.getByTestId('online-room-screen')).toHaveAttribute(
        'data-room-code',
        roomCode,
      );
      await assertZeroStrayHangul(ctx.page);
      await assertNoUninterpolatedTemplates(ctx.page);
      await assertNoDuplicateVisibleTestIds(ctx.page);
      await toggleLanguage(ctx.page, 'ko');
      await leaveOnlineRoom(ctx.page);

      // 3. Game Screen (mid-game toggle preserves phase, turn, active player & all pieces)
      await openLocalTab(ctx.page);
      await configureLobby(ctx.page, {
        variant: 'wallgo1',
        format: '3p',
        timerSeconds: 0,
        shuffleOrder: false,
        seats: [{ name: p1 }, { name: p2 }, { name: p3 }],
      });
      await startGame(ctx.page);
      await completePlacement(ctx.page, SCRIPT_D_PLACEMENTS);
      const beforeToggle = await readGameScreenState(ctx.page);
      expect(beforeToggle.phase).toBe('select_piece');

      await toggleLanguage(ctx.page, 'en');
      const afterToggle = await readGameScreenState(ctx.page);
      expect(afterToggle.phase).toBe('select_piece');
      expect(afterToggle.turnNumber).toBe(beforeToggle.turnNumber);
      expect(afterToggle.currentPlayer).toBe(beforeToggle.currentPlayer);
      await expect(boardPiecesLocator(ctx.page)).toHaveCount(6);
      await assertZeroStrayHangul(ctx.page);
      await assertNoUninterpolatedTemplates(ctx.page);
      await assertNoDuplicateVisibleTestIds(ctx.page);

      // Complete Script D turns to create a local match for History & Replay
      await playHumanTurn(ctx.page, { row: 1, col: 0 }, { row: 1, col: 0 }, hWall(0, 0));
      await playHumanTurn(ctx.page, { row: 5, col: 0 }, { row: 5, col: 0 }, hWall(4, 0));
      await playHumanTurn(ctx.page, { row: 0, col: 1 }, { row: 0, col: 1 }, hWall(0, 1));
      await playHumanTurn(ctx.page, { row: 5, col: 2 }, { row: 5, col: 2 }, vWall(5, 1));
      await playHumanTurn(ctx.page, { row: 5, col: 1 }, { row: 5, col: 1 }, hWall(4, 1));
      await playHumanTurn(ctx.page, { row: 0, col: 1 }, { row: 0, col: 1 }, vWall(0, 1));
      await playHumanTurn(ctx.page, { row: 5, col: 2 }, { row: 6, col: 2 }, vWall(6, 1));
      await waitForGameOver(ctx.page, 10_000);

      await ctx.page.getByTestId('result-lobby-button').click();
      await expect(ctx.page.getByTestId('lobby-screen')).toBeVisible();

      // 4. Match History (filter state preserved across EN -> KO -> EN)
      await openHistoryScreen(ctx.page);
      await setHistoryFilter(ctx.page, 'local');
      await searchHistory(ctx.page, tag);
      const localCard = await waitForHistoryMatchCard(ctx.page, {
        source: 'local',
        textContains: p1,
      });

      await toggleLanguage(ctx.page, 'ko');
      await expect(ctx.page.getByTestId('history-screen')).toHaveAttribute(
        'data-active-filter',
        'local',
      );
      await toggleLanguage(ctx.page, 'en');
      await expect(ctx.page.getByTestId('history-screen')).toHaveAttribute(
        'data-active-filter',
        'local',
      );
      await assertZeroStrayHangul(ctx.page);
      await assertNoUninterpolatedTemplates(ctx.page);
      await assertNoDuplicateVisibleTestIds(ctx.page);

      // 5. Replay Viewer (step preserved & description updates live)
      await openReplayForMatch(ctx.page, localCard.id);
      await ctx.page.getByTestId('replay-next-button').click();
      await ctx.page.getByTestId('replay-next-button').click();
      await expect(ctx.page.getByTestId('replay-screen')).toHaveAttribute('data-step', '2');
      const enDesc = ((await ctx.page.getByTestId('replay-step-description').textContent()) ?? '').trim();
      expect(enDesc.length).toBeGreaterThan(0);

      await toggleLanguage(ctx.page, 'ko');
      await expect(ctx.page.getByTestId('replay-screen')).toHaveAttribute('data-step', '2');
      const koDesc = ((await ctx.page.getByTestId('replay-step-description').textContent()) ?? '').trim();
      expect(koDesc).not.toBe(enDesc);

      await toggleLanguage(ctx.page, 'en');
      await expect(ctx.page.getByTestId('replay-screen')).toHaveAttribute('data-step', '2');
      await assertZeroStrayHangul(ctx.page);
      await assertNoUninterpolatedTemplates(ctx.page);
      await assertNoDuplicateVisibleTestIds(ctx.page);

      ctx.assertClean();
    } finally {
      await ctx.close();
    }
  });

  test('V2-T1-05: English RulesModal (all 3 tabs + inline SVG) and ResultModal (rankings, Round 2 preview & transition) render 100% in English', async ({
    browser,
  }, testInfo) => {
    const ctx = await createGuardedContext(browser, { testInfo, locale: 'en-US' });

    try {
      await openLobby(ctx.page);

      // Verify RulesModal across all 3 tabs in English
      await openRulesModal(ctx.page);
      const modal = ctx.page.getByTestId('rules-modal');
      for (const tab of ['wallgo1', 'wallgo2', 'scoring'] as const) {
        if (tab === 'wallgo1') {
          await expect(ctx.page.getByTestId('rules-tab-wallgo1')).toHaveAttribute(
            'aria-selected',
            'true',
          );
        } else {
          await switchRulesTab(ctx.page, tab);
        }
        const text = ((await modal.textContent()) ?? '').trim();
        expect(text.length, `English Rules tab "${tab}" must render substantive copy`).toBeGreaterThanOrEqual(80);
        if (tab === 'wallgo2') {
          expect(await modal.locator('svg').count()).toBeGreaterThanOrEqual(1);
        }
        await assertZeroStrayHangul(ctx.page, { scopeTestId: 'rules-modal' });
        await assertNoUninterpolatedTemplates(ctx.page, modal);
      }
      await closeRulesModal(ctx.page, 'button');

      // Complete 3P Script D with default EN names (Player 1..3)
      await runScriptD(ctx.page);

      const resultModal = ctx.page.getByTestId('result-modal');
      await expect(resultModal).toBeVisible();
      await expect(ctx.page.getByTestId('result-rank-row-0')).toHaveAttribute('data-rank', '1');
      await expect(ctx.page.getByTestId('result-rank-row-0')).toHaveAttribute(
        'data-total-cells',
        '43',
      );
      await expect(ctx.page.getByTestId('result-rank-row-1')).toHaveAttribute('data-rank', '2');
      await expect(ctx.page.getByTestId('result-rank-row-1')).toHaveAttribute(
        'data-total-cells',
        '4',
      );
      await expect(ctx.page.getByTestId('result-rank-row-2')).toHaveAttribute('data-rank', '3');
      await expect(ctx.page.getByTestId('result-rank-row-2')).toHaveAttribute(
        'data-total-cells',
        '2',
      );

      const r2Preview = ctx.page.getByTestId('round2-preview');
      await expect(r2Preview).toBeVisible();
      const advancing = ((await r2Preview.getAttribute('data-advancing-ids')) ?? '')
        .split(',')
        .map((v) => v.trim())
        .sort();
      expect(advancing).toEqual(['1', '2']);

      await expect(ctx.page.getByTestId('start-round2-button')).toBeVisible();
      await expect(ctx.page.getByTestId('rematch-button')).toBeVisible();
      await expect(ctx.page.getByTestId('inspect-board-button')).toBeVisible();
      await expect(ctx.page.getByTestId('result-lobby-button')).toBeVisible();

      await assertZeroStrayHangul(ctx.page);
      await assertNoUninterpolatedTemplates(ctx.page);

      // Transition into Round 2 and confirm 100% EN game screen
      await startPrisonMatchRound2(ctx.page);
      await assertZeroStrayHangul(ctx.page);
      await assertNoUninterpolatedTemplates(ctx.page);

      ctx.assertClean();
    } finally {
      await ctx.close();
    }
  });

  test('V2-T1-06: English turn guidance across every turn phase and paused-clock timeout toast render 100% in English', async ({
    browser,
  }, testInfo) => {
    const ctx = await createGuardedContext(browser, { testInfo, locale: 'en-US' });

    try {
      await openLobbyWithPausedClock(ctx.page, CLOCK_T0);
      await configureLobby(ctx.page, {
        variant: 'wallgo1',
        format: '3p',
        timerSeconds: 60,
        shuffleOrder: false,
      });
      await startGame(ctx.page);

      const banner = ctx.page.getByTestId('turn-banner');
      const placementText = ((await banner.textContent()) ?? '').trim();
      expect(placementText).toContain('Player 1');
      await assertZeroStrayHangul(ctx.page);
      await assertNoUninterpolatedTemplates(ctx.page);

      await completePlacement(ctx.page, SCRIPT_A1_PLACEMENTS);
      const selectText = ((await banner.textContent()) ?? '').trim();
      expect(selectText).toContain('Player 1');
      expect(selectText).not.toBe(placementText);
      await assertZeroStrayHangul(ctx.page);

      await selectCell(ctx.page, 0, 0);
      const moveText = ((await banner.textContent()) ?? '').trim();
      expect(moveText).toContain('Player 1');
      expect(moveText).not.toBe(selectText);
      await assertZeroStrayHangul(ctx.page);

      await moveSelectedTo(ctx.page, 0, 0);
      const wallText = ((await banner.textContent()) ?? '').trim();
      expect(wallText).toContain('Player 1');
      expect(wallText).not.toBe(moveText);
      await assertZeroStrayHangul(ctx.page);

      await cancelTurnMove(ctx.page);

      // Verify pause shield and button label in English
      await toggleTimerPause(ctx.page, true);
      await assertZeroStrayHangul(ctx.page);
      await assertNoUninterpolatedTemplates(ctx.page);
      await toggleTimerPause(ctx.page, false);

      // Trigger deterministic 00:00 timeout and verify English alert toast
      await triggerCurrentTurnTimeout(ctx.page, 60);
      const toast = ctx.page.getByTestId('game-toast');
      await expect(toast).toBeVisible();
      await expect(toast).toHaveAttribute('role', 'alert');
      const toastText = ((await toast.textContent()) ?? '').trim();
      expect(toastText).toMatch(/time[\s-]*out|expired|random|auto/i);

      await assertZeroStrayHangul(ctx.page);
      await assertNoUninterpolatedTemplates(ctx.page);
      await expect(ctx.page.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
      await expect(ctx.page.locator('[data-testid^="placed-wall-"]')).toHaveCount(1);

      ctx.assertClean();
    } finally {
      await ctx.close();
    }
  });
});

// =============================================================================
// V2-FA-02 — Nickname, Room Lifecycle, Code/Invite, Waiting Room & Unconfigured Redis (6)
// =============================================================================

test.describe(
  'Wall Go v2 Tier 1 — Online Lifecycle, Waiting Room & Unconfigured Redis (V2-FA-02)',
  { tag: ['@v2', '@tier1'] },
  () => {
    test('V2-T1-07: Nickname persists in wallgo.profile, edits live in Waiting Room, and preserves local seat editing', async ({
      page,
      browser,
    }, testInfo) => {
      const localName = makeUniqueNickname('Loc', testInfo);
      const hostNick = makeUniqueNickname('H7', testInfo);
      const guestNick1 = makeUniqueNickname('G7a', testInfo);
      const guestNick2 = makeUniqueNickname('G7b', testInfo);

      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });
      const apiTracker = attachApiRequestTracker(host.page);

      try {
        // 1. Local seat editing works cleanly with zero /api/* traffic
        await openLobby(host.page);
        await expect(host.page.getByTestId('nav-local-tab')).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await host.page.getByTestId('seat-name-0').fill(localName);
        await expect(host.page.getByTestId('seat-name-0')).toHaveValue(localName);
        apiTracker.assertZeroApiRequests('Local seat edit');
        apiTracker.detach();

        // 2. Host creates online room and saves wallgo.profile
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '3p',
          timerSeconds: 0,
          shuffleOrder: false,
        });

        const hostProfile = await host.page.evaluate((key) => {
          const raw = window.localStorage.getItem(key);
          return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
        }, V2_STORAGE_KEYS.profile);
        expect(hostProfile).not.toBeNull();
        expect(hostProfile?.nickname).toBe(hostNick);
        expect(typeof hostProfile?.clientId).toBe('string');
        expect(String(hostProfile?.clientId ?? '').length).toBeGreaterThan(0);
        expect(typeof hostProfile?.updatedAt).toBe('number');

        // 3. Guest joins and edits nickname live in Waiting Room
        const guest = await pool.createClient(guestNick1, { label: 'guest' });
        await joinRoomByCode(guest.page, code, guestNick1);

        await expect(host.page.getByTestId('room-seat-0')).toContainText(hostNick);
        await expect(host.page.getByTestId('room-seat-1')).toContainText(guestNick1);
        await expect(guest.page.getByTestId('room-seat-0')).toContainText(hostNick);
        await expect(guest.page.getByTestId('room-seat-1')).toContainText(guestNick1);

        await updateWaitingRoomNickname(guest.page, guestNick2);
        guest.nickname = guestNick2;

        await expect(guest.page.getByTestId('room-seat-1')).toContainText(guestNick2);
        await expect(host.page.getByTestId('room-seat-1')).toContainText(guestNick2, {
          timeout: 10_000,
        });

        const guestProfile = await guest.page.evaluate((key) => {
          const raw = window.localStorage.getItem(key);
          return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
        }, V2_STORAGE_KEYS.profile);
        expect(guestProfile?.nickname).toBe(guestNick2);

        // 4. Host leaves, reloads /, and confirms nickname-input remembers hostNick
        await leaveOnlineRoom(host.page);
        const reloaded = await host.page.reload({ waitUntil: 'load' });
        expect(reloaded?.ok()).toBe(true);
        await openOnlineTab(host.page, { expectConfigured: true });
        await expect(host.page.getByTestId('nickname-input')).toHaveValue(hostNick);

        pool.assertAllClean();
      } finally {
        apiTracker.detach();
        await pool.closeAll();
      }
    });

    test('V2-T1-08: Room create displays 6-char code, copy code/invite feedback works, and code-entry join activates Start', async ({
      page,
      browser,
    }, testInfo) => {
      const hostNick = makeUniqueNickname('H8', testInfo);
      const guestNick = makeUniqueNickname('G8', testInfo);
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '2p',
          timerSeconds: 0,
          shuffleOrder: false,
        });

        const roomScreen = host.page.getByTestId('online-room-screen');
        await expect(roomScreen).toHaveAttribute('role', 'main');
        await expect(roomScreen).toHaveAttribute('data-is-host', 'true');
        await expect(roomScreen).toHaveAttribute('data-my-seat', '0');
        await expect(roomScreen).toHaveAttribute('data-room-status', 'waiting');
        expect(code).toMatch(V2_ROOM_CODE_REGEX);
        expect(new URL(host.page.url()).searchParams.get('room')).toBe(code);

        const displayedCode = await copyRoomCode(host.page);
        expect(displayedCode).toBe(code);
        await expect(host.page.getByTestId('room-code-display')).toContainText(code);
        await copyInviteLink(host.page);

        await expect(host.page.getByTestId('room-seat-0')).toHaveAttribute(
          'data-seat-type',
          'human',
        );
        await expect(host.page.getByTestId('room-seat-0')).toHaveAttribute('data-is-me', 'true');
        await expect(host.page.getByTestId('room-seat-0')).toHaveAttribute('data-is-host', 'true');
        await expect(host.page.getByTestId('room-seat-0')).toHaveAttribute(
          'data-connected',
          'true',
        );
        await expect(host.page.getByTestId('room-seat-1')).toHaveAttribute(
          'data-seat-type',
          'open',
        );
        await expect(host.page.getByTestId('room-seat-2')).toHaveCount(0);
        await expect(host.page.getByTestId('room-start-game-button')).toBeDisabled();

        const guest = await pool.createClient(guestNick, { label: 'guest' });
        await joinRoomByCode(guest.page, code, guestNick);

        const guestRoom = guest.page.getByTestId('online-room-screen');
        await expect(guestRoom).toHaveAttribute('data-room-code', code);
        await expect(guestRoom).toHaveAttribute('data-is-host', 'false');
        await expect(guestRoom).toHaveAttribute('data-my-seat', '1');
        await expect(guest.page.getByTestId('room-seat-1')).toHaveAttribute('data-is-me', 'true');

        await expect(host.page.getByTestId('room-seat-1')).toHaveAttribute(
          'data-seat-type',
          'human',
        );
        await expect(host.page.getByTestId('room-seat-1')).toHaveAttribute(
          'data-connected',
          'true',
        );
        await expect(host.page.getByTestId('room-start-game-button')).toBeEnabled();

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-09: Direct invite URL deep links join cleanly via both /?room=CODE and /room/CODE', async ({
      page,
      browser,
    }, testInfo) => {
      const { names } = createScopedMatchNicknames(['H9', 'G9a', 'G9b'] as const, testInfo);
      const [hostNick, g1Nick, g2Nick] = names;
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '3p',
          timerSeconds: 0,
          shuffleOrder: false,
        });

        const guest1 = await pool.createClient(g1Nick, { label: 'guest1' });
        await joinRoomViaInviteUrl(guest1.page, code, {
          nickname: g1Nick,
          pathStyle: 'query',
        });
        await expect(guest1.page.getByTestId('online-room-screen')).toHaveAttribute(
          'data-room-code',
          code,
        );
        await expect(guest1.page.getByTestId('online-room-screen')).toHaveAttribute(
          'data-my-seat',
          '1',
        );
        expect(new URL(guest1.page.url()).searchParams.get('room')).toBe(code);

        const guest2 = await pool.createClient(g2Nick, { label: 'guest2' });
        await joinRoomViaInviteUrl(guest2.page, code, {
          nickname: g2Nick,
          pathStyle: 'path',
        });
        await expect(guest2.page.getByTestId('online-room-screen')).toHaveAttribute(
          'data-room-code',
          code,
        );
        await expect(guest2.page.getByTestId('online-room-screen')).toHaveAttribute(
          'data-my-seat',
          '2',
        );

        for (const [idx, expectedName] of [
          [0, hostNick],
          [1, g1Nick],
          [2, g2Nick],
        ] as const) {
          const seat = host.page.getByTestId(`room-seat-${idx}`);
          await expect(seat).toHaveAttribute('data-seat-type', 'human');
          await expect(seat).toHaveAttribute('data-connected', 'true');
          await expect(seat).toContainText(expectedName);
        }
        await expect(host.page.getByTestId('room-start-game-button')).toBeEnabled();

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-10: Waiting room host config edits (variant, format, timer, shuffle) propagate live to guests', async ({
      page,
      browser,
    }, testInfo) => {
      const hostNick = makeUniqueNickname('H10', testInfo);
      const guestNick = makeUniqueNickname('G10', testInfo);
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '3p',
          timerSeconds: 0,
          shuffleOrder: false,
        });
        const guest = await pool.createClient(guestNick, { label: 'guest' });
        await joinRoomByCode(guest.page, code, guestNick);

        // Host updates all 4 waiting-room configuration controls
        await configureWaitingRoom(host.page, {
          variant: 'wallgo2',
          timerSeconds: 60,
          shuffleOrder: true,
          format: '2p',
        });

        await expect(host.page.getByTestId('room-seat-2')).toHaveCount(0);
        await expect(host.page.getByTestId('room-start-game-button')).toBeEnabled();

        // Guest observes all 4 settings live, controls disabled, Start unmounted
        await expect(guest.page.getByTestId('room-variant-wallgo2')).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(guest.page.getByTestId('room-format-2p')).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(guest.page.getByTestId('room-timer-60')).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(guest.page.getByTestId('room-shuffle-toggle')).toHaveAttribute(
          'aria-checked',
          'true',
        );
        await expect(guest.page.getByTestId('room-seat-2')).toHaveCount(0);
        await expect(guest.page.getByTestId('room-variant-wallgo1')).toBeDisabled();
        await expect(guest.page.getByTestId('room-format-3p')).toBeDisabled();
        await expect(guest.page.getByTestId('room-timer-0')).toBeDisabled();
        await expect(guest.page.getByTestId('room-shuffle-toggle')).toBeDisabled();
        await expect(guest.page.getByTestId('room-start-game-button')).toHaveCount(0);

        // Host restores 3p -> seat 2 returns as open & Start disables again
        await configureWaitingRoom(host.page, { format: '3p' });
        await expect(host.page.getByTestId('room-seat-2')).toHaveAttribute(
          'data-seat-type',
          'open',
        );
        await expect(guest.page.getByTestId('room-seat-2')).toHaveAttribute(
          'data-seat-type',
          'open',
        );
        await expect(host.page.getByTestId('room-start-game-button')).toBeDisabled();

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-11: Waiting room AI bot mixing (room-seat-role-*) and host kick (room-seat-kick-*)', async ({
      page,
      browser,
    }, testInfo) => {
      const hostNick = makeUniqueNickname('H11', testInfo);
      const guestNick = makeUniqueNickname('G11', testInfo);
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '3p',
          timerSeconds: 0,
          shuffleOrder: false,
        });
        const guest = await pool.createClient(guestNick, {
          label: 'guest',
          guardOptions: { allowAbortedRoomPolls: true },
        });
        await joinRoomByCode(guest.page, code, guestNick);

        // Mix AI into Seat 2
        await setWaitingRoomSeatRole(host.page, 2, 'ai-easy');
        await expect(guest.page.getByTestId('room-seat-2')).toHaveAttribute('data-seat-type', 'ai');
        await setWaitingRoomSeatRole(host.page, 2, 'ai-normal');
        await expect(host.page.getByTestId('room-start-game-button')).toBeEnabled();

        // Kick visibility contract: host-only & non-host-human-only
        await expect(host.page.getByTestId('room-seat-kick-0')).toHaveCount(0);
        await expect(host.page.getByTestId('room-seat-kick-2')).toHaveCount(0);
        await expect(host.page.getByTestId('room-seat-kick-1')).toBeVisible();
        await expect(guest.page.getByTestId('room-seat-kick-0')).toHaveCount(0);
        await expect(guest.page.getByTestId('room-seat-kick-1')).toHaveCount(0);
        await expect(guest.page.getByTestId('room-seat-kick-2')).toHaveCount(0);

        // Host kicks Guest from Seat 1
        await kickRoomSeat(host.page, 1);
        await expect(host.page.getByTestId('room-start-game-button')).toBeDisabled();

        // Guest is cleanly evicted from the waiting room
        await expect(guest.page.getByTestId('online-room-screen')).toHaveCount(0, {
          timeout: 10_000,
        });
        await expect(guest.page.getByTestId('lobby-screen')).toBeVisible();

        // Host fills vacated Seat 1 with Hard AI -> Start re-enables
        await setWaitingRoomSeatRole(host.page, 1, 'ai-hard');
        await expect(host.page.getByTestId('room-start-game-button')).toBeEnabled();

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-12: Graceful Redis Unconfigured notice renders in KO & EN, disables room buttons, and keeps local play working', async ({
      page,
    }) => {
      const guard = attachRuntimeErrorGuard(page);

      try {
        await mockRedisUnconfigured(page);
        await openLobby(page);
        await openOnlineTab(page, { expectConfigured: false });

        const notice = page.getByTestId('redis-unconfigured-notice');
        await expect(notice).toBeVisible();
        await expect(notice).toHaveAttribute('role', 'status');
        const koNoticeText = ((await notice.textContent()) ?? '').trim();
        expect(koNoticeText).toMatch(/upstash|redis/i);
        expect(koNoticeText).toMatch(/[가-힣]/);

        await expect(page.getByTestId('create-room-button')).toBeDisabled();
        const codeInput = page.getByTestId('join-room-code-input');
        if (await codeInput.isEnabled()) {
          await codeInput.fill('ABCDEF');
        }
        await expect(page.getByTestId('join-room-button')).toBeDisabled();

        // Toggle to EN: setup notice updates cleanly to English with zero stray Hangul
        await toggleLanguage(page, 'en');
        const enNoticeText = ((await notice.textContent()) ?? '').trim();
        expect(enNoticeText).toMatch(/upstash|redis/i);
        await assertZeroStrayHangul(page);
        await assertNoUninterpolatedTemplates(page);

        // Local play remains 100% functional
        await openLocalTab(page);
        await startGame(page);
        await expect(page.getByTestId('game-screen')).toHaveAttribute('data-mode', 'local');
        await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'placement');

        guard.assertClean();
      } finally {
        guard.detach();
      }
    });
  },
);

// =============================================================================
// V2-FA-03 — Multi-Context Online Gameplay, Sync, Cancel, Undo Disabled, AI Mix & Timer (6)
// =============================================================================

test.describe(
  'Wall Go v2 Tier 1 — Online Multi-Context Gameplay, Sync, Cancel, AI Mix & Timer (V2-FA-03)',
  { tag: ['@v2', '@tier1'] },
  () => {
    test('V2-T1-13: 2P multi-context synchronized online placement, main turns, HUD landmarks & completion', async ({
      page,
      browser,
    }, testInfo) => {
      test.setTimeout(60_000);
      const { names } = createScopedMatchNicknames(['H13', 'G13'] as const, testInfo);
      const [hostNick, guestNick] = names;
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '2p',
          timerSeconds: 0,
          shuffleOrder: false,
        });
        const guest = await pool.createClient(guestNick, { label: 'guest' });
        await joinRoomByCode(guest.page, code, guestNick);
        await startOnlineGame(host.page, [host.page, guest.page]);

        // Verify online game metadata & HUD landmarks on both clients
        for (const [client, expectedSeat, expectedIsHost] of [
          [host, '0', 'true'],
          [guest, '1', 'false'],
        ] as const) {
          const game = client.page.getByTestId('game-screen');
          await expect(game).toHaveAttribute('data-mode', 'online');
          await expect(game).toHaveAttribute('data-room-code', code);
          await expect(game).toHaveAttribute('data-format', '2p');
          await expect(game).toHaveAttribute('data-phase', 'placement');
          await expect(game).toHaveAttribute('data-my-seat', expectedSeat);
          await expect(game).toHaveAttribute('data-is-host', expectedIsHost);

          await expect(client.page.getByTestId('online-connection-badge')).toHaveAttribute(
            'data-status',
            'connected',
          );
          await expect(client.page.getByTestId('online-seat-status-0')).toHaveAttribute(
            'data-status',
            'online',
          );
          await expect(client.page.getByTestId('online-seat-status-1')).toHaveAttribute(
            'data-status',
            'online',
          );
          await assertV2ScreenLayout(client.page, 'game');
        }

        const copyInviteBtn = host.page.getByTestId('online-copy-invite-button');
        await copyInviteBtn.click();
        await expect(copyInviteBtn).toHaveAttribute('data-copied', 'true');

        // Execute full 2P online game (4 placements + 6 turns)
        await completeOnline2PWallGo1Fast([host, guest]);

        for (const p of [host.page, guest.page]) {
          await expect(p.getByTestId('result-rank-row-0')).toHaveAttribute('data-rank', '1');
          await expect(p.getByTestId('result-rank-row-0')).toHaveAttribute(
            'data-total-cells',
            '45',
          );
          await expect(p.getByTestId('result-rank-row-1')).toHaveAttribute('data-rank', '2');
          await expect(p.getByTestId('result-rank-row-1')).toHaveAttribute('data-total-cells', '4');
        }
        await assertAllClientsBoardSynced([host.page, guest.page]);

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-14: 3P multi-context synchronized placement, active-seat enforcement & live territory sync', async ({
      page,
      browser,
    }, testInfo) => {
      test.setTimeout(60_000);
      const { names } = createScopedMatchNicknames(['H14', 'G14a', 'G14b'] as const, testInfo);
      const [hostNick, g1Nick, g2Nick] = names;
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '3p',
          timerSeconds: 0,
          shuffleOrder: false,
        });
        const guest1 = await pool.createClient(g1Nick, { label: 'guest1' });
        const guest2 = await pool.createClient(g2Nick, { label: 'guest2' });
        await joinRoomByCode(guest1.page, code, g1Nick);
        await joinRoomByCode(guest2.page, code, g2Nick);
        await startOnlineGame(host.page, [host.page, guest1.page, guest2.page]);

        // Non-active seats must have 0 valid moves and cannot place out of turn
        await expect(host.page.getByTestId('game-screen')).toHaveAttribute(
          'data-current-player',
          '0',
        );
        await expect(guest1.page.locator('[data-valid-move="true"]')).toHaveCount(0);
        await expect(guest2.page.locator('[data-valid-move="true"]')).toHaveCount(0);
        await tapLocatorCenter(guest1.page, cellLocator(guest1.page, 3, 3));
        await expect(cellLocator(guest1.page, 3, 3)).toHaveAttribute('data-occupied-by', 'none');
        await expect(guest1.page.getByTestId('game-screen')).toHaveAttribute(
          'data-current-player',
          '0',
        );

        // Complete 3P snake placement [0,1,2,2,1,0]
        await completeOnlinePlacement([host, guest1, guest2], SCRIPT_A1_PLACEMENTS, 0);

        // Non-active player cannot select their own piece during P0's turn
        await tapLocatorCenter(guest1.page, cellLocator(guest1.page, 0, 1));
        await expect(cellLocator(guest1.page, 0, 1)).toHaveAttribute('data-selected', 'false');
        await expect(guest1.page.getByTestId('game-screen')).toHaveAttribute(
          'data-phase',
          'select_piece',
        );

        // Execute 2 turns to seal P0's corner (0,0) = 1-cell territory
        const turn1 = await playOnlineTurnStep([host, guest1, guest2], {
          expectedPlayerId: 0,
          from: { row: 0, col: 0 },
          to: { row: 0, col: 0 },
          wall: hWall(0, 0),
        });
        await playOnlineTurnStep([host, guest1, guest2], {
          expectedPlayerId: 1,
          minTurnNumber: turn1.turnAfter,
          from: { row: 0, col: 1 },
          to: { row: 0, col: 1 },
          wall: vWall(0, 0),
        });

        for (const p of [host.page, guest1.page, guest2.page]) {
          await expect(placedWallLocator(p, hWall(0, 0))).toBeVisible({ timeout: 10_000 });
          await expect(placedWallLocator(p, vWall(0, 0))).toBeVisible({ timeout: 10_000 });
          await expect(territoryBadgeLocator(p, 0, 0)).toHaveAttribute('data-count', '1');
          await expect(p.getByTestId('player-score-0')).toHaveAttribute('data-value', '1');
          await expect(p.getByTestId('game-screen')).toHaveAttribute('data-current-player', '2');
        }
        await assertAllClientsBoardSynced([host.page, guest1.page, guest2.page]);

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-15: Intra-turn cancel-move-button reverts local draft before wall placement without advancing server turn', async ({
      page,
      browser,
    }, testInfo) => {
      const hostNick = makeUniqueNickname('H15', testInfo);
      const guestNick = makeUniqueNickname('G15', testInfo);
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '2p',
          timerSeconds: 0,
          shuffleOrder: false,
        });
        const guest = await pool.createClient(guestNick, { label: 'guest' });
        await joinRoomByCode(guest.page, code, guestNick);
        await startOnlineGame(host.page, [host.page, guest.page]);
        await completeOnlinePlacement([host, guest], DEFAULT_2P_PLACEMENTS, 4);

        const turnBefore = (await readGameScreenState(host.page)).turnNumber;

        // Host makes uncommitted local move (1,1) -> (1,2)
        await selectCell(host.page, 1, 1);
        await moveSelectedTo(host.page, 1, 2);

        // Guest still sees original server state (draft is strictly local before wall placement)
        await expect(cellLocator(guest.page, 1, 1)).toHaveAttribute('data-occupied-by', '0');
        await expect(cellLocator(guest.page, 1, 2)).toHaveAttribute('data-occupied-by', 'none');
        await expect(guest.page.getByTestId('game-screen')).toHaveAttribute(
          'data-turn-number',
          String(turnBefore),
        );

        // Host cancels intra-turn move
        await cancelTurnMove(host.page);
        await expect(cellLocator(host.page, 1, 1)).toHaveAttribute('data-occupied-by', '0');
        await expect(cellLocator(host.page, 1, 2)).toHaveAttribute('data-occupied-by', 'none');
        await expect(host.page.getByTestId('game-screen')).toHaveAttribute(
          'data-turn-number',
          String(turnBefore),
        );

        // Host commits a different legal move + wall -> advances server turn on both clients
        await moveSelectedTo(host.page, 0, 1);
        await wallSlotLocator(host.page, vWall(0, 1)).click();

        for (const p of [host.page, guest.page]) {
          await expect(p.getByTestId('game-screen')).toHaveAttribute(
            'data-turn-number',
            String(turnBefore + 1),
            { timeout: 10_000 },
          );
          await expect(p.getByTestId('game-screen')).toHaveAttribute('data-current-player', '1');
          await expect(cellLocator(p, 0, 1)).toHaveAttribute('data-occupied-by', '0');
          await expect(placedWallLocator(p, vWall(0, 1))).toBeVisible();
        }

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-16: Post-turn undo-button & redo-button stay disabled (data-online-disabled="true") while mid-game invite copy works', async ({
      page,
      browser,
    }, testInfo) => {
      const hostNick = makeUniqueNickname('H16', testInfo);
      const guestNick = makeUniqueNickname('G16', testInfo);
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '2p',
          timerSeconds: 0,
          shuffleOrder: false,
        });
        const guest = await pool.createClient(guestNick, { label: 'guest' });
        await joinRoomByCode(guest.page, code, guestNick);
        await startOnlineGame(host.page, [host.page, guest.page]);
        await completeOnlinePlacement([host, guest], DEFAULT_2P_PLACEMENTS, 4);

        const t1 = await playOnlineTurnStep([host, guest], {
          expectedPlayerId: 0,
          from: { row: 1, col: 1 },
          to: { row: 0, col: 1 },
          wall: vWall(0, 1),
        });
        await playOnlineTurnStep([host, guest], {
          expectedPlayerId: 1,
          minTurnNumber: t1.turnAfter,
          from: { row: 1, col: 5 },
          to: { row: 1, col: 4 },
          wall: hWall(1, 4),
        });

        await expect(host.page.getByTestId('game-screen')).toHaveAttribute(
          'data-current-player',
          '0',
          { timeout: 10_000 },
        );

        for (const p of [host.page, guest.page]) {
          await expect(p.getByTestId('undo-button')).toBeDisabled();
          await expect(p.getByTestId('undo-button')).toHaveAttribute('data-online-disabled', 'true');
          await expect(p.getByTestId('redo-button')).toBeDisabled();
          await expect(p.getByTestId('redo-button')).toHaveAttribute('data-online-disabled', 'true');
        }

        // During intra-turn place_wall (legal move (0,1)->(0,0), unobstructed by v(0,1)),
        // cancel-move-button is enabled while undo/redo stay strictly disabled
        await selectCell(host.page, 0, 1);
        await moveSelectedTo(host.page, 0, 0);
        await expect(host.page.getByTestId('cancel-move-button')).toBeEnabled();
        await expect(host.page.getByTestId('undo-button')).toBeDisabled();
        await expect(host.page.getByTestId('undo-button')).toHaveAttribute(
          'data-online-disabled',
          'true',
        );
        await expect(host.page.getByTestId('redo-button')).toBeDisabled();
        await expect(host.page.getByTestId('redo-button')).toHaveAttribute(
          'data-online-disabled',
          'true',
        );

        const guestCopyBtn = guest.page.getByTestId('online-copy-invite-button');
        await guestCopyBtn.click();
        await expect(guestCopyBtn).toHaveAttribute('data-copied', 'true');

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-17: Mixed Human + AI online room executes server-paced AI placements and main turns cleanly', async ({
      page,
      browser,
    }, testInfo) => {
      test.setTimeout(60_000);
      const hostNick = makeUniqueNickname('H17', testInfo);
      const guestNick = makeUniqueNickname('G17', testInfo);
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '3p',
          timerSeconds: 0,
          shuffleOrder: false,
        });
        const guest = await pool.createClient(guestNick, { label: 'guest' });
        await joinRoomByCode(guest.page, code, guestNick);
        await setWaitingRoomSeatRole(host.page, 2, 'ai-normal');
        await startOnlineGame(host.page, [host.page, guest.page]);

        for (const p of [host.page, guest.page]) {
          await expect(p.getByTestId('online-seat-status-2')).toHaveAttribute('data-status', 'ai');
          await expect(playerCardLocator(p, 2)).toHaveAttribute('data-is-ai', 'true');
        }

        // Snake placement [0, 1, 2 (AI), 2 (AI), 1, 0]
        await expect(host.page.getByTestId('game-screen')).toHaveAttribute(
          'data-current-player',
          '0',
        );
        await placeFirstAvailableEmptyCell(host.page, [{ row: 0, col: 0 }]);
        await expect(boardPiecesLocator(host.page)).toHaveCount(1);

        await expect(guest.page.getByTestId('game-screen')).toHaveAttribute(
          'data-current-player',
          '1',
          { timeout: 10_000 },
        );
        await expect(boardPiecesLocator(guest.page)).toHaveCount(1);
        await placeFirstAvailableEmptyCell(guest.page, [{ row: 0, col: 6 }]);
        await expect(boardPiecesLocator(guest.page)).toHaveCount(2);

        // Wait for server-paced AI (P2) to place BOTH pieces and return turn to Guest (P1)
        await expect(boardPiecesLocator(guest.page)).toHaveCount(4, { timeout: 15_000 });
        await expect(guest.page.getByTestId('game-screen')).toHaveAttribute(
          'data-current-player',
          '1',
        );
        await placeFirstAvailableEmptyCell(guest.page, [{ row: 6, col: 6 }]);
        await expect(boardPiecesLocator(guest.page)).toHaveCount(5);

        await expect(boardPiecesLocator(host.page)).toHaveCount(5, { timeout: 10_000 });
        await expect(host.page.getByTestId('game-screen')).toHaveAttribute(
          'data-current-player',
          '0',
        );
        await placeFirstAvailableEmptyCell(host.page, [{ row: 6, col: 0 }]);

        for (const p of [host.page, guest.page]) {
          await expect(p.getByTestId('game-screen')).toHaveAttribute('data-phase', 'select_piece', {
            timeout: 10_000,
          });
          await expect(boardPiecesLocator(p)).toHaveCount(6);
        }

        // Turn 1: Host (P0) human
        const turn0 = (await readGameScreenState(host.page)).turnNumber;
        await playFirstLegalHumanTurn(host.page, 0);
        await expect
          .poll(async () => {
            const s = await readGameScreenState(host.page);
            return s.phase === 'game_over' || s.turnNumber > turn0;
          })
          .toBe(true);

        // Turn 2: Guest (P1) human
        await expect
          .poll(
            async () => {
              const s = await readGameScreenState(guest.page);
              return s.phase === 'game_over' || (s.currentPlayer === 1 && s.turnNumber > turn0);
            },
            { timeout: 15_000 },
          )
          .toBe(true);

        const guestState = await readGameScreenState(guest.page);
        if (guestState.phase !== 'game_over') {
          await playFirstLegalHumanTurn(guest.page, 1);
          await expect
            .poll(async () => {
              const s = await readGameScreenState(guest.page);
              return s.phase === 'game_over' || s.turnNumber > guestState.turnNumber;
            })
            .toBe(true);

          const turnAfterGuest = (await readGameScreenState(guest.page)).turnNumber;

          // Turn 3: AI (P2) auto-executes via server ai_step and hands turn back to Host (P0)
          for (const p of [host.page, guest.page]) {
            await expect
              .poll(
                async () => {
                  const s = await readGameScreenState(p);
                  return (
                    s.phase === 'game_over' ||
                    (s.turnNumber > turnAfterGuest && s.currentPlayer === 0)
                  );
                },
                { timeout: 20_000 },
              )
              .toBe(true);
          }
        }

        await assertAllClientsBoardSynced([host.page, guest.page]);
        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-18: Synchronized online turn timer (60s) pauses during placement, counts down in sync, ignores RulesModal pause, and resets on turn commit', async ({
      page,
      browser,
    }, testInfo) => {
      const hostNick = makeUniqueNickname('H18', testInfo);
      const guestNick = makeUniqueNickname('G18', testInfo);
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '2p',
          timerSeconds: 60,
          shuffleOrder: false,
        });
        const guest = await pool.createClient(guestNick, { label: 'guest' });
        await joinRoomByCode(guest.page, code, guestNick);
        await startOnlineGame(host.page, [host.page, guest.page]);

        // During placement: timer mounted & paused at 60s on both clients; pause control disabled/unmounted in online mode
        for (const p of [host.page, guest.page]) {
          const timer = p.getByTestId('turn-timer');
          await expect(timer).toBeVisible();
          await expect(timer).toHaveAttribute('role', 'timer');
          await expect(timer).toHaveAttribute('data-paused', 'true');
          await expect(timer).toHaveAttribute('data-seconds', '60');
        }
        const pauseBtn = host.page.getByTestId('timer-pause-button');
        if ((await pauseBtn.count()) > 0) {
          await expect(pauseBtn).toBeDisabled();
        }

        await completeOnlinePlacement([host, guest], DEFAULT_2P_PLACEMENTS, 4);

        const readTimerSeconds = async (p: typeof host.page): Promise<number> =>
          Number((await p.getByTestId('turn-timer').getAttribute('data-seconds')) ?? '-1');

        for (const p of [host.page, guest.page]) {
          await expect(p.getByTestId('turn-timer')).toHaveAttribute('data-paused', 'false');
        }

        const initialHostSec = await readTimerSeconds(host.page);
        const initialGuestSec = await readTimerSeconds(guest.page);
        expect(initialHostSec).toBeGreaterThanOrEqual(45);
        expect(initialHostSec).toBeLessThanOrEqual(60);
        expect(Math.abs(initialHostSec - initialGuestSec)).toBeLessThanOrEqual(3);

        // Observe live countdown via web-first polling (wait for >= 3s drop to <= 56s)
        const targetTickSec = Math.min(56, initialHostSec - 3);
        await expect
          .poll(() => readTimerSeconds(host.page), { timeout: 12_000 })
          .toBeLessThanOrEqual(targetTickSec);

        // Opening RulesModal must NEVER pause the online turn timer
        await openRulesModal(host.page);
        await expect(host.page.getByTestId('turn-timer')).toHaveAttribute('data-paused', 'false');
        await closeRulesModal(host.page, 'button');

        const preCommitSec = await readTimerSeconds(host.page);
        expect(preCommitSec).toBeLessThanOrEqual(56);

        // Commit turn 1 -> timer resets cleanly to ~60s on both clients
        await playOnlineTurnStep([host, guest], {
          expectedPlayerId: 0,
          from: { row: 1, col: 1 },
          to: { row: 0, col: 1 },
          wall: vWall(0, 1),
        });

        await expect(guest.page.getByTestId('game-screen')).toHaveAttribute(
          'data-current-player',
          '1',
          { timeout: 10_000 },
        );
        await expect
          .poll(() => readTimerSeconds(host.page), { timeout: 10_000 })
          .toBeGreaterThan(preCommitSec);
        await expect
          .poll(() => readTimerSeconds(guest.page), { timeout: 10_000 })
          .toBeGreaterThan(preCommitSec);

        const postHostSec = await readTimerSeconds(host.page);
        const postGuestSec = await readTimerSeconds(guest.page);
        expect(postHostSec).toBeGreaterThanOrEqual(55);
        expect(postHostSec).toBeLessThanOrEqual(60);
        expect(postGuestSec).toBeGreaterThanOrEqual(55);
        expect(postGuestSec).toBeLessThanOrEqual(60);
        expect(Math.abs(postHostSec - postGuestSec)).toBeLessThanOrEqual(3);

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });
  },
);

// =============================================================================
// V2-FA-04 — Online Resilience: Reconnect, AI-Sub, Spectator & Same-Room Round 2 (6)
// =============================================================================

test.describe(
  'Wall Go v2 Tier 1 — Online Resilience, Reconnect, AI-Sub, Spectator & Round 2 (V2-FA-04)',
  { tag: ['@v2', '@tier1'] },
  () => {
    test('V2-T1-19: Refresh (page.reload) auto-reconnects into the exact Waiting Room seat for both Guest and Host', async ({
      page,
      browser,
    }, testInfo) => {
      const hostNick = makeUniqueNickname('H19', testInfo);
      const guestNick = makeUniqueNickname('G19', testInfo);
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, {
        label: 'host',
        guardOptions: { allowAbortedRoomPolls: true },
      });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '3p',
          timerSeconds: 0,
          shuffleOrder: false,
        });
        const guest = await pool.createClient(guestNick, {
          label: 'guest',
          guardOptions: { allowAbortedRoomPolls: true },
        });
        await joinRoomByCode(guest.page, code, guestNick);

        // Confirm sessionToken persisted in wallgo.roomSessions & URL carries ?room=CODE
        const guestSessionToken = await guest.page.evaluate(
          ({ storageKey, roomCode }) => {
            const raw = window.localStorage.getItem(storageKey);
            if (!raw) {
              return null;
            }
            const map = JSON.parse(raw) as Record<string, { sessionToken?: string }>;
            return map[roomCode]?.sessionToken ?? null;
          },
          { storageKey: V2_STORAGE_KEYS.roomSessions, roomCode: code },
        );
        expect(typeof guestSessionToken).toBe('string');
        expect(String(guestSessionToken ?? '').length).toBeGreaterThan(0);
        expect(new URL(guest.page.url()).searchParams.get('room')).toBe(code);

        // Reload Guest -> auto-reconnects straight into Seat 1 with zero clicks
        await reloadOnlinePage(guest.page);
        const guestRoom = guest.page.getByTestId('online-room-screen');
        await expect(guestRoom).toBeVisible();
        await expect(guestRoom).toHaveAttribute('data-room-code', code);
        await expect(guestRoom).toHaveAttribute('data-my-seat', '1');
        await expect(guestRoom).toHaveAttribute('data-is-host', 'false');
        await expect(guest.page.getByTestId('room-seat-1')).toHaveAttribute('data-is-me', 'true');
        await expect(guest.page.getByTestId('room-seat-1')).toHaveAttribute(
          'data-connected',
          'true',
        );
        await expect(guest.page.getByTestId('room-seat-1')).toContainText(guestNick);

        // Reload Host -> auto-reconnects straight into Seat 0 preserving Host role
        await reloadOnlinePage(host.page);
        const hostRoom = host.page.getByTestId('online-room-screen');
        await expect(hostRoom).toBeVisible();
        await expect(hostRoom).toHaveAttribute('data-room-code', code);
        await expect(hostRoom).toHaveAttribute('data-is-host', 'true');
        await expect(hostRoom).toHaveAttribute('data-my-seat', '0');
        await expect(host.page.getByTestId('room-seat-0')).toHaveAttribute('data-is-me', 'true');
        await expect(host.page.getByTestId('room-seat-0')).toHaveAttribute('data-is-host', 'true');
        await expect(host.page.getByTestId('room-start-game-button')).toBeVisible();

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-20: Refresh mid-game and mid-turn before wall placement auto-reconnects cleanly to select_piece', async ({
      page,
      browser,
    }, testInfo) => {
      const hostNick = makeUniqueNickname('H20', testInfo);
      const guestNick = makeUniqueNickname('G20', testInfo);
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, {
        label: 'host',
        guardOptions: { allowAbortedRoomPolls: true },
      });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '2p',
          timerSeconds: 0,
          shuffleOrder: false,
        });
        const guest = await pool.createClient(guestNick, {
          label: 'guest',
          guardOptions: { allowAbortedRoomPolls: true },
        });
        await joinRoomByCode(guest.page, code, guestNick);
        await startOnlineGame(host.page, [host.page, guest.page]);
        await completeOnlinePlacement([host, guest], DEFAULT_2P_PLACEMENTS, 4);

        // Host commits turn 1 so Guest (P1) is active
        await playOnlineTurnStep([host, guest], {
          expectedPlayerId: 0,
          from: { row: 1, col: 1 },
          to: { row: 0, col: 1 },
          wall: vWall(0, 1),
        });

        await expect(guest.page.getByTestId('game-screen')).toHaveAttribute(
          'data-current-player',
          '1',
          { timeout: 10_000 },
        );

        // Guest makes uncommitted local draft move (1,5) -> (1,4), then refreshes
        await selectCell(guest.page, 1, 5);
        await moveSelectedTo(guest.page, 1, 4);
        await reloadOnlinePage(guest.page);

        // Guest reconnects straight into game-screen at select_piece with uncommitted draft discarded
        const guestGame = guest.page.getByTestId('game-screen');
        await expect(guestGame).toBeVisible();
        await expect(guestGame).toHaveAttribute('data-mode', 'online');
        await expect(guestGame).toHaveAttribute('data-room-code', code);
        await expect(guestGame).toHaveAttribute('data-my-seat', '1');
        await expect(guestGame).toHaveAttribute('data-current-player', '1');
        await expect(guestGame).toHaveAttribute('data-phase', 'select_piece');
        await expect(cellLocator(guest.page, 1, 5)).toHaveAttribute('data-occupied-by', '1');
        await expect(cellLocator(guest.page, 1, 4)).toHaveAttribute('data-occupied-by', 'none');
        await expect(placedWallLocator(guest.page, vWall(0, 1))).toBeVisible();

        // Guest completes the turn and Host syncs cleanly
        await playHumanTurn(guest.page, { row: 1, col: 5 }, { row: 1, col: 4 }, hWall(1, 4));
        await expect(placedWallLocator(host.page, hWall(1, 4))).toBeVisible({ timeout: 10_000 });
        await expect(host.page.getByTestId('game-screen')).toHaveAttribute(
          'data-current-player',
          '0',
        );

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-21: Mid-game explicit Leave marks seat offline; Host clicks substitute-ai-button-{id} and AI completes turn', async ({
      page,
      browser,
    }, testInfo) => {
      test.setTimeout(60_000);
      const hostNick = makeUniqueNickname('H21', testInfo);
      const guestNick = makeUniqueNickname('G21', testInfo);
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '2p',
          timerSeconds: 0,
          shuffleOrder: false,
        });
        const guest = await pool.createClient(guestNick, { label: 'guest' });
        await joinRoomByCode(guest.page, code, guestNick);
        await startOnlineGame(host.page, [host.page, guest.page]);
        await completeOnlinePlacement([host, guest], DEFAULT_2P_PLACEMENTS, 4);

        const t1 = await playOnlineTurnStep([host, guest], {
          expectedPlayerId: 0,
          from: { row: 1, col: 1 },
          to: { row: 0, col: 1 },
          wall: vWall(0, 1),
        });
        const turnBefore = t1.turnAfter;

        await expect(guest.page.getByTestId('game-screen')).toHaveAttribute(
          'data-current-player',
          '1',
          { timeout: 10_000 },
        );

        // Guest explicitly leaves mid-game -> immediate offline transition (0s grace)
        await leaveOnlineRoom(guest.page);

        // Host substitutes disconnected seat 1 with AI
        await substituteDisconnectedSeatWithAi(host.page, 1, [host.page], 10_000);

        // AI completes the abandoned turn automatically
        await expect
          .poll(
            async () => {
              const s = await readGameScreenState(host.page);
              return s.phase === 'game_over' || (s.turnNumber > turnBefore && s.currentPlayer === 0);
            },
            { timeout: 20_000 },
          )
          .toBe(true);
        expect(await host.page.locator('[data-testid^="placed-wall-"]').count()).toBeGreaterThanOrEqual(
          2,
        );

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-22: Overflow joiner enters full room as read-only Spectator (online-spectator-banner), receives live updates, cannot mutate', async ({
      page,
      browser,
    }, testInfo) => {
      test.setTimeout(60_000);
      const { names } = createScopedMatchNicknames(['H22', 'G22', 'S22'] as const, testInfo);
      const [hostNick, guestNick, specNick] = names;
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '2p',
          timerSeconds: 0,
          shuffleOrder: false,
        });
        const guest = await pool.createClient(guestNick, { label: 'guest' });
        await joinRoomByCode(guest.page, code, guestNick);

        // 3rd user joins full 2p room -> overflow Spectator
        const spec = await pool.createClient(specNick, { label: 'spectator' });
        await joinRoomViaInviteUrl(spec.page, code, { nickname: specNick, pathStyle: 'query' });

        await expect(spec.page.getByTestId('online-room-screen')).toHaveAttribute(
          'data-my-seat',
          'spectator',
        );
        await expect(spec.page.getByTestId('online-room-screen')).toHaveAttribute(
          'data-is-host',
          'false',
        );

        for (const p of [host.page, guest.page, spec.page]) {
          const specList = p.getByTestId('room-spectator-list');
          await expect(specList).toHaveAttribute('data-spectator-count', '1', { timeout: 10_000 });
          await expect(specList).toContainText(specNick);
        }

        // Start game -> Spectator enters read-only game view with online-spectator-banner inside turn-banner
        await startOnlineGame(host.page, [host.page, guest.page, spec.page]);

        const specGame = spec.page.getByTestId('game-screen');
        await expect(specGame).toHaveAttribute('data-mode', 'online');
        await expect(specGame).toHaveAttribute('data-my-seat', 'spectator');
        const specBanner = spec.page.getByTestId('turn-banner').getByTestId('online-spectator-banner');
        await expect(specBanner).toBeVisible();
        await expect(specBanner).toHaveAttribute('role', 'note');
        await assertV2ScreenLayout(spec.page, 'game');

        // Read-only enforcement on Spectator
        await expect(spec.page.locator('[data-valid-move="true"]')).toHaveCount(0);
        await tapLocatorCenter(spec.page, cellLocator(spec.page, 2, 2));
        await expect(cellLocator(spec.page, 2, 2)).toHaveAttribute('data-occupied-by', 'none');
        await expect(spec.page.getByTestId('undo-button')).toBeDisabled();
        await expect(spec.page.getByTestId('redo-button')).toBeDisabled();
        await expect(spec.page.getByTestId('cancel-move-button')).toBeDisabled();

        // Players place + commit turn 1 -> Spectator receives live board sync
        await completeOnlinePlacement([host, guest], DEFAULT_2P_PLACEMENTS, 4);
        await playOnlineTurnStep([host, guest], {
          expectedPlayerId: 0,
          from: { row: 1, col: 1 },
          to: { row: 0, col: 1 },
          wall: vWall(0, 1),
        });

        await expect(boardPiecesLocator(spec.page)).toHaveCount(8, { timeout: 10_000 });
        await expect(placedWallLocator(spec.page, vWall(0, 1))).toBeVisible({ timeout: 10_000 });
        await assertAllClientsBoardSynced([host.page, guest.page, spec.page]);

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-23: Same-room 3P completion -> Host starts Round 2 (online-round2-button) with 1st-place survivor auto-spectating', async ({
      page,
      browser,
    }, testInfo) => {
      test.setTimeout(90_000);
      const { names } = createScopedMatchNicknames(['H23', 'G23a', 'G23b'] as const, testInfo);
      const [hostNick, g1Nick, g2Nick] = names;
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '3p',
          timerSeconds: 0,
          shuffleOrder: false,
        });
        const guest1 = await pool.createClient(g1Nick, { label: 'guest1' });
        const guest2 = await pool.createClient(g2Nick, { label: 'guest2' });
        await joinRoomByCode(guest1.page, code, g1Nick);
        await joinRoomByCode(guest2.page, code, g2Nick);
        await startOnlineGame(host.page, [host.page, guest1.page, guest2.page]);

        // Complete 3P Round 1: Host=43 (1st survivor), Guest1=4 (2nd), Guest2=2 (3rd)
        await completeOnline3PWallGo1ScriptD([host, guest1, guest2]);

        await expect(host.page.getByTestId('online-round2-button')).toBeVisible();
        await expect(guest1.page.getByTestId('online-round2-button')).toHaveCount(0);
        await expect(guest2.page.getByTestId('online-round2-button')).toHaveCount(0);

        // Host launches Round 2 in the SAME room
        await startOnlineRound2(host.page, [host.page, guest1.page, guest2.page]);

        for (const p of [host.page, guest1.page, guest2.page]) {
          await expect(p.getByTestId('game-screen')).toHaveAttribute('data-room-code', code);
          await expect(boardPiecesLocator(p)).toHaveCount(4);
          await expect(p.getByTestId('wall-break-toggle')).toHaveCount(0);
        }

        // Host (1st-place survivor) becomes spectator while preserving isHost="true"
        await expect(host.page.getByTestId('game-screen')).toHaveAttribute(
          'data-my-seat',
          'spectator',
        );
        await expect(host.page.getByTestId('game-screen')).toHaveAttribute('data-is-host', 'true');
        await expect(
          host.page.getByTestId('turn-banner').getByTestId('online-spectator-banner'),
        ).toBeVisible();
        await expect(host.page.locator('[data-valid-move="true"]')).toHaveCount(0);

        // Advancing bottom 2 players remap cleanly to Seats 0 & 1
        await expect(guest1.page.getByTestId('game-screen')).toHaveAttribute('data-my-seat', '0');
        await expect(guest1.page.getByTestId('player-card-0')).toContainText(g1Nick);
        await expect(guest2.page.getByTestId('game-screen')).toHaveAttribute('data-my-seat', '1');
        await expect(guest2.page.getByTestId('player-card-1')).toContainText(g2Nick);

        // Guest1 & Guest2 complete Round 2 while Host spectates live
        await completeOnline2PWallGo1Fast([guest1, guest2], [host.page]);

        for (const p of [host.page, guest1.page, guest2.page]) {
          await expect(p.getByTestId('online-round2-button')).toHaveCount(0);
          await expect(p.getByTestId('result-rank-row-0')).toHaveAttribute(
            'data-total-cells',
            '45',
          );
          await expect(p.getByTestId('result-rank-row-1')).toHaveAttribute('data-total-cells', '4');
        }
        await assertAllClientsBoardSynced([host.page, guest1.page, guest2.page]);

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });

    test('V2-T1-24: Online post-game Host online-rematch-button and online-return-waiting-button flows', async ({
      page,
      browser,
    }, testInfo) => {
      test.setTimeout(90_000);
      const { names } = createScopedMatchNicknames(['H24', 'G24'] as const, testInfo);
      const [hostNick, guestNick] = names;
      const pool = createOnlineSessionPool(browser, testInfo);
      const host = pool.attachPrimaryClient(page, hostNick, { label: 'host' });

      try {
        const code = await createOnlineRoom(host.page, {
          nickname: hostNick,
          variant: 'wallgo1',
          format: '2p',
          timerSeconds: 0,
          shuffleOrder: false,
        });
        const guest = await pool.createClient(guestNick, { label: 'guest' });
        await joinRoomByCode(guest.page, code, guestNick);
        await startOnlineGame(host.page, [host.page, guest.page]);
        await completeOnline2PWallGo1Fast([host, guest]);

        // Host sees rematch & return-to-waiting (no round2 in 2P); Guest sees none
        await expect(host.page.getByTestId('online-rematch-button')).toBeVisible();
        await expect(host.page.getByTestId('online-return-waiting-button')).toBeVisible();
        await expect(host.page.getByTestId('online-round2-button')).toHaveCount(0);
        await expect(guest.page.getByTestId('online-rematch-button')).toHaveCount(0);
        await expect(guest.page.getByTestId('online-return-waiting-button')).toHaveCount(0);
        await expect(guest.page.getByTestId('online-round2-button')).toHaveCount(0);

        // Trigger online rematch in same room
        await triggerOnlineRematch(host.page, [host.page, guest.page]);
        for (const p of [host.page, guest.page]) {
          await expect(p.getByTestId('game-screen')).toHaveAttribute('data-room-code', code);
          await expect(boardPiecesLocator(p)).toHaveCount(4);
        }

        // Complete rematch, then return both clients to waiting room
        await completeOnline2PWallGo1Fast([host, guest]);
        await returnOnlineToWaiting(host.page, [host.page, guest.page]);

        for (const p of [host.page, guest.page]) {
          await expect(p.getByTestId('online-room-screen')).toHaveAttribute('data-room-code', code);
          await expect(p.getByTestId('room-seat-0')).toContainText(hostNick);
          await expect(p.getByTestId('room-seat-1')).toContainText(guestNick);
        }
        await expect(host.page.getByTestId('room-start-game-button')).toBeEnabled();

        pool.assertAllClean();
      } finally {
        await pool.closeAll();
      }
    });
  },
);
