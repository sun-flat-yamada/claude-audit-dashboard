# Task: Harden Fork-Safety of Live Data Branches (#155)

- [x] Phase 1: Issue Definition & Scoping (#155, parent #154)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: committed and reported)
- [ ] Phase 3: Session branch renamed (cloud session; no sibling worktree)
- [ ] Phase 4: Implementation, Blueprint Sync & Local Quality Gate
  - [ ] `data-branch.sh` visibility guard
  - [ ] Workflows pass `REPOSITORY_VISIBILITY` / `GH_TOKEN` to the save step
  - [ ] `data/ledger/` in `.gitignore` and `fork:verify`
  - [ ] Tests (`scripts/__tests__`)
  - [ ] Docs: BLUEPRINT, DEPLOYMENT, storage-and-data-routing, CHANGELOG
  - [ ] Quality gate + lint / format
- [ ] Phase 5: Walkthrough Generation & Evidence Sealing
- [ ] Phase 6: Rebase onto Base & Create PR (ready for review)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish`
