# Design brief: UX and UI pass

Written 2 Nov 2026 after a walkthrough of the site (desktop 1280 and phone 375) and a short interview. No code changed.

## Decisions from the interview

- **Primary user:** players on their phone. Desktop is secondary.
- **Feel:** keep the dark, rich purple identity. Tidy contrast, spacing and hierarchy; no shift to minimal or casino.
- **Pain points:** unclear navigation and a cramped mobile layout.
- **Home when idle:** keep the personal all-time net hero as now. When a game is live, a live card goes above it.
- **Navigation:** Home, Live, Leaderboard, Games, Me.
- **Home density:** a short Home that links out to detail pages.
- **Delivery:** this brief first; implement after review.

## Findings

Navigation
- Labels do not predict contents. "Leaderboard" also holds Profile, "Club" holds the guidelines, and Account and Sign out sit behind the header menu.
- Live uses a dollar-sign icon and Games a calendar icon; neither says what the tab is.
- Phone tab labels are small and "Leaderboard" nearly fills its slot.

Home on phone
- Long scroll: hero, last game, three stat tiles, two podiums, form chart, more below.
- Stat tile labels wrap ("LEADERBOARD MOVE" breaks onto two lines) and the tiles are cramped at 375px.
- Podium cards have large empty gaps between the avatars, the rank steps and the list.
- The install banner sits above the greeting and pushes content down on every visit until dismissed.
- Greeting "Your game, in numbers." spends two lines of prime space on a tagline.

Loading and feedback
- Every tab opens on a blank skeleton block that stays visible for a moment; on slow phones this reads as broken. Prefer skeletons shaped like the real content.
- Page-level footer ("28 cash games, 177 player results ... numbers from the nights this club has recorded") repeats on every tab and adds little.

Legibility (dark theme)
- Mono caption labels and secondary text are small and low-contrast; check against WCAG AA (4.5:1).
- A large negative net in a bright purple gradient is the first thing a losing player sees. Consider a calmer treatment for negative values.

## Proposals, in priority order

1. **Bottom nav: Home, Live, Leaderboard, Games, Me.**
   - Me: profile, avatar, achievements, account, club switcher, sign out.
   - Club guidelines and club settings move under Me (admins) or a link from Home.
   - Icons: Live gets a pulsing dot only while a game is open (already exists), otherwise a neutral icon; Games gets a list or cards icon.
2. **Short Home.** Order: live card (only if a game is open), personal net hero, last game, one podium (profit, with a toggle to club points), "See all" links. Move the form chart, stat tiles and Club Buzz to Leaderboard or Me.
3. **Install banner** becomes a dismissible row inside Me, plus a one-time prompt after the second visit. Not above the content.
4. **Stat tiles** become a horizontal scroller or a 2-column grid with one-line labels ("Rank move", "Form", "Best game").
5. **Podium** on phone: reduce vertical gaps, drop the empty pedestal height, show the top 3 plus "you" row.
6. **Loading:** content-shaped skeletons; no footer until data is ready.
7. **Contrast pass:** raise secondary text and caption colors to AA; keep the purple accent.
8. **Negative numbers:** same size as positive, red text on the existing card, without the large gradient hero emphasis.

## Out of scope for now

- Next-game scheduling and RSVP (would need new data and endpoints).
- Desktop-specific layout changes.
- Light theme review.

## Open questions

- Should Club guidelines stay visible to every member from Home, or live only under Me?
- Is the Profile view used enough to deserve its own place, or should it fold into Me?
- Which members are actually on phones? Usage tracking (`/poker/usage`) could confirm before the nav change.

## Suggested implementation order

Nav restructure (1), install banner (3) and tile/podium spacing (4, 5) are small and independent. Home restructure (2) depends on the nav. Contrast and loading (6, 7, 8) can go in a separate PR.
