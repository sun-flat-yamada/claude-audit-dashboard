# Task: Optionally encrypt ledger files at rest (U8)

- [x] Phase 1: Issue Definition & Scoping (#162, parent #154)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: reported, not awaited)
- [x] Phase 3: Implementation (cloud session: session branch instead of a sibling worktree)
  - [x] Core manifest / verify extension (`encryptedSha256`)
  - [x] Envelope encryption and key formats (`ledger-crypto.ts`)
  - [x] Repository codecs (mixed forms, re-encode) and container wiring (fail closed)
  - [x] `ledger keygen` / `encrypt` (incl. `--identity` for pipeline key rotation) / `decrypt`
  - [x] Workflows, `.env.example`, secret-scan patterns
  - [x] Unit and integration tests
  - [x] Real-tenant checks split out (`needs-real-tenant`, #172)
- [x] Phase 4: Docs sync and local quality gate (`/gate`, `pnpm lint`, `pnpm format:check`)
- [x] Phase 5: Walkthrough
- [x] Phase 6: Rebase onto base & create the PR (`Closes #162`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish`
