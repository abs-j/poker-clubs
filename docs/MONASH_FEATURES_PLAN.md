# Bringing Monash Poker Dashboard features back

Decided 2 Nov 2026. Work happens here only; the Monash repo is read-only reference.

| Phase | What | Status |
|---|---|---|
| 1 | Share cards (night, tournament, points, season, my result) with a per-share Hide amounts switch | Done |
| 2 | Monthly Wrapped modal, Me-page archive, and recap studio (Feed, Story, Square) with the same Hide amounts switch | Done |
| 3 | First-view Home cards, then a static `/demo` build with a guided tour | Planned |

Skipped on purpose: rivalry / head-to-head (profile "You vs them" covers it), Monash admin screens, Monash branding.

Notes
- Do not share deep links such as `?recap=`. Clubs are invite-only, so a recipient who is not signed in hits a login wall. Share the picture.
- The demo must be a separate static bundle with fictional names and an in-browser mock API (no real backend or data).

Phase 2 notes
- Wrapped opens once for the latest finished calendar month (per member, per device, `pc.wrappedDismissed.v1`) and can be reopened from Me, "Poker Wrapped". Dev only: `?asOf=YYYY-MM-DD` fakes the date; production ignores it.
- "Share as pictures" opens the recap studio. Games (cash nights) and tournament detail also have an "Instagram slides" button.
- Hide amounts works on packs after they are built (`redactAmounts` in `lib/recaps.ts`), so it covers every slide and the caption.
- Dropped on purpose: the "club points after this night" slide (its helper went with the monthly-points revamp), personal and standings recap builders, and the `?recap=` link.
