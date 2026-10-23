# Task: Ledger backfill within the API retention windows (U5)

- [x] Phase 1: Issue Definition & Scoping (#159, parent #154)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: reported, not awaited)
- [ ] Phase 3: Implementation (cloud session: session branch instead of a sibling worktree)
  - [ ] Core backfill plan, resume rule, use case, roll-up filing
  - [ ] Collector range fetching, backfill registry, progress store, command
  - [ ] Manual workflow and input validation script
  - [ ] Unit, integration and script tests
  - [ ] Real-tenant checks split out (`needs-real-tenant`)
- [ ] Phase 4: Docs sync and local quality gate (`/gate`, `pnpm lint`, `pnpm format:check`)
- [ ] Phase 5: Walkthrough
- [ ] Phase 6: Rebase onto base & create the PR (`Closes #159`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish`
