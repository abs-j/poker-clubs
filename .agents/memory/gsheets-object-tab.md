---
name: Google Sheets OBJECT tabs
description: Connector behavior for Google Sheets tabs created as dashboard/object sheets.
---

Google Sheets tabs with `sheetType: OBJECT` may exist in spreadsheet metadata without exposing grid values, charts, or layout objects through the connected Sheets API or public gviz exports.

**Why:** The analytics hub reference tab was present but returned no grid data or embedded-object metadata, so exact visual replication required a web implementation based on the approved API data rather than direct tab introspection.

**How to apply:** Treat OBJECT tabs as visual references that need an accessible screenshot or manual inventory; do not assume a range read or `gid` export will reveal their contents.