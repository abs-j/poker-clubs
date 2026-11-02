import { useMemo } from "react";
import { ChartCard } from "@/components/club-charts";
import { ShareButton } from "@/components/share-button";
import { buildSeasonCardModel } from "@/lib/share-card";
import { clubName } from "@/lib/club-format";
import { buildSeason, type Season } from "@/lib/achievements";
import type { ChartSession } from "@/lib/club-charts";
import { formatDate } from "@/views/shared";

function AwardTile({ label, name, detail, onOpen }: { label: string; name: string; detail: string; onOpen: (name: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(name)}
      className="min-w-0 rounded-xl bg-secondary/45 p-3 text-left transition-colors hover:bg-secondary"
    >
      <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-1.5 truncate text-sm font-semibold">{name}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
    </button>
  );
}

type SeasonCardProps = {
  sessions: ChartSession[];
  viewer: string;
  onOpenPlayer: (name: string) => void;
};

/**
 * Season highlights: the awards. The standings
 * themselves live in the two podiums above, so this card no longer repeats them.
 */
export function SeasonCard({ sessions, viewer, onOpenPlayer }: SeasonCardProps) {
  const season = useMemo<Season | null>(() => buildSeason(sessions), [sessions]);
  if (!season || !season.leader) return null;

  return (
    <ChartCard
      testId="card-season"
      eyebrow={season.closed ? `${season.label} · final` : `${season.label} · so far`}
      title="Season highlights"
      description={`${season.games} ${season.games === 1 ? "game" : "games"} from ${formatDate(season.from, "d MMM")} to ${formatDate(season.to, "d MMM")}.`}
      action={
        <ShareButton
          testId="button-share-season-image"
          fileSlug={`standings-${season.key}`}
          label="Share standings"
          title="The standings, as a picture"
          build={(hideAmounts) =>
            buildSeasonCardModel({
              label: season.label,
              games: season.games,
              standings: season.standings,
              mostWins: season.mostWins ? { name: season.mostWins.name, wins: season.mostWins.wins } : null,
              hideAmounts,
            })
          }
          caption={() => `${season.label} standings · ${clubName()}`}
        />
      }
    >
      {(season.mostWins || season.mostGames) && (
        <div className="grid grid-cols-2 gap-3">
          {season.mostWins && (
            <AwardTile label="Most wins" name={season.mostWins.name} detail={`${season.mostWins.wins} ${season.mostWins.wins === 1 ? "game" : "games"} won`} onOpen={onOpenPlayer} />
          )}
          {season.mostGames && (
            <AwardTile label="Most games" name={season.mostGames.name} detail={`${season.mostGames.games} played`} onOpen={onOpenPlayer} />
          )}
        </div>
      )}

    </ChartCard>
  );
}
