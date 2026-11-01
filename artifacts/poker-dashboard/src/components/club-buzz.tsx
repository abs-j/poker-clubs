import { useMemo } from "react";
import { ArrowUpRight, Info } from "lucide-react";
import { ChartCard } from "@/components/club-charts";
import { usePoints } from "@/components/points-context";
import { buildBuzz, type BuzzItem, type BuzzPoints } from "@/lib/achievements";
import type { ChartSession } from "@/lib/club-charts";
import { clubToday } from "@/lib/club-format";
import { previousSeason, seasonLabel, seasonOf } from "@/lib/points";

const TONE: Record<BuzzItem["tone"], { icon: typeof Info; color: string }> = {
  up: { icon: ArrowUpRight, color: "bg-chart-1/15 text-chart-1" },
  info: { icon: Info, color: "bg-primary/10 text-primary" },
};

type ClubBuzzProps = {
  sessions: ChartSession[];
};

/** What changed lately, in plain sentences: new leaders, podium moves, the month's champion. */
export function ClubBuzz({ sessions }: ClubBuzzProps) {
  const { currentSeason, seasons, rowsFor, rowsBeforeLatest } = usePoints();
  const items = useMemo(() => {
    let points: BuzzPoints | null = null;
    if (currentSeason) {
      const now = rowsFor(currentSeason);
      const latestNightDate = now.flatMap((row) => (row.history[0] ? [row.history[0].date] : [])).sort().pop() ?? null;
      // Only a month that has just ended gets a "champion" line.
      const lastMonth = previousSeason(seasonOf(clubToday()));
      const lastRows = seasons.includes(lastMonth) ? rowsFor(lastMonth) : [];
      const champion =
        lastRows.length && (lastRows.length === 1 || lastRows[0].points > lastRows[1].points)
          ? { label: seasonLabel(lastMonth), name: lastRows[0].name }
          : null;
      points = { seasonLabel: seasonLabel(currentSeason), now, before: rowsBeforeLatest(currentSeason), latestNightDate, champion };
    }
    return buildBuzz(sessions, 5, points);
  }, [sessions, currentSeason, seasons, rowsFor, rowsBeforeLatest]);
  if (!items.length) return null;

  return (
    <ChartCard testId="card-club-buzz" eyebrow="Club buzz" title="What's happening" description="Written automatically from the latest results.">
      <ul className="stagger space-y-2.5">
        {items.map((item, index) => {
          const tone = TONE[item.tone];
          const Icon = tone.icon;
          return (
            <li key={item.id} className="stagger-item flex items-start gap-3 text-sm" style={{ "--i": index } as React.CSSProperties}>
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tone.color}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="leading-6">{item.text}</span>
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}
