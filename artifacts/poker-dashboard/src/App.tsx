import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getPokerDashboard, getGetPokerLiveActivityQueryKey, useGetPokerDashboard, useGetPokerLiveActivity } from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { HomeOverview } from "@/components/home-overview";
import { JackpotPanel } from "@/components/jackpot-panel";
import { SettleUpCard } from "@/components/settle-up";
import { BottomTabBar, PlayersSubnav, TopTabs, type DashboardView } from "@/components/app-nav";
import { FilterBar } from "@/components/filter-bar";
import { MyNightCard } from "@/components/my-night-card";
import { LiveBanner } from "@/components/live-banner";
import { InstallCard } from "@/components/install-card";
import { MovedCard } from "@/components/moved-card";
import { clearMovedFrom, readMovedFrom } from "@/lib/moved-notice";
import { InstallHelpDialog } from "@/components/install-help-dialog";
import { SeasonCard } from "@/components/season-card";
import { PointsPodiumCard } from "@/components/points-podium-card";
import { pointsSeasons, seasonForPeriod, type NightKind } from "@/lib/points";
import { PointsSeasonProvider } from "@/components/points-season-context";
import { NewBadgeNotice } from "@/components/new-badge-notice";
import { AchievementsProvider } from "@/components/achievements-context";
import { PointsProvider } from "@/components/points-context";
import { Avatar, AvatarProvider } from "@/components/avatar";
import { useMemberAvatars } from "@/lib/avatars";
import { JoinPage, ResetPasswordPage, WelcomeFlow } from "./views/welcome";
import { PrivacyPage, TermsPage } from "./views/legal";
import { accountApi } from "@/lib/account-api";
import { plural } from "@/lib/utils";
import { ClubSettingsProvider, useClubSettings } from "@/components/club-settings-context";
import { WrappedHost } from "@/components/wrapped-host";
import { DemoTour } from "@/demo/tour";
import { IS_DEMO } from "@/lib/demo-flag";
import type { GamesMode } from "./views/games-view";
import { browserSessionDeps, checkMemberSession, type MemberAuthSession } from "@/lib/member-session";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { dashboardSearchForView, getInitialDashboardView } from "@/lib/live-ledger-links";
import { formatVisibleDuration } from "@/lib/member-usage";

import { useMemberUsageTracking } from "@/hooks/use-member-usage";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { buildCombinedLeaderboard, buildTournamentLeaderboard, buildTournamentSessions } from "@/lib/earnings-analytics";
import type { DashboardPlayer as Player, DashboardSession as Session, PerformanceScope, ProfitPoint, TournamentEvent, TournamentSnapshot } from "@/lib/earnings-analytics";
import NotFound from "@/pages/not-found";

// Heavy, rarely-used pieces are fetched on demand instead of shipping in the first load.
const RecordView = lazy(() => import("./views/record-view").then((m) => ({ default: m.RecordView })));
const CumulativeProfitCard = lazy(() => import("./views/trends-section").then((m) => ({ default: m.CumulativeProfitCard })));
const PublicGamesGrowthChart = lazy(() => import("@/components/public-games-growth-chart"));
const PlatformUsagePage = lazy(() => import("./views/platform-usage").then((m) => ({ default: m.PlatformUsagePage })));
const AccountView = lazy(() => import("./views/account-view").then((m) => ({ default: m.AccountView })));
const GuidelinesView = lazy(() => import("./views/guidelines-view").then((m) => ({ default: m.GuidelinesView })));
const ClubAdminView = lazy(() => import("./views/guidelines-view").then((m) => ({ default: m.ClubAdminView })));
const GamesView = lazy(() => import("./views/games-view").then((m) => ({ default: m.GamesView })));
const PointsLeaderboard = lazy(() => import("./views/points-leaderboard").then((m) => ({ default: m.PointsLeaderboard })));
const PeriodLeaderboards = lazy(() => import("./views/period-leaderboards").then((m) => ({ default: m.PeriodLeaderboards })));
const PlayersView = lazy(() => import("./views/players-view").then((m) => ({ default: m.PlayersView })));
import { ArrowDown, ArrowUp, Activity, BarChart3, CalendarDays, House, Check, ChevronDown, ChevronRight, CircleDollarSign, Copy, Download, ExternalLink, Eye, EyeOff, LayoutDashboard, LockKeyhole, LogOut, Menu, MoreHorizontal, Moon, Pencil, Printer, QrCode, Plus, RefreshCw, Settings, ShieldCheck, Sun, Trash2, Users, X } from "lucide-react";

import { Route, Router as WouterRouter, Switch } from "wouter";
import { EmptyPanel, MetricCard, MonthFilter, PageIntro, buildRankMovementMap, buildScopedPlayers, compactCurrency, formatCurrency, formatDate, monthLabel, normalizePlayerName, signedCurrency, slug } from "./views/shared";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false } },
});


type MonthlySummary = {
  month: string;
  label: string;
  range: string;
  sessionCount: number;
  recordCount: number;
  totalBuyIn: number;
  totalCashOut: number;
  totalNet: number;
  avgPot: number;
  uniquePlayers: number;
  topWinner: string | null;
  topWinnerProfit: number;
  positiveSessions: number;
  negativeSessions: number;
};
type PeriodSummary = {
  key: string;
  label: string;
  range: string;
  sessionCount: number;
  recordCount: number;
  totalBuyIn: number;
  totalCashOut: number;
  totalNet: number;
  avgPot: number;
  uniquePlayers: number;
  topWinner: string | null;
  topWinnerProfit: number;
  positiveSessions: number;
  negativeSessions: number;
};

function buildScopePeriods(
  basePeriods: PeriodSummary[],
  scope: PerformanceScope,
  tournamentSessions: Session[],
  cashSessions: Session[],
): PeriodSummary[] {
  if (scope === "cash") return basePeriods;
  if (tournamentSessions.length === 0) return scope === "tournaments" ? [] : basePeriods;

  const keyOf = (session: Session) => session.month;
  const byKey = new Map<string, Session[]>();
  for (const session of tournamentSessions) {
    const key = keyOf(session);
    byKey.set(key, [...(byKey.get(key) ?? []), session]);
  }

  const eventPeriod = (key: string, events: Session[]): PeriodSummary => {
    const totalBuyIn = events.reduce((sum, event) => sum + event.totalBuyIn, 0);
    const totalCashOut = events.reduce((sum, event) => sum + event.totalCashOut, 0);
    const top = events
      .flatMap((event) => event.players)
      .sort((left, right) => right.net - left.net || left.player.localeCompare(right.player))[0];
    return {
      key,
      label: monthLabel(events[0].month),
      range: events.length === 1 ? formatDate(events[0].date) : monthLabel(events[0].month),
      sessionCount: events.length,
      recordCount: events.reduce((sum, event) => sum + event.playerCount, 0),
      totalBuyIn,
      totalCashOut,
      totalNet: totalCashOut - totalBuyIn,
      avgPot: totalBuyIn / events.length,
      uniquePlayers: new Set(events.flatMap((event) => event.players.map((p) => normalizePlayerName(p.player)))).size,
      topWinner: top?.player ?? null,
      topWinnerProfit: top?.net ?? 0,
      positiveSessions: events.filter((event) => event.totalNet > 0).length,
      negativeSessions: events.filter((event) => event.totalNet < 0).length,
    };
  };

  if (scope === "tournaments") {
    return [...byKey.entries()]
      .map(([key, events]) => {
        const existing = basePeriods.find((period) => period.key === key);
        const period = eventPeriod(key, events);
        return existing ? { ...existing, ...period } : period;
      })
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  const merged = basePeriods.map((period) => {
    const events = byKey.get(period.key);
    if (!events) return period;
    const added = eventPeriod(period.key, events);
    const sessionCount = period.sessionCount + added.sessionCount;
    const totalBuyIn = period.totalBuyIn + added.totalBuyIn;
    const cashNames = cashSessions
      .filter((session) => keyOf(session) === period.key)
      .flatMap((session) => session.players.map((player) => normalizePlayerName(player.player)));
    const eventNames = events.flatMap((event) => event.players.map((p) => normalizePlayerName(p.player)));
    const tournamentTopIsHigher = Boolean(added.topWinner) && (!period.topWinner || added.topWinnerProfit > period.topWinnerProfit);
    return {
      ...period,
      sessionCount,
      recordCount: period.recordCount + added.recordCount,
      totalBuyIn,
      totalCashOut: period.totalCashOut + added.totalCashOut,
      totalNet: period.totalNet + added.totalNet,
      avgPot: totalBuyIn / sessionCount,
      uniquePlayers: new Set([...cashNames, ...eventNames]).size,
      positiveSessions: period.positiveSessions + added.positiveSessions,
      negativeSessions: period.negativeSessions + added.negativeSessions,
      topWinner: tournamentTopIsHigher ? added.topWinner : period.topWinner,
      topWinnerProfit: tournamentTopIsHigher ? added.topWinnerProfit : period.topWinnerProfit,
    };
  });
  const missing = [...byKey.entries()]
    .filter(([key]) => !basePeriods.some((period) => period.key === key))
    .map(([key, events]) => eventPeriod(key, events));
  return [...merged, ...missing].sort((left, right) => left.key.localeCompare(right.key));
}

function Home() {
  const [memberSession, setMemberSession] = useState<MemberAuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setAuthLoading(true);
    setUnreachable(false);
    void checkMemberSession(browserSessionDeps(() => cancelled)).then((result) => {
      if (cancelled) return;
      if (result === "unreachable") setUnreachable(true);
      else setMemberSession(result);
      setAuthLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Coming back online, or returning to the tab, tries again on its own.
  useEffect(() => {
    if (!unreachable) return;
    const retry = () => setAttempt((value) => value + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [unreachable]);

  const handleLogout = async () => {
    await accountApi.signOut();
    queryClient.clear();
    setMemberSession(null);
  };

  if (authLoading) return <AuthLoadingState />;
  if (unreachable) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-foreground">
        <div data-testid="state-auth-unreachable" className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Can&apos;t reach the club site</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You&apos;re still signed in. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="mt-5 inline-flex h-10 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }
  if (!memberSession) return <WelcomeFlow onAuthenticated={setMemberSession} />;
  return (
    <ClubSettingsProvider fallback={<DashboardSkeleton />}>
      <DashboardHome memberName={memberSession.memberName ?? "Member"} platformAdmin={memberSession.platformAdmin === true} onLogout={handleLogout} />
    </ClubSettingsProvider>
  );
}

function AuthLoadingState() {
  return <div data-testid="state-auth-loading" className="flex min-h-[100dvh] items-center justify-center bg-background px-5 text-foreground"><div className="text-center"><div className="mx-auto flex h-11 w-11 animate-pulse items-center justify-center rounded-xl bg-primary/15 text-primary"><LockKeyhole className="h-5 w-5" /></div><p className="mt-4 text-sm font-semibold">Checking member access…</p></div></div>;
}

function SessionExpiredState({ onSignIn }: { onSignIn: () => void }) {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5 text-foreground"><div className="max-w-md rounded-2xl border border-border bg-card p-7 text-center soft-shadow"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><LockKeyhole className="h-5 w-5" /></div><h1 className="mt-4 text-xl font-semibold">Your session has expired</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Sign in again to continue viewing the club dashboard.</p><button onClick={onSignIn} data-testid="button-session-sign-in" className="mt-5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Sign in again</button></div></div>;
}

function DashboardHome({ memberName, platformAdmin, onLogout }: { memberName: string; platformAdmin: boolean; onLogout: () => Promise<void> }) {
  const { settings: clubSettings } = useClubSettings();
  const { canInstall, oneTap, platform, install, helpOpen, setHelpOpen } = useInstallPrompt();
  const [movedFrom, setMovedFrom] = useState(() => readMovedFrom());
  const dashboardQuery = useGetPokerDashboard();
  const { data: dashboard, isLoading, isError, error } = dashboardQuery;
  // Dark is the default. Only an explicit choice of light is remembered.
  const [isDark, setIsDark] = useState(() => {
    try {
      return window.localStorage.getItem("poker-theme") !== "light";
    } catch {
      return true;
    }
  });
  const [activeView, setActiveView] = useState<DashboardView>(() => getInitialDashboardView(window.location.search, window.location.hash));
  const [performanceScope, setPerformanceScope] = useState<PerformanceScope>("all");
  const [monthFilter, setMonthFilter] = useState<MonthFilter | null>("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const [clubAdmin, setClubAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    accountApi.me().then((me) => { if (!cancelled) setClubAdmin(me.clubs.find((club) => club.slug === me.active)?.role !== "member"); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [visualizerSearch, setVisualizerSearch] = useState("");

  // The usage report has no separate admin section, so the admin page counts as the Club tab.
  useMemberUsageTracking(activeView === "admin" ? "guidelines" : activeView);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    // Keep the browser's address bar / status bar colour in step with the page.
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark ? "#100a19" : "#f8f6fc");
  }, [isDark]);
  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    try {
      window.localStorage.setItem("poker-theme", next ? "dark" : "light");
    } catch {
      // The choice still applies for this visit.
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshError(false);
    try {
      const fresh = await getPokerDashboard({ headers: { "Cache-Control": "no-cache" } });
      queryClient.setQueryData(dashboardQuery.queryKey, fresh);
    } catch {
      setRefreshError(true);
    } finally {
      window.setTimeout(() => setRefreshing(false), 650);
    }
  };

  const players = (dashboard?.leaderboard ?? []) as Player[];
  const sessions = (dashboard?.sessions ?? []) as Session[];
  const months = (dashboard?.months ?? []) as MonthlySummary[];
  const history = (dashboard?.playerProfitHistory ?? []) as ProfitPoint[];
  const tournamentSnapshot = dashboard?.tournamentSnapshot as TournamentSnapshot | undefined;
  const tournaments = useMemo(
    () => ((dashboard?.tournaments ?? []) as TournamentEvent[]),
    [dashboard?.tournaments],
  );
  const tournamentSessions = useMemo(
    () => buildTournamentSessions(tournaments, tournamentSnapshot, sessions),
    [tournaments, tournamentSnapshot, sessions],
  );
  const scopePlayers = useMemo(() => {
    if (performanceScope === "cash" || !tournamentSnapshot) return players;
    return performanceScope === "tournaments"
      ? buildTournamentLeaderboard(tournamentSnapshot)
      : buildCombinedLeaderboard(players, tournamentSnapshot);
  }, [performanceScope, players, tournamentSnapshot]);
  const hasNumbers =
    players.length > 0 ||
    sessions.length > 0 ||
    history.length > 0 ||
    (dashboard?.tournamentSnapshot.players.length ?? 0) > 0;
  const availablePlayers = useMemo(() => players.map((player) => player.name), [players]);
  const currentSeasonMonth = useMemo<MonthFilter>(() => {
    const latestSession = sessions.slice().sort((left, right) => right.sessionNumber - left.sessionNumber)[0];
    return latestSession?.month ?? months.find((month) => month.sessionCount > 0)?.month ?? "ALL";
  }, [months, sessions]);
  const activeMonthFilter = monthFilter ?? currentSeasonMonth;
  const activePeriodFilter = activeMonthFilter;
  const selectedPeriodKey = activePeriodFilter === "ALL" ? null : activePeriodFilter;
  const periods = useMemo<PeriodSummary[]>(() => {
    const basePeriods = months.map(({ month, ...summary }) => ({ key: month, ...summary }));
    return buildScopePeriods(basePeriods, performanceScope, tournamentSessions, sessions);
  }, [months, performanceScope, sessions, tournamentSessions]);
  const periodFilterOrder = useMemo(
    () => ["ALL", ...periods.map((period) => period.key)],
    [periods],
  );
  // One filter bar drives both leaderboards: the period picks the points season and the
  // Cash / Tournaments choice limits which nights are scored.
  // Points are monthly. With "All time" chosen the points show the latest month rather than a lifetime total.
  const pointsSeasonKey = useMemo(() => {
    const seasons = pointsSeasons(sessions, tournaments);
    return activePeriodFilter === "ALL" ? seasons[0] ?? null : seasonForPeriod(activePeriodFilter, seasons);
  }, [activePeriodFilter, sessions, tournaments]);
  const pointsKinds = useMemo<NightKind[] | undefined>(
    () => (performanceScope === "cash" ? ["cash"] : performanceScope === "tournaments" ? ["tournament"] : undefined),
    [performanceScope],
  );
  const fullScopeSessions = useMemo(() => {
    const cash = performanceScope === "tournaments" ? [] : sessions;
    const tournament = performanceScope !== "cash" ? tournamentSessions : [];
    return [...cash, ...tournament].sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.sessionNumber - right.sessionNumber,
    );
  }, [performanceScope, sessions, tournamentSessions]);
  const scopeSessions = useMemo(
    () => selectedPeriodKey
      ? fullScopeSessions.filter((session) => session.month === selectedPeriodKey)
      : fullScopeSessions,
    [fullScopeSessions, selectedPeriodKey],
  );
  // Games has its own Cash / Tournaments switch, so these ignore the shared scope filter.
  const inSelectedPeriod = (date: string, month: string) =>
    !selectedPeriodKey || month === selectedPeriodKey;
  const cashGamesInView = useMemo(
    () => sessions.filter((session) => inSelectedPeriod(session.date, session.month))
      .sort((left, right) => right.date.localeCompare(left.date) || right.sessionNumber - left.sessionNumber),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, selectedPeriodKey],
  );
  const tournamentsInView = useMemo(
    () => tournaments.filter((event) => inSelectedPeriod(event.date, event.date.slice(0, 7))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tournaments, selectedPeriodKey],
  );
  const seasonPlayers = useMemo(
    () => buildScopedPlayers(scopePlayers, scopeSessions),
    [scopePlayers, scopeSessions],
  );
  const visibleSessions = useMemo(() => {
    const needle = visualizerSearch.trim().toLocaleLowerCase();
    return scopeSessions.filter((session) => {
      if (!needle) return true;
      return [
        session.date,
        session.winner ?? "",
        session.lowPlayer ?? "",
        ...session.players.map((player) => player.player),
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [scopeSessions, visualizerSearch]);
  const visiblePeriod = selectedPeriodKey
    ? periods.find((period) => period.key === selectedPeriodKey) ?? null
    : null;
  const updatedLabel = dashboard?.isStale
    ? `Last successful sync ${formatSyncTime(dashboard.lastUpdated)}`
    : `Synced ${formatSyncTime(dashboard?.lastUpdated ?? "")}`;
  const navigate = (view: DashboardView) => {
    setActiveView(view);
    const search = dashboardSearchForView(window.location.search, view);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${search}${window.location.hash}`,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const changePerformanceScope = (scope: PerformanceScope) => {
    setPerformanceScope(scope);
    setMonthFilter("ALL");
    setVisualizerSearch("");
  };

  // Home always shows all earnings, whatever scope the Games/Players filters are set to.
  const homePlayers = useMemo(
    () => (tournamentSnapshot ? buildCombinedLeaderboard(players, tournamentSnapshot) : players),
    [players, tournamentSnapshot],
  );
  const homeSessions = useMemo(
    () =>
      [...sessions, ...tournamentSessions].sort(
        (left, right) => left.date.localeCompare(right.date) || left.sessionNumber - right.sessionNumber,
      ),
    [sessions, tournamentSessions],
  );
  const myStanding = useMemo(() => {
    const key = normalizePlayerName(memberName);
    const row = homePlayers.find((player) => normalizePlayerName(player.name) === key);
    if (!row) return undefined;
    const move = buildRankMovementMap(homePlayers, homeSessions).get(key);
    const movement = !move || move.direction === "new" ? null : move.direction === "up" ? move.places : move.direction === "down" ? -move.places : 0;
    return { rank: row.rank, of: homePlayers.length, movement, net: row.profitTotal };
  }, [homePlayers, homeSessions, memberName]);

  // A light status check so the Live tab can show when a game is in progress.
  const liveStatusQuery = useGetPokerLiveActivity({
    query: { queryKey: getGetPokerLiveActivityQueryKey(), refetchInterval: 30_000, staleTime: 15_000 },
  });
  const liveOpen = liveStatusQuery.data?.sessionStatus === "open";
  const memberAvatars = useMemberAvatars();
  const [showHistoryChart, setShowHistoryChart] = useState(false);
  const [gamesMode, setGamesMode] = useState<GamesMode>("all");
  const [selectedTournament, setSelectedTournament] = useState<string | null>(null);
  const isPlayersView = activeView === "months" || activeView === "players";
  const showFilters = activeView === "sessions" || isPlayersView;

  const openPlayer = (name: string) => {
    setSelectedPlayer(name);
    navigate("players");
  };
  const openGame = (sessionNumber: number) => {
    // Tournament sessions open the tournament; cash games open their card.
    const tournamentSession = tournamentSessions.find((session) => session.sessionNumber === sessionNumber);
    if (tournamentSession?.tournamentId) {
      openTournament(tournamentSession.tournamentId);
      return;
    }
    setGamesMode("all");
    setSelectedSession(sessionNumber);
    navigate("sessions");
  };
  const openTournament = (id: string | null) => {
    setGamesMode("tournaments");
    setSelectedTournament(id);
    navigate("sessions");
  };

  // Once the dashboard is on screen, fetch the other tabs' code in idle time so switching tabs is instant.
  const ready = !!dashboard;
  useEffect(() => {
    if (!ready) return;
    const prefetch = () => {
      void import("./views/live-view");
      void import("./views/account-view");
      void import("./views/guidelines-view");
      void import("./views/games-view");
      void import("./views/points-leaderboard");
      void import("./views/period-leaderboards");
      void import("./views/players-view");
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(prefetch, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(prefetch, 1500);
    return () => window.clearTimeout(id);
  }, [ready]);

  if (isLoading) return <DashboardSkeleton />;
  if (isError && (error as { status?: number } | null)?.status === 401) return <SessionExpiredState onSignIn={() => void onLogout()} />;
  if (isError) return <ErrorState refreshing={refreshing} onRetry={handleRefresh} />;
  if (!dashboard) return <EmptyDashboard />;
  // Live, the account page and the club rules do not need any recorded results.
  if (!hasNumbers && activeView !== "live" && activeView !== "account" && activeView !== "guidelines" && activeView !== "admin") {
    return (
      <NewClubStart
        clubName={dashboard.title}
        memberName={memberName}
        platformAdmin={platformAdmin}
        onNavigate={navigate}
        tabBar={<BottomTabBar active={activeView} onNavigate={navigate} liveOpen={liveOpen} />}
      />
    );
  }
  const totals = dashboard.totals;
  const allScopeSessionCount =
    (performanceScope === "tournaments" ? 0 : sessions.length) +
    (performanceScope !== "cash" ? tournamentSessions.length : 0);
  const allScopeBuyIns =
    performanceScope === "cash"
      ? totals.totalBuyIn
      : performanceScope === "tournaments"
        ? tournamentSnapshot?.totalInvested ?? 0
        : totals.totalBuyIn + tournamentSessions.reduce((sum, session) => sum + session.totalBuyIn, 0);

  return (
    <AvatarProvider avatars={memberAvatars}>
    <AchievementsProvider sessions={homeSessions} players={homePlayers} history={history}>
    <PointsProvider cashNights={sessions} tournaments={tournaments} rules={clubSettings.points.rules}>
    <WrappedHost sessions={homeSessions} viewer={memberName} autoOpen={!IS_DEMO}>
    <NewBadgeNotice viewer={memberName} />
    <InstallHelpDialog open={helpOpen} onOpenChange={setHelpOpen} platform={platform} />
    <div className="min-h-[100dvh] bg-background text-foreground">
      <main className="min-h-[100dvh]">
        <div className="mx-auto max-w-[1450px] px-4 pb-24 pt-4 sm:px-7 lg:px-10 lg:pb-6 lg:pt-6">
          <header className="rise-in border-b border-border">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <button onClick={() => navigate("overview")} data-testid="button-brand-home" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl brand-mark bg-primary text-primary-foreground shadow-[0_3px_0_hsl(262_80%_40%)]" aria-label="Open home"><House className="h-5 w-5" /></button>
                <div className="flex min-w-0 items-baseline gap-2">
                  <p data-testid="text-dashboard-title" className="min-w-0 truncate text-lg font-semibold tracking-[-0.03em] sm:text-xl">{dashboard.title || "Poker Session Log & Months"}</p>
                </div>
              </div>
              <div className="hidden flex-wrap items-center gap-2 print-hidden lg:flex">
                {platformAdmin && <a href="/admin" data-testid="link-platform-usage" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold transition-transform hover:-translate-y-0.5"><Activity className="h-4 w-4" />Site usage</a>}
                <button onClick={() => navigate("account")} data-testid="button-open-account" aria-label="Open Me" className={`inline-flex h-9 items-center gap-2 rounded-lg border bg-card pl-1.5 pr-3 text-xs font-semibold transition-transform hover:-translate-y-0.5 ${activeView === "account" ? "border-primary text-primary" : "border-border"}`}><Avatar name={memberName} size={24} />{memberName}</button>
                <button onClick={toggleTheme} data-testid="button-toggle-theme" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground" aria-label="Toggle dark mode">{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
              </div>
              <div className="print-hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" data-testid="button-mobile-dashboard-menu" aria-label="Open dashboard menu" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-foreground">
                      <Menu className="h-5 w-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="truncate text-xs text-muted-foreground">Signed in as {memberName}</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => navigate("account")} data-testid="menu-open-account">
                      <Avatar name={memberName} size={20} />Me
                    </DropdownMenuItem>
                    {clubAdmin && (
                      <DropdownMenuItem onSelect={() => navigate("admin")} data-testid="menu-club-admin">
                        <Settings className="h-4 w-4" />Club admin
                      </DropdownMenuItem>
                    )}
                    {platformAdmin && (
                      <DropdownMenuItem onSelect={() => { window.location.assign("/admin"); }} data-testid="menu-platform-usage">
                        <Activity className="h-4 w-4" />Site usage
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void handleRefresh()} disabled={refreshing} data-testid="menu-refresh-dashboard">
                      <Activity className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />{refreshing ? "Refreshing…" : "Refresh dashboard"}
                    </DropdownMenuItem>
                    {canInstall && (
                      <DropdownMenuItem onSelect={() => void install()} data-testid="menu-install-app">
                        <Download className="h-4 w-4" />Install app
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={toggleTheme} data-testid="menu-toggle-theme">
                      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                      Switch to {isDark ? "light" : "dark"} mode
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void onLogout()} data-testid="menu-member-logout" className="text-destructive focus:text-destructive">
                      <LogOut className="h-4 w-4" />Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <TopTabs active={activeView} onNavigate={navigate} liveOpen={liveOpen} />
            {(dashboard.isStale || refreshError) && <div data-testid={refreshError ? "status-refresh-error" : "status-stale-sync"} className="mb-3 inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"><Activity className="h-3.5 w-3.5" />{refreshError ? "Refresh failed. Showing the current dashboard data." : `Showing the last successful sync · ${updatedLabel}`}</div>}
          </header>

          <div key={activeView} className="view-enter">
              {isPlayersView && <PlayersSubnav active={activeView} onChange={navigate} />}
              {showFilters && (
                <FilterBar
                  showScope={activeView !== "sessions"}
                  scope={performanceScope}
                  onScope={changePerformanceScope}
                  period={activePeriodFilter}
                  onPeriod={(value) => {
                    setMonthFilter(value);
                    setVisualizerSearch("");
                  }}
                  periods={periodFilterOrder.map((value) => {
                    const period = periods.find((item) => item.key === value);
                    return value === "ALL"
                      ? { value, label: "All time", summary: `${plural(allScopeSessionCount, "game")} · ${compactCurrency(allScopeBuyIns)}` }
                      : { value, label: period?.label ?? value, summary: period ? `${plural(period.sessionCount, "game")} · ${compactCurrency(period.totalBuyIn)}` : "No games" };
                  })}
                />
              )}

            {activeView === "overview" && (
              <div className="mt-4">
                {movedFrom ? (
                  <MovedCard
                    clubName={dashboard.title}
                    canInstall={canInstall}
                    oneTap={oneTap}
                    onInstall={() => void install()}
                    onDismiss={() => {
                      clearMovedFrom();
                      setMovedFrom(null);
                    }}
                  />
                ) : (
                  canInstall && <InstallCard oneTap={oneTap} onInstall={() => void install()} />
                )}
                {liveOpen && (
                  <LiveBanner
                    startedBy={liveStatusQuery.data?.startedBy ?? null}
                    buyIns={liveStatusQuery.data?.totals.buyIns ?? 0}
                    playerCount={liveStatusQuery.data?.playerSummaries.length ?? 0}
                    onOpen={() => navigate("live")}
                  />
                )}
                <HomeOverview
                  showSummary={!liveOpen}
                  afterHero={
                    <div className="space-y-4">
                      {!liveOpen && <MyNightCard sessions={homeSessions} viewer={memberName} standing={myStanding} />}
                      <SettleUpCard onOpenSession={openGame} />
                      <JackpotPanel players={availablePlayers} canPay={false} admin={false} onManage={clubAdmin ? () => navigate("live") : undefined} />
                    </div>
                  }
                  memberName={memberName}
                  standings={homePlayers}
                  cashPlayers={players}
                  tournament={tournamentSnapshot}
                  tournamentCount={tournamentSessions.length}
                  latestDate={dashboard.totals.latestGameDate ?? null}
                  onSeePlayers={() => navigate("months")}
                  onOpenPlayer={openPlayer}
                  onOpenAccount={() => navigate("account")}
                  onSeePoints={() => {
                    navigate("months");
                    // The points table sits under the profit podium; bring it into view.
                    window.setTimeout(() => document.getElementById("club-points")?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
                  }}
                />
              </div>
            )}

          <div className="mt-4">
            <Suspense fallback={<ViewSkeleton />}>
            {activeView === "sessions" && <GamesView mode={gamesMode} onMode={(mode) => { setGamesMode(mode); setSelectedTournament(null); }} cashSessions={cashGamesInView} tournaments={tournamentsInView} viewer={memberName} selectedSession={selectedSession} onSelectSession={setSelectedSession} selectedTournament={selectedTournament} onSelectTournament={setSelectedTournament} onOpenPlayer={openPlayer} />}
              {activeView === "live" && (
                <>
                  <button type="button" onClick={() => navigate("guidelines")} data-testid="link-live-rules" className="mb-1 inline-flex min-h-[44px] items-center text-xs font-semibold text-primary hover:underline">Blind schedule &amp; rules →</button>
                  <RecordView memberName={memberName} availablePlayers={availablePlayers} clubAdmin={clubAdmin} onRecorded={() => void handleRefresh()} onOpenSettings={() => { window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#admin-settings`); navigate("admin"); }} />
                </>
              )}
             {activeView === "months" && (
              <PointsSeasonProvider season={pointsSeasonKey} kinds={pointsKinds}>
                <PeriodLeaderboards players={selectedPeriodKey ? seasonPlayers : scopePlayers} sessions={scopeSessions} allSessions={homeSessions} activePeriod={activePeriodFilter} scope={performanceScope} viewer={memberName} onSelectPlayer={openPlayer}
                afterPodium={<PointsPodiumCard viewer={memberName} onOpenPlayer={openPlayer} selectable eyebrow="Monthly points" title="The monthly points podium" description={activePeriodFilter === "ALL" ? "Points are monthly. This is the latest month; pick another month above." : "Points for the month chosen above. Tap the podium for the table."} />}
                afterOverview={
                  <div id="club-points" className="scroll-mt-4">
                    <PointsLeaderboard viewer={memberName} onOpenPlayer={openPlayer} />
                  </div>
                }
              />
              </PointsSeasonProvider>
            )}
            {activeView === "months" && (
              <div className="mt-4 space-y-4">
                <SeasonCard sessions={homeSessions} viewer={memberName} onOpenPlayer={openPlayer} />
                {showHistoryChart ? (
                  <Suspense fallback={<div className="h-72 skeleton rounded-2xl" />}>
                    <CumulativeProfitCard sessions={homeSessions} viewer={memberName} />
                  </Suspense>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowHistoryChart(true)}
                    data-testid="button-show-history-chart"
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-card px-5 py-4 text-left transition-colors hover:border-primary/50 hover:bg-secondary/40"
                  >
                    <span>
                      <span className="block text-sm font-semibold">Show everyone&apos;s running totals</span>
                      <span className="block text-xs text-muted-foreground">A line chart of net profit game by game, with you highlighted.</span>
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
              {activeView === "players" && <PlayersView players={selectedPeriodKey ? seasonPlayers : scopePlayers} sessions={scopeSessions} allSessions={homeSessions} tournaments={tournaments} onOpenTournament={openTournament} scope={performanceScope} initialPlayer={selectedPlayer ?? memberName} viewer={memberName} />}
             {activeView === "guidelines" && <GuidelinesView sessions={homeSessions} onOpenAdmin={() => navigate("admin")} />}
             {activeView === "admin" && <ClubAdminView onBack={() => navigate("guidelines")} />}
            {activeView === "account" && (
              <AccountView
                memberName={memberName}
                sessions={homeSessions}
                standing={myStanding}
                isDark={isDark}
                onToggleTheme={toggleTheme}
                canInstall={canInstall}
                onInstall={() => void install()}
                onLogout={() => void onLogout()}
                onOpenProfile={() => openPlayer(memberName)}
                onOpenRules={() => navigate("guidelines")}
              />
            )}
            </Suspense>
          </div>

          </div>
          {activeView === "overview" && (          <footer className="mt-8 grid gap-4 border-t border-border py-7 text-xs text-muted-foreground sm:grid-cols-[1fr_auto_auto] sm:items-end">
             <div className="space-y-1"><p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground">{sessions.length} cash games{tournamentSessions.length ? ` · ${tournamentSessions.length} ${tournamentSessions.length === 1 ? "tournament" : "tournaments"}` : ""} · {dashboard.totals.totalRecords} player results</p><p data-testid="text-footer-latest">{dashboard.totals.latestSession ? `Latest game #${dashboard.totals.latestSession}` : "Season in progress"}</p></div>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em]">Numbers from the nights this club has recorded</span>
          </footer>)}
        </div>
      </main>
      <BottomTabBar active={activeView} onNavigate={navigate} liveOpen={liveOpen} />
    </div>
    {IS_DEMO && <DemoTour activeView={activeView} onNavigate={navigate} />}
    </WrappedHost>
    </PointsProvider>
    </AchievementsProvider>
    </AvatarProvider>
  );
}

function ErrorState({ refreshing, onRetry }: { refreshing: boolean; onRetry: () => void }) { return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5 text-foreground"><div data-testid="state-dashboard-error" className="max-w-md rounded-2xl border border-destructive/30 bg-card p-7 text-center soft-shadow"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><Activity className="h-5 w-5" /></div><h1 className="mt-4 text-xl font-semibold">The club sheet is out of reach</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">The last dashboard request did not complete. Your figures have not been changed.</p><button onClick={onRetry} disabled={refreshing} data-testid="button-retry-dashboard" className="mt-5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{refreshing ? "Checking source" : "Try again"}</button></div></div>; }
function NewClubStart({ clubName, memberName, platformAdmin, onNavigate, tabBar }: { clubName: string; memberName: string; platformAdmin: boolean; onNavigate: (view: "live" | "guidelines" | "admin") => void; tabBar: ReactNode }) {
  // Only admins can set a club up; everyone else just waits for the first night.
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    accountApi.me().then((me) => { if (!cancelled) setIsAdmin(me.clubs.find((club) => club.slug === me.active)?.role !== "member"); }).catch(() => { if (!cancelled) setIsAdmin(false); });
    return () => { cancelled = true; };
  }, []);
  if (isAdmin === false) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground">
        <main className="mx-auto max-w-2xl px-4 pb-28 pt-8 sm:px-7">
          <p className="section-label text-primary">Welcome</p>
          <h1 data-testid="text-new-club-title" className="mt-1 text-2xl font-semibold tracking-tight">{clubName}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Hi {memberName}, you're in. Nothing has been recorded yet.</p>
          {platformAdmin && <a href="/admin" data-testid="link-platform-usage" className="mt-4 inline-flex h-10 items-center rounded-xl border border-border px-4 text-sm font-semibold">Site usage</a>}
          <div className="soft-shadow mt-6 rounded-2xl border border-border bg-card p-5" data-testid="box-member-waiting">
            <h2 className="text-base font-semibold">Waiting for the first night</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Standings, games and your results appear here as soon as a club admin records or imports a night. Check the Record tab on game night.</p>
            <button type="button" onClick={() => onNavigate("live")} data-testid="button-start-live" className="mt-4 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Open the Record tab</button>
          </div>
        </main>
        {tabBar}
      </div>
    );
  }
  const steps: Array<{ title: string; body: string; action: string; view: "live" | "guidelines" | "admin"; hash?: string; testId: string }> = [
    { title: "Bring your club in", body: "Copy your invite link or show the QR code. Anyone who opens it can join and pick their name.", action: "Invite people", view: "guidelines", hash: "section-invites", testId: "button-start-invite" },
    { title: "Bring in your history", body: "Import past results from a spreadsheet. The leaderboard, points and profiles fill in straight away.", action: "Import results", view: "admin", hash: "admin-setup", testId: "button-start-import" },
    { title: "Run a night", body: "Start a game to record buy-ins and cash-outs as people play. Close it and the night joins the leaderboard.", action: "Open the Record tab", view: "live", testId: "button-start-live" },
  ];
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <main className="mx-auto max-w-2xl px-4 pb-28 pt-8 sm:px-7">
        <p className="section-label text-primary">Welcome</p>
        <h1 data-testid="text-new-club-title" className="mt-1 text-2xl font-semibold tracking-tight">{clubName}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Hi {memberName}. Your club is set up and empty. Here is how to get going.</p>
        {platformAdmin && <a href="/admin" data-testid="link-platform-usage" className="mt-4 inline-flex h-10 items-center rounded-xl border border-border px-4 text-sm font-semibold">Site usage</a>}
        <div className="mt-6 space-y-3">
          {steps.map((step, index) => (
            <div key={step.title} className="soft-shadow rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-semibold text-muted-foreground">Step {index + 1}</p>
              <h2 className="mt-1 text-base font-semibold">{step.title}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.body}</p>
              <button type="button" onClick={() => { if (step.hash) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${step.hash}`); onNavigate(step.view); }} data-testid={step.testId} className="mt-4 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">{step.action}</button>
            </div>
          ))}
        </div>
      </main>
      {tabBar}
    </div>
  );
}
function EmptyDashboard() { return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5 text-foreground"><EmptyPanel title="No season figures yet" description="The connected sheet is ready, but there are no recorded poker sessions to display." /></div>; }
function ViewSkeleton() {
  return (
    <div data-testid="state-view-loading" aria-hidden="true" className="space-y-4">
      <div className="h-9 w-40 skeleton rounded-lg" />
      <div className="h-28 skeleton rounded-2xl" />
      <div className="h-28 skeleton rounded-2xl" />
      <div className="h-28 skeleton rounded-2xl" />
    </div>
  );
}
// Shaped like Home: header, hero, last game, podium.
function DashboardSkeleton() { return <div data-testid="state-dashboard-loading" className="min-h-[100dvh] bg-background px-4 pt-4 text-foreground sm:px-7 lg:px-10 lg:pt-6"><div className="mx-auto max-w-[1450px] animate-pulse space-y-4"><div className="flex items-center gap-3"><div className="h-10 w-10 rounded-xl bg-secondary" /><div className="h-6 w-48 rounded-lg bg-secondary" /></div><div className="h-12 w-3/4 rounded-xl bg-secondary" /><div className="h-52 rounded-2xl bg-secondary" /><div className="h-28 rounded-2xl bg-secondary" /><div className="h-72 rounded-2xl bg-secondary" /></div></div>; }
function formatSyncTime(value: string) { const date = new Date(value); if (Number.isNaN(date.getTime())) return "recently"; return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date); }
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><ErrorBoundary><WouterRouter base={IS_DEMO ? "/demo" : ""}><Switch><Route path="/admin"><Suspense fallback={<AuthLoadingState />}><PlatformUsagePage /></Suspense></Route><Route path="/dashboard" component={Home} /><Route path="/terms" component={TermsPage} /><Route path="/privacy" component={PrivacyPage} /><Route path="/reset-password" component={ResetPasswordPage} /><Route path="/join/:code">{(params) => <JoinPage code={params.code} />}</Route><Route path="/" component={Home} /><Route component={NotFound} /></Switch></WouterRouter><Toaster /></ErrorBoundary></TooltipProvider></QueryClientProvider>;
}

export default App;