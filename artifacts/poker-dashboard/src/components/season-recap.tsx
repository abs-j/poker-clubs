import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Share2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar } from "@/components/avatar";
import { AnimatedNumber } from "@/components/animated-number";
import { RecapStudio } from "@/components/recap-studio";
import { buildSeasonRecap, type SeasonRecap } from "@/lib/achievements";
import { buildWrappedRecap } from "@/lib/recaps";
import { WRAPPED_Z_INDEX } from "@/lib/wrapped";
import type { ChartSession } from "@/lib/club-charts";
import { ordinal } from "@/lib/utils";
import { formatCurrency, formatDate, signedCurrency } from "@/views/shared";

type SeasonRecapDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: ChartSession[];
  viewer: string;
  /** Calendar month such as "2026-10". Omit to use the month of the latest game. */
  month?: string;
};

function wrappedPack(recap: SeasonRecap) {
  return buildWrappedRecap({
    monthKey: recap.season.key,
    label: recap.season.label,
    games: recap.season.games,
    players: recap.players,
    totalPot: recap.totalPot,
    leader: recap.season.leader,
    bestNight: recap.bestNight,
    standings: recap.season.standings,
    viewer: recap.viewer
      ? {
          name: recap.viewer.name,
          rank: recap.viewer.rank,
          of: recap.viewer.of,
          net: recap.viewer.net,
          games: recap.viewer.games,
          wins: recap.viewer.wins,
          bestGame: recap.viewer.bestGame,
        }
      : null,
  });
}

/** A small line of the viewer's rank after each game; rank 1 is at the top. */
function RankJourney({ ranks, of }: { ranks: Array<number | null>; of: number }) {
  const points = ranks
    .map((rank, index) => ({ rank, index }))
    .filter((point): point is { rank: number; index: number } => point.rank !== null);
  if (points.length < 2) return null;
  const width = 280;
  const height = 90;
  const step = ranks.length > 1 ? width / (ranks.length - 1) : width;
  const y = (rank: number) => 8 + ((rank - 1) / Math.max(1, of - 1)) * (height - 16);
  const path = points.map((point, i) => `${i ? "L" : "M"}${(point.index * step).toFixed(1)} ${y(point.rank).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg viewBox={`-8 0 ${width + 16} ${height}`} role="img" aria-label="Your rank after each game" className="mt-4 w-full max-w-xs">
      <path d={path} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="draw-line" />
      <circle cx={last.index * step} cy={y(last.rank)} r="5" fill="#fff" />
    </svg>
  );
}

export default function SeasonRecapDialog({ open, onOpenChange, sessions, viewer, month }: SeasonRecapDialogProps) {
  const recap = useMemo(() => buildSeasonRecap(sessions, viewer, month), [sessions, viewer, month]);
  const [index, setIndex] = useState(0);
  const [studioOpen, setStudioOpen] = useState(false);
  useEffect(() => {
    setIndex(0);
  }, [month]);
  const pack = useMemo(() => (studioOpen && recap ? wrappedPack(recap) : null), [studioOpen, recap]);
  const touchStart = useRef<number | null>(null);
  if (!recap) return null;

  const { season, viewer: me } = recap;
  const slides: Array<{ key: string; tone: string; body: React.ReactNode }> = [
    {
      key: "intro",
      tone: "from-violet-700 to-fuchsia-700",
      body: (
        <>
          <p className="recap-eyebrow">{season.label}</p>
          <p className="recap-big"><AnimatedNumber value={season.games} format={(value) => String(Math.round(value))} /></p>
          <p className="recap-line">{season.games === 1 ? "game" : "games"} played by {recap.players} {recap.players === 1 ? "player" : "players"}</p>
          <p className="recap-sub">{formatCurrency(recap.totalPot)} in buy-ins across the table</p>
        </>
      ),
    },
    {
      key: "leader",
      tone: "from-indigo-700 to-violet-700",
      body: season.leader ? (
        <>
          <p className="recap-eyebrow">{season.closed ? "Player of the month" : "Leading the month"}</p>
          <Avatar name={season.leader.name} size={92} ring="hsl(43 96% 56%)" className="mt-5" />
          <p className="recap-name">{season.leader.name}</p>
          <p className="recap-line font-mono">{signedCurrency(season.leader.net)}</p>
          <p className="recap-sub">
            {season.leader.wins} {season.leader.wins === 1 ? "win" : "wins"} in {season.leader.games} games
            {season.lead !== null && season.lead > 0 ? ` · ahead by ${formatCurrency(season.lead)}` : ""}
          </p>
        </>
      ) : null,
    },
  ];
  if (recap.bestNight) {
    slides.push({
      key: "best-night",
      tone: "from-fuchsia-700 to-purple-800",
      body: (
        <>
          <p className="recap-eyebrow">Biggest night</p>
          <p className="recap-big font-mono">{signedCurrency(recap.bestNight.net)}</p>
          <p className="recap-line">{recap.bestNight.name}</p>
          <p className="recap-sub">{formatDate(recap.bestNight.date)}</p>
        </>
      ),
    });
  }
  if (me) {
    slides.push({
      key: "you",
      tone: "from-purple-800 to-indigo-800",
      body: (
        <>
          <p className="recap-eyebrow">Your {season.label}</p>
          <p className="recap-big font-mono"><AnimatedNumber value={me.net} format={signedCurrency} /></p>
          <p className="recap-line">{ordinal(me.rank)} of {me.of} this month</p>
          <p className="recap-sub">
            {me.games} {me.games === 1 ? "game" : "games"} · {me.wins} won · best night {signedCurrency(me.bestGame)}
            {Math.abs(me.streak) >= 2 ? ` · ${Math.abs(me.streak)} ${me.streak > 0 ? "wins" : "losses"} in a row` : ""}
          </p>
          <RankJourney ranks={me.rankJourney} of={me.of} />
        </>
      ),
    });
  } else {
    slides.push({
      key: "join",
      tone: "from-purple-800 to-indigo-800",
      body: (
        <>
          <p className="recap-eyebrow">Your {season.label}</p>
          <p className="recap-line">You didn&apos;t play this month.</p>
          <p className="recap-sub">Sit in the next game and you&apos;ll show up here.</p>
        </>
      ),
    });
  }
  const live = slides.filter((slide) => slide.body);
  const current = Math.min(index, live.length - 1);
  const go = (next: number) => setIndex(Math.max(0, Math.min(live.length - 1, next)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layer={WRAPPED_Z_INDEX} data-testid="dialog-season-recap" className="max-w-md">
        <DialogHeader>
          <DialogTitle>Poker Wrapped · {season.label}</DialogTitle>
          <DialogDescription>Swipe, tap the arrows or use the dots.</DialogDescription>
        </DialogHeader>
        <div
          className="relative overflow-hidden rounded-2xl"
          onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; }}
          onTouchEnd={(event) => {
            if (touchStart.current === null) return;
            const delta = event.changedTouches[0].clientX - touchStart.current;
            touchStart.current = null;
            if (Math.abs(delta) > 40) go(current + (delta < 0 ? 1 : -1));
          }}
        >
          <div
            className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
            style={{ transform: `translateX(-${current * 100}%)` }}
          >
            {live.map((slide, slideIndex) => (
              <div
                key={slide.key}
                aria-hidden={slideIndex !== current}
                data-testid={`recap-slide-${slide.key}`}
                className={`recap-slide flex aspect-[4/5] w-full shrink-0 flex-col items-center justify-center bg-gradient-to-br ${slide.tone} p-8 text-center text-white`}
              >
                {slideIndex === current && slide.body}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(current - 1)}
            disabled={current === 0}
            aria-label="Previous slide"
            className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white disabled:opacity-0"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => go(current + 1)}
            disabled={current === live.length - 1}
            aria-label="Next slide"
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white disabled:opacity-0"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div className="flex justify-center gap-2" role="tablist" aria-label="Recap slides">
          {live.map((slide, slideIndex) => (
            <button
              key={slide.key}
              type="button"
              role="tab"
              aria-selected={slideIndex === current}
              aria-label={`Slide ${slideIndex + 1}`}
              onClick={() => go(slideIndex)}
              className={`h-2 rounded-full transition-all ${slideIndex === current ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30"}`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setStudioOpen(true)}
          data-testid="button-share-wrapped"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          <Share2 className="h-4 w-4" aria-hidden="true" />
          Share as pictures
        </button>
        <RecapStudio open={studioOpen} onOpenChange={setStudioOpen} pack={pack} layer={WRAPPED_Z_INDEX + 10} />
      </DialogContent>
    </Dialog>
  );
}
