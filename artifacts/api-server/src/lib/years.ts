// Which year of a club's history the dashboard shows. The website slices results by month
// number, so a club with several years of history has to look at one year at a time (or at
// everything, without month and quarter slices). Pure, so it can be unit tested.

/** The calendar years a club has nights in, oldest first. */
export function yearsOf(dates: string[]): number[] {
  return [...new Set(dates.map((date) => Number(date.slice(0, 4))).filter((year) => Number.isInteger(year)))].sort((a, b) => a - b);
}

/**
 * What to show: the requested year or "all" when the club has that, else the latest year for a
 * club with more than one year of history, else everything (a one-year club never needs a switch).
 */
export function pickYear(years: number[], requested: string | undefined): string {
  if (requested === "all") return "all";
  if (requested && years.includes(Number(requested))) return String(Number(requested));
  return years.length > 1 ? String(years[years.length - 1]) : "all";
}
