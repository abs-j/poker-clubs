# Email setup (Resend)

The app sends two emails: **confirm your email** (on sign-up) and **reset your password**. Invites are
shared as a link or QR code, not by email. All of it goes through [Resend](https://resend.com). Without a key the
app still works; password reset is simply switched off (the "Forgot your password?"
link doesn't appear).

## One-time setup

1. Create a Resend account and **add your domain** (Domains → Add Domain). Add the DNS records it shows
   (SPF and DKIM) at your DNS host and wait for it to show *Verified*. Use a subdomain such as
   `mail.yourdomain.com` if you want to keep it apart from other mail.
2. Create an **API key** (API Keys → Create, "Sending access" is enough).
3. Set these as secrets on the Repl (Tools → Secrets):

| Secret | Value | Notes |
|---|---|---|
| `RESEND_API_KEY` | `re_…` | Turns email on. |
| `EMAIL_FROM` | `Poker Clubs <noreply@mail.yourdomain.com>` | Must be on the verified domain. |
| `APP_URL` | `https://your-app.example` | The public address. Email links and sign-in redirects are built from it. |
| `APP_NAME` | `Poker Clubs` | Optional. Used in email subjects and headings. |
| `REQUIRE_EMAIL_VERIFICATION` | `true` | Optional. Blocks sign-in until the address is confirmed. Off by default: invite links are the gate. |
| `TRUSTED_ORIGINS` | `https://www.your-app.example` | Optional. Extra addresses the app is served from. |

Without `EMAIL_FROM` the app falls back to Resend's test sender (`onboarding@resend.dev`), which can only
deliver to the address you signed up to Resend with. Fine for a first try, not for real users.

## Trying it without a key

With no `RESEND_API_KEY` and `NODE_ENV` not `production`, the app is in **log mode**: emails are printed in the
server log and kept in memory. Read them at `GET /api/dev/emails` (that route does not exist in production).
This is what the smoke test uses.

## Safety notes

- Reset and confirm emails are sent after the request has answered, so a slow or failing provider never
  changes what a visitor sees, and asking to reset an address with no account looks identical to one with an account.
- Links in emails only ever point at `APP_URL` (or a configured trusted origin); a request can't make the app email
  a link to another site.
- Sign-in, sign-up, reset and confirm
  requests are rate limited in production.
- Reset links work once, for one hour, and signing in elsewhere is revoked when a password is reset.
