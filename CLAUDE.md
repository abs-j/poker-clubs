# Poker Clubs: working notes

Invite-only poker club results tracker (React + Vite site, Express 5 API, Better Auth, Drizzle + Postgres).
Read `README.md` first, then `docs/MULTI_CLUB_PLAN.md` (what was built, phase by phase, and what is left).
This is the general product. The separate Monash Poker Society site lives in another repo and folder
(`../Monash Poker Dashboard`, `abs-j/monash-poker-dashboard`) and must not be touched from here.

## State

MVP-ready. Phases 1 to 5 are done: multi-club data, accounts and invites, native results and CSV/Sheet import,
club settings and points rules, years, tournaments, email (Resend), Terms/Privacy, account and club deletion,
CSV export. Pushed to the private repo `abs-j/poker-clubs` as one clean commit; the old 234-commit Monash-derived
history exists only on the local branch `full-history` (it contains Monash screenshots; don't push it public).

## Next, in order

1. **Deploy on Replit**: done. Live at https://pokerclubs.abhayjhade.com (Autoscale). Still to do: run the launch checklist in
   `docs/DEPLOY.md` end to end (restore drill, `LIVE_SITE_URL`).
2. **Resend**: live site reports email on. Confirm real delivery (`docs/EMAIL_SETUP.md`) and `VITE_CONTACT_EMAIL`.
3. **Before making the repo public:** replace real Monash member first names in the tests/mockup
   (`import-parse.test.mjs`, `podium.test.mjs`, `recaps.test.mjs`, `share-card.test.mjs`, `mockup-sandbox/.../StoryFirst.tsx`),
   and remove the legacy Monash sheet code (`poker-sheet.ts`, the sheet mirror in `live-activity.ts`, `SPREADSHEET_ID`).
   Have the Terms/Privacy text (`artifacts/poker-dashboard/src/views/legal.tsx`) reviewed.
4. Nice to have: avatars out of Postgres, a public landing page, edit a recorded night, tournament CSV import/export.

## Run it

Node 24 (`fnm use 24`), pnpm, Postgres. Copy `.env.local.example` to `.env.local`, then `./scripts/dev-local.sh`
(API :8080, site :5173). With no mail key emails go to the server log and `GET /api/dev/emails`.

## Verify changes

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server test       # node --experimental-strip-types needs Node 22+/24
pnpm --filter @workspace/poker-dashboard test
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/poker-dashboard build
```

End-to-end: `scripts/smoke/smoke.mjs` (run it from a folder with `puppeteer-core` installed). It needs the real API and
site running with the legacy access-code env set, because its first half checks the Monash legacy mode:
`SMOKE_BASE_URL=http://localhost:5173 SMOKE_MEMBER_CODE=<code> SMOKE_ADMIN_PASSWORD=<pw> CHROME_PATH=<chrome> node scripts/smoke/smoke.mjs`.
CI (`.github/workflows/ci.yml`) does this on every push; it passed on the first push.
Last local run (31 Oct 2026): 118 API tests, 115 dashboard tests, typecheck clean. Smoke last run at 52/52 earlier.

## Things that bit before

- Every club's data is scoped by `club_id`; the active club comes from the signed-in membership, never a default.
  Any new route must take its club from `memberClubId(res)` / `adminClubId(res)`.
- The legacy Monash mode (access codes, Google Sheet reader and mirror, public snapshot, default club) is OFF unless
  `MEMBER_ACCESS_CODES` or `LEGACY_DEFAULT_CLUB=true`. `getDefaultClubId()` returns `null` otherwise.
- No migration files: schema changes are applied with `pnpm --filter @workspace/db run push`. The API refuses to start
  (clear message) if tables or recent columns are missing; add new columns to `lib/schema-check.ts`.
- The dashboard payload is validated by generated zod schemas from `lib/api-spec/openapi.yaml`, which strips unknown fields.
  New club data therefore goes through separate endpoints (see `lib/account-api.ts` in the site) instead of the dashboard payload.
- Better Auth in production only trusts `APP_URL` (and `TRUSTED_ORIGINS`); localhost is trusted only outside production.
- This machine's system Python lacks root certificates: fetch with `curl`, not `urllib`.
- Postgres' unix-socket path is too long under the temp dir; start a throwaway one with `-c unix_socket_directories=''`.
