# Handoff: ledger work (for Cursor or anyone continuing)

State as of 31 Oct 2026. Last local run with S2 on top of S1: typecheck clean, API 135 tests, dashboard 99 tests, smoke 53/53.
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
`live_sessions.host_name` (L1), `live_sessions.bank_name`, `live_sessions.settle_up` (boolean, default false) and the new table `night_settlements` (L2), and the new table `jackpot_payouts` (L4: `club_id`, `player_id`, `cents`, `paid_at`, `paid_by`). S1 does not change the schema. Merging names does not either, so publishing S2 does not need a database push. The next structure step after S2 is admin edit and delete on the Games tab.

## How to work

```sh
fnm use 24; pnpm install
./scripts/dev-local.sh              # needs .env.local (see .env.local.example); API :8080, site :5173
pnpm run typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/poker-dashboard test
SMOKE_BASE_URL=http://localhost:5173 CHROME_PATH=<chrome> node scripts/smoke/smoke.mjs   # run from a folder with puppeteer-core; needs an empty/throwaway DB
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
- Member usage tracking stays, visible only to the platform admin (later, in the structure work).

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
- The "Record a night" form is gone from `components/club-data-panel.tsx`; `POST /clubs/current/sessions` still exists but the site no longer calls it. CSV, paste and Sheet history import stay in admin Setup.

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
Admins also see an **Admin** section on the Club tab: People (roles, emails, add a name), Setup (one-time history import and tournament CSV import, plus the night list that still lives there until the Games tab takes editing), Settings, and Danger (delete club, owner only, still confirmed by typing the name). Delete account stays on Me, behind Danger, and still asks for the password (or email) and a confirmation.

### S2. Merge two names
Done. No schema change, so no database push.
- `POST /api/clubs/current/players/merge/preview` and `POST /api/clubs/current/players/merge`. Club owner or admin only: a signed-in member gets 403, anyone else 401. The club comes from `adminClubId`. A name that is not in that club is 404.
- One transaction moves session results, ledger names (including who logged, edited or deleted an entry, and comments), tournament results, settle-up ticks, jackpot payouts, host, bank, started-by and ended-by, the balance choice when it names a player, the linked account, the profile picture, and usage rows. The removed name is deleted only after nothing still points at it.
- Same night in a cash game: buy-ins and cash-outs are added. Same tournament: results are added and prizes written down as amounts, unless both names took a top-up or both had a free entry, in which case the merge is refused and nothing changes. Same settle-up night: the tick stays only when both names were already settled. Two linked accounts are refused.
- The Club tab's Admin → People section (from S1) includes the merge form for an owner or admin: pick both names, preview what moves, then confirm. People starts collapsed. The preview says the merge cannot be undone.
- API tests live in `merge-players.test.mjs` and need `DATABASE_URL` (CI's checks job provides Postgres). Smoke covers the preview and confirm on a phone. Last local run on top of S1: typecheck clean, API 135, dashboard 99, smoke 53/53.

Next structure step: **admin edit and delete on the Games tab** (admins and hosts edit, reopen or delete a night from Games). Do not start the platform admin page or the Privacy change in that step.

## Known loose ends
- Real Monash member first names in the tests and mockup have been replaced with fictional ones. The git history (and the local `full-history` branch) still contains them and the old screenshots; do not make that history public.
- Dead but harmless: unused tables/columns (`auth_sessions`, `login_throttle`, `clubs.hashtag`, `invites.emailed_to`, `live_activity_events.sheet_hash`), `liveLedgerSheetRowRangesForSession` and the sheet helpers in `lib/live-ledger-utils.ts` / `lib/live-ledger-deletion.ts`, the empty `quarters` field in the dashboard payload, some `.recap-*` CSS.
- Not done: edit a recorded night from the Games tab (the reopen step covers the ledger side), jackpot rows in the CSV export, tournament CSV export, avatars still stored in Postgres. S1 (Me vs Club admin) is done. Merging two names is done (S2). Still ahead: Games-tab edit tools, the platform admin page replacing `/admin`, and the Privacy note that usage is for the platform owner only.
