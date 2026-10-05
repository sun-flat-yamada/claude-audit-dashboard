# Task: F-015 PR2 time-point summary, diff core, export and compare data files

- [x] Phase 1: Issue Definition & Scoping (#106, sub-issue of #42)
- [x] Phase 2: Implementation Plan formulated (owner decisions on the open questions applied; design from PR1 D-1 to D-5)
- [x] Phase 3: Implementation in the session checkout (replaces the sibling worktree)
  - [x] Core: summary / index schema, `buildTimePointSummary`, `diffTimePoints`, export formatters, shared CSV helper
  - [x] Collector: summary store, `check` hook, backfill, `detail/compare/*`, manifest kind, bundle check
  - [x] `pnpm demo` judges three points in one store; regenerate `data/sample/`
  - [x] Tests (core table-driven, collector, dashboard component and E2E expectations)
- [x] Phase 4: Docs sync (DASHBOARD-FEATURES F-015, BLUEPRINT §9, storage rule, DEPLOYMENT / SETUP, CHANGELOG) and local quality gate (incl. `pnpm test:e2e`)
- [x] Phase 5: Walkthrough Generation & Evidence Sealing
- [x] Phase 6: Create draft PR (Auto-Pilot off)
- [ ] Phase 7: Rebase & Merge (owner)
