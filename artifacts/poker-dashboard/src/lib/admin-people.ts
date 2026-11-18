/** Pure helpers for the admin People list: duplicate hints, filtering, junk-name flags. */

export type PersonRow = {
  playerId: number;
  name: string;
  role: "owner" | "admin" | "member" | null;
  /** Nights + tournaments this name appears in. */
  played: number;
};

export type PeopleFilter = "all" | "admins" | "members" | "unjoined";

const norm = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Edit distance, capped: returns max+1 as soon as the strings cannot be within max. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Trailing " 2", " J" style suffixes: "Jackie 2" -> "jackie". */
const stem = (name: string) => norm(name.replace(/\s+(\d+|[a-z])$/i, ""));

export type DuplicateHint = { keep: PersonRow; merge: PersonRow };

/** A name with this few games is likely a typo or a one-off spelling, so it gets looser matching. */
export const FEW_GAMES = 2;

/**
 * Do these look like the same person? Strict for established names; looser when one of them has
 * only a game or two, since a misspelling usually has just one game: "Shivv" against "Shiv".
 */
export function similarNames(a: PersonRow, b: PersonRow): boolean {
  const na = norm(a.name);
  const nb = norm(b.name);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const sa = stem(a.name);
  if (sa === stem(b.name) && sa.length >= 3) return true;
  const minLen = Math.min(na.length, nb.length);
  if (minLen >= 4 && editDistance(na, nb, 1) <= 1) return true;
  if (Math.min(a.played, b.played) <= FEW_GAMES) {
    const [short, long] = na.length <= nb.length ? [a.name.trim().toLowerCase(), b.name.trim().toLowerCase()] : [b.name.trim().toLowerCase(), a.name.trim().toLowerCase()];
    // "Shiv" inside "Shivam", or "Ben" before "Ben Ch".
    if (norm(short).length >= 4 && norm(long).startsWith(norm(short))) return true;
    if (norm(short).length >= 3 && long.startsWith(`${short} `)) return true;
  }
  return false;
}

/**
 * Pairs that look like the same person. The name with more history (or a joined account) is the one
 * to keep, and a joined account is never suggested as the one to fold away.
 */
export function suggestDuplicates(people: PersonRow[]): DuplicateHint[] {
  const hints: DuplicateHint[] = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i];
      const b = people[j];
      if (!similarNames(a, b)) continue;
      const score = (p: PersonRow) => (p.role ? 1_000_000 : 0) + p.played;
      const [keep, merge] = score(a) >= score(b) ? [a, b] : [b, a];
      if (merge.role) continue;
      hints.push({ keep, merge });
    }
  }
  return hints;
}

export type FirstGameFlag = {
  /** The name as typed on the night. */
  name: string;
  /** Not on the roster at all, as opposed to on it with no games yet. */
  isNew: boolean;
  /** Established names it resembles, most games first. */
  matches: PersonRow[];
};

/**
 * Names on a night being recorded that are about to have their first game and resemble someone who
 * already has history. Catches "Shivv" before it becomes a second person.
 */
export function firstGameFlags(names: string[], people: PersonRow[]): FirstGameFlag[] {
  const seen = new Set<string>();
  const flags: FirstGameFlag[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ");
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const existing = people.find((p) => p.name.trim().toLowerCase() === key);
    if (existing && existing.played > 0) continue;
    const candidate: PersonRow = { playerId: existing?.playerId ?? -1, name, role: existing?.role ?? null, played: 0 };
    const matches = people
      .filter((p) => p.playerId !== candidate.playerId && p.played > 0 && similarNames(candidate, p))
      .sort((a, b) => b.played - a.played)
      .slice(0, 3);
    if (matches.length > 0) flags.push({ name, isNew: !existing, matches });
  }
  return flags;
}

const JUNK = /^(asd+f*|test\d*|bad beat( jackpot)?( (cr|db))?|jackpot|x+|\.+)$/i;

/** Names that are probably not people: no history and a placeholder-looking name, or bad beat bookkeeping rows. */
export function looksLikeJunk(person: PersonRow): boolean {
  return JUNK.test(person.name.trim()) || (person.played === 0 && !person.role && person.name.trim().length <= 2);
}

export function filterPeople(people: PersonRow[], query: string, filter: PeopleFilter): PersonRow[] {
  const q = query.trim().toLowerCase();
  return people.filter((person) => {
    if (q && !person.name.toLowerCase().includes(q)) return false;
    if (filter === "admins") return person.role === "owner" || person.role === "admin";
    if (filter === "members") return person.role === "member";
    if (filter === "unjoined") return person.role === null;
    return true;
  });
}

export function peopleCounts(people: PersonRow[]) {
  return {
    all: people.length,
    admins: people.filter((p) => p.role === "owner" || p.role === "admin").length,
    members: people.filter((p) => p.role === "member").length,
    unjoined: people.filter((p) => p.role === null).length,
  };
}
