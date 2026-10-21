---
name: Shared live-ledger synchronization
description: Safeguards for development and production writers and repairs to duplicated or shifted Live Activity sheet rows.
---

Only production may synchronize with the shared Live Activity spreadsheet; development must remain database-only. Serialize production syncs, resets, and targeted session deletions with the same advisory lock. For scoped deletions, clear only rows matching the session key or its event IDs, and restore the pre-change sheet snapshot if the paired database transaction fails. The rollback guard must wrap the entire transaction call, not only its callback, so commit-time failures are covered; mark the snapshot before awaiting a sheet clear. Write to explicit A1 row ranges and verify the Sheets API's returned range. Stop sync before writing if invalid or duplicate rows are detected.

**Why:** Development and production share one sheet, so a development writer can contaminate production data. A sheet request may clear rows before returning an error, and PostgreSQL can fail after the transaction callback completes; rollback must cover both cases. A malformed data block can also shift append operations and create repeated copies; resets and targeted deletions must not race with production syncs or leave the sheet and database out of agreement.

**How to apply:** Keep sheet synchronization disabled unless `NODE_ENV` is production. Before repairing, resetting, or deleting Live Activity rows, identify active writers and back up the tab. Hold the shared advisory lock across reads and writes, use explicit row ranges, verify Sheets' confirmation, and restore the sheet snapshot after any failed transaction when a clear was attempted.