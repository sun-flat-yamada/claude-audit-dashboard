# Task: usage-matrix cost_report date windows (V8)

- [x] Phase 1: Issue Definition & Scoping (#152)
- [x] Phase 2: Implementation Plan formulated & approved
- [x] Phase 3: Implementation
  - [x] Window split helper and cap detection in `analytics-api.ts`
  - [x] `costMatrix()` window loop and per-group fallback
  - [x] Reproduction and fallback tests in `gateways.test.ts`
  - [x] Replay range for bucketed reports (`replay-fetch.ts`) and the pipeline test expectation (found during verification)
- [x] Phase 4: Docs sync (`CHANGE-PLAN.md` §10, `API-MAPPING.md`, `BLUEPRINT.md`, `CHANGELOG.md`)
- [x] Phase 4: Local Quality Gate (full `/gate`, `pnpm lint`, `pnpm format:check` and `pnpm audit:deps` passed locally)
- [x] Phase 5: Walkthrough Generation (sealed with the local gate results)
- [ ] Phase 6: File the Issue, rename the branch, rebase onto base & create the PR (`Closes #152`)
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish` and Worktree Cleanup
- [ ] Follow-up (human): real-tenant re-check with `sources.usageMatrix.enabled: true`
