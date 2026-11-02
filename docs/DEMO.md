# Public demo (`/demo`)

The same app with a fake API that runs in the browser, so anyone can look around without an account.
Fictional club ("Riverside Poker Club"), made-up players, a guided tour and a "How it's built" step.
No server, database or real data is involved. Changes (live ledger entries, picture) last until refresh;
everything else answers "this is a demo".

- Linked from the landing page: **Try the demo** (`/demo/`) and **How it's built** (`/demo/?tour=built`).
- It is not a second build. Opening any URL under `/demo` loads the normal site (the host's `/* -> /index.html` rewrite
  does the routing), and `lib/demo-flag.ts` turns the demo on for that page load from the URL. Leaving the demo is a normal
  link (full page load), which drops the fake API again, so it can never touch the real site's data.
- Run locally: start the site as usual and open http://localhost:5173/demo/.

Where things live (`artifacts/poker-dashboard/src`):
- `lib/demo-flag.ts`: `IS_DEMO`, true when the page was opened under `/demo`.
- `demo/data.ts`: fictional players, seeded nights and tournaments, built with the server's own
  `club-dashboard.ts` and `tournament-native.ts`, so the payload shape cannot drift. Dates are counted back from today.
- `demo/mock-api.ts`: answers `/api/*` in the browser (loaded lazily from `main.tsx` before anything fetches). Unhandled GETs
  log `[demo] not handled` to the console; add them here if a new screen needs data.
- `demo/tour.tsx`: the walkthrough steps. `App.tsx` mounts it and gives the router the `/demo` base.
- `artifacts/api-server/src/lib/demo-data.test.mjs`: the demo payload must pass the real dashboard response schema.

Things that bit:
- A separate static build under `/demo` was tried first and failed on the live host: the folder URL was answered with the
  real app's 404 page. Serving the demo from the main bundle needs nothing from the host except the SPA rewrite.
- The demo does not register a service worker and turns off Wrapped's automatic popup so it does not cover the tour.
- Use query strings, not extra paths, for demo state (`?tour=built`).
