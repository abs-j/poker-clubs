# Handoff: ledger work (for Cursor or anyone continuing)

State as of 31 Oct 2026. `main` is clean and green (typecheck, API 115 tests, dashboard 95 tests, browser smoke 45/45 in CI).
Read first: `CLAUDE.md` (run and verify commands, gotchas), `docs/SIMPLIFICATION_PLAN.md` (decisions), then this file.

## What is done and merged

- Quick wins, CORS and security headers, balance-on-close (jackpot for a surplus, players for a shortfall).
- Four cuts: hashtag, custom points, emailed invites, admin avatars; Compare tab and share cards; the legacy Monash mode;
  Year/Quarter filters (seasons are calendar months, keys like `2026-10`).
- **The live site (https://pokerclubs.abhayjhade.com) is behind `main`.** Publishing is done from Replit (sync from GitHub, then Publish).
  Schema changes need `pnpm --filter @workspace/db run push`; Replit applies additive changes on Publish.
  The balance-on-close columns (`club_sessions.jackpot_cents`, `live_sessions.balance_resolution`) were already published.

## Where work stopped

L1 is merged (PR #14). `live_sessions.host_name` is additive and nullable; production still needs `pnpm --filter @workspace/db run push` when that build is published. Nothing from L2 is started. Continue with L2 below.

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
`live_sessions.bank_name`; new table `night_settlements (club_session_id, player_id, settled_at, settled_by)` or a column on `session_results`.
Endpoints: set bank (host/admin), tick/untick settled (host/bank/admin). UI: bank picker on the ledger; after close, a per-player Settled list;
Home card "you owe / are owed" from unsettled nights. Add a "settled" state to the Games night card.

### L3. Past nights and notes inside the ledger
Start-night takes a date (server: allow a past date; `liveLedgerSessionDate` and `getLatestSessionForDate` in `lib/live-activity.ts` assume today).
Move the paste-notes and screenshot tools from `components/club-data-panel.tsx` (`box-night-notes`, `lib/night-notes.ts`, `/clubs/current/sessions/notes-image`)
into the ledger as "Fill from notes" creating entries as the host. Remove the "Record a night" form once covered. Keep the CSV/paste/Sheet history import in admin Setup.

### L4. Jackpot payout, tournaments from "New night"
Payout: table or column recording `(club_id, player_id, cents, at, by)`; `clubJackpot()` in `lib/club-sessions.ts` subtracts payouts; UI on the jackpot card in `live-view.tsx`.
"New night" menu on the Live tab with Cash night and Tournament; the tournament form currently lives in `components/club-data-panel.tsx`.

## After the ledger: structure work (see the plan)
Split My account into Me and Club admin (Club tab gets an Admin section: People, Setup, Settings, Danger); make Members/invite link available to all members
(admins reset it); merge two names; admin Games-tab edit/delete; platform admin page (email allow-list env var, usage across clubs) replacing `/admin`; update the Privacy page
so usage is visible only to the platform owner; Leaderboard tab label and Home content per the plan.

## Known loose ends
- Real member first names remain in `artifacts/api-server/src/lib/import-parse.test.mjs`, `artifacts/poker-dashboard/src/lib/podium.test.mjs`, `artifacts/mockup-sandbox/.../StoryFirst.tsx`; replace before making the repo public.
- Dead but harmless: unused tables/columns (`auth_sessions`, `login_throttle`, `clubs.hashtag`, `invites.emailed_to`, `live_activity_events.sheet_hash`), `liveLedgerSheetRowRangesForSession` and the sheet helpers in `lib/live-ledger-utils.ts` / `lib/live-ledger-deletion.ts`, the empty `quarters` field in the dashboard payload, some `.recap-*` CSS.
- Not done: edit a recorded night (the reopen step covers it), jackpot rows in the CSV export, tournament CSV export, avatars still stored in Postgres.
