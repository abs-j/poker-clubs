# Simplification plan

Decisions from the design interview (31 Oct 2026). Principle: **simplify; remove or default before adding.**
Status (1 Nov 2026): the cuts, the ledger, the structure work and the monthly-points revamp are done. Home is the live banner or your summary and last game, plus the monthly points podium, the profit podium and anything you still owe. The ranking tab is labelled Leaderboard. See `docs/HANDOFF.md` for loose ends that are not part of this plan.

## How the site is used

- A small committee of admins runs each club; **everyone uses the live ledger** on game night.
- Nights are logged live or caught up afterwards, depending on the night. Importing history is a **one-time setup** task.
- Cash games almost always; tournaments are occasional.
- Multiple clubs per person is rare.

## Roles

| Who | Can |
|---|---|
| Platform admin (the site owner, identified by an email allow-list env var) | See usage (sign-ins, time on site, sections opened) across all clubs. View only. |
| Club owner / admin | Everything in their club: settings, people, roles, merge names, reopen or delete any night, reset the invite link, export, delete club. See member emails. |
| Host (per night, not a role) | Whoever starts a night hosts it. Can add, edit and delete any entry in it, set the bank, close it and make the balance choice, record payouts, tick settled, reopen it. Admins can hand a night to someone else. |
| Member | Start a night (becomes its host), add entries for anyone, edit or delete only entries they logged, copy the invite link, see standings. |

One open night per club.

## Information architecture

- **Tabs:** Home, Games, Live, Leaderboard, Club.
- **Home:** live banner if a night is on, otherwise my summary and last game. Keeps the monthly points podium and the profit podium for a quick glance. Shows any nights I still owe or am owed on.
- **Live:** one ledger for everything about a night. "New night" starts today's (or a past date). Entries by hand, paste notes, or screenshot (the existing notes tools move here). A night can be cash or tournament. Optional bank. Close with the balance step. Closed nights can be reopened. Settle-up ticks per player.
- **Games:** the nights. Admins and hosts edit, reopen or delete from here (replaces the admin night list).
- **Leaderboard:** the full tables on one scrolling page. Filters: Month and All time only (months include the year). Points are monthly only; "All time" shows the latest month. Player profiles show the games you both played (what each of you won or lost, plus a recent trend), which replaces both the Compare tab and "you vs them".
- **Club:** members only: Club Buzz, invite link (anyone copies, admins reset), rules, jackpot, members (collapsible). Admins also get a Club admin button that opens a separate **Admin** page: People, Setup (one-time history import, tournament CSV import), Settings, Danger.
- **Me (avatar menu):** picture, record, trophies, password, theme, install, switch club, sign out, delete account. No admin items.
- **Seasons are calendar months** (previously quarters).
- **Platform admin page** for the owner only. Replaces `/admin`.

## Remove

Legacy Monash mode (access codes, admin password, Google Sheet reader and mirror, public snapshot, Monash rules, default club). Head-to-head Compare tab. Share cards, season recap and Wrapped (share cards, the recap studio and Wrapped came back on 2 Nov 2026, see below). Hashtag setting. Custom points numbers (keep the three presets). Admin avatar management. Emailed invites (keep link, copy/share and QR). Year and Quarter filters. The separate "Add a player who hasn't joined yet" form (names appear when typed in a ledger or import; members claim on join). "Start/Join another club" forms on the account page (club switcher menu instead). Currency and timezone become defaults from the browser, edited under Advanced.

## Keep

Club points with the three presets. Club Buzz. Trophies and badge pop-ups. Tournaments (record form and CSV import). Member usage tracking (platform admin only). Account and club deletion, CSV export.

## New

Hosts, bank, settle-up (per-player Settled ticks; Home shows what you owe or are owed), jackpot payout (host or admin records a payout to a player), reopen a closed night, merge two names, past-dated nights inside the ledger, platform admin page. Privacy page updated so usage is visible to the platform owner only.

## Build order

1. **Cuts** (smaller codebase first): remove legacy Monash; Compare (add "you vs them" to profiles); share cards, recap and Wrapped; hashtag; custom points; admin avatars; emailed invites; Year and Quarter filters with monthly seasons.
2. **Ledger**: hosts and permissions, past nights and import-style entry inside the ledger, bank and settle-up, reopen, jackpot payout, tournaments from "New night".
3. **Structure**: split My account into Me and Club admin, platform admin page, merge names, move the Games edit tools, retire `/admin`.

Done: months are real calendar months ("2026-10", shown "Oct 2026") everywhere, seasons are months, and the Year/Quarter filters and year cookie are gone. The dashboard payload still carries an empty `quarters` field so its shape is unchanged.

## Restored on 2 Nov 2026: share cards

Share is back as a picture you can save or send to a chat: your last game (Home, with a "whole night" and "copy as text" option), a night (Games), a tournament, the points table and the season card. Each picture dialog has a **Hide amounts** switch (remembered on the device) that leaves money figures off and keeps names, places and counts. The recap studio and monthly Wrapped came back too (see `docs/MONASH_FEATURES_PLAN.md`). Compare stays out.
