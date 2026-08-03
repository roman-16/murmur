---
name: quality-gates
description: Quality gate for the Murmur GNOME Shell extension. Use after any change to its TypeScript sources in src/, before considering the work done.
---

# Quality gates

Lint and type-check, then fix every finding:

```bash
just lint
```

Both gates must pass: `oxlint` over `src/`, and `tsc --noEmit` against the GNOME Shell type definitions.
