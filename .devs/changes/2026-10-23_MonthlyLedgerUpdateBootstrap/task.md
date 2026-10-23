# Task: Monthly ledger update and bootstrap (U3)

- [x] Phase 1: Issue Definition & Scoping (#157, parent #154)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: reported, not awaited)
- [ ] Phase 3: Implementation (cloud session: session branch instead of a sibling worktree)
  - [ ] Core `domain/ledger/` merge rules and dataset registry
  - [ ] Core `updateLedger` use case and `LedgerRepository` port
  - [ ] Collector `FsLedgerRepository`, MANIFEST.json, codec
  - [ ] CLI `ledger update` / `ledger bootstrap`, `pipeline` step, npm script
  - [ ] `pnpm size` ledger footprint
  - [ ] Unit tests (merge rules) and integration tests (idempotency, bootstrap)
- [ ] Phase 4: Docs sync (BLUEPRINT, ARCHITECTURE, storage-and-data-routing, CHANGELOG)
- [ ] Phase 4: Local Quality Gate (`/gate`, `pnpm lint`, `pnpm format:check`)
- [ ] Phase 5: Walkthrough Generation
- [ ] Phase 6: Rebase onto base & create the PR (`Closes #157`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish`
