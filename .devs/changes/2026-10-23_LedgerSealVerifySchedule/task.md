# Task: Seal and verify ledger months on a schedule (U6)

- [x] Phase 1: Issue Definition & Scoping (#160, parent #154)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: reported, not awaited)
- [x] Phase 3: Implementation (cloud session: session branch instead of a sibling worktree)
  - [x] Core seal / verify / revisions / health, manifest extension
  - [x] OP-003 / OP-004 and the `ledgerHealth` dataset
  - [x] Collector repository, status store, commands, notifications
  - [x] Workflows and input validation scripts
  - [x] Unit, integration and script tests
  - [x] Real-tenant checks split out (`needs-real-tenant`, #170)
- [x] Phase 4: Docs sync, `pnpm demo` and local quality gate (`/gate`, `pnpm lint`, `pnpm format:check`)
- [x] Phase 5: Walkthrough
- [x] Phase 6: Rebase onto base & create the PR (`Closes #160`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish`
