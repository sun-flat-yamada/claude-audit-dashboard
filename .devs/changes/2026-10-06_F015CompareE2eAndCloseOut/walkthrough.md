# Walkthrough: F-015 PR5 compare E2E and axe suite, docs close-out

## Summary

Adds the E2E and accessibility coverage of the F-015 compare view to the B5 suite on every relevant data profile and closes F-015 in the docs (Implemented). Work-Unit Issue #119 (sub-issue of #42). No application code, contract or `data/sample/` change: axe found no violation (of any impact) on `/compare`, so nothing needed fixing and nothing is suppressed. Rebased onto main after the compare page fixes #117 / PR #120 (the rule table column order changed; the specs address columns by name).

## Changes Made

### Data profiles (`packages/dashboard/scripts`, `playwright.config.ts`)

- `e2e-profiles.mjs`, `e2e-prepare.mjs`: new derived profile `compare-archived` (the sample whose `detail/compare/index.json` also lists three `archived` points, validated with `compareIndexSchema`); the `empty` profile now also carries a compare index with no points (validated). `playwright.config.ts`: the `e2e/compare` folder runs on `sample`, `fixtures`, `optional-sources`, `unavailable`, `empty` and `compare-archived`.
- Owner decisions applied: `optional-sources` is the multi-point profile besides `sample`; the `fixtures` tenant stays single-point ("comparison is not possible yet").

### Specs (`packages/dashboard/e2e`)

- `support/compare.ts`: loads the profile's published compare files, computes the expected diff with the core `diffTimePoints`, locators by role and name, rule table columns by name.
- `compare/multi-point.spec.ts` (sample, optional-sources): default selection (newest vs previous), selectors, swap, hash and a reloaded deep link, back / forward, regressed-first rules with icon + label + colour, chips with counts, search, coverage, key figures, unknown id, same point, missing / broken point file.
- `compare/export.spec.ts`: Markdown / CSV / JSON via `waitForEvent('download')`, equal to the core formatters; on the sample the three pairs equal the collector goldens byte for byte with the deterministic file names.
- `compare/keyboard.spec.ts`: skip link, focus order (selectors, swap, exports, chips, search), arrow keys on the selectors, Enter / Space on swap, chips and exports, focus indicators, the rule region scrolling at 390px.
- `compare/a11y.spec.ts`: axe wcag2a + wcag2aa (critical / serious must be 0) in light, dark and at 390px (no horizontal page scroll), including a regression filter, the unchanged rules, an empty search, after an export, focused select and chip, the archived guide and the focused archived option, and the guidance notices of the profiles without a comparison.
- `compare/states.spec.ts`: fixtures (single point), unavailable (not published; not collected through the manifest), empty, `compare-archived` (disabled options, the `pnpm cli restore <id>` / `pnpm build:detail --snapshot <id>` text, archived id in the link, keyboard never selects an archived point).
- `stale/schema-mismatch.spec.ts`: the compare alert names `detail/compare/index.json` and `pnpm build:detail`.

### Docs

`docs/DASHBOARD-FEATURES.md` (F-015 Implemented in the matrix, status section and Testing row), `docs/BLUEPRINT.md` (F-015 paragraph, section 17 note, 18.3 profiles / coverage / accessibility), `README.md` and `README.ja.md` (dashboard feature bullet), `CHANGELOG.md`, `CONTRIBUTING.md` (profile and spec folder list, axe note). The run instructions (`pnpm test:e2e`, `--repeat-each=5`) are unchanged.

## Verification Results

| Stage | Command | Result |
| :-- | :-- | :-- |
| Code-Data Decoupling | `pnpm fork:verify` | clean (exit 0) |
| TypeScript (incl. e2e) | `pnpm typecheck` | pass |
| Tests | `pnpm test` | core 316, collector 315, dashboard 442, scripts 32 passed |
| Secret scan | `pnpm secret-scan` | clean |
| Build | `pnpm build` | pass |
| Lint / format / audit | `pnpm lint && pnpm format:check && pnpm audit:deps` | pass, no known vulnerabilities |
| E2E and axe | `pnpm test:e2e` (full suite, rebased code) | 565 passed, 0 failed, 250 skipped (profile-specific) |
| Stability | `playwright test e2e/compare e2e/stale e2e/empty e2e/unavailable e2e/sample/compare.spec.ts --repeat-each=5` (`retries: 0`) | 665 passed (133 x 5), 0 failed |

## F-015 completion checklist (PR1 to PR5)

| Step | Work-Unit Issue | PR | Content |
| :-- | :-- | :-- | :-- |
| PR1 | #101 | #103 | multi-time-point synthetic data, F-015 design D-1 to D-5 |
| PR2 | #106 | #108 | time-point summary, diff core, export formatters, `detail/compare/*`, 3-point sample trend |
| PR3 | #110 | #113 | compare UI `#/compare`, hash-router query support |
| PR4 | #116 | #118 | archived points in the compare index, restore-to-compare integration tests |
| Fix | #117 | #120 | compare tables at 390px, copy, base-only default selection |
| PR5 | #119 | this PR | E2E and axe for the compare view, docs close-out |

## #42 acceptance criteria, one by one

| Criterion | Status | Where |
| :-- | :-- | :-- |
| Two reports selectable, diff clear (icon + label + colour, no horizontal scroll at 390px, light / dark) | met | #113, #120, E2E and axe in this PR |
| Status changes extracted and classified (full table test) | met | #108 `time-point-diff.test.ts` (5 x 5) |
| Coverage and resource / cost differences shown | met | #113, E2E here |
| Markdown / CSV / JSON export works | met | #108 formatters, #113 buttons, downloads in E2E here |
| `pnpm demo` multi-point sample, golden test and `fork:verify` | met | #103, #108 |
| Unit and component tests with test data | met | #108, #113, #118 |
| Integration test comparing an archived snapshot | met | #118 `compare-archived.test.ts` |
| E2E / axe added to the B5 suite, all existing E2E pass | met | this PR (565 passed) |
| Contract change: schemaVersion bump, sample regeneration, `fork:verify` | met / not applicable | new files have their own `schemaVersion` (design D-1 b); `DashboardView` was not changed by F-015; sample regenerated in #108 |
| `docs/DASHBOARD-FEATURES.md` F-015 Status and `docs/BLUEPRINT.md` section 9 in sync | met | this PR |
| Quality gate commands | met | table above |

Notes for the owner: (1) all 11 boxes are satisfied in the repository, so the PR uses `Closes #42`. (2) The issue text also asks that every E2E profile carries several time points; by the owner's decision the fixture tenant stays single-point (tests the "not possible" notice) and `empty` / `unavailable` publish no points by design (they test the states). (3) The issue's prerequisites that are real-tenant work (#29 / #37 / #38 / #39 verification with a live key) are not acceptance criteria of #42 and stay open.
