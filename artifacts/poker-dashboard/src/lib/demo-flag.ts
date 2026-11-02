/**
 * True when the page was opened under /demo. The demo is the same app with a fake in-browser API,
 * so it works wherever the real site's index.html is served. It is decided once per page load:
 * leaving the demo is a full page load (a normal link), which drops the fake API again.
 */
export const IS_DEMO = typeof window !== "undefined" && (window.location.pathname === "/demo" || window.location.pathname.startsWith("/demo/"));
