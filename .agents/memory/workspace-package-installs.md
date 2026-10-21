---
name: Workspace-scoped package installs
description: Add dependencies to the correct package in this pnpm monorepo.
---

In this pnpm monorepo, the Replit language-package installer runs `pnpm add` from the repository root and cannot select a child workspace. Scope package changes with `pnpm --filter @workspace/<package> add <dependency>` so the dependency is recorded by the artifact or library that imports it.

**Why:** A root install fails with `ERR_PNPM_ADDING_TO_ROOT` or puts a runtime dependency in the wrong package.

**How to apply:** For dependencies used by a workspace package, use the package filter in the pnpm command, then verify that package's `package.json` and the root lockfile changed.