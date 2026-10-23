# Task: Copy sealed ledger months to external storage (U7)

- [x] Phase 1: Issue Definition & Scoping (#161, parent #154)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: reported, not awaited)
- [x] Phase 3: Implementation (cloud session: session branch instead of a sibling worktree)
  - [x] Core: manifest `transfers`, `LedgerSink` / `LedgerFileAccess` ports, `pushLedgerMonth`, alert
  - [x] Repository: stored files, digests, transfer record
  - [x] Sinks: registry, `filesystem`, `gdrive`, `sharepoint` (OIDC exchange, retries)
  - [x] `ledger push`, container wiring (`sealSinks`), config and environment
  - [x] Workflow (`ledger-seal.yml`) and wiring test, `.env.example`
  - [x] Unit, HTTP-fake and integration tests
  - [x] Real-tenant checks split out (`needs-real-tenant`, #175)
- [x] Phase 4: Docs sync and local quality gate (`/gate`, `pnpm lint`, `pnpm format:check`)
- [x] Phase 5: Walkthrough
- [x] Phase 6: Rebase onto base & create the PR (`Closes #161`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish`
