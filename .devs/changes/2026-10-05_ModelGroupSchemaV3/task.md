# Task: model x group aggregate in DashboardView v3 (#102)

- [x] Phase 1: Issue Definition & Scoping (#102; owner decided D6 (a) and retiring detail/usage-matrix.json)
- [x] Phase 2: Implementation Plan formulated & approved (owner approved the decisions and the plan, including `DETAIL_SCHEMA_VERSION` 2)
- [x] Phase 3: Implementation in the session checkout (replaces the sibling worktree)
  - [x] Contract v3 and presenters in core; retire the detail matrix kind
  - [x] Collector: writeDashboard / writeDetail, demo and sample regeneration
  - [x] Dashboard: Models from the view, Overview card, routes
  - [x] fork-verify (via the dashboard schema), stage-data, tests, E2E
- [x] Phase 4: Blueprint Sync & Local Quality Gate (+ `pnpm test:e2e`)
- [x] Phase 5: Walkthrough Generation & Evidence Sealing
- [x] Phase 6: Create PR
- [ ] Phase 7: Rebase & Merge (owner)
