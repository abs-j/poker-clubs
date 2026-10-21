// A club's results as CSV, in exactly the layout the importer reads, so an export can be re-imported
// (into the same club after a mishap, or into another one). Pure, so it can be unit tested.
import type { NightInput } from "./club-dashboard";

const cell = (value: string | number): string => {
  const text = String(value);
  // Quote anything a spreadsheet could misread, and defuse cells that start like a formula.
  const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const money = (value: number) => value.toFixed(2);

export function nightsToCsv(nights: NightInput[]): string {
  const lines = ["Date,Player,Buy-in,Cash-out,Net"];
  for (const night of nights) {
    for (const player of night.players) {
      lines.push([night.date, cell(player.name), money(player.buyIn), money(player.cashOut), money(player.cashOut - player.buyIn)].join(","));
    }
  }
  return `${lines.join("\r\n")}\r\n`;
}
