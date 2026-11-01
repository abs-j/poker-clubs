import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { ChartCard } from "@/components/club-charts";
import { normalizeName } from "@/lib/club-charts";
import type { DashboardPlayer as Player, TournamentSnapshot } from "@/lib/earnings-analytics";
import { AnimatedNumber } from "@/components/animated-number";
import { usePoints } from "@/components/points-context";
import { pointsFor, seasonLabel, seasonOf } from "@/lib/points";
import { clubToday } from "@/lib/club-format";
import { PointsPodiumCard } from "@/components/points-podium-card";
import { Podium } from "@/components/podium";
import { Avatar } from "@/components/avatar";
import { prefersReducedMotion } from "@/lib/motion";
import { formatDate, signedCurrency } from "@/views/shared";
import "./home-overview.css";

type HomeOverviewProps = {
  memberName: string;
  /** Combined cash + tournament standings, ranked. */
  standings: Player[];
  /** Cash-only totals, used for the cash/tournament split. */
  cashPlayers: Player[];
  tournament: TournamentSnapshot | undefined;
  onSeePlayers: () => void;
  onOpenPlayer: (name: string) => void;
  onOpenAccount: () => void;
  /** Opens the club points table on the Leaderboard tab. */
  onSeePoints: () => void;
  /** How many tournaments the totals include. */
  tournamentCount?: number;
  latestDate: string | null;
  /**
   * A night is on, so Home leads with the live banner instead of this summary.
   * The profit podium still shows.
   */
  showSummary?: boolean;
  /** Last game, then anything still to settle. Shown under the summary. */
  afterHero?: ReactNode;
};

/** Home: your summary and last game, then the profit podium for a quick glance. */
export function HomeOverview({
  memberName,
  standings,
  cashPlayers,
  tournament,
  onSeePlayers,
  onOpenPlayer,
  onOpenAccount,
  onSeePoints,
  tournamentCount = 0,
  latestDate,
  showSummary = true,
  afterHero,
}: HomeOverviewProps) {
  const key = normalizeName(memberName);
  const { currentSeason, rowsFor } = usePoints();
  const monthIsCurrent = currentSeason === seasonOf(clubToday());
  const myPoints = currentSeason ? pointsFor(rowsFor(currentSeason), memberName) : null;
  const me = standings.find((player) => normalizeName(player.name) === key);
  const cashNet = cashPlayers.find((player) => normalizeName(player.name) === key)?.profitTotal ?? 0;
  const tournamentNet = tournament?.available
    ? tournament.players.find((player) => normalizeName(player.player) === key)?.netProfit ?? 0
    : null;
  const total = me ? me.profitTotal : null;
  const rest = standings.slice(3, 5);

  return (
    <section data-testid="section-home-overview" className="story-first">
      <div className="sf-wrap stagger">
        {showSummary && (
          <>
            <div className="sf-intro">
              <div className="flex min-w-0 items-center gap-3.5">
                <button
                  type="button"
                  onClick={onOpenAccount}
                  aria-label="Open Me"
                  data-testid="button-home-avatar"
                  className="shrink-0 rounded-full transition-transform hover:scale-105"
                >
                  <Avatar name={memberName} size={52} />
                </button>
                <div className="min-w-0">
                  <p className="sf-kicker">Welcome back, {memberName}</p>
                  <h1>
                    Your game, <em>in numbers.</em>
                  </h1>
                </div>
              </div>
              {latestDate && (
                <div className="sf-date-tag" data-testid="text-earnings-through">
                  <CalendarDays size={14} aria-hidden="true" /> Through {formatDate(latestDate, "d MMM yyyy")}
                </div>
              )}
            </div>

            <div className="sf-story">
              <div
                className="sf-hero-card"
                onPointerMove={(event) => {
                  if (prefersReducedMotion() || event.pointerType === "touch") return;
                  const box = event.currentTarget.getBoundingClientRect();
                  const px = (event.clientX - box.left) / box.width - 0.5;
                  const py = (event.clientY - box.top) / box.height - 0.5;
                  event.currentTarget.style.transform = `perspective(900px) rotateX(${(-py * 4).toFixed(2)}deg) rotateY(${(px * 5).toFixed(2)}deg)`;
                }}
                onPointerLeave={(event) => {
                  event.currentTarget.style.transform = "";
                }}
              >
                <span className="sf-blob sf-blob-a" aria-hidden="true" />
                <span className="sf-blob sf-blob-b" aria-hidden="true" />
                <p className="sf-label" data-testid="text-personal-net-label">Your all-time net</p>
                <div className="sf-money" data-testid="text-personal-net">
                  {total === null ? "—" : <AnimatedNumber value={total} format={signedCurrency} />}
                </div>
                <div className="sf-hero-bottom">
                  <span className="sf-rank-pill" data-testid="text-personal-rank">
                    {me ? `#${me.rank} of ${standings.length} on profit` : "Not on the leaderboard yet"}
                  </span>
                  {myPoints && (
                    <button type="button" onClick={onSeePoints} className="sf-rank-pill" data-testid="text-points-rank">
                      #{myPoints.rank} in {seasonLabel(currentSeason ?? "")} · {Math.round(myPoints.points)} pts
                    </button>
                  )}
                  <span>Cash games{tournament?.available ? " + tournament" : ""}</span>
                </div>
                <div className="sf-split-inline">
                  <span>Cash <strong>{signedCurrency(cashNet)}</strong></span>
                  {tournamentNet !== null && <span>Tournament <strong>{signedCurrency(tournamentNet)}</strong></span>}
                </div>
              </div>

              <aside className="sf-side-card">
                <h2>Where it came from</h2>
                <div className="sf-split">
                  <div>
                    <span>Cash games</span>
                    <strong data-testid="text-cash-net"><AnimatedNumber value={cashNet} format={signedCurrency} /></strong>
                  </div>
                  <div>
                    <span>Tournament</span>
                    <strong data-testid="text-tournament-net">
                      {tournamentNet === null ? "—" : <AnimatedNumber value={tournamentNet} format={signedCurrency} />}
                    </strong>
                  </div>
                </div>
                <p className="sf-note">
                  {tournament?.available && tournament.eventDate
                    ? `${tournamentCount > 1 ? `${tournamentCount} tournaments, latest ` : "Tournament on "}${formatDate(tournament.eventDate)}. Results use net profit only.`
                    : "Cash game totals from the club's recorded nights."}
                </p>
              </aside>
            </div>
          </>
        )}

        {afterHero && <div style={{ marginTop: showSummary ? 16 : 0 }}>{afterHero}</div>}

        {currentSeason && (
          <div className="sf-content" style={{ marginTop: 16 }}>
            <PointsPodiumCard
              testId="card-home-monthly-points"
              viewer={memberName}
              onOpenPlayer={onOpenPlayer}
              season={currentSeason}
              eyebrow="Monthly points"
              title={monthIsCurrent ? "This month's points" : `${seasonLabel(currentSeason)} points`}
              description={monthIsCurrent ? "The season so far. Points reset each month." : "No games yet this month, so these are the last month's final standings."}
              onSeeAll={onSeePoints}
              withRunnersUp
            />
          </div>
        )}

        <div className="sf-content" style={{ marginTop: 16 }}>
          <ChartCard
            testId="card-home-standings"
            eyebrow="All-time profit"
            title="The profit podium"
            action={
              <button type="button" onClick={onSeePlayers} className="inline-flex min-h-[44px] items-center self-start whitespace-nowrap text-xs font-semibold text-primary hover:underline sm:self-auto">
                Full leaderboard →
              </button>
            }
          >
            <Podium players={standings} viewer={memberName} onOpenPlayer={onOpenPlayer} onOpenBoard={onSeePlayers} />
            <div className="sf-ranking" style={{ padding: 0, marginTop: 20 }}>
              {rest.map((row) => {
                const isMe = normalizeName(row.name) === key;
                return (
                  <button
                    type="button"
                    key={row.name}
                    onClick={() => onOpenPlayer(row.name)}
                    data-testid={`row-earnings-standing-${normalizeName(row.name).replace(/[^a-z0-9]+/g, "-")}`}
                    className={`sf-rank-row w-full text-left ${isMe ? "is-member" : ""}`}
                  >
                    <span className="sf-rank-num">{row.rank}</span>
                    <span className="sf-rank-name">
                      {row.name}
                      {isMe && <span className="sf-you">you</span>}
                    </span>
                    <span className={`sf-rank-value ${row.profitTotal >= 0 ? "sf-positive" : "sf-negative"}`}>
                      {signedCurrency(row.profitTotal)}
                    </span>
                  </button>
                );
              })}
              {me && me.rank > 5 && (
                <button
                  type="button"
                  onClick={() => onOpenPlayer(me.name)}
                  className="sf-rank-row is-member w-full text-left"
                >
                  <span className="sf-rank-num">{me.rank}</span>
                  <span className="sf-rank-name">{me.name}<span className="sf-you">you</span></span>
                  <span className={`sf-rank-value ${me.profitTotal >= 0 ? "sf-positive" : "sf-negative"}`}>{signedCurrency(me.profitTotal)}</span>
                </button>
              )}
            </div>
          </ChartCard>
        </div>
      </div>
    </section>
  );
}
