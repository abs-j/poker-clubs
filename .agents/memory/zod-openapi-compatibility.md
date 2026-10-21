---
name: Generated Zod compatibility
description: Orval integer schemas are incompatible with the workspace's installed Zod runtime.
---

The generated API validator currently targets a Zod 4-style `zod.int()` helper, while the workspace runtime is Zod 3.25. Until the dependency is upgraded intentionally, model whole-number API fields as numeric OpenAPI values so generated validators use `zod.number()`.

**Why:** The mismatch caused both the library typecheck and the API server startup to fail after code generation.

**How to apply:** If generated validators suddenly contain `zod.int()`, check the installed Zod version before changing application code; either upgrade Zod across the workspace or use compatible numeric schemas. After changing nullable nested schemas, let code generation finish before relying on Vite HMR; partial generated output can briefly be syntactically invalid until the workflow is restarted.