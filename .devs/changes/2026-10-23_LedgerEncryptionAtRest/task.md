# Task: Optionally encrypt ledger files at rest (U8)

- [x] Phase 1: Issue Definition & Scoping (#162, parent #154)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: reported, not awaited)
- [ ] Phase 3: Implementation (cloud session: session branch instead of a sibling worktree)
  - [ ] Core manifest / verify extension (`encryptedSha256`)
  - [ ] Envelope encryption and key formats (`ledger-crypto.ts`)
  - [ ] Repository codecs (mixed forms, re-encode) and container wiring (fail closed)
  - [ ] `ledger keygen` / `encrypt` / `decrypt`
  - [ ] Workflows, `.env.example`, secret-scan patterns
  - [ ] Unit and integration tests
  - [ ] Real-tenant checks split out (`needs-real-tenant`)
- [ ] Phase 4: Docs sync and local quality gate (`/gate`, `pnpm lint`, `pnpm format:check`)
- [ ] Phase 5: Walkthrough
- [ ] Phase 6: Rebase onto base & create the PR (`Closes #162`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish`
