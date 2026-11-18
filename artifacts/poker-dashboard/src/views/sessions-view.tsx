import { useMemo, type ReactNode } from "react";
import { type PerformanceScope, type DashboardSession as Session } from "@/lib/earnings-analytics";
import { ArrowDown, ChevronDown, Trophy } from "lucide-react";
import { plural } from "@/lib/utils";
import { ShareButton } from "@/components/share-button";
import { RecapButton } from "@/components/recap-button";
import { buildCashRecap } from "@/lib/recaps";
import { buildNightCardModel } from "@/lib/share-card";
import { clubName } from "@/lib/club-format";
import { Avatar } from "@/components/avatar";
import { SettleBadge, SettleForSession } from "@/components/settle-up";
import { DateTile, EmptyPanel, PageIntro, dateParts, formatCurrency, formatDate, monthLabel, signedCurrency, slug } from "./shared";

type SessionsViewProps = {
  sessions: Session[];
  scope: PerformanceScope;
  selectedSession: number | null;
  onSelectSession: (number: number | null) => void;
  onOpenPlayer: (name: string) => void;
  /** Games supplies its own page heading. */
  hideIntro?: boolean;
  /** Edit, reopen and delete, rendered under each card. */
  footer?: (session: Session) => ReactNode;
};

function SummaryTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="soft-shadow rounded-2xl border border-border bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-xl font-semibold">{value}</p>
      {detail && <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

export function SessionsView({ sessions, scope, selectedSession, onSelectSession, onOpenPlayer, hideIntro = false, footer }: SessionsViewProps) {
  const sorted = useMemo(
    () => sessions.slice().sort((a, b) => b.date.localeCompare(a.date) || b.sessionNumber - a.sessionNumber),
    [sessions],
  );

  const summary = useMemo(() => {
    if (!sessions.length) return null;
    const totalPot = sessions.reduce((sum, session) => sum + session.totalBuyIn, 0);
    const players = sessions.reduce((sum, session) => sum + session.playerCount, 0);
    const biggest = sessions.reduce((best, session) => (session.totalBuyIn > best.totalBuyIn ? session : best), sessions[0]);
    return {
      totalPot,
      averagePot: totalPot / sessions.length,
      averagePlayers: players / sessions.length,
      biggest,
    };
  }, [sessions]);

  return (
    <section data-testid="section-sessions" className="space-y-4">
      {!hideIntro && (
        <PageIntro
          eyebrow="Games"
          title="Every game, in context"
          description={scope === "cash" ? "The pot, winner and every player's result for each cash game." : "The pot, winner and every player's result for each cash game and tournament."}
          count={`${sessions.length} in view`}
        />
      )}

      {summary && (
        <div data-testid="summary-games" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryTile label="Games" value={String(sessions.length)} detail={`${formatCurrency(summary.totalPot)} in total buy-ins`} />
          <SummaryTile label="Average pot" value={formatCurrency(summary.averagePot)} detail="Buy-ins per game" />
          <SummaryTile label="At the table" value={summary.averagePlayers.toFixed(1)} detail="Players per game, on average" />
          <SummaryTile label="Biggest pot" value={formatCurrency(summary.biggest.totalBuyIn)} detail={formatDate(summary.biggest.date)} />
        </div>
      )}

      {sorted.length > 0 ? (
        <div data-testid="grid-session-cards" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((session, index) => (
            <div
              key={`${session.eventType ?? "cash"}-${session.sessionNumber}`}
              id={`game-${session.sessionNumber}`}
              className="stagger-item h-full scroll-mt-24"
              style={{ "--i": Math.min(index, 14) } as React.CSSProperties}
            >
              <SessionCard
                session={session}
                expanded={selectedSession === session.sessionNumber}
                onToggle={() => onSelectSession(selectedSession === session.sessionNumber ? null : session.sessionNumber)}
                onOpenPlayer={onOpenPlayer}
                footer={footer?.(session)}
              />
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanel title="No games in this selection" description="Try another month or quarter, or switch the scope above." />
      )}
    </section>
  );
}

/** One person's line on a card: avatar, what they were, their name and their result. */
function ResultLine({ label, name, amount, tone, testId }: { label: string; name: string | null; amount: number; tone: "win" | "low"; testId: string }) {
  const up = amount >= 0;
  return (
    <div data-testid={testId} className="flex items-center gap-3">
      {name ? <Avatar name={name} size={34} /> : <span className="h-[34px] w-[34px] rounded-full bg-secondary" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${tone === "win" ? "text-chart-1" : "text-muted-foreground"}`}>
          {tone === "win" ? <Trophy className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />}
          {label}
        </p>
        <p className="truncate text-sm font-semibold leading-snug">{name ?? "—"}</p>
      </div>
      <p className={`shrink-0 font-mono text-sm font-semibold ${up ? "text-chart-1" : "text-destructive"}`}>{name ? signedCurrency(amount) : "—"}</p>
    </div>
  );
}

export function SessionCard({ session, expanded, onToggle, onOpenPlayer, footer }: { session: Session; expanded: boolean; onToggle: () => void; onOpenPlayer: (name: string) => void; footer?: ReactNode }) {
  const isTournament = session.eventType === "tournament";
  const when = dateParts(session.date);
  const up = session.players.filter((player) => player.net > 0).length;
  const down = session.players.filter((player) => player.net < 0).length;
  const decided = up + down;
  return <article data-testid={`card-session-${session.sessionNumber}`} className={`group soft-shadow flex h-full flex-col overflow-hidden rounded-2xl border bg-card transition-colors duration-200 ${expanded ? "border-primary/60" : "border-border hover:border-primary/35"}`}>
    <button onClick={onToggle} aria-expanded={expanded} data-testid={`button-expand-session-${session.sessionNumber}`} className="w-full text-left">
      <div className="flex items-center gap-3 px-4 pb-3 pt-4">
        <DateTile date={session.date} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{when.weekday ? `${when.weekday}, ${formatDate(session.date)}` : formatDate(session.date)}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {isTournament ? <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">Tournament</span> : <><span>Game #{session.sessionNumber}</span><SettleBadge sessionNumber={session.sessionNumber} /></>}
          </p>
        </div>
        <div className="shrink-0 text-right group-has-[[data-card-menu]]:pr-8">
          <p className="font-mono text-base font-semibold">{formatCurrency(session.totalBuyIn)}</p>
          <p className="text-[11px] text-muted-foreground">{plural(session.playerCount, "player")} · {isTournament ? "invested" : "pot"}</p>
        </div>
      </div>
      {isTournament && <div data-testid={`session-tournament-summary-${session.sessionNumber}`} className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-lg bg-secondary/30 px-3 py-2 text-xs">
        <span className="text-muted-foreground">Returned <strong className="ml-1 font-mono font-semibold text-foreground">{formatCurrency(session.totalCashOut)}</strong></span>
        <span className="text-muted-foreground">Field net <strong className={`ml-1 font-mono font-semibold ${session.totalNet >= 0 ? "text-chart-1" : "text-destructive"}`}>{signedCurrency(session.totalNet)}</strong></span>
      </div>}
      <div className="space-y-3 border-t border-border/70 px-4 py-3.5">
        <ResultLine testId={`session-winner-${session.sessionNumber}`} tone="win" label={isTournament ? "Top net" : "Winner"} name={session.winner} amount={session.winnerProfit} />
        <ResultLine testId={`session-low-${session.sessionNumber}`} tone="low" label={isTournament ? "Lowest net" : "Low"} name={session.lowPlayer} amount={session.lowProfit} />
      </div>
      {decided > 0 && (
        <div className="px-4 pb-3.5" data-testid={`session-spread-${session.sessionNumber}`}>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-secondary" role="img" aria-label={`${up} up, ${down} down`}>
            <span className="bg-chart-1" style={{ width: `${(up / decided) * 100}%` }} />
            <span className="bg-destructive/70" style={{ width: `${(down / decided) * 100}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground"><span className="font-semibold text-chart-1">{up} up</span> · <span className="font-semibold text-destructive">{down} down</span></p>
        </div>
      )}
      <div className="mt-auto flex items-center justify-between border-t border-border/70 bg-secondary/20 px-4 py-2.5 text-xs">
        <span className="font-semibold text-muted-foreground">Player results</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </div>
    </button>
    {expanded && (
      <div data-testid={`panel-session-details-${session.sessionNumber}`} className="border-t border-border px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <span>Player</span>
          <span>{isTournament ? "Buy-in · payout · net" : "Buy-in · net"}</span>
        </div>
        <div className="max-h-64 space-y-1 overflow-auto">
          {session.players.slice().sort((a, b) => b.net - a.net).map((player) => (
            <div key={player.player} data-testid={`row-session-player-${session.sessionNumber}-${slug(player.player)}`} className="flex items-center gap-2 border-t border-border/50 py-2 text-xs">
              <button type="button" onClick={() => onOpenPlayer(player.player)} className="min-w-0 flex-1 truncate text-left font-medium hover:text-primary hover:underline">{player.player}</button>
              <span className="font-mono text-muted-foreground">{formatCurrency(player.buyIn)}</span>
              {isTournament && <span className="font-mono text-muted-foreground">{formatCurrency(player.cashOut)}</span>}
              <span className={`w-16 text-right font-mono ${player.net >= 0 ? "text-chart-1" : "text-destructive"}`}>{signedCurrency(player.net)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
        <ShareButton
          testId={`button-share-night-${session.sessionNumber}`}
          fileSlug={`night-${session.date}`}
          className="flex-1 justify-center"
          title={isTournament ? "The tournament, as a picture" : "The night, as a picture"}
          build={(hideAmounts) =>
            buildNightCardModel({
              date: formatDate(session.date),
              isTournament,
              totalBuyIn: session.totalBuyIn,
              players: session.players.map((player) => ({ player: player.player, net: player.net })),
              hideAmounts,
            })
          }
          caption={(hideAmounts) => {
            const top = session.players.slice().sort((a, b) => b.net - a.net)[0];
            const lead = top && top.net > 0 ? `${top.player}${hideAmounts ? "" : ` ${signedCurrency(top.net)}`} took the night` : "Game night";
            return `${lead} · ${formatDate(session.date)} · ${clubName()}`;
          }}
        />
        {!isTournament && (
          <RecapButton
            testId={`button-recap-night-${session.sessionNumber}`}
            className="flex-1 justify-center"
            build={() =>
              buildCashRecap({
                date: session.date,
                sessionNumber: session.sessionNumber,
                totalBuyIn: session.totalBuyIn,
                players: session.players.map((player) => ({ player: player.player, buyIn: player.buyIn, cashOut: player.cashOut, net: player.net })),
              })
            }
          />
        )}
        </div>
        {!isTournament && <SettleForSession sessionNumber={session.sessionNumber} names={session.players.map((player) => player.player)} />}
      </div>
    )}
    {footer}
  </article>;
}
