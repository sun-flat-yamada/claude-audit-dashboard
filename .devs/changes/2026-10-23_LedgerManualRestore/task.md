# Task: Make the encrypted ledger restorable by hand (U9)

- [x] Phase 1: Issue Definition & Scoping (#174, parent #154)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: reported, not awaited)
- [ ] Phase 3: Implementation (cloud session: session branch instead of a sibling worktree)
  - [ ] Host guard (`CI`, `CLAUDE_CODE_REMOTE`) over the injected environment
  - [ ] Pipeline-key files for `decrypt` / `encrypt`
  - [ ] `ledger key-check`
  - [ ] `Ledger Key Check` workflow and wiring tests
  - [ ] Unit and integration tests
  - [ ] Real-tenant checks split out (`needs-real-tenant`)
- [ ] Phase 4: Docs sync and local quality gate (`/gate`, `pnpm lint`, `pnpm format:check`)
- [ ] Phase 5: Walkthrough
- [ ] Phase 6: Rebase onto base & create the PR (`Closes #174`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish`
