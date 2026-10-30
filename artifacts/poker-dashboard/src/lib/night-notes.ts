// Reads a night out of notes someone typed or pasted ("Ann - $10 -> $48"), so the record-a-night
// form can be filled in without retyping. Forgiving on purpose: arrows, dashes, "to", rebuys added
// with "+", stray symbols and trailing "(+38)" notes are all accepted. Pure functions, no network.

export type NoteRow = { name: string; buyIn: string; cashOut: string };

export type NoteResult = {
  rows: NoteRow[];
  /** Names that aren't in the roster; they'd be added as new players. */
  newNames: string[];
  /** Lines that had a name but no readable amounts. */
  skipped: string[];
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const AMOUNT = /\d+(?:\.\d{1,2})?/g;
const ARROW = /(?:->|=>|→|➔|➜|>|\bto\b)/i;
const format = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

/** The name is everything before the first amount: the first "$", or else the first number after a separator. */
function splitLine(line: string): { name: string; amounts: string } | null {
  const dollar = line.indexOf("$");
  const bare = line.search(/[\s:=-]\d/);
  const cut = dollar >= 0 ? dollar : bare >= 0 ? bare + 1 : -1;
  if (cut < 0) return null;
  const name = line.slice(0, cut).replace(/[\s\-–—:=,]+$/, "").replace(/\s+/g, " ").trim();
  return name ? { name, amounts: line.slice(cut) } : null;
}

export function parseNightNotes(text: string, roster: string[] = []): NoteResult {
  const known = new Map(roster.map((name) => [name.trim().toLowerCase(), name.trim()]));
  const rows: NoteRow[] = [];
  const newNames: string[] = [];
  const skipped: string[] = [];
  const index = new Map<string, number>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    if (!line) continue;
    const parts = splitLine(line);
    const amounts = parts?.amounts.match(AMOUNT)?.map(Number) ?? [];
    if (!parts || amounts.length < 2) {
      skipped.push(raw.trim());
      continue;
    }

    // With an arrow, everything before it is buy-in (a rebuy is "20 + 20") and the first amount after it is the cash-out.
    // Without one, the last amount is the cash-out and the rest are buy-ins.
    const arrow = parts.amounts.search(ARROW);
    const before = arrow >= 0 ? (parts.amounts.slice(0, arrow).match(AMOUNT) ?? []).map(Number) : [];
    const after = arrow >= 0 ? (parts.amounts.slice(arrow).match(AMOUNT) ?? []).map(Number) : [];
    const buyIns = before.length > 0 && after.length > 0 ? before : amounts.slice(0, -1);
    const cashOut = before.length > 0 && after.length > 0 ? after[0] : amounts[amounts.length - 1];
    const buyIn = round2(buyIns.reduce((sum, value) => sum + value, 0));

    const name = known.get(parts.name.toLowerCase()) ?? parts.name;
    if (!known.has(name.toLowerCase()) && !newNames.some((existing) => existing.toLowerCase() === name.toLowerCase())) newNames.push(name);

    const key = name.toLowerCase();
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, rows.length);
      rows.push({ name, buyIn: format(buyIn), cashOut: format(round2(cashOut)) });
    } else {
      // The same person listed twice on one night is a rebuy.
      rows[at] = { name: rows[at].name, buyIn: format(round2(Number(rows[at].buyIn) + buyIn)), cashOut: format(round2(Number(rows[at].cashOut) + cashOut)) };
    }
  }
  return { rows, newNames, skipped };
}
