---
name: Google Sheets date formatting
description: Google Sheets may return locale-formatted dates or numeric date serials instead of ISO strings.
---

Normalize source dates before grouping or comparing them. Reads can return `DD/MM/YYYY` or numeric serials when a column was written with user-entered parsing, while the API contract uses ISO `YYYY-MM-DD`. For mirror writes, prefer raw values for ISO date strings so retries can parse the same event IDs instead of appending duplicates.

**Why:** A live-activity retry found date serials where the parser expected ISO, treated existing events as missing, and appended duplicate mirror rows.

**How to apply:** Accept ISO and spreadsheet serial dates at the source boundary, validate calendar values, and keep mirror imports idempotent before any append or reconciliation.