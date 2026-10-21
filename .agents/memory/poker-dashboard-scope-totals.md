---
name: Poker dashboard scope totals
description: How the dashboard should reconcile all-season accounting metrics with dated session analytics.
---

Use the dashboard totals and quarter summaries for headline buy-in, record-count, and accounting metrics. Use dated session rows for charts, session cards, and quarter-scoped player aggregates.

**Why:** The source includes accounting rows without session dates. Summing only dated session cards drops valid records and produces incorrect all-season totals.

**How to apply:** Keep the quarter filter as the scope for KPI calculations, keep visualizer search separate from KPI scope, and use unique aggregated player net results—not raw record counts—for green/red pool distribution.