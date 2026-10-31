# Poker Clubs: multi-club plan

This repo is a fork of the Monash Poker Dashboard (history kept), being turned into a hosted app where
anyone can sign up, create a club, or join one. Monash becomes club #1.

## Decisions

| Topic | Decision |
|---|---|
| Joining | Invite only (link / QR / code). No public directory. |
| Price | Free, possibly forever. No billing code. |
| Auth | Better Auth (self-hosted, Postgres via Drizzle, organization plugin for clubs/roles/invites). |
| Audience | Uni clubs and friend groups. Light moderation. |
| Data | Postgres is the source of truth. Google Sheets becomes a one-off import, not a runtime dependency. |
| Hosting | Replit, as a separate Repl and domain from the Monash site. Keep the app portable (plain Node + Postgres) but the Replit config stays. |
| Client | PWA first (already present). Native wrapper later if wanted. |

## Single-club assumptions to remove

| Assumption | Where | Replacement |
|---|---|---|
| One Google Sheet holds history | `SPREADSHEET_ID` in `artifacts/api-server/src/lib/poker-sheet.ts` | Club-scoped `sessions` / `session_results` tables |
| Per-name access codes in env | `MEMBER_ACCESS_CODES`, `lib/auth.ts` | Better Auth accounts + memberships |
| One global admin password | `ADMIN_PASSWORD` | Club roles (owner/admin/member) + platform super-admin |
| A person is a name string | `memberName` across routes, tables, avatars | `players` table with IDs, nullable `user_id` |
| Hardcoded points rules | `POINTS_RULES` in `poker-dashboard/src/lib/points.ts` | Per-club settings with presets |
| "Monash" copy | ~44 places (share cards, manifest, login, guidelines) | Club name/branding from settings |
| Tournaments parsed from a sheet snapshot | `tournament-parse.ts` | Native tournament entry |
| Replit Sheets connector | `poker-sheet.ts` | Stays for Monash only until Phase 3; other clubs use CSV/Sheet import |

## Target data model

- `clubs`, `memberships` (role, status), `invites` (token, role, expiry, max uses)
- `players` (club-scoped identity; `user_id` null until the person claims it)
- `sessions` (club, kind cash|tournament, date, status) and `session_results` (buy-in, cash-out, place, knockouts)
- `tournaments` (buy-in, rebuys, bounty, prize shares)
- Existing live-ledger tables gain `club_id` and `player_id`
- Better Auth owns users/accounts/sessions tables

## Tenancy rules

- Routes: `/api/clubs/:clubId/...`; web: `/c/:slug/...`, `/join/:code`.
- One `requireClubRole()` middleware resolves club + role; all queries go through a club-scoped helper.
- Add Postgres row-level security as a second layer.

## Phases

1. **Tenancy foundation**: `clubs`, `players`, `club_id` everywhere, Monash backfilled as club #1. No user-visible change.
2. **Accounts, create, join**: Better Auth, create-club, invite links, claim-your-name, roles. Retire access codes and admin password.
3. **Native data**: session/results entry, live-ledger close writes to DB, CSV + Sheet import, Monash history migration.
4. **Customization**: club settings, branding, points presets, editable guidelines, native tournaments.
5. **Launch hardening**: email (verify/reset), per-user rate limits, account/club deletion, avatar storage out of base64-in-Postgres, landing page, backups.

Smallest launchable slice: create club, invite link, join + claim name, live ledger, leaderboard from DB, CSV import.

## Risks

- Name-string to player-ID migration touches ~60 call sites (avatars, usage, ledger events).
- Who can edit results among strangers: roles, audit trail (exists for ledger), optional lock after N days.
- Keep the app record-keeping only (no money handling); add terms and an 18+ gate.
- 5s polling is fine for small clubs; move to SSE if needed.

## Phase 1 status (tenancy foundation): done

- New tables `clubs` and `players`; nullable `club_id` on `live_sessions`, `live_activity_events`, `member_avatars`, `member_usage`, `member_usage_activity`, `site_visits`, `auth_sessions`.
- Unique indexes for avatars and usage now include `club_id`.
- `ensureDefaultClub()` (lib/db) creates the Monash club, stamps every un-owned row, and registers each known name as a player. Idempotent; runs at API start via `getDefaultClubId()`.
- Reads and writes in the live ledger, avatars, usage, sign-in records and admin reports are scoped to the club. Every request resolves to the default club until Phase 2.
- Deploy order: `pnpm --filter @workspace/db run push`, then start the API (the backfill runs on boot).

Verified against a Postgres seeded with the old schema: push, backfill (twice), then login, start session, add entry, avatars.

Known gaps for later phases:
- `club_id` is still nullable; make it NOT NULL in Phase 2 once every write path passes a club.
- Sheet mirror, ledger reset, backup and targeted deletion in `live-activity.ts` still operate on the whole ledger and use one global advisory lock (`monash-live-session`). Fine for one club; must become per-club before a second club has live data.
- Edit/delete of a ledger entry looks up by `eventId` only (unguessable UUID); add an explicit club check when club comes from the request.
- `players` is populated but nothing reads it yet; the leaderboard still matches on name strings.
- Name normalisation exists twice (SQL in `default-club.ts`, `normalizeMemberKey` in `avatar-image.ts`); unify when `players` becomes the lookup.

## Phase 2 status (accounts, create, join): done

- Better Auth (email + password; Google when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set) under `/api/identity`.
  We use it for identity only: `clubs`, `players`, `memberships` and `invites` are our own tables, so no organization-plugin mapping.
- Create a club, invite by link/QR/code, claim an existing name or add a new one, roles (owner/admin/member), remove/leave, switch clubs.
- The active club comes from a cookie validated against membership on every request. Every route now takes its club from the session,
  not from a default. Ledger backup/reset/delete and the sheet mirror are club-scoped.
- A club other than the original reads no spreadsheet: its dashboard is empty and carries no sheet link.
- Legacy access codes and the admin password still work for the original club when `MEMBER_ACCESS_CODES` / `ADMIN_PASSWORD` are set,
  and are optional otherwise.

Known gaps:
- A new club's leaderboard stays empty: closing a live night is kept in ledger history and is not yet written to sessions/results.
  This is Phase 3 and is the next thing a real club will notice.
- "Monash" is still hard-coded in share cards, manifest, guidelines and install help (Phase 4).
- Email verification and password reset need an email provider (Phase 5). Until then a forgotten password cannot be recovered.
- `club_id` is still nullable on legacy tables; one global advisory lock still serialises live-session writes across clubs.
- Production needs `APP_URL` (the public https origin) so sign-in cookies and origin checks match.

## Phase 3 status (native data): done

- New tables `club_sessions` and `session_results`. Closed live-ledger nights, imported history and hand-entered nights all land
  there, and every club other than the original builds its dashboard from them (`club-dashboard.ts`, pure and unit tested). The
  original club keeps reading its Google Sheet.
- Closing a live night records it as a night straight away (`syncClosedLiveSessions`, idempotent, also catches up older nights).
  Deleting a closed ledger session or resetting the ledger removes the nights it produced.
- Import (admin): paste, CSV file, or a public Google Sheet link; preview first, then import; re-importing skips nights already
  recorded; one-click undo per import. The parser (`import-parse.ts`) accepts Monash's own layout (date only on the first row of
  a night, `$` amounts, a Total row), flat exports, any column order, `dd/mm` or `mm/dd` dates, rebuys as repeated rows, and skips
  totals/adjustment/jackpot rows while saying so. Run against the real Monash sheet it reads 69 nights and the same 62 players.
- Record a night by hand, list and delete recorded nights, and "That's me" so a member can claim an imported name.
- All 12 months are supported (the Monash reader only knew March to December).
- Fixed a Phase 2 leak: the admin audit log is now per club.

Known gaps:
- Months are keyed by month number only, so a club with several years of history sees October of every year merged. A proper
  season/year filter is the next thing to add to the dashboard payload.
- Tournaments are not native yet (the payload carries none for new clubs). Phase 4.
- Points rules are still the Monash constants (Phase 4).
- The original club still reads its sheet; moving it to the database is an import away (its own sheet link works) but has not been done.
- Two people cannot be merged after the fact; only an unused name can be swapped via "That's me".

## Phase 4 status (customization): done

- **Club settings** (admins edit, members read): name, hashtag, currency, timezone, and the club's own written rules. The club's name,
  hashtag, currency and timezone replace the hard-coded Monash copy on share cards, recaps and captions, file names, money
  formatting, live-ledger times and the page title. "Tonight" now follows the club's timezone (a Los Angeles club's night does not
  roll over at Melbourne midnight). The original club keeps its built-in rules text.
- **Points rules**: three presets (Standard, Social, Competitive) or fully custom numbers, bounds-checked on the server
  (`points-rules.ts`), with a live "what this scores" preview. The leaderboard, recaps and "How points work" all read the club's rules.
- **Years**: a club with more than one year of results sees the latest year by default, can switch year, or pick All time (which
  drops the month/quarter slices, since those would mix years). One-year clubs see no change.
- **Native tournaments**: record who finished where, entries, knockouts, optional bounty and prize split (or enter payouts by hand).
  Prize pools, returns and profit are worked out (`tournament-native.ts`); bounties not claimed by a knockout roll into the prize
  pool so the books always balance. They use the same payload as sheet tournaments, so the Games, tournament, points and recap
  screens work unchanged.

Known gaps:
- Tournament import (done later): admins choose the "Tournament Log" and "Tournament Results" tabs as CSV, preview, and import. Prizes, entries, knockouts and payouts are kept as recorded, then rebuilt and checked against the sheet's own totals. Needs `winner_keeps_bounty` on `club_tournaments` (run the db push). A free entry now covers only a player's first entry. No tournament CSV export yet.
- A tournament form with top-ups / free entries is supported by the API but not exposed in the form.
- Share cards still have Monash-flavoured sample copy in a few tests; the product name is "Poker Clubs" until a brand is chosen
  (`VITE_APP_NAME`).
- The `/public` snapshot page and the Google Sheets live mirror remain Monash-only.

## Phase 5 status (launch hardening): email done

- Resend (plain `fetch`, no SDK): confirm-your-email on sign-up (resendable from the Account page), forgot / reset password
  (single-use, one-hour link, other sessions revoked), and admins can email an invite (one use, 14 days, 20 a day per club).
  See [EMAIL_SETUP.md](EMAIL_SETUP.md) for the secrets to set. No key means log mode in development and email off in production.
- Rate limits on sign-in, sign-up, reset and confirm (production only).

## Phase 5 status (launch hardening): MVP-ready

- **Legacy isolated.** The original Monash mode (access codes, Google Sheet reader and mirror, public snapshot, the default club) is
  off unless `MEMBER_ACCESS_CODES` or `LEGACY_DEFAULT_CLUB=true` is set. A normal deployment creates no phantom club, runs no
  background sheet job and serves no Monash endpoint.
- **First-deploy safety.** The API checks the schema at start-up and says `Run: pnpm --filter @workspace/db run push` if it is missing.
- **Terms and Privacy pages**, a required "I'm 18 or over and agree" box at sign-up (the time is stored), and a notice for Google sign-in.
- **Account and club deletion.** Delete your account (password, or typed email for Google sign-ins): results stay in the club under the
  name, unlinked. An owner must hand the club over first (new "Make owner"), unless they are its only member, in which case it goes with
  them. Owners can delete a club by typing its name; every table is cleared. **CSV export** of a club's results (re-importable).
- **Change password** while signed in.
- Verified in production mode against an empty database: `Secure; HttpOnly; SameSite=Lax` cookies, untrusted origins refused, sign-in
  rate limited, email off handled quietly, no dev inbox route.
- Repo hygiene: Monash screenshots removed from the working tree, product README, `docs/DEPLOY.md` with a launch checklist, the
  scheduled live check no longer depends on the Monash sheet.

Not done, and fine for an MVP: avatars still live in Postgres, no public marketing page beyond the sign-in screen, no tournament CSV
export, no platform super-admin, no in-app way to edit a recorded night (delete and re-enter), per-instance rate-limit memory.

## Since MVP (Oct 2026)

- Night notes: paste "Ann - $10 -> $48" lines, or choose a screenshot of notes (Claude vision, optional `ANTHROPIC_API_KEY`, admin only, 20 reads per club per day).
- Tournament CSV import (Tournament Log and Tournament Results tabs) and one picker for both files.
- Deployed on Replit (Autoscale) at pokerclubs.abhayjhade.com.
- Launch audit (31 Oct): credentialed CORS restricted to trusted origins, API security headers, claim-a-name no longer fails when the
  current name only has tournament results, a share-ready invite is created with every new club, member empty state, Monash wording
  removed from generic screens. Larger UX work (admin area separate from "My account", retiring `/admin`) is still open.

