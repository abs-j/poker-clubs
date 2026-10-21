import { useEffect, useState } from "react";

type Years = { years: number[]; selected: string };

/**
 * Which year of the club's history the site shows. Only appears once a club has more than one
 * year of results: the month and quarter slices are per year, so a long-running club picks one.
 */
export function YearPicker() {
  const [data, setData] = useState<Years | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/clubs/current/years", { credentials: "include", cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Years>) : null))
      .then((body) => !cancelled && setData(body))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || data.years.length < 2) return null;

  const change = async (year: string) => {
    const response = await fetch("/api/clubs/current/year", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year }),
    });
    if (response.ok) window.location.reload();
  };

  return (
    <label className="print-hidden ml-auto flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      <span className="sr-only sm:not-sr-only">Year</span>
      <select
        value={data.selected}
        onChange={(event) => void change(event.target.value)}
        aria-label="Year to show"
        data-testid="select-year"
        className="h-9 rounded-lg border border-border bg-card px-2 text-xs font-semibold normal-case tracking-normal text-foreground"
      >
        {[...data.years].reverse().map((year) => (
          <option key={year} value={String(year)}>{year}</option>
        ))}
        <option value="all">All time</option>
      </select>
    </label>
  );
}
