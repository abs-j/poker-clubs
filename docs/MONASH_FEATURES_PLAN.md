# Bringing Monash Poker Dashboard features back

Decided 2 Nov 2026. Work happens here only; the Monash repo is read-only reference.

| Phase | What | Status |
|---|---|---|
| 1 | Share cards (night, tournament, points, season, my result) with a per-share Hide amounts switch | Done |
| 2 | Monthly Wrapped modal and recap studio (Feed, Story, Square sizes) | Next |
| 3 | First-view Home cards, then a static `/demo` build with a guided tour | Planned |

Skipped on purpose: rivalry / head-to-head (profile "You vs them" covers it), Monash admin screens, Monash branding.

Notes
- Do not share deep links such as `?recap=`. Clubs are invite-only, so a recipient who is not signed in hits a login wall. Share the picture.
- The demo must be a separate static bundle with fictional names and an in-browser mock API (no real backend or data).
