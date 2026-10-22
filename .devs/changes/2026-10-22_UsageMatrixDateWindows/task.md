# Task: usage-matrix cost_report date windows (V8)

- [x] Phase 1: Issue Definition & Scoping (draft prepared; to be filed upstream)
- [x] Phase 2: Implementation Plan formulated & approved
- [x] Phase 3: Implementation
  - [x] Window split helper and cap detection in `analytics-api.ts`
  - [x] `costMatrix()` window loop and per-group fallback
  - [x] Reproduction and fallback tests in `gateways.test.ts`
  - [x] Replay range for bucketed reports (`replay-fetch.ts`) and the pipeline test expectation (found during verification)
- [x] Phase 4: Docs sync (`CHANGE-PLAN.md` §10, `API-MAPPING.md`, `BLUEPRINT.md`, `CHANGELOG.md`)
- [/] Phase 4: Local Quality Gate (sandbox subset passed; full `/gate` to run locally)
- [x] Phase 5: Walkthrough Generation (results of the local gate to be added)
- [ ] Phase 6: File the Issue, rename the branch, rebase onto base & create the PR (`Closes #<id>`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish` and Worktree Cleanup
- [ ] Follow-up (human): real-tenant re-check with `sources.usageMatrix.enabled: true`
