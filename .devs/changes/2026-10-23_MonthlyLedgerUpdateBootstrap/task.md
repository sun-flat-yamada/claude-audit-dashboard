# Task: Monthly ledger update and bootstrap (U3)

- [x] Phase 1: Issue Definition & Scoping (#157, parent #154)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: reported, not awaited)
- [x] Phase 3: Implementation (cloud session: session branch instead of a sibling worktree)
  - [x] Core `domain/ledger/` merge rules and dataset registry
  - [x] Core `updateLedger` use case and `LedgerRepository` port
  - [x] Collector `FsLedgerRepository`, MANIFEST.json, codec
  - [x] CLI `ledger update` / `ledger bootstrap`, `pipeline` step, npm script
  - [x] `pnpm size` ledger footprint
  - [x] Unit tests (merge rules) and integration tests (idempotency, bootstrap)
- [x] Phase 4: Docs sync (BLUEPRINT, ARCHITECTURE, storage-and-data-routing, SETUP, DEPLOYMENT, CHANGELOG)
- [x] Phase 4: Local Quality Gate (`/gate`, `pnpm lint`, `pnpm format:check`)
- [x] Phase 5: Walkthrough Generation
- [ ] Phase 6: Rebase onto base & create the PR (`Closes #157`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish`
