// Reads a club's past results out of pasted or uploaded spreadsheet text (CSV from a Google
// Sheet or Excel, or tab-separated text copied straight from a sheet). Forgiving on purpose:
// column order, money formats, date formats and "date only on the first row of a night"
// layouts are all accepted. Pure functions, so it can be unit tested.

export type DateOrder = "dmy" | "mdy";

export type ParsedNight = {
  /** "YYYY-MM-DD". */
  date: string;
  players: Array<{ name: string; buyIn: number; cashOut: number }>;
};

export type ParseResult = {
  nights: ParsedNight[];
  warnings: string[];
  rowsRead: number;
  rowsSkipped: number;
  /** Set when nothing could be read; the other fields are empty then. */
  error?: string;
};

export const MAX_IMPORT_ROWS = 50_000;
const MAX_WARNINGS = 25;

/** Splits text into rows of cells. The delimiter (tab, comma or semicolon) is detected from the first line. */
export function parseDelimited(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  const counts = {
    "\t": (firstLine.match(/\t/g) ?? []).length,
    ",": (firstLine.match(/,/g) ?? []).length,
    ";": (firstLine.match(/;/g) ?? []).length,
  };
  const delimiter = counts["\t"] > 0 ? "\t" : counts[";"] > counts[","] ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** "$1,234.50", "(20.00)", "-$5", "20" → a number. Blank and "-" mean zero. Anything else is null. */
export function parseMoney(raw: string): number | null {
  let value = raw.trim().replace(/[−–—]/g, "-");
  if (value === "" || value === "-") return 0;
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  value = value.replace(/[$£€\s,]/g, "");
  if (value.startsWith("-")) {
    negative = !negative;
    value = value.slice(1);
  }
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const amount = Math.round(Number(value) * 100) / 100;
  return negative ? -amount : amount;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (year < 2000 || year > 2100) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Reads the date formats people actually type. Returns "YYYY-MM-DD" or null. */
export function parseDate(raw: string, order: DateOrder = "dmy"): string | null {
  // Drop a leading weekday: "Fri 13/03/2026".
  const value = raw.trim().replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+(?=\d)/i, "");

  let match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (match) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    const first = Number(match[1]);
    const second = Number(match[2]);
    return order === "dmy" ? isoDate(year, second, first) : isoDate(year, first, second);
  }

  match = value.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (match && MONTHS[match[2].toLowerCase()]) {
    return isoDate(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1]));
  }

  match = value.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (match && MONTHS[match[1].toLowerCase()]) {
    return isoDate(Number(match[3]), MONTHS[match[1].toLowerCase()], Number(match[2]));
  }
  return null;
}

const normaliseHeader = (cell: string) => cell.trim().toLowerCase().replace(/[^a-z]+/g, " ").trim();

type Columns = { date: number; player: number; buyIn: number; cashOut: number; net: number };

function findHeader(rows: string[][]): { index: number; columns: Columns } | null {
  for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
    const headers = rows[index].map(normaliseHeader);
    const find = (test: (header: string) => boolean) => headers.findIndex(test);
    const date = find((header) => header === "date" || header === "game date" || header === "session date");
    const player = find((header) => ["player", "name", "member", "player name"].includes(header));
    const buyIn = find((header) => /^buy ?ins?$/.test(header) || header === "buyin" || header === "buy in total");
    const cashOut = find((header) => /^cash ?outs?$/.test(header) || header === "cashout");
    const net = find((header) => header === "net" || header === "profit" || header === "net profit");
    if (date >= 0 && player >= 0 && buyIn >= 0 && cashOut >= 0) {
      return { index, columns: { date, player, buyIn, cashOut, net } };
    }
  }
  return null;
}

// Lines that live in the same columns as players but are not people: totals, adjustments,
// a jackpot pot, hidden balance rows. They are skipped, and the import says which it skipped.
const NOT_A_PLAYER = /^(?:(?:grand\s+)?(?:sub\s*)?totals?|adj(?:ustments?)?|balance\b.*|bad beat jackpot|jackpot)$/i;

export function parseHistory(text: string, options: { dateOrder?: DateOrder } = {}): ParseResult {
  const order = options.dateOrder ?? "dmy";
  const empty = (error: string): ParseResult => ({ nights: [], warnings: [], rowsRead: 0, rowsSkipped: 0, error });
  if (!text.trim()) return empty("Paste your results or choose a file first.");

  const rows = parseDelimited(text);
  if (rows.length > MAX_IMPORT_ROWS) return empty(`That is more than ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split it into smaller files.`);
  const header = findHeader(rows);
  if (!header) {
    return empty("Couldn't find the columns. The first row needs Date, Player, Buy-in and Cash-out headings.");
  }
  const { columns } = header;

  const warnings: string[] = [];
  const warn = (message: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(message);
    else if (warnings.length === MAX_WARNINGS) warnings.push("…and more.");
  };

  const nights: ParsedNight[] = [];
  let current: ParsedNight | null = null;
  // After a date we couldn't read, the rows under it are skipped quietly: one warning is enough.
  let inUnreadableBlock = false;
  let rowsRead = 0;
  let rowsSkipped = 0;
  const skippedNames = new Set<string>();

  for (let index = header.index + 1; index < rows.length; index += 1) {
    const cells = rows[index];
    const line = index + 1;
    if (cells.every((cell) => cell.trim() === "")) continue;
    const cell = (column: number) => (column >= 0 ? (cells[column] ?? "").trim() : "");

    const name = cell(columns.player).replace(/\s+/g, " ");
    const rawDate = cell(columns.date);
    let startsNight = false;
    if (rawDate) {
      const date = parseDate(rawDate, order);
      if (!date) {
        warn(`Row ${line}: couldn't read the date "${rawDate}", so the rows under it were skipped.`);
        current = null;
        inUnreadableBlock = true;
        rowsSkipped += 1;
        continue;
      }
      inUnreadableBlock = false;
      if (!current || current.date !== date) startsNight = true;
      else startsNight = current.players.some((player) => player.name.toLowerCase() === name.toLowerCase());
      if (startsNight) {
        current = { date, players: [] };
        nights.push(current);
      }
    }

    if (!name) {
      rowsSkipped += 1;
      continue;
    }
    if (NOT_A_PLAYER.test(name)) {
      skippedNames.add(name);
      rowsSkipped += 1;
      continue;
    }
    if (!current) {
      if (!inUnreadableBlock) warn(`Row ${line}: "${name}" has no date above it, so it was skipped.`);
      rowsSkipped += 1;
      continue;
    }

    const buyIn = parseMoney(cell(columns.buyIn));
    const cashOut = parseMoney(cell(columns.cashOut));
    if (buyIn === null || cashOut === null) {
      warn(`Row ${line}: couldn't read the amounts for ${name}.`);
      rowsSkipped += 1;
      continue;
    }
    if (buyIn < 0 || cashOut < 0) {
      warn(`Row ${line}: ${name} has a negative buy-in or cash-out, so it was skipped.`);
      rowsSkipped += 1;
      continue;
    }
    if (buyIn === 0 && cashOut === 0) {
      rowsSkipped += 1;
      continue;
    }

    const net = columns.net >= 0 ? parseMoney(cell(columns.net)) : null;
    if (net !== null && cell(columns.net) !== "" && Math.abs(net - (cashOut - buyIn)) > 0.011) {
      warn(`Row ${line}: ${name}'s Net doesn't match cash-out minus buy-in. Used the buy-in and cash-out.`);
    }

    const existing = current.players.find((player) => player.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      // A second row for the same person on a night is a rebuy: add it to their total.
      existing.buyIn = Math.round((existing.buyIn + buyIn) * 100) / 100;
      existing.cashOut = Math.round((existing.cashOut + cashOut) * 100) / 100;
    } else {
      current.players.push({ name, buyIn, cashOut });
    }
    rowsRead += 1;
  }

  if (skippedNames.size > 0) {
    warn(`Skipped rows that aren't players: ${[...skippedNames].slice(0, 6).join(", ")}${skippedNames.size > 6 ? "…" : ""}.`);
  }
  const kept = nights.filter((night) => night.players.length > 0);
  if (kept.length === 0) {
    return { nights: [], warnings, rowsRead, rowsSkipped, error: "No results could be read from that. Check the headings and amounts." };
  }
  for (const night of kept) {
    const buy = night.players.reduce((sum, player) => sum + player.buyIn, 0);
    const cash = night.players.reduce((sum, player) => sum + player.cashOut, 0);
    if (Math.abs(buy - cash) > 0.5) {
      warn(`${night.date}: buy-ins and cash-outs differ by $${Math.abs(buy - cash).toFixed(2)}. Imported as it is.`);
    }
  }
  return { nights: kept, warnings, rowsRead, rowsSkipped };
}

/** Two nights with the same date and the same amounts per person are the same night. */
export function nightFingerprint(night: ParsedNight): string {
  const parts = night.players
    .map((player) => `${player.name.trim().replace(/\s+/g, " ").toLowerCase()}:${Math.round(player.buyIn * 100)}:${Math.round(player.cashOut * 100)}`)
    .sort();
  return `${night.date}|${parts.join(",")}`;
}

/** Turns a Google Sheets link into the address of its CSV export. Only docs.google.com sheets are allowed. */
export function sheetExportUrl(link: string): string | null {
  const id = link.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1];
  if (!id) return null;
  const gid = link.match(/[#&?]gid=(\d{1,12})/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}
