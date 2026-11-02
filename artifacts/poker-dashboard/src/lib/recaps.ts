// What each Instagram recap slide says. Pure data (no canvas), so the wording and the numbers
// can be tested; `recap-render.ts` turns a slide into a picture.
import { clubName, currencySymbol, moneyFormatter } from "./club-format.ts";
import { ordinal } from "./share-card.ts";

export type RecapFormat = "feed" | "story" | "square";

export const RECAP_FORMATS: Record<RecapFormat, { width: number; height: number; label: string; hint: string; safeTop: number; safeBottom: number }> = {
  feed: { width: 1080, height: 1350, label: "Feed post", hint: "4:5, the best size for a feed post or carousel", safeTop: 70, safeBottom: 60 },
  story: { width: 1080, height: 1920, label: "Story", hint: "9:16, keeps clear of Instagram's top and bottom bars", safeTop: 230, safeBottom: 280 },
  square: { width: 1080, height: 1080, label: "Square", hint: "1:1, works anywhere", safeTop: 60, safeBottom: 56 },
};

export type RecapRow = {
  place: number;
  name: string;
  value: string;
  sub?: string;
  positive?: boolean;
};

export type RecapTile = {
  label: string;
  /** The big text: usually a name. */
  value: string;
  /** A figure under it. */
  detail?: string;
  tone?: "good" | "bad" | "neutral";
};

export type RecapSlide =
  | {
      kind: "cover";
      eyebrow: string;
      title: string;
      headline: string;
      value: string;
      positive: boolean;
      chips: string[];
    }
  | { kind: "ranking"; eyebrow: string; title: string; subtitle?: string; rows: RecapRow[] }
  | { kind: "tiles"; eyebrow: string; title: string; tiles: RecapTile[] }
  | {
      kind: "podium";
      eyebrow: string;
      title: string;
      places: Array<{ place: 1 | 2 | 3; name: string; value: string; sub?: string }>;
      note?: string;
    };

export type RecapPack = {
  id: string;
  /** e.g. "Game night · 10 Oct 2026" */
  title: string;
  dateLabel: string;
  slides: RecapSlide[];
  /** A caption ready to paste next to the images. */
  caption: string;
};

const money = (value: number) => moneyFormatter(Number.isInteger(Math.abs(value)) ? 0 : 2).format(Math.abs(value));
const exact = (value: number) => moneyFormatter(2).format(Math.abs(value));
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${exact(value)}`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "2026-10-10" -> { long: "Saturday 10 Oct", full: "10 Oct 2026" } without timezone surprises. */
export function describeDate(iso: string): { long: string; full: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return { long: iso, full: iso };
  const [, year, month, day] = match;
  const weekday = DAYS[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()];
  const short = `${Number(day)} ${MONTHS[Number(month) - 1]}`;
  return { long: `${weekday} ${short}`, full: `${short} ${year}` };
}

const isJackpot = (name: string) => name.trim().toLocaleLowerCase() === "bad beat jackpot";

const tidy = (lines: string[]) =>
  lines.filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n");

export type CashRecapInput = {
  date: string;
  sessionNumber: number;
  players: Array<{ player: string; buyIn: number; cashOut: number; net: number }>;
  totalBuyIn: number;
};

/** The recap for one cash night: cover, results, highlights. */
export function buildCashRecap(input: CashRecapInput): RecapPack {
  const when = describeDate(input.date);
  const real = input.players.filter((player) => !isJackpot(player.player));
  const ranked = real.slice().sort((a, b) => b.net - a.net || a.player.localeCompare(b.player));
  const winner = ranked[0];
  const loser = ranked[ranked.length - 1];
  const inProfit = ranked.filter((player) => player.net > 0).length;
  const mostIn = real.slice().sort((a, b) => b.buyIn - a.buyIn || a.player.localeCompare(b.player))[0];
  const pot = input.totalBuyIn || real.reduce((sum, player) => sum + player.buyIn, 0);

  const slides: RecapSlide[] = [
    {
      kind: "cover",
      eyebrow: "Game night",
      title: when.long,
      headline: winner && winner.net > 0 ? `${winner.player} took the night` : "Everyone played it safe",
      value: winner ? signed(winner.net) : "—",
      positive: !winner || winner.net >= 0,
      chips: [plural(real.length, "player"), `${money(pot)} in the pot`],
    },
    {
      kind: "ranking",
      eyebrow: "Results",
      title: "How the night finished",
      subtitle: `${plural(real.length, "player")} · ${when.full}`,
      rows: ranked.map((player, index) => ({
        place: index + 1,
        name: player.player,
        value: signed(player.net),
        sub: `${exact(player.buyIn)} in · ${exact(player.cashOut)} out`,
        positive: player.net >= 0,
      })),
    },
  ];

  const tiles: RecapTile[] = [];
  if (winner) tiles.push({ label: "Biggest win", value: winner.player, detail: signed(winner.net), tone: "good" });
  if (loser && loser !== winner) tiles.push({ label: "Roughest night", value: loser.player, detail: signed(loser.net), tone: loser.net < 0 ? "bad" : "neutral" });
  if (mostIn) tiles.push({ label: "Most bought in", value: mostIn.player, detail: `${exact(mostIn.buyIn)} in`, tone: "neutral" });
  tiles.push({ label: "Finished in profit", value: `${inProfit} of ${real.length}`, detail: `${money(pot)} pot`, tone: "neutral" });
  if (tiles.length >= 3) slides.push({ kind: "tiles", eyebrow: "Highlights", title: "The night in four numbers", tiles: tiles.slice(0, 4) });


  const runnersUp = ranked.slice(1, 3).filter((player) => player.net > 0);
  const caption = tidy([
    `♠ ${clubName()} · ${when.long}`,
    winner && winner.net > 0 ? `🏆 ${winner.player} took the night, ${signed(winner.net)}` : "",
    runnersUp.length ? `🥈 ${runnersUp.map((player) => `${player.player} ${signed(player.net)}`).join(" · ")}` : "",
    `${plural(real.length, "player")} · ${money(pot)} in the pot`,
    "",
    "Full results and club points on the club site.",
    "#pokernight",
  ]);

  return { id: `cash-${input.sessionNumber}`, title: `Game night · ${when.full}`, dateLabel: when.full, slides, caption };
}

export type TournamentRecapInput = {
  id: string;
  date: string;
  title: string;
  players: number;
  entries: number;
  rebuys: number;
  topUps: number;
  knockouts: number;
  mainPrizePool: number;
  bountyPool: number;
  winner: string | null;
  winnerPrize: number;
  topBountyHunter: string | null;
  mostKnockouts: number;
  results: Array<{
    player: string;
    finishPlace: number | null;
    knockouts: number;
    mainPrize: number;
    bountiesWon: number;
    netProfit: number;
  }>;
};

/** The recap for one tournament: cover, podium, results and highlights. */
export function buildTournamentRecap(input: TournamentRecapInput): RecapPack {
  const when = describeDate(input.date);
  const results = input.results.filter((result) => !isJackpot(result.player));
  const podium = results
    .filter((result) => result.finishPlace !== null && result.finishPlace <= 3)
    .sort((a, b) => (a.finishPlace ?? 0) - (b.finishPlace ?? 0));
  const winner = input.winner ?? podium[0]?.player ?? null;

  const slides: RecapSlide[] = [
    {
      kind: "cover",
      eyebrow: "Tournament night",
      title: when.long,
      headline: winner ? `${winner} took it down` : "Tournament results",
      value: winner ? exact(input.winnerPrize) : "—",
      positive: true,
      chips: [`${plural(input.players, "player")} · ${plural(input.entries, "entry", "entries")}`, `${money(input.mainPrizePool)} in prizes`],
    },
  ];

  if (podium.length >= 2) {
    slides.push({
      kind: "podium",
      eyebrow: "The podium",
      title: "Top three",
      places: podium.slice(0, 3).map((result) => ({
        place: (result.finishPlace ?? 1) as 1 | 2 | 3,
        name: result.player,
        value: exact(result.mainPrize),
        sub: `${signed(result.netProfit)} net${result.knockouts > 0 ? ` · ${plural(result.knockouts, "knockout")}` : ""}`,
      })),
      note: input.bountyPool > 0 ? `Plus ${money(input.bountyPool)} in bounties` : undefined,
    });
  }

  const ordered = results.slice().sort((a, b) => {
    if (a.finishPlace !== null && b.finishPlace !== null) return a.finishPlace - b.finishPlace;
    if (a.finishPlace !== null) return -1;
    if (b.finishPlace !== null) return 1;
    return b.netProfit - a.netProfit || a.player.localeCompare(b.player);
  });
  slides.push({
    kind: "ranking",
    eyebrow: "Results",
    title: "How everyone finished",
    subtitle: `${plural(input.players, "player")} · ${when.full}`,
    rows: ordered.map((result, index) => ({
      place: result.finishPlace ?? index + 1,
      name: result.player,
      value: signed(result.netProfit),
      sub:
        [result.mainPrize > 0 ? `prize ${exact(result.mainPrize)}` : "", result.knockouts > 0 ? plural(result.knockouts, "knockout") : ""]
          .filter(Boolean)
          .join(" · ") || undefined,
      positive: result.netProfit >= 0,
    })),
  });

  const tiles: RecapTile[] = [];
  if (input.topBountyHunter) tiles.push({ label: "Top bounty hunter", value: input.topBountyHunter, detail: plural(input.mostKnockouts, "knockout"), tone: "good" });
  tiles.push({ label: "Prize pool", value: money(input.mainPrizePool), detail: input.bountyPool > 0 ? `+ ${money(input.bountyPool)} bounties` : undefined, tone: "neutral" });
  tiles.push({ label: "Entries", value: String(input.entries), detail: `${input.rebuys} rebuys · ${input.topUps} top-ups`, tone: "neutral" });
  tiles.push({ label: "Knockouts", value: String(input.knockouts), detail: plural(input.players, "player"), tone: "neutral" });
  slides.push({ kind: "tiles", eyebrow: "Highlights", title: "The night in four numbers", tiles: tiles.slice(0, 4) });


  const caption = tidy([
    `♠ ${clubName()} · Tournament · ${when.long}`,
    winner ? `🏆 ${winner} took it down, ${exact(input.winnerPrize)}` : "",
    podium.length > 1 ? `🥈 ${podium.slice(1, 3).map((result) => `${result.player} ${ordinal(result.finishPlace ?? 0)}`).join(" · ")}` : "",
    `${plural(input.players, "player")} · ${money(input.mainPrizePool)} in prizes · ${plural(input.knockouts, "knockout")}`,
    input.topBountyHunter ? `🎯 Top bounty hunter: ${input.topBountyHunter} (${input.mostKnockouts})` : "",
    "",
    "Full results on the club site.",
    "#pokertournament",
  ]);

  return { id: `tournament-${input.id}`, title: `Tournament · ${when.full}`, dateLabel: when.full, slides, caption };
}

/** The fields of a tournament event the recap needs, so callers can pass an event as it is. */
export type RecapEventLike = TournamentRecapInput;

export function tournamentRecapFromEvent(event: RecapEventLike): RecapPack {
  return buildTournamentRecap({
    id: event.id,
    date: event.date,
    title: event.title,
    players: event.players,
    entries: event.entries,
    rebuys: event.rebuys,
    topUps: event.topUps,
    knockouts: event.knockouts,
    mainPrizePool: event.mainPrizePool,
    bountyPool: event.bountyPool,
    winner: event.winner,
    winnerPrize: event.winnerPrize,
    topBountyHunter: event.topBountyHunter,
    mostKnockouts: event.mostKnockouts,
    results: event.results,
  });
}

export type WrappedRecapInput = {
  monthKey: string;
  label: string;
  games: number;
  players: number;
  totalPot: number;
  leader: { name: string; net: number; wins: number; games: number } | null;
  bestNight: { name: string; net: number; date: string } | null;
  standings: Array<{ name: string; net: number; wins: number; games: number }>;
  viewer: { name: string; rank: number; of: number; net: number; games: number; wins: number; bestGame: number } | null;
};

/** One shareable pack for a finished month: cover, personal tiles, and the table. */
export function buildWrappedRecap(input: WrappedRecapInput): RecapPack {
  const focus = input.viewer?.net ?? input.leader?.net ?? 0;
  const slides: RecapSlide[] = [
    {
      kind: "cover",
      eyebrow: "Poker Wrapped",
      title: input.label,
      headline: input.leader ? `${input.leader.name} led the month` : "The month in review",
      value: input.viewer ? signed(input.viewer.net) : input.leader ? signed(input.leader.net) : String(input.games),
      positive: focus >= 0,
      chips: [plural(input.games, "game"), plural(input.players, "player"), `${money(input.totalPot)} in buy-ins`],
    },
  ];
  const tiles: RecapTile[] = [];
  if (input.leader) {
    tiles.push({
      label: "Player of the month",
      value: input.leader.name,
      detail: `${signed(input.leader.net)} · ${plural(input.leader.wins, "win")}`,
      tone: input.leader.net >= 0 ? "good" : "bad",
    });
  }
  if (input.bestNight) {
    tiles.push({
      label: "Biggest night",
      value: input.bestNight.name,
      detail: `${signed(input.bestNight.net)} · ${describeDate(input.bestNight.date).full}`,
      tone: "good",
    });
  }
  if (input.viewer) {
    tiles.push({
      label: "Your month",
      value: signed(input.viewer.net),
      detail: `${ordinal(input.viewer.rank)} of ${input.viewer.of} · ${plural(input.viewer.games, "game")}`,
      tone: input.viewer.net >= 0 ? "good" : "bad",
    });
    tiles.push({
      label: "Your best game",
      value: signed(input.viewer.bestGame),
      detail: plural(input.viewer.wins, "win"),
      tone: input.viewer.bestGame >= 0 ? "good" : "bad",
    });
  }
  if (tiles.length >= 2) slides.push({ kind: "tiles", eyebrow: "Highlights", title: input.label, tiles: tiles.slice(0, 4) });
  if (input.standings.length) {
    slides.push({
      kind: "ranking",
      eyebrow: "Month standings",
      title: input.label,
      subtitle: plural(input.games, "game"),
      rows: input.standings.slice(0, 8).map((row, index) => ({
        place: index + 1,
        name: row.name,
        value: signed(row.net),
        sub: `${plural(row.wins, "win")} · ${plural(row.games, "game")}`,
        positive: row.net >= 0,
      })),
    });
  }
  const viewerLine = input.viewer
    ? `You finished ${ordinal(input.viewer.rank)} of ${input.viewer.of} · ${signed(input.viewer.net)}`
    : "You didn't play this month.";
  const caption = tidy([
    `♠ ${clubName()} · Poker Wrapped · ${input.label}`,
    input.leader ? `${input.leader.name} led the month, ${signed(input.leader.net)}` : "The month in review",
    viewerLine,
    `${plural(input.games, "game")} · ${plural(input.players, "player")}`,
    "",
    "#pokernight",
  ]);
  return {
    id: `wrapped-${input.monthKey}`,
    title: `Poker Wrapped · ${input.label}`,
    dateLabel: input.label,
    slides,
    caption,
  };
}

// ------------------------------------------------------------ hiding amounts

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The same pack with every money figure left off: names, places, counts and points stay.
 * Works on the finished strings so it covers every kind of pack.
 */
export function redactAmounts(pack: RecapPack): RecapPack {
  const symbol = escapeRegex(currencySymbol());
  const token = new RegExp(`[+−-]?\\s?${symbol}\\s?\\d[\\d,]*(?:\\.\\d+)?`, "g");
  const hasMoney = (text: string) => new RegExp(token.source).test(text);
  const strip = (text: string) =>
    text
      .replace(token, "")
      .replace(/\s*[·,]?\s*\b(?:in the pot|pot|in buy-ins|in|out)\s*$/i, "")
      .replace(/\s*[·,]\s*(?=[·,]|$)/g, "")
      .replace(/^\s*[·,]\s*/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  const word = (text: string, positive: boolean) => (hasMoney(text) ? (positive ? "In profit" : "Down") : text);

  const slides = pack.slides.map((slide): RecapSlide => {
    if (slide.kind === "cover") {
      const chips = slide.chips.filter((chip) => !hasMoney(chip));
      // A neutral figure (games or players) instead of a win/loss word, kinder to a bad month.
      if (hasMoney(slide.value) && chips.length) return { ...slide, value: chips[0], chips: chips.slice(1) };
      return { ...slide, value: word(slide.value, slide.positive), chips };
    }
    if (slide.kind === "ranking") {
      return {
        ...slide,
        rows: slide.rows.map((row) => ({ ...row, value: hasMoney(row.value) ? "" : row.value, sub: row.sub && hasMoney(row.sub) ? strip(row.sub) || undefined : row.sub })),
      };
    }
    if (slide.kind === "tiles") {
      return {
        ...slide,
        tiles: slide.tiles.map((tile) => ({
          ...tile,
          value: word(tile.value, tile.tone !== "bad"),
          detail: tile.detail && hasMoney(tile.detail) ? strip(tile.detail) || undefined : tile.detail,
        })),
      };
    }
    if (slide.kind === "podium") {
      return { ...slide, places: slide.places.map((place) => ({ ...place, value: hasMoney(place.value) ? "" : place.value, sub: place.sub && hasMoney(place.sub) ? strip(place.sub) || undefined : place.sub })) };
    }
    return slide;
  });
  const caption = tidy(pack.caption.split("\n").map((line) => (hasMoney(line) ? strip(line) : line)));
  return { ...pack, slides, caption };
}
