# Task: B3-1 Synthetic long history, size measurement, restore

- [x] Phase 1: Issue Definition & Scoping (#82, sub-issue of #38; `Refs #38`)
- [x] Phase 2: Implementation Plan formulated (owner decision recorded: key-free part only)
- [x] Phase 3: Implementation in the session checkout (replaces the sibling worktree)
  - [x] Core: parser, threshold judgement, alert (pure)
  - [x] Collector: git size measurement, restore, `size` / `restore` commands, `--snapshot`, config
  - [x] Synthetic history generator and temp git repo builder (tests only)
  - [x] Tests (dedup, archive does not shrink, thresholds, notification, round trip, regeneration, inventory equality)
  - [x] Workflow inputs and non-fatal size step
- [x] Phase 4: Docs sync (CHANGE-PLAN 9, BLUEPRINT 6.3, DEPLOYMENT, SETUP) & Local Quality Gate
- [x] Phase 5: Walkthrough Generation & Evidence Sealing
- [x] Phase 6: Create draft PR (`Closes #82`, `Refs #38`)
- [ ] Phase 7: Rebase & Merge (owner)
