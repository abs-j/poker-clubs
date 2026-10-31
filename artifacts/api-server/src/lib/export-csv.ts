// A club's results as CSV, in the layout the importers already read, so an export can be brought
// back (into the same club after a mishap, or into another one). Cash nights stay one file.
// Tournaments are the two sheets the tournament importer reads (log and results). Pure, so it
// can be unit tested.
import type { NightInput } from "./club-dashboard.ts";
import { buildTournamentEvent, type TournamentInput } from "./tournament-native.ts";

const cell = (value: string | number): string => {
  const text = String(value);
  // Quote anything a spreadsheet could misread, and defuse cells that start like a formula.
  const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const money = (value: number) => value.toFixed(2);

/** The name the cash importer already treats as the pot, not a person. */
const JACKPOT = "Bad Beat Jackpot";

export type ExportNight = NightInput & {
  /** Surplus from this night that went into the bad beat jackpot, in dollars. Zero omits the row. */
  jackpot?: number;
};

export type JackpotPayoutExport = {
  /** Calendar date the payout was recorded, YYYY-MM-DD in the club's timezone. */
  date: string;
  /** Who was paid. */
  name: string;
  /** Dollars paid out of the pot. */
  amount: number;
};

const cashRow = (date: string, name: string, buyIn: number, cashOut: number) =>
  [date, cell(name), money(buyIn), money(cashOut), money(cashOut - buyIn)].join(",");

/**
 * Cash nights, then the jackpot.
 * A surplus is a "Bad Beat Jackpot" row on that night: buy-in 0, cash-out the amount that went in
 * (the same shape a spreadsheet uses, which the cash importer skips and counts toward the night's
 * balance). A payout is its own row, "Bad Beat Jackpot payout to <name>": buy-in the amount that
 * left the pot, cash-out 0. Payout rows sit after the nights so they are not mixed into a table.
 */
export function nightsToCsv(nights: ExportNight[], payouts: JackpotPayoutExport[] = []): string {
  const lines = ["Date,Player,Buy-in,Cash-out,Net"];
  for (const night of nights) {
    for (const player of night.players) {
      lines.push(cashRow(night.date, player.name, player.buyIn, player.cashOut));
    }
    if ((night.jackpot ?? 0) > 0) lines.push(cashRow(night.date, JACKPOT, 0, night.jackpot ?? 0));
  }
  for (const payout of payouts) {
    const name = payout.name.trim();
    if (!(payout.amount > 0) || !payout.date || !name) continue;
    lines.push(cashRow(payout.date, `${JACKPOT} payout to ${name}`, payout.amount, 0));
  }
  return `${lines.join("\r\n")}\r\n`;
}

const LOG_HEADER = [
  "Tournament ID",
  "Date",
  "Title",
  "Status",
  "Venue",
  "Notes",
  "Buy-in ($)",
  "Top-up ($)",
  "Bounty amount ($)",
  "Starting stack",
  "Winner keeps own bounty",
  "1st place share",
  "2nd place share",
  "3rd place share",
  "Total collected ($)",
  "Bounty pool ($)",
  "Main prize pool ($)",
  "Data check",
];

const RESULTS_HEADER = [
  "Tournament ID",
  "Player",
  "Entries",
  "Rebuys",
  "Top-up",
  "Free entry",
  "Finish place",
  "Knockouts",
  "Main prize ($)",
  "Net profit ($)",
];

const flag = (value: boolean) => (value ? "TRUE" : "FALSE");
const textCell = (value: string | null) => (value ? cell(value) : "");

export type TournamentCsv = { log: string; results: string };

/**
 * The Tournament Log and Tournament Results sheets. Totals and prizes are the ones the app
 * works out, so importing the two files back agrees with the sheet's own data check.
 */
export function tournamentsToCsv(inputs: TournamentInput[]): TournamentCsv {
  const log = [LOG_HEADER.join(",")];
  const results = [RESULTS_HEADER.join(",")];
  for (const input of inputs) {
    const event = buildTournamentEvent(input);
    log.push(
      [
        cell(input.id),
        input.date,
        cell(input.title),
        "Completed",
        textCell(input.venue),
        textCell(input.notes),
        money(input.buyIn),
        money(input.topUp),
        money(input.bounty),
        String(input.startingStack),
        flag(input.winnerKeepsBounty),
        String(input.shares.first),
        String(input.shares.second),
        String(input.shares.third),
        money(event.totalCollected),
        money(event.bountyPool),
        money(event.mainPrizePool),
        cell(event.dataCheck ?? ""),
      ].join(","),
    );
    for (const result of event.results) {
      results.push(
        [
          cell(input.id),
          cell(result.player),
          String(result.entries),
          String(result.rebuys),
          flag(result.topUp),
          flag(result.freeEntry),
          result.finishPlace === null ? "" : String(result.finishPlace),
          String(result.knockouts),
          money(result.mainPrize),
          money(result.netProfit),
        ].join(","),
      );
    }
  }
  return { log: `${log.join("\r\n")}\r\n`, results: `${results.join("\r\n")}\r\n` };
}
