> **Legacy document.** This describes the original single-club Monash site (Google Sheets, access codes). The multi-club product is described in [MULTI_CLUB_PLAN.md](MULTI_CLUB_PLAN.md) and [DEPLOY.md](DEPLOY.md).

# Monash Poker Society Website: Features, APIs, and Integrations

This document describes the website and supporting services currently present in this repository. It is intended as both a product overview and a technical reference. It does not contain secret values.

## 1. What the website does

The website has three access levels:

1. **Public snapshot** — a limited, aggregate view of club activity.
2. **Members** — the full historical poker dashboard and live session ledger.
3. **Administrators** — member sign-in and usage reports plus live-ledger maintenance tools.

The website does not take payments, manage poker accounts, or provide a general-purpose player account system. Member identity is determined by the configured member access codes.

In the live ledger, a newly typed player name is an attribution for that ledger activity; it does not create a member login or permanently register a player account. Per-player net profit is cash-outs minus buy-ins. The overall live-ledger balance is buy-ins minus cash-outs.

## 2. Features by audience

### Public snapshot

- Shows aggregate club activity, such as recorded sessions, total players, latest activity date, and games played over time.
- Provides links to member sign-in.
- The public summary API deliberately excludes player identities, rankings, financial totals, sheet links, and individual session records.

### Member dashboard

Members sign in with an access code and can use these sections:

- **Overview** — selected-period or all-time leaderboard highlights, rank movement, session activity chart, and period performance table.
- **Session log** — dated cash-game and tournament event cards, player results, and event details. Earnings scope can be narrowed to cash games, tournaments, or combined earnings, and the selected month or quarter controls the relevant views.
- **Live ledger** — start/resume and close a live session; record buy-ins/rebuys and cash-outs; attribute entries to the member or another player; enter new player names; see activity, player totals, net profit, and session balance; edit or remove entries with a reason; review closed live sessions; retry a sheet mirror; and share or download a QR code linking to the member-only live view.
- **Leaderboards** — searchable and sortable all-time or period standings, including profit, volume, win-rate-style measures, and record counts.
- **Head-to-head** — select two players for side-by-side metrics, category comparisons, and cumulative-profit charts.
- **Players** — search/select a player and view profile metrics, profit history, and recent results.
- **Guidelines & Rules** — club principles and poker rules.
- **Copy player totals** — copies player name, buy-ins, and cash-outs as tab-separated rows. Net profit is displayed but is not included in this copy action.
- **Theme and responsive layouts** — dashboard layouts adapt to small and large screens; the app includes light/dark theme support.

### Administrator dashboard

The admin area is separate from member sign-in and uses the configured admin password.

- Shows successful member sign-in totals, distinct members, sign-ins by member, and the latest 500 sign-in records.
- Shows section-level page views, visible-tab active time, and last activity by member. Usage is refreshed by the admin page every minute.
- Includes the live-ledger maintenance panels:
  - Download a full environment backup before destructive operations.
  - Reset the current environment's live ledger and start a fresh session.
  - List closed ledger sessions and delete a selected session after a fresh backup and exact confirmation.
- Admin ledger reset/deletion does not change historical source tabs such as Player Totals or Session Log. In production, corresponding Live Activity sheet rows are also affected as described below.

## 3. Architecture and tools

| Area | Implementation |
| --- | --- |
| Dashboard UI | React, TypeScript, and Vite |
| Page navigation | Wouter |
| Server-state fetching/cache | TanStack React Query |
| Charts | Recharts |
| Styling and UI | Tailwind CSS and reusable UI components |
| Icons and QR | lucide-react and qrcode.react |
| API service | Express 5 on Node.js |
| Database | PostgreSQL through Drizzle ORM |
| API contracts | `lib/api-spec/openapi.yaml` is the source contract; Orval generates TypeScript client hooks and Zod request/response schemas |
| Workspace | pnpm monorepo |
| Server logging | pino / pino-http |
| Spreadsheet access | Replit Google Sheets connector (`google-sheet`) from the server; never called directly from the browser |

The web and API services are separate artifacts. The browser makes same-origin requests under `/api`; Replit's artifact routing forwards those requests to the API service.

## 4. Data sources and storage

### Historical poker data

The API reads the configured Google Sheets workbook using these tabs/ranges:

| Tab | Use |
| --- | --- |
| `Player Totals` | Current player standings and accounting totals |
| `Cumulative Profit` | Player cumulative-profit history |
| `Legends` | Club-contributor/player badge metadata |
| `Latest Game Date` (with accepted aliases) | Latest-date helper when needed |
| `Session Log` | Canonical dated cash-game history; monthly and quarterly views are derived from this data |
| Tournament snapshot (with accepted aliases) | Optional, one-off dated tournament results |

The tournament snapshot is currently configured for **2026-10-04**. It is treated as an event snapshot, not as a general tournament-management system. Its player Net Profit is used for tournament earnings rather than adding gross payout to profit.

The API batches spreadsheet reads, caches the assembled dashboard response, and also uses a five-minute React Query stale period in the browser. The dashboard endpoint allows an explicit no-cache refresh. If the authenticated Sheets connector is unavailable or rate-limited with 401, 403, or 429 responses, historical reads can fall back to Google's public, read-only CSV export. Missing required source tabs are reported as source errors; the tournament snapshot is optional.

### Live ledger

- PostgreSQL is the source of truth for active and closed live sessions, activity entries, and audit comments.
- A session records its date, status, starter/closer, totals, balance, and its unique session key.
- Each activity row records its actor, attributed player, action, amount, timestamps, edit/deletion metadata, revision, and comment.
- Edits and deletions retain their reasons in the audit-comment table; removing an entry is represented in ledger history rather than silently erasing the audit trail.
- The current live activity is polled by the member UI every five seconds.
- In **production only**, live activity is mirrored to the Google Sheets `Live Activity` tab. The mirror can be retried from the member view. The database remains available as the live ledger even when a sheet sync is pending or has failed.
- In **development**, live ledger activity stays in that environment's database and does not write to the shared Live Activity sheet.
- Closing a live session saves it to live-ledger history. The current close flow does **not** append it to the historical `Session Log`; live-ledger history is intentionally separate from historical leaderboard data.

### Other PostgreSQL records

- `auth_sessions` — hashed session tokens, roles, member names, and expiry.
- `site_visits` — successful member login records.
- `member_usage` — aggregated page views and visible active time per member and dashboard section.
- `live_sessions`, `live_activity_events`, and `live_activity_event_comments` — live-ledger session, entry, and audit data.

## 5. API reference

All listed paths are under the `/api` prefix. “Member” and “Admin” indicate the corresponding session cookie is required.

### Health and authentication

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /healthz` | Public | API health check |
| `POST /auth/member/login` | Public | Validate a member access code, create a member session, and record a successful sign-in |
| `GET /auth/member/session` | Public | Check the current member session |
| `POST /auth/member/logout` | Public | Delete and clear the member session |
| `POST /auth/admin/login` | Public | Validate the admin password and create an admin session |
| `GET /auth/admin/session` | Public | Check the current admin session |
| `POST /auth/admin/logout` | Public | Delete and clear the admin session |

### Dashboard, usage, and live ledger

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /poker/public-summary` | Public | Return the restricted aggregate snapshot |
| `GET /poker/dashboard` | Member | Return historical dashboard data from Google Sheets |
| `POST /poker/usage` | Member | Record one section view or a visible-time interval |
| `GET /admin/visits` | Admin | Return sign-in counts/history and grouped member-usage totals |
| `GET /poker/live-activity` | Member | Read the current live-ledger snapshot |
| `GET /poker/live-activity/history` | Member | Read closed live ledgers |
| `POST /poker/live-activity` | Member | Add a buy-in or cash-out entry, optionally attributed to another or newly named player |
| `PATCH /poker/live-activity/{eventId}` | Member | Edit an entry; an edit reason is required |
| `DELETE /poker/live-activity/{eventId}` | Member | Mark an entry deleted; a deletion reason is required |
| `POST /poker/live-activity/sync` | Member | Retry mirroring live activity to the production sheet |
| `POST /poker/live-session/start` | Member | Start or resume today's live session |
| `POST /poker/live-session/end` | Member | Close a used session or discard an empty session |

### Admin live-ledger maintenance

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /admin/live-ledger/backup` | Admin | Download sessions, entries, comments, and production sheet rows where applicable |
| `GET /admin/live-ledger/sessions` | Admin | List closed sessions |
| `DELETE /admin/live-ledger/sessions/{sessionKey}` | Admin | Delete one closed session after a fresh backup and exact confirmation |
| `POST /admin/live-ledger/reset` | Admin | Reset the environment's live ledger after a fresh backup |

The OpenAPI definitions live in `lib/api-spec/openapi.yaml`. Regenerate client hooks and schemas after changing that file with:

```sh
pnpm --filter @workspace/api-spec run codegen
```

## 6. External calls and integration behavior

### Google Sheets

The API server uses Replit's configured Google Sheets integration (`google-sheet`) to:

- Read workbook metadata and historical tab ranges.
- Read and write the production `Live Activity` mirror.
- Create the `Live Activity` tab and write its expected header row if required.
- Read/write selected rows for protected ledger maintenance.

Historical reads can use the public Google Sheets CSV export as a read-only fallback for connector authorization/rate-limit failures. That fallback is not used to write data. Production live-ledger synchronization and cleanup require the configured authenticated connector.

### Browser-to-API calls

The dashboard calls its own `/api` service using generated query/mutation hooks for the OpenAPI endpoints. Login, admin panels, QR actions, and a few download/maintenance actions use direct same-origin `fetch`. No Google credentials or spreadsheet requests are made from browser code.

### Other external services

The codebase does not currently implement third-party sign-in, payment processing, email delivery, or a general player-management service.

## 7. Authentication, usage measurement, and privacy

- Member and admin sessions use separate HTTP-only cookies and separate roles.
- Session identifiers are random tokens; PostgreSQL stores their hashes, not the raw token. Sessions expire after seven days.
- Cookies use `SameSite=Lax`; production cookies are marked secure.
- Failed-login throttling blocks an IP key after five failures within the in-memory 15-minute window, for 15 minutes. The login throttling key is not part of the visit/usage report.
- The server requires `DATABASE_URL`, `SESSION_SECRET`, `MEMBER_ACCESS_CODES`, and `ADMIN_PASSWORD` to run. Configure them through Replit Secrets. Their values are deliberately not documented here.
- Member usage records successful section views and visible-tab time. The browser sends a heartbeat every 30 seconds and flushes on visibility changes/page exit; each accepted interval is capped at 60 seconds. Time pauses while the browser tab is hidden.
- Usage identifies the authenticated member and dashboard section. It does not collect page contents, passwords, access codes, or IP addresses in the usage records.
- The admin usage page aggregates these records; it reports accumulated time and views, not a definitive real-time “currently online” status.

## 8. Developer and operational notes

### Workflows

- API server: `pnpm --filter @workspace/api-server run dev`
- Dashboard: `pnpm --filter @workspace/poker-dashboard run dev`
- API health check: `GET /api/healthz`

### Useful checks

```sh
pnpm --filter @workspace/poker-dashboard run typecheck
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-spec run codegen
```

### Safe handling of live-ledger data

- Do not allow development to write to the production Live Activity sheet.
- Back up before resets or targeted session deletions. Targeted deletion is restricted to closed sessions and uses a fresh backup identifier plus exact confirmation.
- Production sheet sync, reset, and deletion are serialized to avoid races. Failed paired operations attempt to restore affected sheet rows.
- Admin reset and deletion are destructive to the selected live-ledger environment. Production operations also affect the shared Live Activity mirror. These actions are not equivalent to changing historical `Player Totals` or `Session Log` data.

## 9. Main code locations

| Path | Responsibility |
| --- | --- |
| `artifacts/poker-dashboard/src/App.tsx` | Public page, member views, member login, admin page, and page-level UI |
| `artifacts/poker-dashboard/src/components/admin-ledger-reset.tsx` | Admin backup and reset controls |
| `artifacts/poker-dashboard/src/components/admin-ledger-sessions.tsx` | Closed-session review and targeted deletion |
| `artifacts/poker-dashboard/src/hooks/use-member-usage.ts` | Browser-side page-view and visible-time tracking |
| `artifacts/poker-dashboard/src/lib/earnings-analytics.ts` | Frontend scope/earnings calculations |
| `artifacts/api-server/src/routes/` | Express route modules |
| `artifacts/api-server/src/lib/auth.ts` | Session cookies, authentication, throttling, and visit recording |
| `artifacts/api-server/src/lib/member-usage.ts` | Member usage API and database aggregation |
| `artifacts/api-server/src/lib/poker-sheet.ts` | Historical spreadsheet reads, parsing, caching, and analytics assembly |
| `artifacts/api-server/src/lib/live-activity.ts` | PostgreSQL ledger operations and production sheet mirror |
| `lib/db/src/schema/` | Drizzle table definitions |
| `lib/api-spec/openapi.yaml` | API contract source of truth |
