---
name: Auth response caching
description: Cache behavior required for cookie-backed auth/session JSON endpoints.
---

Cookie-backed session endpoints must return JSON reliably even when a browser carries an old validator. Use no-store and bypass conditional request validators on auth responses.

**Why:** Express can emit a 304 with an empty body when If-None-Match is present; a client calling response.json() then treats a valid session as unauthenticated.

**How to apply:** For session checks, login/logout responses, and protected admin summaries, disable caching and remove If-None-Match/If-Modified-Since before Express performs conditional response handling.