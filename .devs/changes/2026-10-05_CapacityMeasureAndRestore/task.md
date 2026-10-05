# Task: B3-1 Synthetic long history, size measurement, restore

- [x] Phase 1: Issue Definition & Scoping (#82, sub-issue of #38; `Refs #38`)
- [x] Phase 2: Implementation Plan formulated (owner decision recorded: key-free part only)
- [/] Phase 3: Implementation in the session checkout (replaces the sibling worktree)
  - [ ] Core: parser, threshold judgement, alert (pure)
  - [ ] Collector: git size measurement, restore, `size` / `restore` commands, `--snapshot`, config
  - [ ] Synthetic history generator and temp git repo builder (tests only)
  - [ ] Tests (dedup, archive does not shrink, thresholds, notification, round trip, regeneration, inventory equality)
  - [ ] Workflow inputs and non-fatal size step
- [ ] Phase 4: Docs sync (CHANGE-PLAN 9, BLUEPRINT 6.3, DEPLOYMENT, SETUP) & Local Quality Gate
- [ ] Phase 5: Walkthrough Generation & Evidence Sealing
- [ ] Phase 6: Create draft PR (`Closes #82`, `Refs #38`)
- [ ] Phase 7: Rebase & Merge (owner)
