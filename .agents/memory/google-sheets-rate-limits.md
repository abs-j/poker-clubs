---
name: Google Sheets rate limits
description: Reliability constraints when loading many monthly tabs through the connected Google Sheets API.
---

Load many source tabs in small batches rather than issuing one large parallel request. Treat connector HTTP 429 responses as recoverable by using the sheet's public read-only export when available.

**Why:** Expanding from quarterly to monthly tabs increased the number of simultaneous connector requests enough to trigger rate limiting during a normal dashboard refresh.

**How to apply:** Keep the batching and 429 fallback behavior when adding more spreadsheet-backed source tabs or refreshing the dashboard reader.