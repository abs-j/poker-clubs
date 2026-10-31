# Handoff: ledger work (for Cursor or anyone continuing)

State as of 31 Oct 2026. Last local run after the dead-code cleanup, merged with jackpot CSV rows, tournament CSV export, and the Home/Leaderboard simplification: typecheck clean, API 138 tests, dashboard 99 tests, smoke 56/56. Schema unchanged.
Read first: `CLAUDE.md` (run and verify commands, gotchas), `docs/SIMPLIFICATION_PLAN.md` (decisions), then this file.

## What is done and merged

- Quick wins, CORS and security headers, balance-on-close (jackpot for a surplus, players for a shortfall).
- Four cuts: hashtag, custom points, emailed invites, admin avatars; Compare tab and share cards; the legacy Monash mode;
  Year/Quarter filters (seasons are calendar months, keys like `2026-10`).
- **The live site (https://pokerclubs.abhayjhade.com) is behind `main`.** Publishing is done from Replit (sync from GitHub, then Publish).
  Schema changes need `pnpm --filter @workspace/db run push`; Replit applies additive changes on Publish.
  The balance-on-close columns (`club_sessions.jackpot_cents`, `live_sessions.balance_resolution`) were already published.

## Where work stopped

L4 is done (jackpot payout, and tournaments started from the Live tab's New night menu). L3 (past nights and notes, no schema change), L2 (bank and settle-up) and L1 (hosts) are merged before it. Production needs `pnpm --filter @workspace/db run push` when a build with these is published; everything added is additive:
`live_sessions.host_name` (L1), `live_sessions.bank_name`, `live_sessions.settle_up` (boolean, default false) and the new table `night_settlements` (L2), and the new table `jackpot_payouts` (L4: `club_id`, `player_id`, `cents`, `paid_at`, `paid_by`). S1, merging names, Games-tab edit and delete, the platform usage page, and the Leaderboard label and Home content do not change the schema, so publishing them does not need a database push. The simplification plan's build order is finished. Nothing in that plan is left to start.

## How to work

```sh
fnm use 24; pnpm install
./scripts/dev-local.sh              # needs .env.local (see .env.local.example); API :8080, site :5173
pnpm run typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/poker-dashboard test
PLATFORM_ADMIN_EMAILS=smoke-platform@example.com SMOKE_BASE_URL=http://localhost:5173 CHROME_PATH=<chrome> node scripts/smoke/smoke.mjs   # run from a folder with puppeteer-core; needs an empty/throwaway DB. The API process needs the same PLATFORM_ADMIN_EMAILS.
```

Rules that bite: every query is scoped by `club_id` (take it from `memberClubId(res)` / `adminClubId(res)`); no migration files, so add new
columns to `lib/schema-check.ts`; the dashboard payload is validated by zod schemas generated from `lib/api-spec/openapi.yaml`
(`pnpm --filter @workspace/api-spec codegen` after editing it), so new data goes through separate endpoints like `lib/account-api.ts`
does. One PR per step, CI must be green, then merge.

## Decisions already made (do not re-ask)

- Roles: platform admin (site owner, via an email allow-list env var, view-only usage across clubs), club owner/admin, **host** (per night, not a role), member.
- **Host = whoever starts the night.** Admins can hand a night to someone else. One open night per club. Any member can start one.
- Any member can add entries for anyone. **Edit/delete an entry: the person who logged it, the night's host, or an admin.**
- **Close a night and make the balance choice: the host or an admin** (members who are not the host cannot close).
- Host or admin can **reopen** a closed night at any time; closing again rebuilds the result and the balance choice.
- **Bank**: optional, one player per night. After close, each player's net is listed with a **Settled** tick; host, bank or admin can tick.
  Home shows a player the nights they still owe or are owed on.
- **Past nights live in the ledger**: starting a night takes a date (default today); paste-notes and screenshot-notes fill its entries;
  the separate "Record a night" form goes away. One-time history import (CSV/paste/Google Sheet link) moves to the admin Setup area.
- **Jackpot payout**: host or admin records a payout to a player; the running total goes down and the payout shows in history.
- Tournaments are recorded from the Live tab's "New night" menu (host or admin); the tournament CSV import stays in admin Setup.
- Member usage tracking stays, visible only to the platform admin.

## Steps (one PR each, in this order)

### L1. Hosts, permissions, reopen
Done in PR #14. Host is `host_name`, or `started_by` when that is null. Reopening deletes the recorded night and clears the saved balance choice, so closing again records the night once and asks for the choice again if the ledger is still out. The balance choice is allowed for the host as well as an admin (`PUT /clubs/current/ledger/resolution` returns 403, not 401, when the caller cannot manage the night).

### L2. Bank and settle-up
Done. Schema: `live_sessions.bank_name` (text, nullable), `live_sessions.settle_up` (boolean, default false; set true for every night started from now on), and table
`night_settlements (club_id, club_session_id, player_id, settled_at, settled_by)` with a unique index on `(club_session_id, player_id)` and cascade delete, so reopening a night (which deletes its recorded night) clears its ticks.
`settle_up` exists so nights recorded before this shipped, imports and hand-entered nights are history: nobody is asked to settle them. Only tracked nights appear on Home and Games.
A player's net is cash-out minus buy-in after the balance choice (what `session_results` holds); a player who broke even has nothing to settle. No row in `night_settlements` means unsettled.
Endpoints (small ones, not the dashboard payload):
- `PUT /api/poker/live-session/bank` `{ name | null }`: host or admin; works on the open night or the latest closed one; the name must be on the roster or in tonight's ledger. `GET /api/poker/live-session/role` now also returns `bankName` and `nightId` (the recorded night of the latest closed session).
- `GET /api/clubs/current/settle-up`: the viewer's unsettled nights split into `owe` and `owed` (with totals and the bank), plus `nights` with `state` (`none`, `open`, `partial`, `settled`) and `sessionNumber` for the Games cards.
- `GET` and `PUT /api/clubs/current/nights/:id/settlement`: the per-player list; `PUT` takes `{ name, settled }` or `{ all: true, settled }`. Host, bank or admin (`canSettle` in `ledger-permissions.ts`); 403 otherwise, 404 for a night in another club or an untracked night.
UI: bank picker in the Live header, the Settle up list under the close summary, a "Settle up" card on Home (hidden when nothing is open), a "N to settle" or "Settled" label and the list on the Games cash card (`components/settle-up.tsx`).
Pure logic is in `lib/settle-up.ts` on both sides, with tests; smoke covers the API rules and the Home, Live and Games screens.

### L3. Past nights and notes inside the ledger
Done. No schema change.
- `POST /api/poker/live-session/start` takes an optional `{ date }` (`YYYY-MM-DD`, not in the future; default is the club's today). Invalid dates return 400 (`chooseLedgerDate` in `lib/live-ledger-utils.ts`).
- `getLatestSessionForDate` matches a night dated that day or closed that day, so a night for a past date is found and closed as the latest session. `endLiveSession` uses the same condition.
- `POST /api/poker/live-session/notes` `{ players: [{ name, buyInCents, cashOutCents }] }` adds buy-in and cash-out entries to the open night, created by the caller (host or admin only), with the comment "From notes". The Live tab shows it as "Fill from notes" (`components/ledger-notes.tsx`, using `lib/night-notes.ts`).
- `POST /clubs/current/sessions/notes-image` (screenshot reading) now needs a member session and is allowed only for the host or an admin of the open night (403 otherwise).
- The "Record a night" form and the uncalled `POST /clubs/current/sessions` route are gone. Editing a recorded night is still `PATCH /clubs/current/sessions/:id`. CSV, paste and Sheet history import stay in admin Setup.

### L4. Jackpot payout, tournaments from "New night"
Done. Schema: table `jackpot_payouts (club_id, player_id, cents, paid_at, paid_by)` with cascade delete from the club and restrict on the player, so a payout is not dropped when someone claims a different name. `clubJackpot()` subtracts those cents from the surplus. The pot cannot be overdrawn.
- `GET /api/clubs/current/jackpot` now also returns `payouts` (`name`, `amount` in dollars, `at`, `by`).
- `POST /api/clubs/current/jackpot/payouts` `{ name, amount }`: the host of the open or latest night, or an admin. 403 otherwise. 400 for an unknown player, a non-positive amount, or more than the pot holds.
- The jackpot card on Live shows the reduced total, the payout history, and (for the host or an admin) a form to record one.
- Live's start button is a **New night** menu: Cash night (any member, same as before) and Tournament (host or admin). The tournament form moved out of admin Setup; CSV import of past tournaments stays there.
- `POST /api/clubs/current/tournaments` is no longer admin-only. A member who is not the host gets 403. Deleting a tournament and importing tournament CSVs stay admin-only.

## After the ledger: structure work (see the plan)

### S1. Me and Club admin
Done. No schema change. The avatar menu opens **Me** (picture, record, trophies, password, theme, install, switch club, sign out, delete account). Club admin is no longer on that page.
The **Club** tab has the rules, a collapsible Members list, the invite link (copy, share and QR) and the jackpot. Every member can read the member invite via `GET /api/clubs/current/invite` (scoped by `club_id`; admin-role invites are not included). Creating, revoking and resetting stay on the existing admin routes (`POST` and `DELETE /api/clubs/current/invites`, and the admin list `GET /api/clubs/current/invites`).
Admins also see an **Admin** section on the Club tab: People (roles, emails, add a name), Setup (one-time history import and tournament CSV import), Settings, and Danger (delete club, owner only, still confirmed by typing the name). Delete account stays on Me, behind Danger, and still asks for the password (or email) and a confirmation. Recorded nights are edited and deleted from the Games tab.

### S2. Merge two names
Done. No schema change, so no database push.
- `POST /api/clubs/current/players/merge/preview` and `POST /api/clubs/current/players/merge`. Club owner or admin only: a signed-in member gets 403, anyone else 401. The club comes from `adminClubId`. A name that is not in that club is 404.
- One transaction moves session results, ledger names (including who logged, edited or deleted an entry, and comments), tournament results, settle-up ticks, jackpot payouts, host, bank, started-by and ended-by, the balance choice when it names a player, the linked account, the profile picture, and usage rows. The removed name is deleted only after nothing still points at it.
- Same night in a cash game: buy-ins and cash-outs are added. Same tournament: results are added and prizes written down as amounts, unless both names took a top-up or both had a free entry, in which case the merge is refused and nothing changes. Same settle-up night: the tick stays only when both names were already settled. Two linked accounts are refused.
- The Club tab's Admin → People section (from S1) includes the merge form for an owner or admin: pick both names, preview what moves, then confirm. People starts collapsed. The preview says the merge cannot be undone.
- API tests live in `merge-players.test.mjs` and need `DATABASE_URL` (CI's checks job provides Postgres). Smoke covers the preview and confirm on a phone.

### S3. Admin edit and delete on the Games tab
Done. No schema change, so no database push.
- The night list is gone from Club admin Setup. Setup is the one-time history import and the tournament CSV import. The copy there points people to the Games tab.
- `GET /api/clubs/current/game-tools` is for any signed-in member. It returns `{ admin, canReopen, reopenSessionNumber, nights }`. Night ids are included only for a club owner or admin. Session numbers match the Games cards (date, then id).
- `PATCH /api/clubs/current/sessions/:id` is admin-only. An imported or hand-entered night can change its date, names, buy-ins and cash-outs. A live-ledger night returns 409 and tells the caller to reopen it. A night in another club, or one that is already gone, is 404. A signed-in member gets 403. Signed out is 401.
- `DELETE /api/clubs/current/sessions/:id` is admin-only and returns 204. The UI asks first and says it cannot be undone. One transaction removes the night, its session results and its settle-up ticks. A live-ledger night also loses its ledger session, events and comments, so closing is not recorded again. If this night added money to the jackpot and deleting it would leave the pot short of what has already been paid out, the delete returns 409 and nothing is removed.
- `GET`, `PATCH` and `DELETE /api/clubs/current/tournaments/:id` are admin-only. Edit reuses the record form, including the fields the card does not show. Delete removes the results and the tournament in one transaction. Another club's id is 404.
- On the Games cards, an admin sees Edit and Delete. Reopen stays the existing host-or-admin flow (`POST /api/poker/live-session/reopen`) and is offered on the latest closed live night. Older live nights can be deleted, not reopened from the card.
- API tests are in `game-edits.test.mjs` (permissions, club scoping, cash totals, jackpot and settle-up, tournaments). Smoke covers the phone Games tab: edit a cash night, the irreversible delete for a night and a tournament, the night list gone from Setup, reopen landing on Live, plus a member seeing no edit or delete and another club getting 404. Last local run: typecheck clean, API 138, dashboard 99, smoke 54/54.

### S4. Platform usage page
Done. No schema change, so no database push.
- The site owner is an account whose email is in `PLATFORM_ADMIN_EMAILS` (comma-separated). Unset, empty, or only spaces means nobody. The check is case-insensitive and is read on each request.
- `GET /api/platform/usage` is the only way to read usage. Signed out is 401. Anyone else is 403. It returns every club's sign-ins, time on site and sections opened. It does not return email addresses, and it has no write method.
- The old club-admin usage routes (`/api/admin/visits`, `/api/admin/members`, `/api/admin/audit`, `/api/admin/health`) are gone (404). Ledger backup and reset stay as club-admin APIs and are not on this page.
- `/admin` is that page. A link labelled "Site usage" shows in the header, the avatar menu, and on the empty-club welcome, only when `platformAdmin` is true on `GET /api/auth/member/session`. Anyone else gets a not-found page and no link.
- The Privacy page (and the matching Terms sentence) says usage is visible only to the platform owner. Club admins still see member emails.
- Set `PLATFORM_ADMIN_EMAILS` in Replit Secrets. Smoke uses `smoke-platform@example.com` for that check, so the API process and the smoke process need the same value.

### S5. Leaderboard label and Home content
Done. No schema change, so no database push.
- The phone and desktop tabs read Home, Games, Live, Leaderboard, Club. The ranking table's label is Leaderboard (it had said Leaderboards). A player's page, opened from that tab, is titled Profile. The platform usage page calls that section Profile too.
- Home with no night on: your summary (all-time net, rank, cash and tournament split), your last game, anything you still owe or are owed, and the profit podium.
- Home while a night is on: the live banner instead of the summary and last game. The profit podium stays, and so does settle-up.
- The points podium, the points table, season highlights, and the optional running-totals chart stay on the Leaderboard. Club buzz stays, on the Club tab. The result-by-game chart stays on a profile. The separate latest-tournament card is gone; Games already lists tournaments, and the last-game card still states a tournament finish.

The simplification plan has no further steps.

## Known loose ends
- Real Monash member first names in the tests and mockup have been replaced with fictional ones. The git history (and the local `full-history` branch) still contains them and the old screenshots; do not make that history public.
- Unused tables and columns stay in `lib/db` on purpose. There is no migration and nothing was dropped, renamed, or altered: `auth_sessions`, `login_throttle`, `clubs.hashtag`, `invites.emailed_to`, `live_activity_events.sheet_hash`.
- The called dashboard route still returns an empty `quarters` field so that payload shape stays the same. Ledger backup and reset still return `sheetRows` / `clearedSheetRows` (always empty; there is no spreadsheet). `/api/healthz` is unchanged.
- Removed as unused, with no schema change: shadcn components nothing imported and the packages only they used; `.recap-*` and `.season-leader` CSS; the sheet row helpers (`liveLedgerSheetRowRangesForSession`, `normalizeGoogleSheetsDate`, `parseMelbourneTimestamp`, `formatLiveLedgerTimestamp`, `lib/live-ledger-deletion.ts`); the recap helper `pointsAfterNight`; uncalled routes `GET /api/auth/admin/session`, `GET` and `DELETE /api/admin/live-ledger/sessions`, and `POST /api/clubs/current/sessions`. `GET /api/clubs/current/tournaments` stays: the tournament CSV export tests list stored tournaments through it. Every other route the site, smoke, or tests still call is unchanged, including ledger backup and reset and the cash and tournament CSV downloads. `@opentelemetry/api` stays on the API: the production bundle leaves those imports external, and Better Auth and Drizzle load them at startup.
- Done, no schema change: the cash CSV (`GET /api/clubs/current/export.csv`, club owner or admin, same as before) includes jackpot rows. A surplus is a `Bad Beat Jackpot` row on that night (buy-in 0, cash-out the amount that went in). A payout is its own row, `Bad Beat Jackpot payout to <name>` (buy-in the amount that left, cash-out 0). Re-importing the file still records the players and skips those rows. Tournament log and results download from Club admin > Setup (`GET /api/clubs/current/tournaments/export/log.csv` and `.../results.csv`) and import back through the existing tournament CSV import.
- Not done, and not part of the simplification plan: avatars still stored in Postgres, a public landing page. S1 (Me vs Club admin), merging two names (S2), Games-tab edit and delete (S3), the platform usage page (S4), and the Leaderboard label and Home content (S5) are done. Reopen still covers editing the latest closed live night; older live nights are delete-only.
