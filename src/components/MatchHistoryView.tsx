import { useEffect, useMemo, useRef, useState } from 'react';
import { LanguageToggle, useI18n } from '../i18n';
import { computePlayerAggregateStats } from '../shared';
import type { MatchRecord, MatchSummary } from '../shared';
import { MiniBoardPreview } from './MiniBoardPreview';

export type HistorySourceFilter = 'all' | 'online' | 'local';

export interface MatchHistoryViewProps {
  localMatches: readonly MatchRecord[];
  onlineMatches?: readonly MatchSummary[];
  onlineAvailable?: boolean;
  onlineLoading?: boolean;
  onBack: () => void;
  onOpenReplay: (match: MatchRecord) => void;
  onLoadOnlineMatch?: (matchId: string) => Promise<MatchRecord>;
  onRefreshOnline?: () => void;
}

function formatMatchDate(iso: string, locale: 'ko' | 'en'): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return iso;
  }
  try {
    return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(parsed));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export function MatchHistoryView({
  localMatches,
  onlineMatches,
  onlineAvailable,
  onlineLoading = false,
  onBack,
  onOpenReplay,
  onLoadOnlineMatch,
}: MatchHistoryViewProps) {
  const { locale, t } = useI18n();
  const [sourceFilter, setSourceFilter] = useState<HistorySourceFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loadingMatchId, setLoadingMatchId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const localById = useMemo(() => {
    const map = new Map<string, MatchRecord>();
    for (const record of localMatches) {
      map.set(record.id, record);
    }
    return map;
  }, [localMatches]);

  const mergedMatches = useMemo(() => {
    const byId = new Map<string, MatchSummary>();
    // Insert online first, then local so local records retain inline replay if an ID overlaps
    if (onlineMatches) {
      for (const m of onlineMatches) {
        byId.set(m.id, m);
      }
    }
    for (const m of localMatches) {
      byId.set(m.id, m);
    }
    return Array.from(byId.values()).sort((a, b) => {
      const ta = Date.parse(a.playedAt);
      const tb = Date.parse(b.playedAt);
      const safeA = Number.isFinite(ta) ? ta : 0;
      const safeB = Number.isFinite(tb) ? tb : 0;
      if (safeB !== safeA) {
        return safeB - safeA;
      }
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
  }, [localMatches, onlineMatches]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredMatches = useMemo(() => {
    const bySource =
      sourceFilter === 'all'
        ? mergedMatches
        : mergedMatches.filter((m) => m.mode === sourceFilter);
    if (!normalizedQuery) {
      return bySource;
    }
    return bySource.filter((m) =>
      m.players.some((p) => p.name.toLowerCase().includes(normalizedQuery)),
    );
  }, [mergedMatches, sourceFilter, normalizedQuery]);

  const statsRows = useMemo(() => {
    const allStats = computePlayerAggregateStats(filteredMatches);
    if (!normalizedQuery) {
      return allStats;
    }
    return allStats.filter((row) =>
      row.displayName.toLowerCase().includes(normalizedQuery),
    );
  }, [filteredMatches, normalizedQuery]);

  const hasActiveFilter = sourceFilter !== 'all' || normalizedQuery.length > 0;

  const handleOpenMatchReplay = async (match: MatchSummary) => {
    setLoadError(null);
    const localRecord = localById.get(match.id);
    if (localRecord) {
      onOpenReplay(localRecord);
      return;
    }
    if (!onLoadOnlineMatch) {
      setLoadError(t.history.loadReplayError);
      return;
    }
    setLoadingMatchId(match.id);
    try {
      const fullRecord = await onLoadOnlineMatch(match.id);
      if (mountedRef.current) {
        setLoadingMatchId(null);
        onOpenReplay(fullRecord);
      }
    } catch {
      if (mountedRef.current) {
        setLoadingMatchId(null);
        setLoadError(t.history.loadReplayError);
      }
    }
  };

  return (
    <main
      className="history-screen"
      data-testid="history-screen"
      role="main"
      data-active-filter={sourceFilter}
    >
      <div className="history-shell">
        <header className="history-header">
          <div className="history-header-left">
            <button
              type="button"
              className="btn-history-back"
              data-testid="history-back-button"
              onClick={onBack}
            >
              ← {t.history.backButton}
            </button>
            <div className="history-title-wrap">
              <h1 className="history-title">{t.history.title}</h1>
              <p className="history-subtitle">{t.history.subtitle}</p>
            </div>
          </div>
          <div className="history-header-actions">
            <LanguageToggle />
          </div>
        </header>

        <div className="history-toolbar">
          <div
            className="history-filters"
            role="group"
            aria-label={t.history.filterGroupAria}
          >
            <button
              type="button"
              className="history-filter-btn"
              data-testid="history-filter-all"
              aria-pressed={sourceFilter === 'all'}
              onClick={() => setSourceFilter('all')}
            >
              {t.history.filterAll}
            </button>
            <button
              type="button"
              className="history-filter-btn"
              data-testid="history-filter-online"
              aria-pressed={sourceFilter === 'online'}
              onClick={() => setSourceFilter('online')}
            >
              {t.history.filterOnline}
            </button>
            <button
              type="button"
              className="history-filter-btn"
              data-testid="history-filter-local"
              aria-pressed={sourceFilter === 'local'}
              onClick={() => setSourceFilter('local')}
            >
              {t.history.filterLocal}
            </button>
          </div>

          <input
            type="search"
            className="history-search-input"
            data-testid="history-search-input"
            aria-label={t.history.searchAria}
            placeholder={t.history.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {onlineAvailable === false && (
          <div className="history-notice" role="status">
            {t.history.onlineUnavailableNotice}
          </div>
        )}

        {onlineLoading && (
          <div className="history-notice history-notice--loading" role="status">
            {t.history.loadingOnline}
          </div>
        )}

        {loadError && (
          <div className="online-error-message" role="alert">
            {loadError}
          </div>
        )}

        <div className="history-body">
          <section className="history-section" aria-label={t.history.statsTitle}>
            <h2 className="history-section-title">{t.history.statsTitle}</h2>
            <div className="history-stats-table-wrap">
              <table
                className="history-stats-table"
                data-testid="history-stats-table"
                data-player-count={statsRows.length}
                aria-label={t.history.statsTableAria}
              >
                <thead>
                  <tr>
                    <th scope="col">{t.history.statsColPlayer}</th>
                    <th scope="col" className="num-col">
                      {t.history.statsColGames}
                    </th>
                    <th scope="col" className="num-col">
                      {t.history.statsColWdl}
                    </th>
                    <th scope="col" className="num-col">
                      {t.history.statsColWinRate}
                    </th>
                    <th scope="col" className="num-col">
                      {t.history.statsColAvgCells}
                    </th>
                    <th scope="col" className="num-col">
                      {t.history.statsColBest}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {statsRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="history-stats-empty-cell">
                        {t.history.statsEmpty}
                      </td>
                    </tr>
                  ) : (
                    statsRows.map((row) => (
                      <tr key={row.key}>
                        <td className="history-stats-player-cell">
                          <span className="history-stats-player-name">
                            {row.displayName}
                          </span>
                          {row.isAIOnly && (
                            <span className="history-chip history-chip--ai">
                              {t.history.statsAiBadge}
                            </span>
                          )}
                        </td>
                        <td className="num-col">{row.gamesPlayed}</td>
                        <td className="num-col">
                          {row.wins} / {row.draws} / {row.losses}
                        </td>
                        <td className="num-col">{row.winRate}%</td>
                        <td className="num-col">{row.avgTerritory}</td>
                        <td className="num-col">{row.bestTerritory}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="history-section" aria-label={t.history.matchListTitle}>
            <h2 className="history-section-title">{t.history.matchListTitle}</h2>

            <div
              className="history-match-list"
              data-testid="history-match-list"
              data-match-count={filteredMatches.length}
            >
              {filteredMatches.length === 0 ? (
                <div
                  className="history-empty-state"
                  data-testid="history-empty-state"
                  role="status"
                >
                  <p className="history-empty-title">
                    {hasActiveFilter && mergedMatches.length > 0
                      ? t.history.emptyFilteredTitle
                      : t.history.emptyTitle}
                  </p>
                  <p className="history-empty-desc">
                    {hasActiveFilter && mergedMatches.length > 0
                      ? t.history.emptyFilteredDesc
                      : t.history.emptyDesc}
                  </p>
                  {hasActiveFilter && mergedMatches.length > 0 && (
                    <button
                      type="button"
                      className="btn-history-reset"
                      onClick={() => {
                        setSourceFilter('all');
                        setSearchQuery('');
                      }}
                    >
                      {t.history.clearFiltersButton}
                    </button>
                  )}
                </div>
              ) : (
                filteredMatches.map((match) => {
                  const isLoadingThis = loadingMatchId === match.id;
                  const rankCounts = new Map<number, number>();
                  for (const p of match.players) {
                    rankCounts.set(p.rank, (rankCounts.get(p.rank) ?? 0) + 1);
                  }

                  return (
                    <article
                      key={match.id}
                      className="history-match-card"
                      data-testid={`history-match-card-${match.id}`}
                      data-match-id={match.id}
                      data-source={match.mode}
                      data-variant={match.ruleVariant}
                      data-format={match.format}
                      data-round={match.isPrisonMatchRound2 ? '2' : '1'}
                    >
                      <div className="history-card-main">
                        <div className="history-card-meta">
                          <span
                            className={`history-chip history-chip--${match.mode}`}
                          >
                            {match.mode === 'online'
                              ? t.history.sourceOnline
                              : t.history.sourceLocal}
                          </span>
                          {match.roomCode && (
                            <span className="history-chip history-chip--code">
                              {t.history.roomCodeLabel(match.roomCode)}
                            </span>
                          )}
                          <span className="history-chip history-chip--variant">
                            {t.common.variantShort[match.ruleVariant]}
                          </span>
                          <span className="history-chip history-chip--format">
                            {match.isPrisonMatchRound2
                              ? t.history.round2Badge
                              : t.common.formatShort[match.format]}
                          </span>
                          <span className="history-card-turns">
                            {t.history.turnsSummary(match.totalTurns, match.totalSteps)}
                          </span>
                          <time className="history-card-date" dateTime={match.playedAt}>
                            {formatMatchDate(match.playedAt, locale)}
                          </time>
                        </div>

                        <div className="history-card-players">
                          {match.players.map((player) => {
                            const isTied = (rankCounts.get(player.rank) ?? 0) > 1;
                            return (
                              <div
                                key={player.playerId}
                                className="history-player-row"
                                data-player-color={player.colorToken}
                                data-rank={player.rank}
                              >
                                <span className="history-player-rank">
                                  {t.result.rank(player.rank, isTied)}
                                </span>
                                <span
                                  className="player-swatch history-player-swatch"
                                  aria-hidden="true"
                                />
                                <span className="history-player-name">
                                  {player.name}
                                </span>
                                {player.isWinner && (
                                  <span className="history-chip history-chip--win">
                                    {t.history.winnerBadge}
                                  </span>
                                )}
                                {player.isDraw && (
                                  <span className="history-chip history-chip--draw">
                                    {t.history.drawBadge}
                                  </span>
                                )}
                                {player.wasSubstitutedToAI ? (
                                  <span className="history-chip history-chip--sub">
                                    {t.history.substitutedBadge}
                                  </span>
                                ) : player.isAI ? (
                                  <span className="history-chip history-chip--ai">
                                    {t.common.aiDifficulty[player.aiDifficulty]}
                                  </span>
                                ) : null}
                                <span className="history-player-score">
                                  {t.hud.cellsCount(player.totalTerritory)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="history-card-side">
                        <MiniBoardPreview
                          board={match.finalBoard}
                          players={match.players}
                          ariaLabel={t.history.miniBoardAria}
                        />
                        <button
                          type="button"
                          className="btn-history-replay"
                          data-testid={`history-replay-button-${match.id}`}
                          disabled={!match.hasReplay || isLoadingThis}
                          onClick={() => void handleOpenMatchReplay(match)}
                        >
                          {isLoadingThis
                            ? t.history.loadingReplayButton
                            : t.history.watchReplayButton}
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
