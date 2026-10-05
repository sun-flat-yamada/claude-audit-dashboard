# Task: F-015 PR1 multi-time-point synthetic data and design

- [x] Phase 1: Issue Definition & Scoping (#101, sub-issue of #42)
- [x] Phase 2: Implementation Plan formulated (owner decision: proceed; F-015 design decisions D-1 to D-5 settled in the plan)
- [x] Phase 3: Implementation in the session checkout (replaces the sibling worktree)
  - [x] Scenarios and collector wrapper (`demo-history.ts`)
  - [x] `writeDemoSample` writes the earlier points under `history/`, T3 path unchanged
  - [x] `fork:verify` validates `history/`
  - [x] Transition and golden tests
  - [x] `pnpm demo` regenerated (new files only)
- [x] Phase 4: Docs sync (DASHBOARD-FEATURES F-015, BLUEPRINT §9 / §17, CHANGELOG) and local quality gate (incl. `pnpm test:e2e`)
- [x] Phase 5: Walkthrough Generation & Evidence Sealing
- [x] Phase 6: Create draft PR (Auto-Pilot off)
- [ ] Phase 7: Rebase & Merge (owner)
