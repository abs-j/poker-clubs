import "./_group.css";
import { useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Sun,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Action = "buy_in" | "cash_out";
type SessionStatus = "open" | "closed" | "ready";
type Entry = { id: string; action: Action; amount: number; player: string; time: string };
type Past = { date: string; entries: number; in: number; out: number; balanced: boolean };

const memberName = "Alex Morgan";
const players = ["Alex Morgan", "Jordan Lee", "Maya Chen", "Sam Patel"];
const initialEntries: Entry[] = [
  { id: "e1", action: "buy_in", amount: 20, player: "Maya Chen", time: "7:42 PM" },
  { id: "e2", action: "buy_in", amount: 10, player: "Jordan Lee", time: "7:48 PM" },
  { id: "e3", action: "cash_out", amount: 30, player: "Maya Chen", time: "9:16 PM" },
];
const pastLedgers: Past[] = [
  { date: "Friday, 14 June 2024", entries: 8, in: 120, out: 120, balanced: true },
  { date: "Saturday, 8 June 2024", entries: 11, in: 180, out: 165, balanced: false },
];
const money = (value: number) => `$${value.toFixed(2)}`;

export function LiveLedgerRefined() {
  const [dark, setDark] = useState(false);
  const [view, setView] = useState("live");
  const [entries, setEntries] = useState(initialEntries);
  const [action, setAction] = useState<Action>("buy_in");
  const [amount, setAmount] = useState("");
  const [player, setPlayer] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("open");
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncMessage, setSyncMessage] = useState("Synced just now");

  const totals = useMemo(() => ({
    buy: entries.filter((entry) => entry.action === "buy_in").reduce((sum, entry) => sum + entry.amount, 0),
    out: entries.filter((entry) => entry.action === "cash_out").reduce((sum, entry) => sum + entry.amount, 0),
  }), [entries]);
  const difference = totals.out - totals.buy;
  const isOpen = sessionStatus === "open";

  const resetForm = () => {
    setAmount("");
    setPlayer("");
    setEditing(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(amount);
    if (!isOpen || !Number.isFinite(value) || value <= 0) return;
    const nextEntry: Entry = {
      id: editing ?? `e${Date.now()}`,
      action,
      amount: value,
      player: player || memberName,
      time: "Just now",
    };
    setEntries((current) => editing
      ? current.map((entry) => entry.id === editing ? nextEntry : entry)
      : [...current, nextEntry]);
    setSyncMessage("Synced just now");
    resetForm();
  };

  const editEntry = (entry: Entry) => {
    setEditing(entry.id);
    setAction(entry.action);
    setAmount(entry.amount.toFixed(2));
    setPlayer(entry.player === memberName ? "" : entry.player);
    setDeleteConfirm(null);
    document.getElementById("quick-entry")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const startSession = () => {
    if (sessionStatus === "closed") {
      setEntries([]);
      setSessionStatus("ready");
      resetForm();
      return;
    }
    setSessionStatus("open");
  };

  const navItems = [
    { id: "overview", label: "Overview", Icon: LayoutDashboard },
    { id: "live", label: "Live ledger", Icon: Activity },
    { id: "players", label: "Players", Icon: Users },
  ];

  return (
    <div className={`${dark ? "dark" : ""} live-ledger-flow min-h-[100dvh] overflow-x-hidden bg-background text-foreground`}>
      <main className="min-h-[100dvh]">
        <div className="mx-auto w-full max-w-[1440px] px-3 pb-8 pt-3 sm:px-6 sm:pt-5 lg:px-10">
          <header className="rise-in border-b border-border pb-3 sm:pb-0">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_3px_0_hsl(245_76%_42%)] sm:h-10 sm:w-10">
                  <CircleDollarSign className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-[15px] font-semibold tracking-[-0.035em] sm:text-lg">Poker Club</h1>
                  <p className="truncate text-[10px] text-muted-foreground sm:text-xs">Shared session ledger</p>
                </div>
              </div>

              <div className="hidden items-center gap-2 lg:flex">
                <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">AM</span>
                  {memberName}
                </span>
                <button onClick={() => setSyncMessage("Synced just now")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold transition-colors hover:bg-secondary" aria-label="Refresh ledger">
                  <RefreshCw className="h-3.5 w-3.5" />Refresh
                </button>
                <button onClick={() => setDark((current) => !current)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Toggle theme">
                  {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
                <button onClick={() => setSyncMessage("Signed out locally")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold transition-colors hover:bg-secondary">
                  <LogOut className="h-3.5 w-3.5" />Sign out
                </button>
              </div>

              <div className="lg:hidden">
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card transition-colors hover:bg-secondary" aria-label="Open dashboard menu">
                      <Menu className="h-5 w-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Signed in as {memberName}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Go to</DropdownMenuLabel>
                    {navItems.map(({ id, label, Icon }) => (
                      <DropdownMenuItem key={id} onSelect={() => setView(id)} className={view === id ? "bg-primary/10 font-semibold text-primary" : ""}>
                        <Icon className="h-4 w-4" />{label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setDark((current) => !current)}>
                      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                      Switch to {dark ? "light" : "dark"} mode
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSyncMessage("Synced just now")}><RefreshCw className="h-4 w-4" />Refresh ledger</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSyncMessage("Signed out locally")} className="text-destructive"><LogOut className="h-4 w-4" />Sign out</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <nav aria-label="Main navigation" className="mt-3 flex gap-1 overflow-x-auto pb-1 lg:mt-4 lg:pb-3">
              {navItems.map(({ id, label, Icon }) => (
                <button key={id} onClick={() => setView(id)} className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${view === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              ))}
              <div className="ml-auto hidden items-center gap-1.5 self-center pr-1 text-[11px] text-muted-foreground sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-chart-1" />
                {syncMessage}
              </div>
            </nav>
          </header>

          {view !== "live" ? (
            <div className="mx-auto flex min-h-[45vh] max-w-xl flex-col items-center justify-center px-4 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                {view === "overview" ? <LayoutDashboard className="h-5 w-5" /> : <Users className="h-5 w-5" />}
              </span>
              <p className="section-label mt-4 text-primary">Poker Club</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">{view === "overview" ? "Session overview" : "Players"}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">The live ledger is where tonight’s money movement is recorded. Return there to pick up where the table left off.</p>
              <button onClick={() => setView("live")} className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
                <Activity className="h-4 w-4" />Go to live ledger
              </button>
            </div>
          ) : (
            <section className="space-y-4 pt-4 sm:space-y-5 sm:pt-5" data-testid="section-live-ledger">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div>
                  <p className="section-label text-primary">Tonight · Poker Club</p>
                  <h2 className="mt-0.5 text-xl font-semibold tracking-[-0.035em] sm:text-2xl">Live ledger</h2>
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-chart-1/25 bg-chart-1/10 px-2.5 py-1.5 text-[10px] font-semibold text-chart-1 sm:text-xs">
                  <span className="relative flex h-2 w-2">
                    {isOpen && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-chart-1 opacity-40" />}
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-chart-1" />
                  </span>
                  {syncMessage === "Signed out locally" ? "Local preview" : syncMessage}
                </div>
              </div>

              <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border p-3 sm:gap-3 sm:px-5 sm:py-4 ${isOpen ? "border-primary/20 bg-primary/[0.045]" : "border-border bg-card"}`}>
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-9 sm:w-9 ${isOpen ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
                    {isOpen ? <Activity className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-xs font-semibold sm:text-sm">{sessionStatus === "open" ? "Session in progress" : sessionStatus === "ready" ? "Ready to play" : "Session closed"}</p>
                      <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ${isOpen ? "bg-chart-1/10 text-chart-1" : "bg-secondary text-muted-foreground"}`}>
                        {sessionStatus === "open" ? "Open" : sessionStatus === "ready" ? "Ready" : "Closed"}
                      </span>
                      {entries.length > 0 && <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold ${Math.abs(difference) < 0.01 ? "bg-chart-1/10 text-chart-1" : "bg-amber-500/10 text-amber-700"}`}>{Math.abs(difference) < 0.01 ? "Balanced" : "Unbalanced"}</span>}
                    </div>
                    <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground sm:mt-1 sm:text-xs sm:leading-5">
                      {sessionStatus === "open" ? "7:38 PM · Alex Morgan" : sessionStatus === "ready" ? "Ledger ready for tonight." : "Tonight’s ledger is closed."}
                    </p>
                  </div>
                </div>
                {isOpen ? (
                  <button onClick={() => setSessionStatus("closed")} className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/[0.07] px-2.5 text-[10px] font-semibold text-destructive transition-colors hover:bg-destructive/10 sm:h-10 sm:gap-2 sm:px-4 sm:text-xs">
                    <Check className="h-4 w-4" />End session
                  </button>
                ) : (
                  <button onClick={startSession} className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-2.5 text-[10px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:h-10 sm:gap-2 sm:px-4 sm:text-xs">
                    <Activity className="h-4 w-4" />{sessionStatus === "ready" ? "Open ledger" : "Start new session"}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
                <Metric label="Buy-ins" compactLabel="IN" value={money(totals.buy)} detail="Money into the game" tone="positive" />
                <Metric label="Cash-outs" compactLabel="OUT" value={money(totals.out)} detail="Money returned" tone="neutral" />
                <Metric label="Net balance" compactLabel="NET" value={`${difference > 0 ? "+" : difference < 0 ? "−" : ""}${money(Math.abs(difference))}`} detail="Cash-outs minus buy-ins" tone={difference === 0 ? "positive" : "negative"} />
                <div className="hidden sm:block"><Metric label="Session balance" value={entries.length === 0 ? "No entries" : Math.abs(difference) < 0.01 ? "Balanced" : "Unbalanced"} detail={entries.length === 0 ? "Ready for first entry" : "Based on all entries"} tone={Math.abs(difference) < 0.01 ? "positive" : "negative"} /></div>
              </div>

              <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(300px,370px)_minmax(0,1fr)]">
                <form id="quick-entry" onSubmit={submit} className={`min-w-0 rounded-2xl border border-border bg-card p-4 shadow-[0_8px_28px_hsl(224_27%_16%/0.035)] sm:p-5 ${editing ? "ring-1 ring-primary/20" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="section-label text-primary">{editing ? "Edit activity" : "Quick entry"}</p>
                      <h3 className="mt-1 text-base font-semibold tracking-tight">{editing ? "Correct this entry" : "Log money movement"}</h3>
                    </div>
                    {editing && <button type="button" onClick={resetForm} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Cancel editing"><X className="h-4 w-4" /></button>}
                  </div>

                  <div className="mt-3 grid min-w-0 grid-cols-2 gap-1 rounded-xl bg-secondary/70 p-1 sm:mt-4">
                    {([["buy_in", "Buy-in / rebuy"], ["cash_out", "Cash-out"]] as const).map(([value, label]) => (
                      <button key={value} type="button" onClick={() => setAction(value)} className={`min-h-10 rounded-lg px-2 text-xs font-semibold transition-colors ${action === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_92px] items-end gap-2 sm:mt-4 sm:block">
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-xs font-semibold">Amount</span>
                      <span className="relative block">
                        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm text-muted-foreground">$</span>
                        <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="10.00" required aria-label="Amount" className="h-11 w-full min-w-0 rounded-xl border border-border bg-background pl-8 pr-3 font-mono text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10" />
                      </span>
                    </label>
                    <button type="submit" disabled={!isOpen} className="mb-0 inline-flex h-11 w-[92px] items-center justify-center gap-1 rounded-xl bg-primary px-2 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:hidden">
                      Add entry{isOpen && <Plus className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                  <details className="mt-2.5 rounded-lg sm:hidden">
                    <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-border/70 bg-background px-3 text-[11px] font-medium">
                      <span className="text-muted-foreground">Player</span>
                      <span className="truncate text-right font-semibold">{player || memberName}<span className="ml-1 font-normal text-muted-foreground">· change</span></span>
                    </summary>
                    <select value={player} onChange={(event) => setPlayer(event.target.value)} className="mt-2 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10">
                      <option value="">Myself — Alex Morgan</option>
                      {players.filter((name) => name !== memberName).map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </details>

                  <label className="mt-3.5 hidden sm:block">
                    <span className="mb-1.5 flex items-center justify-between text-xs font-semibold">
                      <span>Player</span><span className="font-normal text-muted-foreground">Optional</span>
                    </span>
                    <select value={player} onChange={(event) => setPlayer(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10">
                      <option value="">Myself — Alex Morgan</option>
                      {players.filter((name) => name !== memberName).map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>

                  <p className="mt-3 hidden text-[11px] leading-5 text-muted-foreground sm:block">Timestamped when saved · logged by <span className="font-medium text-foreground">Alex Morgan</span></p>
                  <button type="submit" disabled={!isOpen} className="mt-4 hidden h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex">
                    {!isOpen ? "Open session to add activity" : editing ? "Save correction" : "Add to ledger"}
                    {isOpen && <Plus className="h-4 w-4" />}
                  </button>
                </form>

                <section className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5" aria-labelledby="recent-ledger-heading">
                  <div className="flex items-end justify-between gap-3 border-b border-border pb-3">
                    <div>
                      <p className="section-label">Recent activity</p>
                      <h3 id="recent-ledger-heading" className="mt-1 text-base font-semibold tracking-tight">Tonight’s ledger</h3>
                    </div>
                    <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
                  </div>

                  {entries.length ? (
                    <div className="divide-y divide-border/70">
                      {[...entries].reverse().map((entry) => (
                        <LedgerRow
                          key={entry.id}
                          entry={entry}
                          editing={editing === entry.id}
                          confirmingDelete={deleteConfirm === entry.id}
                          disabled={!isOpen}
                          onEdit={() => editEntry(entry)}
                          onRequestDelete={() => setDeleteConfirm(entry.id)}
                          onCancelDelete={() => setDeleteConfirm(null)}
                          onDelete={() => {
                            setEntries((current) => current.filter((item) => item.id !== entry.id));
                            setDeleteConfirm(null);
                            if (editing === entry.id) resetForm();
                            setSyncMessage("Synced just now");
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-h-40 flex-col items-center justify-center px-4 py-8 text-center">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><CircleDollarSign className="h-5 w-5" /></span>
                      <p className="mt-3 text-sm font-semibold">No activity yet</p>
                      <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">The first buy-in or cash-out will appear here as soon as it’s logged.</p>
                    </div>
                  )}
                </section>
              </div>

              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                <PlayerTotals entries={entries} />
                <section className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="section-label">Your sessions</p>
                      <h3 className="mt-1 text-base font-semibold tracking-tight">Ledger history</h3>
                    </div>
                    <button onClick={() => setHistory((current) => !current)} aria-expanded={history} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold transition-colors hover:bg-secondary">
                      {history ? "Hide history" : "Past ledgers"}<ChevronDown className={`h-4 w-4 transition-transform ${history ? "rotate-180" : ""}`} />
                    </button>
                  </div>
                  {history && (
                    <div className="mt-4 space-y-2.5 border-t border-border pt-3">
                      {pastLedgers.map((past) => (
                        <details key={past.date} className="rounded-xl border border-border/70 bg-background">
                          <summary className="flex cursor-pointer list-none flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold">{past.date}</span>
                              <span className="mt-1 block text-[11px] text-muted-foreground">{past.entries} entries · closed 10:21 PM</span>
                            </span>
                            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                              <span className="font-mono">In {money(past.in)}</span>
                              <span className="font-mono">Out {money(past.out)}</span>
                              <span className={`rounded-md px-2 py-1 font-semibold ${past.balanced ? "bg-chart-1/10 text-chart-1" : "bg-amber-500/10 text-amber-700"}`}>{past.balanced ? "Balanced" : "Unbalanced"}</span>
                            </span>
                          </summary>
                          <div className="border-t border-border/70 px-3 py-2.5 text-[11px] text-muted-foreground">This archived ledger is available for reference. Its entries are not part of tonight’s totals.</div>
                        </details>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <div className="flex items-center justify-center gap-1.5 pb-1 text-[10px] text-muted-foreground sm:hidden">
                <span className="h-1.5 w-1.5 rounded-full bg-chart-1" />{syncMessage}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function Metric({ label, compactLabel, value, detail, tone }: { label: string; compactLabel?: string; value: string; detail: string; tone: "positive" | "negative" | "neutral" }) {
  const valueColor = tone === "positive" ? "text-chart-1" : tone === "negative" ? "text-destructive" : "text-foreground";
  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card px-3 py-2.5 sm:p-4">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground sm:text-[11px]"><span className="sm:hidden">{compactLabel ?? label}</span><span className="hidden sm:inline">{label}</span></p>
      <p className={`mt-1.5 truncate font-mono text-[18px] font-semibold tracking-[-0.045em] sm:mt-2 sm:text-2xl ${valueColor}`}>{value}</p>
      <p className="mt-1 hidden truncate text-[10px] text-muted-foreground sm:block sm:text-[11px]">{detail}</p>
    </article>
  );
}

function LedgerRow({
  entry,
  editing,
  confirmingDelete,
  disabled,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onDelete,
}: {
  entry: Entry;
  editing: boolean;
  confirmingDelete: boolean;
  disabled: boolean;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const isBuy = entry.action === "buy_in";
  return (
    <div className={`min-w-0 py-3.5 ${editing ? "bg-primary/[0.035]" : ""}`}>
      <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isBuy ? "bg-chart-1/12 text-chart-1" : "bg-accent/20 text-accent-foreground"}`}>
          {isBuy ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-xs font-semibold sm:text-sm">{isBuy ? "Buy-in / rebuy" : "Cash-out"}</p>
            <span className="max-w-full truncate rounded-md bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">{entry.player}</span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">{entry.time} <span className="mx-0.5">·</span> logged by Alex Morgan</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`font-mono text-xs font-semibold sm:text-sm ${isBuy ? "text-chart-1" : "text-foreground"}`}>{isBuy ? "+" : "−"}{money(entry.amount)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button onClick={onEdit} disabled={disabled} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40" aria-label={`Edit ${isBuy ? "buy-in" : "cash-out"} for ${entry.player}`}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={onRequestDelete} disabled={disabled} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40" aria-label={`Delete entry for ${entry.player}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {confirmingDelete && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/[0.04] px-3 py-2">
          <p className="text-[11px] font-medium">Remove this ledger entry?</p>
          <div className="flex gap-1.5">
            <button onClick={onCancelDelete} className="min-h-8 rounded-md px-2.5 text-[10px] font-semibold text-muted-foreground hover:bg-secondary">Keep</button>
            <button onClick={onDelete} className="min-h-8 rounded-md bg-destructive px-2.5 text-[10px] font-semibold text-destructive-foreground">Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerTotals({ entries }: { entries: Entry[] }) {
  const names = [...new Set(entries.map((entry) => entry.player))];
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="section-label">By player</p>
          <h3 className="mt-1 text-base font-semibold tracking-tight">Current session totals</h3>
        </div>
        <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      {names.length ? (
        <div className="mt-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 border-b border-border/70 py-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground sm:gap-x-5 sm:text-[10px]">
            <span>Player</span><span className="text-right">Buy-ins</span><span className="text-right">Cash-outs</span>
          </div>
          {names.map((name) => {
            const playerEntries = entries.filter((entry) => entry.player === name);
            const buys = playerEntries.filter((entry) => entry.action === "buy_in").reduce((sum, entry) => sum + entry.amount, 0);
            const cashOuts = playerEntries.filter((entry) => entry.action === "cash_out").reduce((sum, entry) => sum + entry.amount, 0);
            return (
              <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 border-b border-border/60 py-3 text-xs last:border-b-0 sm:gap-x-5">
                <span className="flex min-w-0 items-center gap-2 font-semibold">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">{name.split(" ").map((part) => part[0]).join("")}</span>
                  <span className="truncate">{name}</span>
                </span>
                <span className="text-right font-mono">{money(buys)}</span>
                <span className="text-right font-mono">{money(cashOuts)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-28 items-center gap-3 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground"><Users className="h-4 w-4" /></span>
          <p className="text-xs leading-5 text-muted-foreground">Player totals will appear after the first activity is recorded.</p>
        </div>
      )}
    </section>
  );
}