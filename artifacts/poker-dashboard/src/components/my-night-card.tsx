import { useEffect, useMemo, useState } from "react";
import { buildMyNight, normalizeName, type ChartSession } from "@/lib/club-charts";
import { useAchievements } from "@/components/achievements-context";
import { usePoints } from "@/components/points-context";
import { nightPointsFor } from "@/lib/points";
import { careerFor } from "@/lib/career";
import { formatCurrency, formatDate, signedCurrency } from "@/views/shared";

function ordinal(n: number) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10] ?? "th"}`;
}

function streakText(streak: number) {
  const count = Math.abs(streak);
  if (count < 2) return null;
  return streak > 0 ? `${count} wins in a row` : `${count} losses in a row`;
}

function moveHeadline(movement: number | null) {
  if (movement === null) return "No change yet";
  if (movement === 0) return "Held your place";
  const places = Math.abs(movement);
  return `${movement > 0 ? "Up" : "Down"} ${places} ${places === 1 ? "place" : "places"}`;
}

export type OfficialStanding = {
  rank: number;
  of: number;
  /** Places gained (+) or lost (-) over the latest club game; null when unknown. */
  movement: number | null;
  /** All-time net profit, shown on the share image. */
  net?: number;
};

const CONFETTI_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-1))",
  "hsl(var(--chart-5))",
];

/** A short, one-off burst of confetti. Pieces are deterministic so renders are stable. */
function WinBurst() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }, (_, index) => ({
        x: `${(index * 37 + 11) % 100}%`,
        dx: `${((index * 53) % 160) - 80}px`,
        dy: `${150 + ((index * 41) % 170)}px`,
        rot: `${((index * 131) % 720) - 360}deg`,
        delay: `${(index % 10) * 45}ms`,
        color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      })),
    [],
  );
  return (
    <div aria-hidden="true" className="confetti pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
      {pieces.map((piece, index) => (
        <span
          key={index}
          className="confetti-piece"
          style={{ "--x": piece.x, "--dx": piece.dx, "--dy": piece.dy, "--rot": piece.rot, "--d": piece.delay, "--c": piece.color } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

type MyNightCardProps = {
  sessions: ChartSession[];
  viewer: string;
  /** The same rank the headline and leaderboards show, so the card never disagrees with them. */
  standing?: OfficialStanding;
};

export function MyNightCard({ sessions, viewer, standing }: MyNightCardProps) {
  const night = useMemo(() => buildMyNight(sessions, viewer), [sessions, viewer]);
  const { careers } = useAchievements();
  const { rowsFor } = usePoints();
  const { tournaments } = usePoints();
  // Form and best game use the whole record when it is known, not only the dated nights.
  const career = careerFor(careers, viewer);
  const streakValue = career && career.results.length ? career.currentStreak : night?.streak ?? 0;
  const bestGameValue = career ? career.bestGame : night?.bestGame ?? 0;
  const [burst, setBurst] = useState(false);

  // Celebrate a winning night once per game per browser session.
  const winKey = night && night.last.net > 0 ? `my-night-burst-${night.last.sessionNumber}-${night.last.date}` : null;
  useEffect(() => {
    if (!winKey) return;
    try {
      if (window.sessionStorage.getItem(winKey)) return;
      window.sessionStorage.setItem(winKey, "1");
    } catch {
      // Storage can be unavailable; celebrating again is harmless.
    }
    setBurst(true);
    const timer = window.setTimeout(() => setBurst(false), 3000);
    return () => window.clearTimeout(timer);
  }, [winKey]);

  if (!night) return null;

  const { last } = night;
  const tournamentEvent = last.isTournament ? tournaments.find((event) => event.date === last.date) ?? null : null;
  const myTournamentResult = tournamentEvent?.results.find((result) => normalizeName(result.player) === normalizeName(night.playerName));
  // A tournament is ranked by where you finished; a cash night by the night's results. Say which.
  const finishText =
    last.isTournament && tournamentEvent && myTournamentResult?.finishPlace
      ? `${ordinal(myTournamentResult.finishPlace)} of ${tournamentEvent.players}`
      : `${ordinal(last.tableRank)} of ${last.playerCount} by result`;
  const finishLine =
    last.isTournament && tournamentEvent && myTournamentResult?.finishPlace
      ? `Finished ${finishText}`
      : `${finishText} on the night`;
  const positive = last.net >= 0;
  const streak = streakText(streakValue);
  const nightPoints = nightPointsFor(rowsFor("ALL"), viewer, {
    sessionNumber: last.sessionNumber,
    date: last.date,
    kind: last.isTournament ? "tournament" : "cash",
  });
  const rank = standing?.rank ?? night.standing.rank;
  const of = standing?.of ?? night.standing.of;

  return (
    <section
      data-testid="card-my-night"
      aria-label="Your latest game"
      className="soft-shadow mb-4 rounded-2xl border border-border bg-card p-5 sm:p-6"
    >
      {burst && <WinBurst />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="section-label text-primary">{last.isTournament ? "Your last tournament" : "Your last game"}</p>
          <h2 className="mt-1 flex flex-wrap items-baseline gap-x-3 text-xl font-semibold tracking-tight">
            <span>{formatDate(last.date)}</span>
            <span
              data-testid="text-my-night-result"
              className={`font-mono text-2xl ${positive ? "text-chart-1" : "text-destructive"}`}
            >
              {signedCurrency(last.net)}
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Bought in {formatCurrency(last.buyIn)} · cashed out {formatCurrency(last.cashOut)} · {finishLine}
          </p>
          {nightPoints && (
            <p data-testid="text-my-night-points" className="mt-1.5 inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              +{Math.round(nightPoints.points * 10) / 10} club points
            </p>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
        <div className="min-w-0 rounded-xl bg-secondary/45 p-2.5 sm:p-3">
          <dt className="text-[11px] uppercase leading-4 tracking-[0.06em] text-muted-foreground">Leaderboard move</dt>
          <dd data-testid="text-my-night-rank" className="mt-1.5 break-words font-mono text-[13px] font-semibold leading-5">
            {moveHeadline(standing ? standing.movement : night.standing.movement)}
          </dd>
          <dd className="mt-0.5 text-[11px] text-muted-foreground">
            Now {ordinal(rank)} of {of}
          </dd>
        </div>
        <div className="min-w-0 rounded-xl bg-secondary/45 p-2.5 sm:p-3">
          <dt className="text-[11px] uppercase leading-4 tracking-[0.06em] text-muted-foreground">Form</dt>
          <dd className="mt-1.5 break-words font-mono text-[13px] font-semibold leading-5">{streak ?? "No streak"}</dd>
          <dd className="mt-0.5 text-[11px] text-muted-foreground">
            {career ? `Across ${career.games} games` : `Over ${night.season.games} ${night.season.games === 1 ? "game" : "games"} on record`}
          </dd>
        </div>
        <div className="min-w-0 rounded-xl bg-secondary/45 p-2.5 sm:p-3">
          <dt className="text-[11px] uppercase leading-4 tracking-[0.06em] text-muted-foreground">Best game</dt>
          <dd className={`mt-1.5 font-mono text-[13px] font-semibold leading-5 ${bestGameValue >= 0 ? "text-chart-1" : "text-destructive"}`}>{signedCurrency(bestGameValue)}</dd>
          <dd className="mt-0.5 text-[11px] text-muted-foreground">
            {career ? `${Math.round(career.inProfitPct)}% of games in profit` : `${night.season.positiveGames} of ${night.season.games} in profit`}
          </dd>
        </div>
      </dl>
    </section>
  );
}
