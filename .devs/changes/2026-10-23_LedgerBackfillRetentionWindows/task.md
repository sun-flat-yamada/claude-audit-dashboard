# Task: Ledger backfill within the API retention windows (U5)

- [x] Phase 1: Issue Definition & Scoping (#159, parent #154)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: reported, not awaited)
- [x] Phase 3: Implementation (cloud session: session branch instead of a sibling worktree)
  - [x] Core backfill plan, resume rule, use case, roll-up filing
  - [x] Collector range fetching, backfill registry, progress store, command
  - [x] Manual workflow and input validation script
  - [x] Unit, integration and script tests
  - [x] Real-tenant checks split out (#168, `needs-real-tenant`)
- [x] Phase 4: Docs sync and local quality gate (`/gate`, `pnpm lint`, `pnpm format:check`)
- [x] Phase 5: Walkthrough
- [ ] Phase 6: Rebase onto base & create the PR (`Closes #159`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish`
