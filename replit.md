# Poker Clubs

Invite-only results tracking for social poker clubs. See [README.md](README.md) for what it is and how to run it,
[docs/DEPLOY.md](docs/DEPLOY.md) for deployment, and [docs/MULTI_CLUB_PLAN.md](docs/MULTI_CLUB_PLAN.md) for how it was built.

## Run & operate

- In Replit, use Run to start the managed workflows `artifacts/api-server: API Server` and
  `artifacts/poker-dashboard: web`, then open the Poker Clubs preview at `/`.
- The workspace uses Node 24. Run `pnpm install --frozen-lockfile` after importing or updating dependencies.
- The development PostgreSQL database is initialized with the existing schema. This is a fresh database;
  create an account in the preview, then create your first club.
- `APP_URL` is configured only for development. Before publishing, configure the production `APP_URL`
  to match the published address.
- No mail provider is configured: development emails are logged and available at `/api/dev/emails`.
  Real email delivery is optional; see [docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md).
- `pnpm --filter @workspace/api-server run dev`: API (port 8080)
- `pnpm --filter @workspace/poker-dashboard run dev`: site (needs `PORT`, `BASE_PATH=/` and `API_PROXY_TARGET`)
- `pnpm --filter @workspace/db run push`: create or update the database tables
- `pnpm run typecheck`, `pnpm --filter @workspace/api-server test`, `pnpm --filter @workspace/poker-dashboard test`
- Required env: `DATABASE_URL`, `SESSION_SECRET`, and in production `APP_URL`

## Stack

pnpm workspaces, Node 24, TypeScript. API: Express 5, Better Auth, Drizzle ORM, PostgreSQL, Zod. Site: React, Vite, Tailwind,
React Query, Recharts. Email: Resend.

## Where things live

- `artifacts/api-server/src/routes`: clubs, club data and settings, account, poker (dashboard + live ledger), admin
- `artifacts/api-server/src/lib`: auth and club access, club sessions and dashboard builder, import/export, tournaments, email
- `artifacts/poker-dashboard/src`: views, components, `lib/account-api.ts` (clubs and accounts), `lib/points.ts` (club points)
- `lib/db/src/schema`: database tables

## Notes

- Every club's data is scoped by `club_id`; the active club comes from the signed-in membership, never from a default.
- The original single-club Monash mode (access codes, Google Sheet reader) exists behind `MEMBER_ACCESS_CODES` or
  `LEGACY_DEFAULT_CLUB=true` and is off in a normal deployment.
