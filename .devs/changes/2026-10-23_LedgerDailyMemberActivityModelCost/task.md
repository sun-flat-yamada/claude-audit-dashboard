# Task: Ledger daily member activity and model-only cost (U4)

- [x] Phase 1: Issue Definition & Scoping (#158, parent #154)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: reported, not awaited)
- [x] Phase 3: Implementation (cloud session: session branch instead of a sibling worktree)
  - [x] Core dataset, ledger registration, reconciliation
  - [x] Collector daily users API, pacing, 31-day report windows
  - [x] Config, container, demo and fixture sources
  - [x] Unit and integration tests
  - [x] Real-tenant checks split out (#166, `needs-real-tenant`)
- [x] Phase 4: Docs sync and local quality gate (`/gate`, `pnpm lint`, `pnpm format:check`, `pnpm test:e2e`)
- [x] Phase 5: Walkthrough
- [ ] Phase 6: Rebase onto base & create the PR (`Closes #158`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish` (pending: run by `change-dev:finish` after CI)
