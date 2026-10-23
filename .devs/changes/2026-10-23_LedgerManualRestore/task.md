# Task: Make the encrypted ledger restorable by hand (U9)

- [x] Phase 1: Issue Definition & Scoping (#174, parent #154)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: reported, not awaited)
- [x] Phase 3: Implementation (cloud session: session branch instead of a sibling worktree)
  - [x] Host guard (`CI`, `CLAUDE_CODE_REMOTE`) over the injected environment
  - [x] Pipeline-key files for `decrypt` / `encrypt`
  - [x] `ledger key-check`
  - [x] `Ledger Key Check` workflow and wiring tests
  - [x] Unit and integration tests
  - [x] Real-tenant checks split out (`needs-real-tenant`, #177)
- [x] Phase 4: Docs sync and local quality gate (`/gate`, `pnpm lint`, `pnpm format:check`)
- [x] Phase 5: Walkthrough
- [x] Phase 6: Rebase onto base & create the PR (`Closes #174`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish`
