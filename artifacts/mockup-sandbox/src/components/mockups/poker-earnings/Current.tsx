import "./_group.css";
import { useMemo, useState, type ReactNode } from "react";
import {
  Activity, ArrowDown, ArrowUp, BarChart3, BookOpen, CalendarDays, Check,
  ChevronDown, ChevronRight, CircleDollarSign, ExternalLink, FileSpreadsheet,
  Filter, LayoutDashboard, LogOut, Menu, Minus, Moon, Star, Sun, UserRound, Users,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer,
  Tooltip as ChartTooltip, XAxis, YAxis,
} from "recharts";

type Player = {
  rank: number;
  name: string;
  isClubContributor: boolean;
  buyInTotal: number;
  cashOutTotal: number;
  profitTotal: number;
  gamesPlayed: number;
  profitPerSession: number;
  positiveSessionPct: number;
  netPct: number;
  buyInPerGame: number;
  maxWin: number;
  maxLoss: number;
};
type SessionPlayer = { player: string; buyIn: number; cashOut: number; net: number; status: string | null };
type Session = {
  sessionNumber: number;
  date: string;
  month: string;
  totalBuyIn: number;
  totalCashOut: number;
  totalNet: number;
  playerCount: number;
  winner: string | null;
  winnerProfit: number;
  lowPlayer: string | null;
  lowProfit: number;
  players: SessionPlayer[];
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
type RankMovement = { direction: "up" | "down" | "same" | "new"; places: number };
type View = "overview" | "sessions" | "live" | "months" | "head-to-head" | "players" | "guidelines";
type BreakdownMode = "months" | "quarters";
type SessionChartDatum = {
  sessionNumber: number;
  date: string;
  month: string;
  pot: number;
  playerCount: number;
  winner: string | null;
  winnerProfit: number;
};
type GroupGrowthDatum = {
  sessionNumber: number;
  date: string;
  playersThisNight: number;
  cumulativePlayers: number;
  buyIns: number;
  cumulativeBuyIns: number;
};

const sampleSessions: Session[] = [
  makeSession(1, "2024-01-19", "1", [
    ["Alex Morgan", 60, 95], ["Maya Chen", 50, 20], ["Jordan Lee", 50, 30], ["Sam Patel", 40, 55],
  ]),
  makeSession(2, "2024-02-02", "2", [
    ["Alex Morgan", 50, 25], ["Maya Chen", 60, 105], ["Jordan Lee", 40, 35], ["Sam Patel", 50, 35],
  ]),
  makeSession(3, "2024-02-23", "2", [
    ["Alex Morgan", 40, 75], ["Maya Chen", 40, 20], ["Jordan Lee", 60, 25], ["Sam Patel", 60, 80], ["Priya Shah", 30, 30],
  ]),
  makeSession(4, "2024-03-15", "3", [
    ["Alex Morgan", 60, 110], ["Maya Chen", 50, 35], ["Jordan Lee", 50, 30], ["Sam Patel", 40, 20], ["Priya Shah", 40, 45],
  ]),
  makeSession(5, "2024-04-05", "4", [
    ["Alex Morgan", 40, 15], ["Maya Chen", 60, 50], ["Jordan Lee", 50, 100], ["Sam Patel", 50, 35], ["Priya Shah", 40, 40],
  ]),
  makeSession(6, "2024-04-26", "4", [
    ["Alex Morgan", 50, 90], ["Maya Chen", 40, 20], ["Jordan Lee", 50, 35], ["Sam Patel", 60, 45], ["Priya Shah", 40, 50], ["Noah Kim", 30, 30],
  ]),
  makeSession(7, "2024-05-17", "5", [
    ["Alex Morgan", 50, 35], ["Maya Chen", 50, 90], ["Jordan Lee", 60, 30], ["Sam Patel", 50, 35], ["Priya Shah", 40, 60], ["Noah Kim", 40, 40],
  ]),
  makeSession(8, "2024-06-07", "6", [
    ["Alex Morgan", 60, 105], ["Maya Chen", 60, 30], ["Jordan Lee", 50, 45], ["Sam Patel", 40, 20], ["Priya Shah", 50, 55], ["Noah Kim", 40, 45],
  ]),
  makeSession(9, "2024-06-28", "6", [
    ["Alex Morgan", 50, 40], ["Maya Chen", 40, 55], ["Jordan Lee", 60, 100], ["Sam Patel", 50, 20], ["Priya Shah", 40, 35], ["Noah Kim", 40, 30],
  ]),
];

function makeSession(sessionNumber: number, date: string, month: string, rows: Array<[string, number, number]>): Session {
  const players = rows.map(([player, buyIn, cashOut]) => ({ player, buyIn, cashOut, net: cashOut - buyIn, status: null }));
  const winner = players.slice().sort((a, b) => b.net - a.net)[0];
  const low = players.slice().sort((a, b) => a.net - b.net)[0];
  const totalBuyIn = players.reduce((sum, player) => sum + player.buyIn, 0);
  const totalCashOut = players.reduce((sum, player) => sum + player.cashOut, 0);
  return {
    sessionNumber, date, month, totalBuyIn, totalCashOut, totalNet: totalCashOut - totalBuyIn,
    playerCount: players.length, winner: winner?.player ?? null, winnerProfit: winner?.net ?? 0,
    lowPlayer: low?.player ?? null, lowProfit: low?.net ?? 0, players,
  };
}

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthColors = ["158 52% 48%", "242 68% 67%", "35 94% 56%", "330 66% 65%", "194 68% 55%", "272 65% 65%"];
const quarterColors: Record<string, string> = { Q1: "158 52% 48%", Q2: "242 68% 67%", Q3: "35 94% 56%", Q4: "330 66% 65%" };
const formatCurrency = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 }).format(value || 0);
const signedCurrency = (value: number) => `${value >= 0 ? "+" : "−"}${formatCurrency(Math.abs(value))}`;
const compactCurrency = (value: number) => Math.abs(value) >= 1000 ? `${value < 0 ? "−" : ""}$${(Math.abs(value) / 1000).toFixed(1)}k` : `${value < 0 ? "−" : ""}$${Math.abs(value).toFixed(0)}`;
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const normalizePlayerName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
const monthLabel = (value: string) => monthNames[Number(value) - 1] ?? value;
const monthColor = (value: string) => `hsl(${monthColors[(Number.isFinite(Number(value)) ? Number(value) : 0) % monthColors.length]})`;
const quarterForMonth = (value: string) => {
  const month = Number(value);
  return month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";
};
const quarterColor = (value: string) => `hsl(${quarterColors[value] ?? quarterColors.Q1})`;
const formatDate = (value: string, pattern = "d MMM yyyy") => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: pattern.includes("yyyy") ? "numeric" : undefined }).format(date);
};
const navItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "sessions", label: "Session log", icon: CalendarDays },
  { id: "live", label: "Live ledger", icon: CircleDollarSign },
  { id: "months", label: "Leaderboards", icon: BarChart3 },
  { id: "head-to-head", label: "Head-to-head", icon: Users },
  { id: "players", label: "Players", icon: UserRound },
  { id: "guidelines", label: "Guidelines & Rules", icon: BookOpen },
];

function buildPlayers(sessions: Session[]): Player[] {
  const names = [...new Set(sessions.flatMap((session) => session.players.map((record) => record.player)))];
  return names.map((name) => {
    const records = sessions.flatMap((session) => session.players.filter((record) => record.player === name));
    const buyInTotal = records.reduce((sum, record) => sum + record.buyIn, 0);
    const cashOutTotal = records.reduce((sum, record) => sum + record.cashOut, 0);
    const profitTotal = records.reduce((sum, record) => sum + record.net, 0);
    const positiveRecords = records.filter((record) => record.net > 0).length;
    return {
      rank: 0, name, isClubContributor: name === "Alex Morgan" || name === "Maya Chen",
      buyInTotal, cashOutTotal, profitTotal, gamesPlayed: records.length,
      profitPerSession: profitTotal / records.length,
      positiveSessionPct: positiveRecords / records.length * 100,
      netPct: buyInTotal ? profitTotal / buyInTotal * 100 : 0,
      buyInPerGame: buyInTotal / records.length,
      maxWin: Math.max(...records.map((record) => record.net), 0),
      maxLoss: Math.min(...records.map((record) => record.net), 0),
    };
  }).sort((a, b) => b.profitTotal - a.profitTotal || b.positiveSessionPct - a.positiveSessionPct || a.name.localeCompare(b.name))
    .map((player, index) => ({ ...player, rank: index + 1 }));
}

function buildPeriods(sessions: Session[], breakdown: BreakdownMode): PeriodSummary[] {
  const groups = new Map<string, Session[]>();
  sessions.forEach((session) => {
    const key = breakdown === "months" ? session.month : quarterForMonth(session.month);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  });
  return [...groups.entries()].sort(([left], [right]) => Number(left) - Number(right)).map(([key, items]) => {
    const records = items.flatMap((session) => session.players);
    const winners = new Map<string, number>();
    items.forEach((session) => {
      if (session.winner) winners.set(session.winner, (winners.get(session.winner) ?? 0) + session.winnerProfit);
    });
    const topWinner = [...winners.entries()].sort((a, b) => b[1] - a[1])[0];
    const totalBuyIn = items.reduce((sum, session) => sum + session.totalBuyIn, 0);
    const totalCashOut = items.reduce((sum, session) => sum + session.totalCashOut, 0);
    const sessionMonths = [...new Set(items.map((session) => Number(session.month)))].sort((a, b) => a - b);
    const range = `${formatDate(items[0].date)} – ${formatDate(items[items.length - 1].date)}`;
    const quarterKey = key.startsWith("Q");
    return {
      key, label: quarterKey ? key : monthLabel(key), range,
      sessionCount: items.length, recordCount: records.length, totalBuyIn, totalCashOut,
      totalNet: totalCashOut - totalBuyIn, avgPot: totalBuyIn / items.length,
      uniquePlayers: new Set(records.map((record) => normalizePlayerName(record.player))).size,
      topWinner: topWinner?.[0] ?? null, topWinnerProfit: topWinner?.[1] ?? 0,
      positiveSessions: items.filter((session) => session.totalNet > 0).length,
      negativeSessions: items.filter((session) => session.totalNet <= 0).length,
    };
  });
}

const allTimePlayers = buildPlayers(sampleSessions);
const totals = {
  totalBuyIn: sampleSessions.reduce((sum, session) => sum + session.totalBuyIn, 0),
  totalRecords: sampleSessions.reduce((sum, session) => sum + session.players.length, 0),
  latestSession: sampleSessions[sampleSessions.length - 1].sessionNumber,
};
const dashboard = { title: "Poker Session Log & Months", spreadsheetUrl: "#", totals };

export function Current() {
  const memberName = "Alex Morgan";
  const [isDark, setIsDark] = useState(false);
  const [breakdown, setBreakdown] = useState<BreakdownMode>("quarters");
  const [monthFilter, setMonthFilter] = useState("ALL");
  const [quarterFilter, setQuarterFilter] = useState("ALL");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeView] = useState<View>("overview");
  const months = useMemo(() => buildPeriods(sampleSessions, "months"), []);
  const quarters = useMemo(() => buildPeriods(sampleSessions, "quarters"), []);
  const periods = breakdown === "months" ? months : quarters;
  const activePeriodFilter = breakdown === "months" ? monthFilter : quarterFilter;
  const periodFilterOrder = ["ALL", ...periods.map((period) => period.key)];
  const selectedPeriodKey = activePeriodFilter === "ALL" ? null : activePeriodFilter;
  const scopeSessions = selectedPeriodKey
    ? sampleSessions.filter((session) => breakdown === "months"
      ? session.month === selectedPeriodKey
      : quarterForMonth(session.month) === selectedPeriodKey)
    : sampleSessions;
  const visiblePeriod = selectedPeriodKey ? periods.find((period) => period.key === selectedPeriodKey) ?? null : null;
  const scopedPlayers = selectedPeriodKey ? buildPlayers(scopeSessions) : allTimePlayers;

  return (
    <div className={`${isDark ? "dark" : ""} poker-earnings min-h-screen bg-background text-foreground`}>
      <main className="min-h-screen">
        <div className="mx-auto max-w-[1450px] px-4 py-4 sm:px-7 lg:px-10 lg:py-6">
          <header className="rise-in border-b border-border">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <button onClick={() => {}} data-testid="button-brand-home" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_3px_0_hsl(245_76%_42%)]" aria-label="Open overview"><CalendarDays className="h-5 w-5" /></button>
                <div className="flex min-w-0 items-baseline gap-2">
                  <h1 data-testid="text-dashboard-title" className="min-w-0 truncate text-lg font-semibold tracking-[-0.03em] sm:text-xl">{dashboard.title}</h1>
                  <a href="https://abhayjhade.com" target="_blank" rel="noreferrer" data-testid="link-creator-top" className="hidden shrink-0 text-[10px] font-medium text-muted-foreground transition-colors hover:text-primary hover:underline sm:inline">By Abhay Jhade</a>
                </div>
              </div>
              <div className="hidden flex-wrap items-center gap-2 print-hidden lg:flex">
                <span className="hidden rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground sm:inline-flex">{memberName}</span>
                <button data-testid="button-member-logout" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold transition-transform hover:-translate-y-0.5"><LogOut className="h-4 w-4" />Sign out</button>
                <button data-testid="button-refresh-dashboard" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold transition-transform hover:-translate-y-0.5"><Activity className="h-4 w-4" />Refresh</button>
                <a href="#" onClick={(event) => event.preventDefault()} data-testid="link-open-spreadsheet" className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"><FileSpreadsheet className="h-4 w-4" />Open sheet<ExternalLink className="h-3 w-3 opacity-60" /></a>
                <button onClick={() => setIsDark((value) => !value)} data-testid="button-toggle-theme" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground" aria-label="Toggle dark mode">{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
              </div>
              <div className="print-hidden lg:hidden">
                <DropdownMenu open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                  <DropdownMenuTrigger asChild><button type="button" data-testid="button-mobile-dashboard-menu" aria-label="Open dashboard menu" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-foreground"><Menu className="h-5 w-5" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="truncate text-xs text-muted-foreground">Signed in as {memberName}</DropdownMenuLabel><DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Go to</DropdownMenuLabel>
                    {navItems.map(({ id, label, icon: Icon }) => <DropdownMenuItem key={id} onSelect={() => setMobileMenuOpen(false)} data-testid={`menu-nav-${id}`} className={activeView === id ? "bg-primary/10 font-semibold text-primary focus:bg-primary/10" : ""}><Icon className="h-4 w-4" />{label}</DropdownMenuItem>)}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem data-testid="menu-refresh-dashboard"><Activity className="h-4 w-4" />Refresh dashboard</DropdownMenuItem>
                    <DropdownMenuItem asChild><a href="#" onClick={(event) => event.preventDefault()} data-testid="menu-open-spreadsheet"><FileSpreadsheet className="h-4 w-4" />Open spreadsheet</a></DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setIsDark((value) => !value)} data-testid="menu-toggle-theme">{isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}Switch to {isDark ? "light" : "dark"} mode</DropdownMenuItem>
                    <DropdownMenuSeparator /><DropdownMenuItem data-testid="menu-member-logout" className="text-destructive focus:text-destructive"><LogOut className="h-4 w-4" />Sign out</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <nav data-testid="nav-product-tabs" aria-label="Dashboard sections" className="mt-4 hidden gap-1 overflow-x-auto pb-2 lg:flex">
              {navItems.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => {}} data-testid={`nav-${id}`} className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${activeView === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}><Icon className="h-3.5 w-3.5" />{label}</button>)}
            </nav>
          </header>

          <section data-testid="section-period-filter" className="mt-4 border-b border-border pb-4">
            <button type="button" onClick={() => setMobileFiltersOpen((open) => !open)} aria-expanded={mobileFiltersOpen} aria-controls="period-filter-controls" data-testid="button-toggle-period-filters" className="mb-2 inline-flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-xs font-semibold lg:hidden">
              <Filter className="h-3.5 w-3.5 text-primary" /><span>Period filters</span><span className="ml-auto font-normal text-muted-foreground">{visiblePeriod?.label ?? "All time"}</span><ChevronDown className={`h-4 w-4 transition-transform ${mobileFiltersOpen ? "rotate-180" : ""}`} />
            </button>
            <div id="period-filter-controls" className={`${mobileFiltersOpen ? "flex" : "hidden"} flex-col gap-2 lg:flex`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><Filter className="h-3.5 w-3.5" />Breakdown</div>
                <div className="flex gap-1 rounded-lg bg-secondary/45 p-1">
                  <button onClick={() => { setBreakdown("months"); setQuarterFilter("ALL"); }} data-testid="button-breakdown-months" className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${breakdown === "months" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Monthly</button>
                  <button onClick={() => { setBreakdown("quarters"); setMonthFilter("ALL"); }} data-testid="button-breakdown-quarters" className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${breakdown === "quarters" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Quarterly</button>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{breakdown === "months" ? "Month" : "Quarter"}</div>
                <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
                  {periodFilterOrder.map((value) => {
                    const period = periods.find((item) => item.key === value);
                    const isAll = value === "ALL";
                    return <MonthButton key={value} value={value} label={isAll ? "All time" : period?.label ?? value} active={activePeriodFilter === value} summary={isAll ? `${sampleSessions.length} · ${compactCurrency(totals.totalBuyIn)}` : period ? `${period.sessionCount} · ${compactCurrency(period.totalBuyIn)}` : "No data"} onClick={() => { if (breakdown === "months") setMonthFilter(value); else setQuarterFilter(value); }} />;
                  })}
                </div>
                <span data-testid="text-viewing-period" className="hidden whitespace-nowrap px-2 text-right text-[11px] text-muted-foreground lg:block"><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" />Viewing: <strong className="text-foreground">{visiblePeriod?.label ?? "All time"}</strong></span>
              </div>
            </div>
          </section>

          <ScopeMetrics dashboard={dashboard} players={allTimePlayers} sessions={scopeSessions} period={visiblePeriod} />
          <div className="mt-4">
            <OverviewView dashboard={dashboard} players={scopedPlayers} sessions={scopeSessions} scopeSessions={scopeSessions} period={visiblePeriod} periods={periods} allTimePlayers={allTimePlayers} allTimeSessions={sampleSessions} onNavigate={() => {}} onSelectPlayer={() => {}} onSelectSession={() => {}} />
          </div>
          <footer className="mt-8 grid gap-4 border-t border-border py-7 text-xs text-muted-foreground sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="space-y-1"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground">All time · {sampleSessions.length} sessions · {dashboard.totals.totalRecords} games</p><p>Monthly and quarterly views are derived from the canonical session log.</p><p data-testid="text-footer-latest">{dashboard.totals.latestSession ? `Latest game #${dashboard.totals.latestSession}` : "Season in progress"}</p></div>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em]">Numbers sourced from the club sheet</span>
            <a href="https://abhayjhade.com" target="_blank" rel="noreferrer" data-testid="link-portfolio" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">More work by Abhay <span aria-hidden="true">→</span></a>
          </footer>
        </div>
      </main>
    </div>
  );
}

function ScopeMetrics({ dashboard: data, players, sessions, period }: { dashboard: typeof dashboard; players: Player[]; sessions: Session[]; period: PeriodSummary | null }) {
  const stats = getScopeStats(data, players, sessions, period);
  const scopeLabel = period?.label ?? "All-time";
  const playerCount = period ? stats.uniquePlayers : players.length;
  return <section data-testid="section-summary-metrics" className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
    <MetricCard testId="metric-total-buy-in" label={`${scopeLabel} buy-ins`} value={formatCurrency(stats.totalBuyIn)} detail={`${sessions.length} sessions · ${stats.recordCount} games`} icon={<CircleDollarSign />} />
    <MetricCard testId="metric-scope-players" label={`${scopeLabel} players`} value={String(playerCount)} detail={period ? "Active players in this period" : "Players in the club standings"} icon={<Users />} />
    <MetricCard testId="metric-scope-sessions" label={`${scopeLabel} sessions`} value={String(sessions.length)} detail={period?.range ?? "All recorded poker nights"} icon={<CalendarDays />} />
  </section>;
}

function getScopeStats(data: typeof dashboard, players: Player[], sessions: Session[], period: PeriodSummary | null) {
  const records = sessions.flatMap((session) => session.players);
  return {
    totalBuyIn: period?.totalBuyIn ?? data.totals.totalBuyIn,
    recordCount: period?.recordCount ?? data.totals.totalRecords,
    positiveRecords: records.filter((record) => record.net > 0).length,
    negativeRecords: records.filter((record) => record.net <= 0).length,
    uniquePlayers: new Set(records.map((record) => normalizePlayerName(record.player))).size,
    leadingPlayer: players[0] ?? null,
  };
}

function OverviewView({ dashboard: _dashboard, players, sessions, scopeSessions, period, periods, allTimePlayers, allTimeSessions, onNavigate, onSelectPlayer, onSelectSession }: {
  dashboard: typeof dashboard; players: Player[]; sessions: Session[]; scopeSessions: Session[];
  period: PeriodSummary | null; periods: PeriodSummary[]; allTimePlayers: Player[]; allTimeSessions: Session[];
  onNavigate: (view: View) => void; onSelectPlayer: (name: string) => void; onSelectSession: (number: number) => void;
}) {
  const primaryRankMovements = buildRankMovementMap(players, scopeSessions);
  const allTimeRankMovements = buildRankMovementMap(allTimePlayers, allTimeSessions);
  return <>
    <section data-testid="section-home-leaderboards" className="grid gap-4">
      {period
        ? <LeaderboardSummary eyebrow="Selected period" title={`${period.label} leaderboard`} players={players} rankMovements={primaryRankMovements} testIdPrefix="period" onSelect={onSelectPlayer} actionLabel="View full table" onAction={() => onNavigate("months")} />
        : <LeaderboardSummary eyebrow="Club history" title="All-time leaderboard" players={allTimePlayers} rankMovements={allTimeRankMovements} testIdPrefix="all-time" onSelect={onSelectPlayer} actionLabel="View full table" onAction={() => onNavigate("months")} />}
    </section>
    {!period && <section data-testid="section-overview-period-ledger" className="mt-4"><PeriodPerformanceTable periods={periods} sessions={scopeSessions} /></section>}
    <section data-testid="section-overview-hero" className="mt-4">
      <div className="soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6">
        <SessionActionChart sessions={sessions} testId="chart-session-pulse" onSelectSession={onSelectSession} />
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-[11px] text-muted-foreground"><span><strong className="text-foreground">{sessions.length}</strong> nights in view</span><span><strong className="text-chart-1">{getScopeStats(_dashboard, players, scopeSessions, period).positiveRecords}</strong> positive games</span><span><strong className="text-destructive">{getScopeStats(_dashboard, players, scopeSessions, period).negativeRecords}</strong> negative games</span><span><strong className="text-foreground">{period?.range ?? "All-time dated sessions"}</strong></span></div>
      </div>
    </section>
    <GroupGrowthSection sessions={scopeSessions} period={period} />
  </>;
}

function LeaderboardSummary({ eyebrow, title, players, rankMovements, testIdPrefix, onSelect, actionLabel, onAction }: {
  eyebrow: string; title: string; players: Player[]; rankMovements: Map<string, RankMovement>;
  testIdPrefix: string; onSelect: (name: string) => void; actionLabel?: string; onAction?: () => void;
}) {
  return <div data-testid={`section-${testIdPrefix}-leaderboard`} className="soft-shadow overflow-hidden rounded-2xl border border-border bg-card">
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
      <div><p className="section-label">{eyebrow}</p><h2 className="mt-1 text-lg font-semibold tracking-tight">{title}</h2></div>
      {actionLabel && onAction && <button onClick={onAction} className="shrink-0 text-xs font-semibold text-primary hover:underline">{actionLabel}<ChevronRight className="ml-1 inline h-3.5 w-3.5" /></button>}
    </div>
    <div className="divide-y divide-border/70">
      {players.slice(0, 5).map((player) => {
        const rankClass = player.rank === 1 ? "bg-accent text-accent-foreground" : player.rank === 2 ? "bg-secondary text-foreground" : player.rank === 3 ? "bg-primary/15 text-primary" : "bg-secondary/45 text-muted-foreground";
        return <button key={player.name} onClick={() => onSelect(player.name)} data-testid={`button-${testIdPrefix}-player-${slug(player.name)}`} className="grid w-full grid-cols-[42px_1fr_auto] items-center gap-2.5 px-3 py-3 text-left transition-colors hover:bg-secondary/50 sm:grid-cols-[50px_minmax(220px,1fr)_120px] sm:gap-4 sm:px-5">
          <span className={`flex h-8 w-9 items-center justify-center rounded-lg font-mono text-[11px] font-semibold sm:w-10 ${rankClass}`}>{player.rank <= 3 ? ["1st", "2nd", "3rd"][player.rank - 1] : `#${player.rank}`}</span>
          <span className="min-w-0"><span className="flex items-center gap-1.5 truncate text-sm font-semibold">{player.name}{player.isClubContributor && <ContributorBadge name={player.name} />}<RankMovementIndicator movement={rankMovements.get(normalizePlayerName(player.name))} /></span></span>
          <span className={`text-right font-mono text-xs font-semibold sm:text-sm ${player.profitTotal >= 0 ? "text-chart-1" : "text-destructive"}`}>{signedCurrency(player.profitTotal)}</span>
        </button>;
      })}
    </div>
  </div>;
}

function RankMovementIndicator({ movement }: { movement?: RankMovement }) {
  if (!movement) return null;
  if (movement.direction === "new") return <span data-testid="indicator-rank-new" title="New to the leaderboard" className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-primary">New</span>;
  const isUp = movement.direction === "up";
  const isDown = movement.direction === "down";
  const Icon = isUp ? ArrowUp : isDown ? ArrowDown : Minus;
  const label = isUp
    ? `Moved up ${movement.places} ${movement.places === 1 ? "place" : "places"} since the previous leaderboard position`
    : isDown
      ? `Moved down ${movement.places} ${movement.places === 1 ? "place" : "places"} since the previous leaderboard position`
      : "No rank change since the previous leaderboard position";
  return <span data-testid={`indicator-rank-${movement.direction}`} title={label} aria-label={label} className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${isUp ? "bg-chart-1/10 text-chart-1" : isDown ? "bg-destructive/10 text-destructive" : "bg-secondary text-muted-foreground"}`}><Icon className="h-3 w-3" aria-hidden="true" />{movement.places > 0 ? movement.places : "—"}</span>;
}

function buildRankMovementMap(players: Player[], sessions: Session[]): Map<string, RankMovement> {
  if (sessions.length < 2) return new Map();
  const lastNumber = Math.max(...sessions.map((session) => session.sessionNumber));
  const previousPlayers = buildPlayers(sessions.filter((session) => session.sessionNumber < lastNumber));
  const previousRanks = new Map(previousPlayers.map((player) => [normalizePlayerName(player.name), player.rank]));
  const movements: Array<[string, RankMovement]> = players.map((player): [string, RankMovement] => {
    const previousRank = previousRanks.get(normalizePlayerName(player.name));
    if (!previousRank) return [normalizePlayerName(player.name), { direction: "new", places: 0 }];
    const places = previousRank - player.rank;
    return [normalizePlayerName(player.name), { direction: places > 0 ? "up" : places < 0 ? "down" : "same", places: Math.abs(places) }];
  });
  return new Map(movements);
}

function SessionActionChart({ sessions, testId, onSelectSession }: { sessions: Session[]; testId: string; onSelectSession?: (sessionNumber: number) => void }) {
  const compact = typeof window !== "undefined" && window.innerWidth < 640;
  const data: SessionChartDatum[] = sessions.slice().sort((left, right) => left.sessionNumber - right.sessionNumber).map((session) => ({
    sessionNumber: session.sessionNumber, date: session.date, month: session.month, pot: session.totalBuyIn,
    playerCount: session.playerCount, winner: session.winner, winnerProfit: session.winnerProfit,
  }));
  const visibleMonths = [...new Set(data.map((item) => item.month))];
  return <>
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
      <div><p className="flex items-center gap-1.5 text-sm font-semibold tracking-tight"><BarChart3 className="h-4 w-4 text-primary" />Session Action &amp; Pot Trajectory (Split by Month)</p><p className="mt-1 text-xs text-muted-foreground">Height represents total buy-in volume per session. Color signifies the month.</p></div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">{visibleMonths.map((month) => <span key={month} className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground"><span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: monthColor(month) }} />{monthLabel(month)}</span>)}</div>
    </div>
    {data.length > 0 ? <div className="canvas-chart mt-4 h-[270px] sm:h-[290px]" data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 10, left: compact ? -18 : 0, bottom: compact ? 46 : 68 }} barCategoryGap={compact ? "18%" : "12%"}>
          <CartesianGrid stroke="hsl(var(--foreground) / .08)" vertical={false} strokeDasharray="3 4" />
          <XAxis dataKey="date" interval={compact ? 4 : 0} angle={-48} textAnchor="end" height={compact ? 62 : 92} tick={{ fontSize: compact ? 8 : 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(value) => compact ? formatDate(String(value), "d MMM") : String(value)} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(value) => compactCurrency(Number(value))} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={compact ? 50 : 58} />
          <ChartTooltip cursor={{ fill: "hsl(var(--foreground) / .035)" }} content={<SessionChartTooltip />} />
          <Bar dataKey="pot" name="Total pot" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
            {data.map((item) => <Cell key={item.sessionNumber} fill={monthColor(item.month)} fillOpacity={0.68} className="cursor-pointer transition-opacity duration-150 hover:opacity-100" onClick={() => onSelectSession?.(item.sessionNumber)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div> : <ChartEmpty label="Session volume will appear after the first recorded game." />}
  </>;
}

function SessionChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: SessionChartDatum }> }) {
  const session = payload?.[0]?.payload;
  if (!active || !session) return null;
  return <div className="min-w-[210px] rounded-lg border border-white/10 bg-[#182039] px-4 py-3 text-xs text-white shadow-2xl">
    <div className="flex items-center justify-between gap-4"><strong className="font-mono text-[13px]">{session.date} ({monthLabel(session.month)})</strong><span className="h-2 w-2 rounded-full" style={{ backgroundColor: monthColor(session.month) }} /></div>
    <p className="mt-2 font-mono text-[#63d9ef]">Total Pot: {formatCurrency(session.pot)} ({session.playerCount} players)</p>
    <p className="mt-1 font-mono text-[#68e0a5]">Winner: {session.winner ?? "—"} ({signedCurrency(session.winnerProfit)})</p>
    <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-white/50">Click the bar to inspect this session</p>
  </div>;
}

function PeriodPerformanceTable({ periods, sessions }: { periods: PeriodSummary[]; sessions: Session[] }) {
  return <div data-testid="section-period-performance-table" className="soft-shadow overflow-hidden rounded-2xl border border-border bg-card">
    <div className="border-b border-border px-5 py-4"><p className="section-label">Performance ledger</p><h2 className="mt-1 text-lg font-semibold">Where each period is being made</h2></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
      <thead className="bg-secondary/35 text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><tr><th className="px-5 py-3">Period</th><th className="px-5 py-3">Sessions</th><th className="px-5 py-3">Games</th><th className="px-5 py-3">Buy-ins</th><th className="px-5 py-3">Avg pot</th><th className="px-5 py-3">Top winner</th><th className="px-5 py-3">Green / red</th></tr></thead>
      <tbody>{periods.map((period) => <tr key={period.key} data-testid={`row-period-${period.key}`} className="border-t border-border/70">
        <td className="px-5 py-4"><div className="flex items-center gap-2 font-semibold"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: period.key.startsWith("Q") ? quarterColor(period.key) : monthColor(period.key) }} />{period.label}</div><span className="block pl-4 text-xs text-muted-foreground">{period.range}</span></td>
        <td className="px-5 py-4 font-mono">{period.sessionCount}</td><td className="px-5 py-4 font-mono">{period.recordCount}</td><td className="px-5 py-4 font-mono">{formatCurrency(period.totalBuyIn)}</td><td className="px-5 py-4 font-mono">{formatCurrency(period.avgPot)}</td>
        <td className="px-5 py-4">{period.topWinner ? <span>{period.topWinner}<span className="ml-2 font-mono text-chart-1">{signedCurrency(period.topWinnerProfit)}</span></span> : <span className="text-muted-foreground">None yet</span>}</td>
        <td className="px-5 py-4 font-mono"><span className="text-chart-1">{period.positiveSessions}</span><span className="px-1 text-muted-foreground">/</span><span className="text-destructive">{period.negativeSessions}</span></td>
      </tr>)}</tbody>
    </table></div>
    <div className="border-t border-border bg-secondary/15 px-5 py-3 text-xs text-muted-foreground">{sessions.length} dated sessions in the selected scope.</div>
  </div>;
}

function buildGroupGrowthData(sessions: Session[]): GroupGrowthDatum[] {
  const seenPlayers = new Set<string>();
  let cumulativeBuyIns = 0;
  return sessions.slice().sort((left, right) => left.sessionNumber - right.sessionNumber).map((session) => {
    session.players.forEach((player) => seenPlayers.add(normalizePlayerName(player.player)));
    cumulativeBuyIns += session.totalBuyIn;
    return {
      sessionNumber: session.sessionNumber, date: session.date, playersThisNight: session.playerCount,
      cumulativePlayers: seenPlayers.size, buyIns: session.totalBuyIn, cumulativeBuyIns,
    };
  });
}

function GroupGrowthSection({ sessions, period }: { sessions: Session[]; period: PeriodSummary | null }) {
  const data = buildGroupGrowthData(sessions);
  const latest = data[data.length - 1];
  const averagePlayers = data.length ? data.reduce((total, item) => total + item.playersThisNight, 0) / data.length : 0;
  const periodLabel = period?.label ?? "All-time";
  return <section data-testid="section-group-growth" className="mt-4">
    <div className="soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="section-label text-primary">The group, over time</p><h2 className="mt-1 text-lg font-semibold tracking-tight">Group growth</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">See how the club has grown across dated poker nights. Charts follow the {periodLabel.toLowerCase()} filter.</p></div>
        <span className="shrink-0 rounded-full border border-border bg-secondary/35 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{data.length} nights tracked</span>
      </div>
      {data.length ? <>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard testId="metric-growth-players" label="Unique players" value={String(latest.cumulativePlayers)} detail="Players seen in this period" icon={<Users />} />
          <MetricCard testId="metric-growth-buy-ins" label="Buy-in volume" value={formatCurrency(latest.cumulativeBuyIns)} detail="Cumulative across dated nights" icon={<CircleDollarSign />} />
          <MetricCard testId="metric-growth-attendance" label="Avg. attendance" value={averagePlayers.toFixed(1)} detail="Players per poker night" icon={<Activity />} />
          <MetricCard testId="metric-growth-nights" label="Nights tracked" value={String(data.length)} detail={`Latest: game #${latest.sessionNumber}`} icon={<CalendarDays />} />
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <GrowthChartCard testId="chart-growth-players" eyebrow="Players over time" title="A wider group at the table" description="Cumulative unique players across each dated poker night." data={data} yFormatter={(value) => String(value)} yAllowDecimals={false} lines={[{ dataKey: "cumulativePlayers", name: "Unique players", color: "hsl(var(--chart-1))" }]} />
          <GrowthChartCard testId="chart-growth-buy-ins" eyebrow="Buy-ins over time" title="More volume across the club" description="Cumulative buy-in volume across the group." data={data} yFormatter={(value) => compactCurrency(Number(value))} lines={[{ dataKey: "cumulativeBuyIns", name: "Cumulative buy-ins", color: "hsl(var(--primary))" }]} />
        </div>
      </> : <div className="mt-5"><ChartEmpty label="Group growth will appear after dated poker nights are recorded." /></div>}
    </div>
  </section>;
}

function GrowthChartCard({ testId, eyebrow, title, description, data, lines, yFormatter, yAllowDecimals = true }: {
  testId: string; eyebrow: string; title: string; description: string; data: GroupGrowthDatum[];
  lines: Array<{ dataKey: keyof GroupGrowthDatum; name: string; color: string }>;
  yFormatter: (value: number) => string; yAllowDecimals?: boolean;
}) {
  return <div className="rounded-xl border border-border/80 bg-secondary/15 p-4 sm:p-5">
    <div><p className="section-label">{eyebrow}</p><h3 className="mt-1 text-base font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>
    <div className="canvas-chart mt-4 h-[250px]" data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--foreground) / .08)" vertical={false} strokeDasharray="3 4" />
          <XAxis dataKey="sessionNumber" tickFormatter={(value) => `#${value}`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={yAllowDecimals} tickFormatter={yFormatter} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={48} />
          <ChartTooltip content={<GrowthChartTooltip />} />
          {lines.map((line) => <Line key={line.dataKey} type="monotone" dataKey={line.dataKey} name={line.name} stroke={line.color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{lines.map((line) => <span key={line.dataKey} className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: line.color }} />{line.name}</span>)}</div>
  </div>;
}

function GrowthChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string; payload?: GroupGrowthDatum }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point || !payload?.length) return null;
  return <div className="min-w-[190px] rounded-lg border border-white/10 bg-[#182039] px-4 py-3 text-xs text-white shadow-2xl">
    <p className="mb-2 font-mono text-[10px] text-white/60">Game #{point.sessionNumber} · {point.date}</p>
    {payload.map((item) => <p key={item.name} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />{item.name}: <strong className="font-mono">{item.name?.toLowerCase().includes("buy") ? formatCurrency(item.value ?? 0) : item.value}</strong></p>)}
  </div>;
}

function MonthButton({ value, label, summary, active, onClick }: { value: string; label: string; summary: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} data-testid={`button-filter-${value.toLowerCase()}`} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${active ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}><span className="text-xs font-semibold">{label}</span><span className={`font-mono text-[10px] ${active ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{summary}</span>{active && <Check className="h-3.5 w-3.5" />}</button>;
}

function MetricCard({ label, value, detail, tone = "neutral", icon, testId }: {
  label: string; value: string; detail?: string; tone?: "positive" | "negative" | "neutral"; icon: ReactNode; testId: string;
}) {
  return <div data-testid={testId} className="group rise-in soft-shadow rounded-xl border border-border bg-card p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg sm:p-4">
    <div className="flex items-center justify-between gap-2 text-muted-foreground"><span className="section-label">{label}</span><span className="text-primary transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-6 [&>svg]:h-4 [&>svg]:w-4">{icon}</span></div>
    <p data-testid={`${testId}-value`} className={`mt-3 font-mono text-xl font-medium tracking-tight sm:text-2xl ${tone === "positive" ? "text-chart-1" : tone === "negative" ? "text-destructive" : "text-foreground"}`}>{value}</p>
    <p className="mt-1 text-[11px] leading-4 text-muted-foreground transition-colors group-hover:text-foreground">{detail ?? "—"}</p>
  </div>;
}

function ChartEmpty({ label }: { label: string }) {
  return <div data-testid="empty-chart" className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-border px-5 text-center text-sm text-muted-foreground">{label}</div>;
}

function ContributorBadge({ name }: { name?: string }) {
  return <span data-testid="badge-club-contributor" role="img" title={`${name ?? "This player"} has contributed to the development of our home games`} aria-label={`${name ?? "This player"} has contributed to the development of our home games`} className="inline-flex shrink-0 cursor-help items-center text-accent"><Star className="h-3.5 w-3.5 fill-current" /></span>;
}
