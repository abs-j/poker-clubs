# Public demo (`/demo`)

A static copy of the site with a fake API that runs in the browser, so anyone can look around without an account.
Fictional club ("Riverside Poker Club"), made-up players, a guided tour and a "How it's built" step.
No server, database or real data is involved. Changes (live ledger entries, picture) last until refresh;
everything else answers "this is a demo".

- Linked from the landing page: **Try the demo** (`/demo/`) and **How it's built** (`/demo/?tour=built`).
- Production: `pnpm --filter @workspace/poker-dashboard run build` builds the site and then the demo into
  `dist/public/demo`, so one deploy ships both. The static host must serve real files before the `/* -> /index.html` rewrite.
- Run locally: `pnpm --filter @workspace/poker-dashboard run dev:demo` (http://localhost:5174/demo/).
- Build only the demo: `build:demo`.

Where things live (`artifacts/poker-dashboard/src`):
- `lib/demo-flag.ts`: `IS_DEMO`, set by `VITE_DEMO=true` at build time. The real build never includes the demo code.
- `demo/data.ts`: fictional players, seeded nights and tournaments, built with the server's own
  `club-dashboard.ts` and `tournament-native.ts`, so the payload shape cannot drift. Dates are counted back from today.
- `demo/mock-api.ts`: answers `/api/*` in the browser (installed in `main.tsx` before anything fetches). Unhandled GETs
  log `[demo] not handled` to the console; add them here if a new screen needs data.
- `demo/tour.tsx`: the walkthrough steps. `App.tsx` mounts it and gives the router the `/demo` base.
- `artifacts/api-server/src/lib/demo-data.test.mjs`: the demo payload must pass the real dashboard response schema.

Things that bit:
- `public/sw.js` ignores `/demo`. Without that, visiting the demo would cache its HTML as the real app's offline shell.
- The demo does not register a service worker and turns off Wrapped's automatic popup so it does not cover the tour.
- Deep links under `/demo/` other than `/demo/` fall through to the real site's index on a static host. The demo uses query strings only.
