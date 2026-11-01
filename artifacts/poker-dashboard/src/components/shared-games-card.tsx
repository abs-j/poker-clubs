import { useMemo } from "react";
import { ChartCard } from "@/components/club-charts";
import { buildSharedGames } from "@/lib/achievements";
import type { ChartSession } from "@/lib/club-charts";
import { formatDate, signedCurrency } from "@/views/shared";

const tone = (value: number) => (value > 0 ? "text-chart-1" : value < 0 ? "text-destructive" : "text-muted-foreground");

type SharedGamesCardProps = {
  sessions: ChartSession[];
  viewer: string;
  other: string;
};

/** On someone else's profile: what each of you won or lost in the games you both played, and how the last few went. */
export function SharedGamesCard({ sessions, viewer, other }: SharedGamesCardProps) {
  const shared = useMemo(() => buildSharedGames(sessions, viewer, other), [sessions, viewer, other]);
  if (!shared) return null;

  if (shared.games < 2) {
    return (
      <ChartCard testId="card-shared-games" eyebrow={`You and ${shared.name}`} title="Games you've both played">
        <p className="text-sm text-muted-foreground">
          {shared.games === 0 ? "You haven't sat in the same game yet." : "You've shared one game so far. The comparison appears after two."}
        </p>
      </ChartCard>
    );
  }

  const gap = shared.yourNet - shared.theirNet;
  return (
    <ChartCard
      testId="card-shared-games"
      eyebrow={`You and ${shared.name}`}
      title="Games you've both played"
      description={`${shared.games} games together. Only nights you were both at the table count.`}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-secondary/45 p-4">
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">You</p>
          <p data-testid="text-shared-you" className={`mt-1.5 font-mono text-xl font-semibold ${tone(shared.yourNet)}`}>{signedCurrency(shared.yourNet)}</p>
        </div>
        <div className="rounded-xl bg-secondary/45 p-4">
          <p className="truncate text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{shared.name}</p>
          <p data-testid="text-shared-them" className={`mt-1.5 font-mono text-xl font-semibold ${tone(shared.theirNet)}`}>{signedCurrency(shared.theirNet)}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {gap === 0
          ? "Dead level across these games."
          : `Across these games you are ${signedCurrency(Math.abs(gap)).replace("+", "")} ${gap > 0 ? "ahead of" : "behind"} ${shared.name}.`}
      </p>

      <div data-testid="strip-shared-recent" className="mt-5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Last {shared.recent.length} together</p>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <ol className="flex min-w-max gap-2">
            {shared.recent.map((row) => (
              <li key={`${row.sessionNumber}-${row.date}`} className="w-[76px] shrink-0 rounded-xl border border-border/70 bg-background/60 p-2 text-center">
                <p className="text-[11px] text-muted-foreground">{formatDate(row.date, "d MMM")}</p>
                <p className={`mt-1.5 font-mono text-xs font-semibold ${tone(row.yours)}`}>{signedCurrency(row.yours)}</p>
                <p className={`mt-1 font-mono text-[11px] ${tone(row.theirs)}`}>{signedCurrency(row.theirs)}</p>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Top number is you, bottom is {shared.name}.</p>
      </div>
    </ChartCard>
  );
}
