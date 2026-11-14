export type InitialDashboardView = "overview" | "live" | "admin" | "guidelines";

/**
 * The view to open on a cold load. "?view=live" is the QR deep link. A hash such as "#admin-settings" (the
 * club admin blocks) or "#section-invites" opens the screen that holds that block, so links to them work
 * from a bookmark or an email, not only from inside the app.
 */
export function getInitialDashboardView(search: string, hash = ""): InitialDashboardView {
  const requestedView = new URLSearchParams(search).get("view");
  if (requestedView === "live") return "live";
  if (requestedView === "overview") return "overview";
  const anchor = hash.replace(/^#/, "");
  if (anchor.startsWith("admin-")) return "admin";
  if (anchor === "section-invites") return "guidelines";
  return "overview";
}

export function dashboardSearchForView(search: string, view: string): string {
  const params = new URLSearchParams(search);
  if (view === "live") {
    params.set("view", "live");
  } else {
    params.delete("view");
  }
  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : "";
}

export function buildLiveLedgerUrl(origin: string, baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const appBase = new URL(normalizedBaseUrl, origin);
  const liveUrl = new URL("dashboard", appBase);
  liveUrl.searchParams.set("view", "live");
  return liveUrl.toString();
}