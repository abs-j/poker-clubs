import "./_group.css";
import { useMemo, useState } from "react";
import {
  Activity, ArrowDown, ArrowUp, CalendarDays, Check, ChevronDown, CircleDollarSign,
  LayoutDashboard, LogOut, Menu, MoreHorizontal, Moon, Pencil, Plus, Sun, Trash2, Users, X,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Action = "buy_in" | "cash_out";
type Entry = { id: string; action: Action; amount: number; player: string; time: string };
type Past = { date: string; entries: number; in: number; out: number; balanced: boolean };

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

export function Current() {
  const memberName = "Alex Morgan";
  const players = ["Alex Morgan", "Jordan Lee", "Maya Chen", "Sam Patel"];
  const [dark, setDark] = useState(false);
  const [view, setView] = useState("live");
  const [entries, setEntries] = useState(initialEntries);
  const [action, setAction] = useState<Action>("buy_in");
  const [amount, setAmount] = useState("");
  const [player, setPlayer] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [started, setStarted] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const totals = useMemo(() => ({
    buy: entries.filter((e) => e.action === "buy_in").reduce((n, e) => n + e.amount, 0),
    out: entries.filter((e) => e.action === "cash_out").reduce((n, e) => n + e.amount, 0),
  }), [entries]);
  const difference = totals.out - totals.buy;
  const reset = () => { setAmount(""); setPlayer(""); setEditing(null); };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    const next = { id: editing ?? `e${Date.now()}`, action, amount: value, player: player || memberName, time: "Just now" };
    setEntries((old) => editing ? old.map((entry) => entry.id === editing ? next : entry) : [...old, next]);
    reset();
  };
  const edit = (entry: Entry) => { setEditing(entry.id); setAction(entry.action); setAmount(entry.amount.toFixed(2)); setPlayer(entry.player === memberName ? "" : entry.player); };

  return (
    <div className={`${dark ? "dark" : ""} live-ledger-flow min-h-screen bg-background text-foreground`}>
      <main className="min-h-screen"><div className="mx-auto max-w-[1450px] px-4 py-4 sm:px-7 lg:px-10 lg:py-6">
        <header className="rise-in border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_3px_0_hsl(245_76%_42%)]" aria-label="Open live ledger"><CalendarDays className="h-5 w-5" /></button>
              <div className="flex min-w-0 items-baseline gap-2"><h1 className="min-w-0 truncate text-lg font-semibold tracking-[-0.03em] sm:text-xl">Poker Session Log & Months</h1><span className="hidden shrink-0 text-[10px] font-medium text-muted-foreground sm:inline">By Abhay Jhade</span></div>
            </div>
            <div className="hidden flex-wrap items-center gap-2 lg:flex">
              <span className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">{memberName}</span>
              <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold"><LogOut className="h-4 w-4" />Sign out</button>
              <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold"><Activity className="h-4 w-4" />Refresh</button>
              <button onClick={() => setDark((v) => !v)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground" aria-label="Toggle dark mode">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
            </div>
            <div className="lg:hidden"><DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}><DropdownMenuTrigger asChild><button className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card" aria-label="Open dashboard menu"><Menu className="h-5 w-5" /></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64"><DropdownMenuLabel className="text-xs text-muted-foreground">Signed in as {memberName}</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuLabel className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Go to</DropdownMenuLabel><DropdownMenuItem onSelect={() => setView("overview")}><LayoutDashboard className="h-4 w-4" />Overview</DropdownMenuItem><DropdownMenuItem onSelect={() => setView("live")} className={view === "live" ? "bg-primary/10 font-semibold text-primary" : ""}><Activity className="h-4 w-4" />Live ledger</DropdownMenuItem><DropdownMenuItem onSelect={() => setDark((v) => !v)}>{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}Switch to {dark ? "light" : "dark"} mode</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive"><LogOut className="h-4 w-4" />Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
          </div>
          <nav className="mt-4 hidden gap-1 overflow-x-auto pb-2 lg:flex">{[["overview", "Overview", LayoutDashboard], ["live", "Live ledger", Activity], ["players", "Players", Users]].map(([id, label, Icon]) => <button key={id as string} onClick={() => setView(id as string)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${view === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"}`}><Icon className="h-3.5 w-3.5" />{label as string}</button>)}</nav>
        </header>
        {view !== "live" ? <div className="py-12 text-center text-muted-foreground"><p className="section-label text-primary">Dashboard section</p><h2 className="mt-2 text-2xl font-semibold">{view === "overview" ? "Overview" : "Players"}</h2><p className="mt-2 text-sm">Choose Live ledger to return to tonight’s activity.</p></div> : <LiveLedger entries={entries} totals={totals} difference={difference} started={started} setStarted={setStarted} action={action} setAction={setAction} amount={amount} setAmount={setAmount} player={player} setPlayer={setPlayer} editing={editing} reset={reset} submit={submit} edit={edit} setEntries={setEntries} history={history} setHistory={setHistory} />}
      </div></main>
    </div>
  );
}

function LiveLedger({ entries, totals, difference, started, setStarted, action, setAction, amount, setAmount, player, setPlayer, editing, reset, submit, edit, setEntries, history, setHistory }: { entries: Entry[]; totals: { buy: number; out: number }; difference: number; started: boolean; setStarted: (v: boolean) => void; action: Action; setAction: (v: Action) => void; amount: string; setAmount: (v: string) => void; player: string; setPlayer: (v: string) => void; editing: string | null; reset: () => void; submit: (e: React.FormEvent) => void; edit: (e: Entry) => void; setEntries: React.Dispatch<React.SetStateAction<Entry[]>>; history: boolean; setHistory: (v: boolean) => void }) {
  return <section className="space-y-5" data-testid="section-live-ledger">
    <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="section-label text-primary">Live session ledger</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Track tonight as it happens</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Log buy-ins and cash-outs, check the balance, and keep a separate record of each session.</p></div><span className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-chart-1/25 bg-chart-1/10 px-2.5 py-1.5 text-[10px] font-semibold text-chart-1"><span className="h-1.5 w-1.5 rounded-full bg-chart-1" />Synced · Today</span></div>
    <div className={`flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between ${started ? "border-primary/25 bg-primary/5" : "border-chart-1/30 bg-chart-1/5"}`}><div><p className="section-label text-primary">{started ? "Session in progress" : "Ready for a new session"}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{started ? "Started by Alex Morgan · 7:38 PM. Activity is being recorded in this ledger." : "Start a ledger when the game begins."}</p></div>{started ? <button onClick={() => setStarted(false)} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-destructive/35 bg-destructive/10 px-5 text-sm font-semibold text-destructive"><Check className="h-4 w-4" />End session</button> : <button onClick={() => setStarted(true)} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"><Activity className="h-4 w-4" />Start session</button>}</div>
    <div className="grid gap-5 xl:grid-cols-[minmax(280px,360px)_1fr]">
      <div className="order-1 xl:order-2"><form onSubmit={submit} className="soft-shadow rounded-2xl border border-border bg-card p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="section-label text-primary">{editing ? "Edit activity" : "Add activity"}</p><h2 className="mt-1 text-lg font-semibold">{editing ? "Correct an entry" : "Log money movement"}</h2></div>{editing && <button type="button" onClick={reset} className="rounded-lg p-1.5 text-muted-foreground"><X className="h-4 w-4" /></button>}</div><div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-secondary/60 p-1">{([["buy_in", "Buy-in / rebuy"], ["cash_out", "Cash-out"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setAction(value)} className={`rounded-lg px-3 py-2.5 text-xs font-semibold ${action === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>{label}</button>)}</div><label className="mt-4 block"><span className="mb-2 block text-xs font-semibold">Amount</span><div className="relative"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm text-muted-foreground">$</span><input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0.01" step="0.01" placeholder="10.00" required className="h-11 w-full rounded-xl border border-border bg-background pl-8 pr-3 font-mono text-sm outline-none focus:border-primary" /></div></label><label className="mt-4 block"><span className="mb-2 flex justify-between text-xs font-semibold"><span>Change player</span><span className="font-normal text-muted-foreground">Optional</span></span><select value={player} onChange={(e) => setPlayer(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"><option value="">Myself — Alex Morgan</option>{["Jordan Lee", "Maya Chen", "Sam Patel"].map((p) => <option key={p}>{p}</option>)}</select></label><p className="mt-4 hidden text-xs leading-5 text-muted-foreground sm:block">Entries are timestamped when saved. The selected player receives the attribution, while <strong className="text-foreground">Alex Morgan</strong> remains the audit actor.</p><button type="submit" disabled={!started} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60">{!started ? "Start session to add activity" : editing ? "Save correction" : "Add to ledger"}<Plus className="h-4 w-4" /></button></form></div>
      <div className="order-2 rounded-2xl border border-border bg-card p-5 sm:p-6 xl:order-3"><div className="border-b border-border pb-4"><p className="section-label">Ledger</p><h2 className="mt-1 text-lg font-semibold">Buy-ins and cash-outs</h2></div>{entries.length ? <div className="mt-2 divide-y divide-border/70">{entries.map((entry) => <LedgerRow key={entry.id} entry={entry} edit={() => edit(entry)} remove={() => setEntries((old) => old.filter((e) => e.id !== entry.id))} disabled={!started} />)}</div> : <div className="flex min-h-56 flex-col items-center justify-center text-center"><CircleDollarSign className="h-5 w-5 text-primary" /><p className="mt-4 text-sm font-semibold">No activity yet</p></div>}</div>
      <div className="order-3 space-y-5 xl:order-1 xl:col-span-2"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Buy-ins" value={money(totals.buy)} detail="Total added" tone="positive" /><Metric label="Cash-outs" value={money(totals.out)} detail="Total returned" tone="neutral" /><Metric label="Difference" value={`${difference >= 0 ? "+" : "−"}${money(Math.abs(difference))}`} detail="Cash-outs minus buy-ins" tone={difference === 0 ? "positive" : "negative"} /><Metric label="Balance" value={entries.length === 0 ? "No entries" : difference === 0 ? "Balanced" : "Unbalanced"} detail="Updates as entries are added" tone={difference === 0 ? "positive" : "negative"} /></div><PlayerTotals entries={entries} /></div>
    </div>
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="section-label">Ledger history</p><h2 className="mt-1 text-lg font-semibold">Past sessions</h2></div><button onClick={() => setHistory(!history)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-xs font-semibold">{history ? "Hide history" : "View past ledgers"}<ChevronDown className={`h-4 w-4 ${history ? "rotate-180" : ""}`} /></button></div>{history && <div className="mt-4 space-y-3 border-t border-border pt-4">{pastLedgers.map((past) => <details key={past.date} className="rounded-xl border border-border/70 bg-background"><summary className="flex cursor-pointer flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">{past.date}</p><p className="mt-1 text-xs text-muted-foreground">{past.entries} entries · closed 10:21 PM</p></div><div className="flex gap-3 text-xs"><span className="font-mono">In {money(past.in)}</span><span className="font-mono">Out {money(past.out)}</span><span className={`rounded-md px-2 py-1 font-semibold ${past.balanced ? "bg-chart-1/10 text-chart-1" : "bg-amber-500/10 text-amber-700"}`}>{past.balanced ? "Balanced" : "Unbalanced"}</span></div></summary></details>)}</div>}</section>
  </section>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "positive" | "negative" | "neutral" }) { return <article className="rounded-2xl border border-border bg-card p-5 soft-shadow"><p className="section-label">{label}</p><p className={`mt-3 font-mono text-2xl font-semibold tracking-tight ${tone === "positive" ? "text-chart-1" : tone === "negative" ? "text-destructive" : "text-foreground"}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></article>; }
function LedgerRow({ entry, edit, remove, disabled }: { entry: Entry; edit: () => void; remove: () => void; disabled: boolean }) { const buy = entry.action === "buy_in"; return <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl ${buy ? "bg-chart-1/15 text-chart-1" : "bg-accent/20 text-accent-foreground"}`}>{buy ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}</span><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{buy ? "Buy-in / rebuy" : "Cash-out"}</p><span className="rounded-md bg-secondary px-1.5 py-1 text-[10px] font-semibold text-muted-foreground">{entry.player}</span></div><p className="mt-1 text-xs text-muted-foreground">{entry.time} · logged by Alex Morgan</p></div></div><div className="flex items-center justify-between gap-3 pl-12 sm:justify-end sm:pl-0"><p className={`font-mono text-sm font-semibold ${buy ? "text-chart-1" : ""}`}>{buy ? "+" : "−"}{money(entry.amount)}</p><div className="flex gap-1"><button onClick={edit} disabled={disabled} className="rounded-lg p-2 text-muted-foreground"><Pencil className="h-3.5 w-3.5" /></button><button onClick={remove} disabled={disabled} className="rounded-lg p-2 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></div></div></div>; }
function PlayerTotals({ entries }: { entries: Entry[] }) { const names = [...new Set(entries.map((e) => e.player))]; return <section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><div className="border-b border-border pb-4"><p className="section-label">By player</p><h2 className="mt-1 text-lg font-semibold">Player totals · current session</h2></div>{names.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[360px] text-left text-sm"><thead><tr className="text-[10px] uppercase tracking-wide text-muted-foreground"><th className="py-2 pr-4">Player</th><th className="px-3 py-2 text-right">Buy-ins</th><th className="py-2 pl-3 text-right">Cash-outs</th></tr></thead><tbody className="divide-y divide-border/70">{names.map((name) => <tr key={name}><th className="py-3 pr-4 font-semibold">{name}</th><td className="px-3 py-3 text-right font-mono">{money(entries.filter((e) => e.player === name && e.action === "buy_in").reduce((n, e) => n + e.amount, 0))}</td><td className="py-3 pl-3 text-right font-mono">{money(entries.filter((e) => e.player === name && e.action === "cash_out").reduce((n, e) => n + e.amount, 0))}</td></tr>)}</tbody></table></div> : <p className="pt-4 text-sm text-muted-foreground">Player totals will appear after the first active entry.</p>}</section>; }