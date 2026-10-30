# Deploying (Replit)

## 1. Secrets

Set these in the Repl (Tools → Secrets) before the first publish.

| Secret | Required | What |
|---|---|---|
| `DATABASE_URL` | yes | Replit's Postgres connection string. |
| `SESSION_SECRET` | yes | A long random string. Keep it; changing it signs everyone out. |
| `APP_URL` | yes | The public address, e.g. `https://pokerclubs.example`. Sign-in redirects and email links are built from it, and it is the only address the sign-in API trusts in production. |
| `RESEND_API_KEY`, `EMAIL_FROM` | recommended | Turns on password reset, email confirmation and emailed invites. See [EMAIL_SETUP.md](EMAIL_SETUP.md). |
| `ANTHROPIC_API_KEY` | optional | Turns on "choose a screenshot" when recording a night: the picture is sent to Claude (`claude-haiku-5-5`) to read the player lines, a few cents per day of use at most. Admin only, 20 reads per club per day. Without it the option answers that it isn't switched on and pasting text still works. The Privacy page already mentions it. |
| `APP_NAME` | optional | Name used in emails. Also set `VITE_APP_NAME` for the site itself. |
| `VITE_CONTACT_EMAIL` | recommended | Shown on the Terms and Privacy pages as the contact address. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Adds "Continue with Google". |
| `REQUIRE_EMAIL_VERIFICATION` | optional | `true` blocks sign-in until the email is confirmed. |
| `TRUSTED_ORIGINS` | optional | Extra addresses the site is served from (e.g. a `www.` alias). |

Do **not** set `MEMBER_ACCESS_CODES`, `ADMIN_PASSWORD` or `LEGACY_DEFAULT_CLUB`. They switch on the original single-club
(Monash) mode: access-code sign-in, a Google Sheet reader and mirror, and a public snapshot page.

## 2. Create the tables (once, and after any schema change)

In the Repl shell:

```sh
pnpm --filter @workspace/db run push
```

The API checks for the tables at start-up and refuses to run with a message saying exactly this if they are missing.
`scripts/post-merge.sh` runs it after merges on Replit.

## 3. Publish

Publish as Autoscale. The API serves under `/api` and the site is static (see the two `artifact.toml` files).

## Launch checklist

- [ ] `GET /api/healthz` answers, and `GET /api/clubs/me` answers with JSON (the database is reachable).
- [ ] Sign up with a fresh email, confirm the email, create a club, make an invite link and join it from a private window.
- [ ] Reset a password from the emailed link.
- [ ] Start a live session, add a buy-in and cash-out, close it; the night appears on the leaderboard.
- [ ] Import a small CSV; download the export; delete the test club and account.
- [ ] Terms and Privacy open without signing in and show your contact address.
- [ ] Set the GitHub repository variable `LIVE_SITE_URL` so the scheduled live check watches the site.
- [ ] Note where Replit's database backups and restore live, and try a restore once.

## Things to know

- **Cookies are `Secure`**, so test over https (the Replit address or your domain), not plain http.
- **Rate limits** on sign-in, sign-up, reset and confirm are on in production and kept in memory per server instance.
- **Email links** only ever point at `APP_URL`. If `APP_URL` is wrong, sign-in redirects and emails will be wrong.
- **No money handling.** The Terms say so; keep it that way.
