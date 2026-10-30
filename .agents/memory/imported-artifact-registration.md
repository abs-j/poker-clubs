---
name: Imported artifact registration
description: Register existing imported artifact manifests without recreating their application directories.
---

An imported workspace can contain valid artifact manifests while `listArtifacts()` initially reports none.
Validate and replace the existing manifests through the supported artifact callback rather than creating new artifacts over existing code.

**Why:** Import metadata may not yet be indexed. Validating the existing manifests registered the imported services and their managed workflows without changing the application structure.

**How to apply:** When manifests exist but registration is empty, read them, make temporary full copies, and use `verifyAndReplaceArtifactToml`. Recheck registration before attempting any scaffolding.
