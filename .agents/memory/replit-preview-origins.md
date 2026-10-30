---
name: Replit preview origins
description: Better Auth development-origin checks can fail when the browser preview host differs from the dev environment hostname.
---

Use the exact browser preview origin for development `APP_URL`. Replit's `REPLIT_DEV_DOMAIN` can use a different hostname alias than the browser-visible preview, and Better Auth compares origins exactly. Keep this fix scoped to development; do not broaden production trusted origins or use an unrestricted wildcard.

**Why:** A sign-up from a `.replit.dev` preview was rejected when development `APP_URL` pointed to its different `.reed.replit.dev` alias.

**How to apply:** Compare the browser's address-bar origin with the development `APP_URL`; update only the development value, restart the API workflow, and verify a harmless auth request no longer returns `Invalid origin`.
