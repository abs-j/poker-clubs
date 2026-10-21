---
name: Poker tournament snapshot
description: Source and identity rules for combining tournament earnings with the poker dashboard.
---

Treat the Tournament 5/10 sheet as one event snapshot dated 4 October 2026, not as an archive. Use each player's Net Profit for earnings, ignore the sheet's TOTAL summary row, and match tournament players to cash standings only by trimmed, whitespace-collapsed, case-insensitive exact full name. Show unmatched tournament names as tournament-only and exclude them from combined cash standings.

Keep the dashboard's purple colorway. Green is reserved for positive-result semantics.

**Why:** The source contains one event snapshot and reports both payouts and net profit; adding gross payouts or inventing event history overstates earnings, while guessing player identities can merge different people. The user explicitly asked to keep the purple colorway.

**How to apply:** Add tournament history only when the source provides dated event data. Keep tournament Net Profit separate from cash all-time accounting and preserve the purple accents when updating this dashboard.
