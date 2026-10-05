# Walkthrough: F-015 PR1 multi-time-point synthetic data and design

## Summary

`pnpm demo` now collects and judges the synthetic tenant at three fixed-clock time points (T1 = latest - 28 days, T2 = latest - 14 days, T3 = latest). T3 is today's single-point sample produced by the unchanged code path, so every root file of `data/sample/` is byte-identical. The two earlier points are additional files under `data/sample/history/<snapshot id>/` (`dashboard.json`, `compliance-report.json`; existing contracts only). The plan settles the open design decisions for the whole of F-015 and lists the work units of the remaining PRs. No `DashboardView` change, no dashboard code change.

## Changes Made

### packages/collector

- `src/adapters/demo/demo-history.ts` (new): the three time points and their scenarios (rules disabled / tuned, datasets unavailable or failing, per-dataset transforms) and the collector wrapper. The latest point has the empty scenario.
- `src/main/demo-history.ts` (new): collects and judges the earlier points in one separate store (oldest first, cumulative score history per point) and returns `history/<id>/dashboard.json` and `compliance-report.json`.
- `src/main/demo.ts`: merges the history files into the sample; the latest-point path is untouched.
- `src/main/__tests__/demo-history.test.ts` (new): asserts every intended transition between consecutive points from the rule results, coverage and KPIs, the latest point equals the public sample, determinism, the committed `history/` equals the generated file set, and the optional-sources profile enables the B4 datasets only at the latest point.

### scripts

- `scripts/fork-verify.ts`: validates `history/*/dashboard.json` (published contract, `source: "demo"`) and the presence of the reports, for `data/sample/` and `data/sample-optional-sources/`; the existing e-mail check already walks every file.

### Transitions (rule: T1 > T2 > T3)

| Kind | Rules |
| :-- | :-- |
| pass > fail | AK-003 (T1>T2); CF-003, UA-001 (T2>T3) |
| fail > pass | CF-006 (T1>T2); AC-002, OP-002 (T2>T3) |
| warning > pass | AM-002 (T1>T2), UA-002 (T2>T3) |
| pass > warning | AM-006, UA-002 (T1>T2) |
| pass > skipped | AC-004, UA-003, UA-004 (T1>T2); skipped > fail / warning at T2>T3 |
| error > pass | UA-001 (T1 invalid parameter > T2) |
| rule added / removed | DG-001, AM-007 added, AK-002 removed (T1>T2); AK-002 added (T2>T3) |
| coverage | invites ok>error>ok, spendLimits ok>unavailable>ok, groups unavailable>error>ok |
| KPIs | members 34>43>40, MAU 23>35>30, month-to-date cost 131.95>4961.23>4775.88 |

### Sample data

Only new files: `data/sample/history/2026-09-01T12-00-00Z/{dashboard,compliance-report}.json`, `data/sample/history/2026-09-15T12-00-00Z/{dashboard,compliance-report}.json`. No existing sample, golden or E2E expectation changed. The committed `dashboard.json` keeps a one-point `compliance.history` (decision recorded in the plan; open question for the owner).

### Docs

- `docs/DASHBOARD-FEATURES.md` F-015 status (Planned, multi-point data available), `docs/BLUEPRINT.md` §9 note, §11/fork:verify item and §17 note, `CHANGELOG.md`.

## Verification Results

| Stage | Command | Result |
| :-- | :-- | :-- |
| Code-Data Decoupling | `pnpm fork:verify` | Clean (exit 0), `history/` validated |
| TypeScript Check | `pnpm typecheck` | Pass (exit 0) |
| Unit & Integration Tests | `pnpm test` | core 179, collector 254, dashboard 342 pass |
| Zero Secret / PII Scan | `pnpm secret-scan` | 0 leaks (exit 0) |
| Production Build | `pnpm build` | Built |
| Lint / Format (CI) | `pnpm lint && pnpm format:check` | Clean |
| Dependency audit | `pnpm audit:deps` | No known vulnerabilities |
| E2E and accessibility | `pnpm test:e2e` | 361 passed, 15 skipped (by profile design), 0 failed (3.9 min) |
| Determinism / speed | `pnpm demo` twice | no diff the second time; about 2 s |
