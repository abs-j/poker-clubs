# Record tab

The old Live tab is now **Record** (view id stays `live` in URLs and usage tracking). Two ways to get a night onto the leaderboard.

## Paste notes (admins)
- Paste notes such as `abhay in 20, out 30, +10` or `ann 10 -> 48`, or choose a photo. The table can be edited, rows removed, players added.
- Reading uses the club's own OpenRouter key and model (club settings, "AI notes reader"). No key means the plain reader (`lib/night-notes.ts`), which also runs if the AI call fails. Photos need the AI reader.
- The key is encrypted with `SETTINGS_ENCRYPTION_KEY`, or `SESSION_SECRET` if that is unset (`lib/secret-box.ts`). It is never sent back to the browser. Changing the secret makes saved keys unreadable; enter them again.
- A gap must be settled to save: a surplus goes to the jackpot, a shortfall is taken off any players in any amounts (`custom` resolution in `lib/night-balance.ts`).
- One optional note per night (`club_sessions.notes`), shown on the Games card and editable by admins.

## At the table (host or admin records, everyone watches)
- Only the host (or an admin) can add entries to an open night; the API refuses everyone else with a 403. Members see the live board, read-only.
- The host's screen has one card per player with one-tap buy-ins, Cash out, and Add a player (`components/table-recorder.tsx`). The earlier quick-entry form is under "Manual entry and corrections" for fixes.
- HG Poker's own screens could not be found online, so the layout follows the common home-game ledger pattern, not a copy of HG.

## Jackpot
- The pot is night surpluses plus deposits (`jackpot_deposits`) minus payouts. Admins add money directly and can edit or delete any payout, delete a deposit, or change a night's surplus; a change that would leave the pot short is refused.
- Shown on Record (full controls for admins) and Home (read-only): `components/jackpot-panel.tsx`.

## Deploy
Run `pnpm --filter @workspace/db run push` for `club_sessions.notes`, `clubs.ai_model`, `clubs.ai_key_cipher` and `jackpot_deposits`.
The smoke script (`scripts/smoke/smoke.mjs`) still assumes members log their own entries and that admins land on the live table; it needs updating before CI passes.
