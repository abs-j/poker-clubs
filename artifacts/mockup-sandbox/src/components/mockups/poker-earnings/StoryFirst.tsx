import "./_group.css";
import "./StoryFirst.css";
import { useMemo, useState } from "react";
import { CalendarDays, ChevronDown, Filter, Spade, X } from "lucide-react";

type Scope = "all" | "cash" | "tournaments";
type Result = { name: string; net: number; unmatched?: boolean };
type Standing = { name: string; net: number };

const cashStandings: Standing[] = [
  { name: "Jules", net: 372.43 }, { name: "Arlo", net: 191.80 }, { name: "Remy", net: 149.07 },
  { name: "Sasha", net: 135.05 }, { name: "Ada", net: 116.26 },
];
const combinedStandings: Standing[] = [
  { name: "Jules", net: 364.93 }, { name: "Ada", net: 265.01 }, { name: "Remy", net: 241.79 },
  { name: "Arlo", net: 184.30 }, { name: "Sasha", net: 115.05 },
];
const tournamentResults: Result[] = [
  { name: "Ada", net: 148.75 }, { name: "Rhys", net: 48.53 }, { name: "Remy", net: 92.72 },
  { name: "Ari K", net: 0 }, { name: "Jules", net: -7.50 }, { name: "Arlo", net: -7.50 },
  { name: "Harper", net: -10 }, { name: "Theo", net: -10, unmatched: true }, { name: "Avery", net: -15 },
  { name: "Ansel", net: -17.50, unmatched: true }, { name: "Silas", net: -17.50 },
  { name: "Sloane", net: -20 }, { name: "Kai", net: -20 }, { name: "Vic", net: -20 },
  { name: "Ari R", net: -20 }, { name: "Sasha", net: -20 }, { name: "Milo", net: -20 },
  { name: "Finn Ch", net: -20 }, { name: "Vera", net: -20 }, { name: "Violet", net: -20 },
  { name: "Sage", net: -25 },
].sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
const monthlyCash = [
  { label: "Mar", net: 91.90 }, { label: "Apr", net: -59.05 }, { label: "May", net: 0.10 },
  { label: "Jun", net: -27.15 }, { label: "Jul", net: 39.35 }, { label: "Aug", net: 76.55 },
  { label: "Sep", net: -13.00 }, { label: "Oct", net: 6.20 },
];
const monthOptions = [
  ["ALL", "All dated results"], ["2026-03", "March 2026"], ["2026-04", "April 2026"],
  ["2026-05", "May 2026"], ["2026-06", "June 2026"], ["2026-07", "July 2026"],
  ["2026-08", "August 2026"], ["2026-09", "September 2026"], ["2026-10", "October 2026"],
];
const playerOptions = [...new Set([...combinedStandings.map((row) => row.name), ...tournamentResults.map((row) => row.name)])].sort((a, b) => a.localeCompare(b));

const fmt = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmt(value)}`;
const monthName = (key: string) => monthOptions.find(([id]) => id === key)?.[1] ?? key;

export function StoryFirst() {
  const [scope, setScope] = useState<Scope>("all");
  const [refinementsOpen, setRefinementsOpen] = useState(false);
  const [period, setPeriod] = useState("ALL");
  const [player, setPlayer] = useState("ALL");
  const standings = scope === "cash" ? cashStandings : scope === "tournaments"
    ? tournamentResults.slice(0, 5).map(({ name, net }) => ({ name, net }))
    : combinedStandings;
  const memberTotal = scope === "cash" ? 116.26 : scope === "tournaments" ? 148.75 : 265.01;
  const memberRank = scope === "cash" ? "#5 in cash" : scope === "tournaments" ? "#1 in this snapshot" : "#2 combined";
  const scopeLabel = scope === "cash" ? "Cash games" : scope === "tournaments" ? "Tournaments" : "All earnings";
  const activeFilters = [
    ...(period !== "ALL" ? [{ id: "period", label: `Dated results / month · ${monthName(period)}`, clear: () => setPeriod("ALL") }] : []),
    ...(player !== "ALL" ? [{ id: "player", label: `Standings player · ${player}`, clear: () => setPlayer("ALL") }] : []),
  ];
  const datedTrail = useMemo(() => {
    let running = 0;
    const points = monthlyCash.map((item, index) => {
      running += item.net;
      return { label: item.label, net: item.net, running, month: `2026-${String(index + 3).padStart(2, "0")}` };
    });
    if (period !== "ALL") {
      const monthPoint = points.find((point) => point.month === period);
      if (!monthPoint) return [];
      const monthOnly = [{ ...monthPoint, running: monthPoint.net }];
      if (scope === "all" && period === "2026-10") {
        monthOnly.push({ label: "4 Oct event", net: 148.75, running: monthPoint.net + 148.75, month: "2026-10-event" });
      }
      return monthOnly;
    }
    if (scope !== "cash") points.push({ label: "4 Oct event", net: 148.75, running: 263.65, month: "2026-10-event" });
    return points;
  }, [scope, period]);
  const visibleStandings = standings.filter((row) => player === "ALL" || row.name === player);
  const visibleResults = tournamentResults.filter((row) => (player === "ALL" || row.name === player) && (period === "ALL" || period === "2026-10"));
  const shouldShowEvent = scope !== "cash" && (period === "ALL" || period === "2026-10");
  const visibleTrendEnd = datedTrail[datedTrail.length - 1]?.running ?? 0;

  return (
    <div className="story-first">
      <main className="sf-wrap">
        <header className="sf-topbar">
          <div className="sf-brand">
            <div className="sf-mark" aria-hidden="true"><Spade size={19} strokeWidth={1.8} /></div>
            <div><div className="sf-brand-title">Poker Club</div><div className="sf-brand-sub">Members · earnings</div></div>
          </div>
          <div className="sf-member" aria-label="Signed in as Ada">
            <span className="sf-avatar" aria-hidden="true">A</span><span>Ada</span><ChevronDown size={13} aria-hidden="true" />
          </div>
        </header>

        <section className="sf-intro" aria-labelledby="sf-title">
          <div><p className="sf-kicker">Your table, your story</p><h1 id="sf-title">The numbers<br className="hidden sm:block" /> <em>behind your game.</em></h1></div>
          <div className="sf-date-tag"><CalendarDays size={14} aria-hidden="true" /> Through 4 October 2026</div>
        </section>

        <nav className="sf-scopes" aria-label="Earnings scope">
          {([{ id: "all", label: "All earnings" }, { id: "cash", label: "Cash games" }, { id: "tournaments", label: "Tournaments" }] as const).map((item) => (
            <button key={item.id} type="button" className="sf-scope" aria-pressed={scope === item.id} onClick={() => { setScope(item.id); setPeriod("ALL"); }}>
              {item.label}
            </button>
          ))}
        </nav>

        <section className="sf-story" aria-label={`${scopeLabel} personal summary`}>
          <div className="sf-hero-card">
            <p className="sf-label">{scope === "tournaments" ? "Your event net · Tournaments" : `Your all-time net · ${scopeLabel}`}</p>
            <div className="sf-money">{signed(memberTotal)}</div>
            <div className="sf-hero-bottom">
              <span className="sf-rank-pill">{memberRank}</span>
              <span>{scope === "cash" ? "Cash Player Totals · all-time" : scope === "tournaments" ? "4 Oct event · Net Profit only" : "Cash all-time + tournament net profit"}</span>
            </div>
          </div>
          <aside className="sf-side-card">
            <div><p className="sf-label">A useful distinction</p><h2>{scope === "tournaments" ? "One snapshot. No season curve." : "Your dated trail, honestly told."}</h2></div>
            <div className="sf-split">
              {scope !== "tournaments" ? <><div><span>Dated cash sessions</span><strong>+{fmt(114.90)}</strong></div><div><span>Undated adjustment</span><strong>+{fmt(1.36)}</strong></div></> : <><div><span>Event</span><strong>4 Oct</strong></div><div><span>Field</span><strong>21 players</strong></div></>}
            </div>
            <p className="sf-note">{scope === "tournaments" ? "Tournament earnings use Net Profit only. No return amount is added." : "Cash trend covers 46 dated sessions (13 Mar–2 Oct). The +$1.36 accounting adjustment has no date; it stays out of the timeline."}</p>
          </aside>
        </section>

        <section aria-label="Refine dashboard">
          <div className="sf-filterbar">
            <div className="sf-filter-heading"><Filter size={14} aria-hidden="true" /><span>Refine your view</span>{activeFilters.length > 0 && <span className="sf-count">{activeFilters.length} active</span>}</div>
            <button className="sf-refine" type="button" aria-expanded={refinementsOpen} aria-controls="sf-filter-panel" onClick={() => setRefinementsOpen((open) => !open)}>
              {refinementsOpen ? "Hide filters" : "Filters"}<ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
          <p className="sf-filter-explainer">Period refines dated results only; your all-time headline and standings stay fixed. Player refines standings and event rows; the trend remains Ada’s.</p>
          {activeFilters.length > 0 && <div className="sf-active-filters" aria-label="Selected filters">
            {activeFilters.map((item) => <span className="sf-chip" key={item.id}>{item.label}<button type="button" aria-label={`Remove ${item.label} filter`} onClick={item.clear}><X size={12} /></button></span>)}
            <button className="sf-clear" type="button" onClick={() => { setPeriod("ALL"); setPlayer("ALL"); }}>Clear all</button>
          </div>}
          {refinementsOpen && <div className="sf-filter-panel" id="sf-filter-panel">
            <div className="sf-field"><label htmlFor="sf-period">Dated results / month</label><select id="sf-period" value={period} onChange={(event) => setPeriod(event.target.value)}>{monthOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="sf-field"><label htmlFor="sf-player">Standings player</label><select id="sf-player" value={player} onChange={(event) => setPlayer(event.target.value)}><option value="ALL">All players</option>{playerOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></div>
          </div>}
        </section>

        <section className="sf-content">
          <article className="sf-panel" aria-labelledby="sf-standing-title">
            <div className="sf-panel-head"><div><p className="sf-label">{scope === "tournaments" ? "Event results" : "Club standings"}</p><h2 id="sf-standing-title">{scope === "cash" ? "Cash · all-time" : scope === "tournaments" ? "Tournament · 4 October" : "Combined · all-time"}</h2><p className="sf-panel-sub">{scope === "cash" ? "Authoritative Player Totals; includes undated accounting rows." : scope === "tournaments" ? "Top net results, ordered by Net Profit; no finishing places implied." : "Cash all-time totals plus the 4 Oct tournament Net Profit."}</p></div><span className="sf-count">{player === "ALL" ? "Top 5" : "1 player"}</span></div>
            <div className="sf-ranking">
              {visibleStandings.length ? visibleStandings.map((row) => {
                const rank = standings.findIndex((entry) => entry.name === row.name) + 1;
                return <div className={`sf-rank-row ${row.name === "Ada" ? "is-member" : ""}`} key={row.name}>
                  <span className="sf-rank-num">{scope === "tournaments" ? "·" : rank}</span><span className="sf-rank-name">{row.name}{row.name === "Ada" && <span className="sf-you">you</span>}</span><span className={`sf-rank-value ${row.net >= 0 ? "sf-positive" : "sf-negative"}`}>{signed(row.net)}</span>
                </div>;
              }) : <div className="sf-trend-empty"><div><strong>{player} isn’t in this standings list</strong><p>Standings show the visible top five for this scope. See the dated tournament result below when available.</p></div></div>}
            </div>
          </article>

          <article className="sf-panel" aria-labelledby="sf-trend-title">
            <div className="sf-panel-head"><div><p className="sf-label">Dated results over time</p><h2 id="sf-trend-title">{scope === "tournaments" ? "Ada’s event net" : "Ada’s dated net"}</h2><p className="sf-panel-sub">{scope === "tournaments" ? "One 4 Oct snapshot, not a season-long curve." : period === "ALL" ? "Ada’s dated monthly cash net, then the 4 Oct tournament result." : scope === "all" && period === "2026-10" ? "October starts at zero: cash net, then the single event net." : "Ada’s cash net for this month, rebased to zero."}</p></div></div>
            {scope === "tournaments" && period !== "ALL" && period !== "2026-10" ? <div className="sf-trend-empty"><div><strong>No tournament event in this month</strong><p>The only tournament snapshot is 4 October 2026. Select October 2026 to view its Net Profit.</p></div></div> : scope === "tournaments" ? <div className="sf-trend-empty"><div><strong>4 October 2026 · {signed(148.75)}</strong><p>One tournament snapshot with 21 players. No additional tournament dates are available to plot.</p></div></div> : (
              <div className="sf-chart-wrap">
                <TrendChart points={datedTrail} scope={scope} />
                <div className="sf-chart-labels"><span>{period === "ALL" ? "13 Mar 2026" : monthName(period)}</span><span>{period === "ALL" ? (scope === "cash" ? "2 Oct 2026" : "4 Oct 2026") : scope === "all" && period === "2026-10" ? "4 Oct event" : "Cash month net"}</span></div>
              </div>
            )}
            {scope !== "tournaments" && <div className="sf-trend-end"><span>{period === "ALL" ? (scope === "cash" ? "Ada’s dated cash trail · 46 sessions" : "Ada’s dated combined trail · through event") : `Ada · ${monthName(period)} dated net`}</span><strong>{signed(period === "ALL" ? (scope === "cash" ? 114.90 : 263.65) : visibleTrendEnd)}</strong></div>}
            {scope === "tournaments" && period === "2026-10" && <div className="sf-event">
              <div className="sf-event-top"><span className="sf-event-date">04 Oct 2026</span><span className="sf-event-tag">Snapshot · 21 players</span></div>
              <h3>Poker Club tournament</h3><p>One dated event in the source. Tournament Net Profit only; invested $370, returned $370.</p>
              <div className="sf-event-net"><span>Field net total</span><strong>$0.00</strong></div>
            </div>}
          </article>
        </section>

        {scope !== "cash" && <section className="sf-panel sf-results" aria-labelledby="sf-results-title">
          <div className="sf-results-head"><div><p className="sf-label">Dated result</p><h2 id="sf-results-title">Tournament net · 4 October 2026</h2><p>Every player shown by Net Profit. Ansel and Theo are tournament-only identities.</p></div><span className="sf-count">{visibleResults.length} of 21 players</span></div>
          {shouldShowEvent ? <div className="sf-table-scroll"><table className="sf-table">
            <thead><tr><th scope="col">Player</th><th scope="col">Tournament net</th></tr></thead>
            <tbody>{visibleResults.map((row) => <tr key={row.name} className={row.name === "Ada" ? "member-row" : ""}>
              <td><span className="sf-table-name">{row.name}</span>{row.name === "Ada" && <span className="sf-you">you</span>}{row.unmatched && <span className="sf-unmatched" title="No exact identity in Player Totals">Tournament-only · unmatched</span>}</td>
              <td className={row.net > 0 ? "sf-positive" : row.net < 0 ? "sf-negative" : "sf-zero"}>{signed(row.net)}</td>
            </tr>)}</tbody>
          </table></div> : <div className="sf-trend-empty"><div><strong>No tournament event in this period</strong><p>The only tournament snapshot is dated 4 October 2026. No other tournament dates are available.</p></div></div>}
        </section>}

        {scope === "cash" && <section className="sf-panel sf-results" aria-labelledby="sf-cash-month-title">
          <div className="sf-results-head"><div><p className="sf-label">Cash · dated trail</p><h2 id="sf-cash-month-title">Monthly net results</h2><p>46 dated sessions from 13 March to 2 October 2026. All-time standings remain separate.</p></div><span className="sf-count">{period === "ALL" ? "8 months" : "1 month"}</span></div>
          <div className="sf-table-scroll"><table className="sf-table"><thead><tr><th scope="col">Month</th><th scope="col">Dated cash net</th></tr></thead><tbody>
            {monthlyCash.filter((item, index) => period === "ALL" || `2026-${String(index + 3).padStart(2, "0")}` === period).map((item) => <tr key={item.label}><td><span className="sf-table-name">{item.label} 2026</span></td><td className={item.net >= 0 ? "sf-positive" : "sf-negative"}>{signed(item.net)}</td></tr>)}
          </tbody></table></div>
        </section>}

        <footer className="sf-foot">All values AUD. All-time cash totals include non-date accounting rows; dated charts include dated results only. Tournament results use Net Profit, never Total Return.</footer>
      </main>
    </div>
  );
}

function TrendChart({ points, scope }: { points: Array<{ label: string; net: number; running: number; month: string }>; scope: Scope }) {
  if (points.length === 0) return <div className="sf-trend-empty"><div><strong>No dated results for this selection</strong><p>Choose another period to see recorded results.</p></div></div>;
  const width = 520;
  const height = 166;
  const paddingX = 18;
  const paddingY = 18;
  const values = points.map((point) => point.running);
  const min = Math.min(0, ...values) - 10;
  const max = Math.max(...values, 10) + 10;
  const x = (index: number) => points.length === 1 ? width / 2 : paddingX + (index / (points.length - 1)) * (width - paddingX * 2);
  const y = (value: number) => height - paddingY - ((value - min) / (max - min)) * (height - paddingY * 2);
  const polyline = points.map((point, index) => `${x(index)},${y(point.running)}`).join(" ");
  const zeroY = y(0);
  return <svg className="sf-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Ada’s dated ${scope === "all" ? "combined" : scope} net; visible results end at ${signed(points[points.length - 1].running)}.`}>
    <line x1={paddingX} x2={width - paddingX} y1={zeroY} y2={zeroY} stroke="#dbe4db" strokeDasharray="4 5" />
    <text x={paddingX} y={Math.max(11, zeroY - 5)} fill="#78877f" fontSize="9" fontFamily="DM Mono, monospace">$0</text>
    {points.length > 1 && <polyline points={polyline} fill="none" stroke="#287453" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
    {points.length > 1 && <polygon points={`${x(0)},${zeroY} ${polyline} ${x(points.length - 1)},${zeroY}`} fill="rgba(40,116,83,.09)" />}
    {points.map((point, index) => <g key={`${point.month}-${point.label}`}><circle cx={x(index)} cy={y(point.running)} r={index === points.length - 1 ? 5 : 3.5} fill={index === points.length - 1 ? "#d8a640" : "#287453"} stroke="#fffefa" strokeWidth="2"><title>{point.label}: {signed(point.net)} · running {signed(point.running)}</title></circle></g>)}
    <text x={width - paddingX} y={Math.max(12, y(points[points.length - 1].running) - 10)} textAnchor="end" fill="#205e46" fontSize="10" fontWeight="600" fontFamily="DM Mono, monospace">{signed(points[points.length - 1].running)}</text>
  </svg>;
}
