# Moving Monash Poker Society onto Poker Clubs

Old: https://monashpoker.abhayjhade.com (repo `abs-j/monash-poker-dashboard`, Repl "Monash Poker Dashboard").
New: https://pokerclubs.abhayjhade.com, Monash is a club there with its history imported.

Goal: one place for Monash results, every old link (bookmarks, home-screen icons, printed live-ledger QR codes)
lands members in the Monash club on the new site, and the old Repl stops costing money and reading the Sheet.

## What was checked (14 Nov 2026)

- Old site is still live and in use: `GET /api/poker/public-summary` reports 87 sessions, 62 players, latest game
  **2026-11-13**. Any night after the import was taken is not on the new site yet.
- Old URLs in the wild: `/`, `/dashboard`, `/dashboard?view=live&player=…` (live-ledger QR), `/public`, `/admin`,
  `?recap=…` / `?asOf=…` (Wrapped). Manifest `start_url` is `/dashboard`, so installed home-screen apps open there.
- Old site registers `sw.js` (network-first for pages, cache-first for `/assets/`). Online users will get a new
  `index.html` straight away; offline they would see the cached old app.
- Old site serves static files with a `/* -> /index.html` rewrite, so a real file like `sw.js` is still served as itself.
- New site: `/join/<code>` previews the club, lets a new member claim their imported name ("That's me"), and sends anyone
  already in the club straight to `/dashboard`. `/dashboard?view=live` opens the live ledger. Invites support no expiry
  and no use limit. Re-importing a sheet skips nights already recorded.
- Old members signed in with access codes; none of that carries over. Everyone needs a Poker Clubs account.

## The redirect (recommended design)

Send **every** old URL to the Monash invite link on the new site:

```
https://monashpoker.abhayjhade.com/<anything>  ->  https://pokerclubs.abhayjhade.com/join/<MONASH_CODE>?from=monash
```

Why the invite link rather than `/dashboard`: one URL does the right thing for everyone. Not signed up: sign up, join,
claim name. Signed in and already a member: JoinPage forwards to `/dashboard`. Not a member yet but has an account: joins.

Map `?view=live` through (`…/join/<code>?from=monash&next=live`) so QR codes on the table still open the ledger
(needs the small change below). Everything else (`/public`, `/admin`, recaps) just goes to the join link.

How to serve it, simplest first:

1. **Redirect-only build on the old Repl (recommended).** On a branch of the Monash repo, point the web artifact's
   `publicDir` at a tiny folder with:
   - `index.html`: `location.replace(target)` built from the current path/query, a `<meta http-equiv="refresh">`
     fallback, and a visible "We've moved" link for no-JS.
   - `sw.js` (kill switch): `skipWaiting`, delete every `poker-*` cache, `registration.unregister()`, then reload open
     clients so they hit the redirect. Browsers re-check `sw.js` on navigation, so this replaces the old worker.
   - `manifest.webmanifest` kept, so old icons still resolve while people switch.
   - Remove the API artifact from the deployment (no more Sheets reads or Postgres compute on that Repl).
   Fully reversible: republish `main` to undo. Low confidence that Replit's static serve supports true 301s, which is
   why this is a client-side redirect; for an invite-only club that does not matter (no SEO).
2. Later, optional: move the `monashpoker.abhayjhade.com` domain onto the Poker Clubs deployment and redirect by host,
   so the old Repl can be deleted. Not worth it at cutover: it touches `APP_URL`/`TRUSTED_ORIGINS` and would serve the new
   app's service worker on the old origin. A plain DNS-level redirect (Cloudflare/registrar URL forwarding) is the
   cleanest end state if your DNS host offers it; check before doing option 2.

Built 14 Nov 2026 on branch `redirect-to-pokerclubs` of the Monash repo (`redirect/`, see its README). The web artifact
publishes `redirect/public`, its build step (`redirect/check.mjs`) fails until `INVITE_CODE` is set in
`redirect/public/target.js`, and the API artifact is removed from the deployment. Tested: mapping unit tests and a local
serve (old `/dashboard?view=live` and `/public` land on the join link). Not tested: the old service worker being replaced
on a real phone, and Replit accepting the removed API artifact.

## Small changes on Poker Clubs (this repo): done 14 Nov 2026

Built in `lib/moved-notice.ts` (+ test), `components/moved-card.tsx`, `JoinPage` and Home. `from` and `next=live` survive
sign-up; any other `next` value is ignored. The card replaces the install card until dismissed or used.

- **Join page `next`**: honour `?next=live` (only that value, no open redirect) so the final hop is
  `/dashboard?view=live` instead of `/dashboard`. Applies both to "already a member" and after a fresh join.
- **"Moved from Monash" banner** when `?from=monash` is present (store it once, show once): "The Monash Poker site lives
  here now. Delete the old home-screen icon and add this one." Reuse `install-card.tsx`.
- Tests for both in `poker-dashboard` (`install-platform` / live-ledger-links style `.test.mjs`).

## Cutover steps

**Before (any day):**
1. Monash club settings on the new site: name, currency AUD, timezone Australia/Melbourne, points rules matching the
   old monthly table, Guidelines text.
2. Parity check: for each month compare nights, players and per-player net on the new leaderboard against the old site.
   Spot-check the 2026-10-04 tournament.
3. Give committee members admin (invite with role admin, or promote after they join).
4. Create the long-lived member invite (no expiry, no max uses) that the redirect will use. Record the code in the
   Monash repo's redirect branch only; it is effectively public once old links point at it, which is the same exposure
   as today's sharable invite. Revoke and re-point if it leaks somewhere unwanted.
5. Build and preview the redirect branch on the old Repl's dev URL; check all URL shapes above, with and without a
   previously installed service worker (open the old site once in a fresh profile, then switch builds).

**Cutover (between game nights, no live session open on the old site):**
1. Old admin page: download the live-ledger backup (sessions, entries, audit comments). Archive it with the DB dump.
2. Make sure the last night is in the Sheet, then re-import the Sheet (and tournament tabs if changed) into the Monash
   club. Already-recorded nights are skipped, so this only adds the delta (at least 2026-11-13 and later).
3. Re-run the parity check on the latest month.
4. Publish the redirect build on the old Repl. Verify from a phone: old bookmark, old home-screen icon, a live QR.
5. Post the announcement in the members' chat: new link, "sign up and tap That's me on your name", old icon can go.

**After:**
- Week 1: watch new sign-ups and unclaimed imported names (members who joined as a new name instead of claiming theirs
  need merging by an admin).
- Stop updating the Google Sheet; it becomes a read-only archive. Disconnect the Sheets connector on the old Repl.
- Keep the redirect up at least until the end of the 2027 season (QR codes, old icons). Take a final `pg_dump` of the
  old Repl's Postgres, then drop it to stop storage cost.

## Not migrated (by design)

Old access codes and sessions, name claims (members re-claim on join), sign-in and usage history, the `/public` snapshot.
Closed live-ledger sessions stay only in the backup; their results already went into the Sheet by hand and were imported.

## Open questions

- Are all nights after the import already on the new site, or does the delta import need doing? (Old site shows a game
  on 2026-11-13.)
- Does your DNS host for `abhayjhade.com` offer URL forwarding? If yes, that can replace the old Repl entirely later.
- Was anything recorded only in the old live ledger and never written to the Sheet?
