# Task: Enforce noreply commit e-mails

- [x] Phase 1: Issue Definition & Scoping (#179)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: reported, not awaited)
- [ ] Phase 3: Implementation (cloud session: session branch instead of a sibling worktree)
  - [ ] `scripts/commit-email-check.ts` and its tests
  - [ ] `commit-email.yml` workflow
  - [ ] `.githooks/` and `pnpm hooks:install`
- [ ] Phase 4: Docs sync and local quality gate (`/gate`, `pnpm lint`, `pnpm format:check`)
- [ ] Phase 5: Walkthrough
- [ ] Phase 6: Rebase onto base & create the PR (`Closes #179`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish`
