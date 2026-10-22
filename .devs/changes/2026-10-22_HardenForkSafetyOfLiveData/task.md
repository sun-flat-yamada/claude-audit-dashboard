# Task: Harden Fork-Safety of Live Data Branches (#155)

- [x] Phase 1: Issue Definition & Scoping (#155, parent #154)
- [x] Phase 2: Implementation Plan formulated (Auto-Pilot on: committed and reported)
- [x] Phase 3: Session branch renamed (cloud session; no sibling worktree)
- [x] Phase 4: Implementation, Blueprint Sync & Local Quality Gate
  - [x] `data-branch.sh` visibility guard
  - [x] Workflows pass `REPOSITORY_VISIBILITY` / `GH_TOKEN` to the save step
  - [x] `data/ledger/` in `.gitignore` and `fork:verify`
  - [x] Tests (`scripts/__tests__`)
  - [x] Docs: BLUEPRINT, DEPLOYMENT, storage-and-data-routing, CHANGELOG
  - [x] Quality gate + lint / format
- [x] Phase 5: Walkthrough Generation & Evidence Sealing
- [ ] Phase 6: Rebase onto Base & Create PR (ready for review)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish`
