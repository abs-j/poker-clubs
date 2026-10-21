# Poker Clubs

Invite-only results tracking for social poker nights: a live buy-in / cash-out ledger, leaderboards, club
points, tournaments, season and year views, and shareable recap cards. Built for uni clubs and friend groups.
Free to run; it never handles money, it only records what members enter.

- **Anyone can sign up and start a club**, then invite people by link, QR code or email. Joining is by invite only.
- **Players are claimable.** History can be imported first (CSV, paste, or a Google Sheet link) and members claim
  their name when they join.
- **Each club sets its own** name, currency, timezone, rules text and how club points are scored.

## Run it locally

Needs Node 24, pnpm and Postgres.

```sh
pnpm install
export DATABASE_URL=postgres://localhost/poker_clubs SESSION_SECRET=any-long-random-string
pnpm --filter @workspace/db run push                     # create the tables
pnpm --filter @workspace/api-server run dev              # API on :8080
PORT=5173 BASE_PATH=/ API_PROXY_TARGET=http://localhost:8080 pnpm --filter @workspace/poker-dashboard run dev
```

Without a mail provider the app runs in *log mode*: emails are printed to the server log and readable at
`GET /api/dev/emails`. See [docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md) to send real mail.

## Checks

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/poker-dashboard test
```

CI also starts the real API and site and runs a browser smoke test (`scripts/smoke/smoke.mjs`).

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md): secrets, the one-time schema step, and a launch checklist.

## Layout

- `artifacts/poker-dashboard`: the React site (Vite, Tailwind)
- `artifacts/api-server`: the Express API (Better Auth for sign-in, Drizzle + Postgres)
- `lib/db`: the database schema
- `docs/MULTI_CLUB_PLAN.md`: how the product was built and what is left
