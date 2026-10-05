# Walkthrough: F-015 PR2 time-point summary, diff core, export and compare data files

## Summary

Implements the data half of F-015 (#42) as Work-Unit #106: per-time-point summaries, the pure diff and export formatters in `@claude-audit/core/contracts`, the collector's summary store and `detail/compare/*` files, validation, and the widening of the sample trend to three points. No UI page (PR3). Owner decisions applied: 90 selectable points, persistent store `data/summaries/`, sample trend widened to 3 points.

## Changes Made

### Core

- `contracts/time-point-summary.ts`: strict `TimePointSummary` / `CompareIndex` schemas (own `schemaVersion`), paths, `COMPARE_POINT_LIMIT = 90`.
- `contracts/time-point-diff.ts`: `diffTimePoints`, `classifyStatusChange` (5 x 5 table, `skipped -> error` is `regressed`), `classifyCoverageChange`.
- `contracts/time-point-export.ts`: Markdown / CSV / JSON formatters, deterministic columns and file names.
- `contracts/compliance-export.ts`: `escapeCsvCell` and `csvText` moved here from the dashboard (finite numbers bypass the formula guard); `dashboard/src/lib/export.ts` re-exports.
- `contracts/detail-view.ts`, `detail-bundle.ts`: manifest kind `compare`; bundle checks for the index <-> files, summary consistency, strict fields, `example.*` only, no sensitive strings.
- `application/presenters/time-point-summary.ts`: `buildTimePointSummary`, `buildCompareIndex`; `detail-view.ts` builds the compare part; `dashboard-view.ts` exports `buildDashboardKpis`.

### Collector

- `main/summaries.ts`: `summaryFor`, `saveSummary`, `readSummaries`, `backfillSummaries`.
- `main/workflows.ts`: `check` writes `summaries/<id>.json` (per-call overrides for the demo scenarios).
- `main/detail.ts`: backfill, compare files (newest 90), stale point files removed, `--snapshot` writes the point's summary.
- `main/demo.ts`, `main/demo-history.ts`: the three points are judged in one store, oldest first.
- `scripts/fork-verify.ts`, `.gitignore`: `data/summaries` is a forbidden tracked path.

### Sample, tests, E2E (every changed file and why)

- `data/sample/dashboard.json`: `compliance.history` now has T1, T2, T3 (owner decision).
- `data/sample/detail/index.json`, `detail/compare/*` (new): the `compare` manifest entry and the three summaries plus index.
- `data/sample/history/*`: regenerated; the files committed with #101 predated the product active-user fields and a token rounding change, so they differed from what the generator produces.
- `demo-history.test.ts`: trend lengths `[1, 2, 3]` and the latest trend equals the three reports.
- `detail.test.ts`: `readBundle` reads nested files; the key-less pipeline now also writes the compare files of the empty collection.
- `optional-profiles.test.ts`: the dataset names also appear in the (status and count only) compare summary.
- `e2e/sample/overview.spec.ts`: the sample has three points, so four charts (score trend first) and a score figure locator limited to spans (the trend's table repeats the score).
- `e2e/sample/keyboard.spec.ts`: the first content stops are the score trend chart, its "View as table" twin, then the status filter.
- New tests: `time-point-diff.test.ts` (5 x 5 table, added / removed, dataset add / remove, empty / identical, score and KPI deltas, export formats and CSV escaping), `time-point-summary.test.ts` (summary build, index, bundle negative cases), `time-point-compare.test.ts` (summary store, backfill, cap 90, stale removal, summaries equal those built from the real sample reports, export goldens in `__golden__/*.golden`, `.gitattributes` keeps their bytes), `ComplianceTrend.test.tsx`.

### Docs

`docs/DASHBOARD-FEATURES.md` (F-015 in progress), `docs/BLUEPRINT.md` (§9 F-015, storage table, §17 note), `.agents/rules/storage-and-data-routing.md`, `docs/DEPLOYMENT.md`, `docs/SETUP.md`, `CHANGELOG.md`.

## Verification Results

| Stage                    | Command                                | Result                                           |
| :----------------------- | :------------------------------------- | :----------------------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`                     | Clean (exit 0)                                   |
| TypeScript Check         | `pnpm typecheck`                       | Pass (exit 0)                                    |
| Unit & Integration Tests | `pnpm test`                            | core 278, collector 281, dashboard 351, scripts 32 pass |
| Zero Secret / PII Scan   | `pnpm secret-scan`                     | 0 leaks (exit 0)                                 |
| Production Build         | `pnpm build`                           | Built                                            |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check`       | Clean                                            |
| Dependency audit         | `pnpm audit:deps`                      | No known vulnerabilities                         |
| E2E and axe              | `pnpm test:e2e` (full suite)           | 362 passed, 15 skipped (as before), axe clean    |
| Determinism              | `pnpm demo` twice                      | identical output                                 |
