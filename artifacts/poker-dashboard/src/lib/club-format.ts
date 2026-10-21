// How the current club writes its name, hashtag, money and times. Plain module state rather
// than React state so the share-card and recap helpers (which are not components) can read it.
// The settings provider sets it once the club's settings have loaded.

export type ClubFormat = { name: string; hashtag: string | null; currency: string; timeZone: string };

let current: ClubFormat = { name: "Poker Club", hashtag: null, currency: "AUD", timeZone: "Australia/Melbourne" };

export function setClubFormat(next: Partial<ClubFormat>): void {
  current = { ...current, ...next };
}

export const clubName = () => current.name;
export const clubTimeZone = () => current.timeZone;
export const clubCurrency = () => current.currency;

/** "#myclub": the club's own tag, or its name squashed into one. */
export function clubHashtag(): string {
  const own = current.hashtag?.trim();
  if (own) return `#${own}`;
  const squashed = current.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `#${squashed || "pokerclub"}`;
}

/** File-name friendly version of the club name. */
export function clubFileSlug(): string {
  return current.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "poker-club";
}

// A few currencies read best in their home locale; everything else follows the browser.
const LOCALES: Record<string, string> = { AUD: "en-AU", NZD: "en-NZ", USD: "en-US", GBP: "en-GB", CAD: "en-CA", EUR: "en-IE", INR: "en-IN", SGD: "en-SG" };

export function moneyFormatter(maximumFractionDigits = 2): Intl.NumberFormat {
  return new Intl.NumberFormat(LOCALES[current.currency], { style: "currency", currency: current.currency, maximumFractionDigits });
}

export function currencySymbol(): string {
  return moneyFormatter(0).formatToParts(0).find((part) => part.type === "currency")?.value ?? "$";
}
