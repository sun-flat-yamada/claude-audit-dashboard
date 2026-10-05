# F-015 PR2: time-point summary, diff core, export formatters and compare data files

Closes #106 (Work-Unit Issue, sub-issue of #42), Refs #42 (F-015 snapshot / report diff view). Builds on PR1 (#101 / #103), which produced the three-time-point synthetic data and settled the design (D-1 to D-5 in `.devs/changes/2026-10-05_F015MultiTimePointSampleData/implementation_plan.md`). This PR implements D-1 (data files), D-2 (summary store, without the `archived` listing), D-3 (pure core) and the data half of D-5 "PR2". It adds no UI page.

## User Review Required

> [!IMPORTANT]
> Owner decisions applied here: (1) selectable time points are capped at 90; (2) the persistent store is `data/summaries/<snapshot id>.json` on `data/audit` (a summary is written next to each judged snapshot and outlives archiving); (3) the committed sample trend is widened to three points: `data/sample/dashboard.json` `compliance.history` now carries T1, T2 and T3, so everything that relied on the one-point "not enough history" display changes deliberately (listed in the PR).
> `DashboardView` stays v2 (no schema change); only the sample VALUE of `compliance.history` changes. The detail manifest gains the kind `compare` (additive; `DETAIL_SCHEMA_VERSION` stays 1 like `usage-matrix`, `alerts`), the new files carry their own `schemaVersion`.

> [!WARNING]
> - To get a three-point `compliance.history` honestly, `pnpm demo` now collects and judges T1, T2 and T3 in ONE store, oldest first, like a real pipeline accumulates reports. The root files other than `dashboard.json` must stay byte-identical (checked by diff); `history/<id>/*` files must stay byte-identical.
> - Classification choice (documented in the code and tested): `skipped -> error` is `regressed` and `error -> skipped` is `improved` (an error is worse than a skip for missing data); `pass < warning < fail` for assessed rules.
> - `buildTimePointSummary` and the KPI figures use the snapshot's `collectedAt` as the clock, so a backfill from a restored snapshot equals what the pipeline would have written.

## Proposed Changes

### packages/core (pure, exported through `@claude-audit/core/contracts` where the dashboard needs it)

#### [NEW] `src/contracts/time-point-summary.ts`

- `TIME_POINT_SUMMARY_SCHEMA_VERSION = 1`, `COMPARE_SCHEMA_VERSION = 1`, paths (`detail/compare/index.json`, `detail/compare/<id>.json`, store `summaries/<id>.json`), `COMPARE_POINT_LIMIT = 90`.
- zod `timePointSummarySchema` (id, collectedAt, score, assessed, total, rules `{id,name,category,severity,status}`, `disabledRules`, datasets `{name,status,count}`, kpis `{id,label,unit,value}`; no evidence, no labels, no per-person data) and `compareIndexSchema` (`points: [{id, collectedAt, state: 'summary' | 'archived', score, assessed}]`, newest first).

#### [NEW] `src/contracts/time-point-diff.ts`

- `diffTimePoints(base, target)`: rule changes (5 x 5 status table plus `added` / `removed`), coverage changes, KPI deltas, score delta with the assessed-count change; counts per class; deterministic order (change class, severity, id). Pure, no clock.

#### [NEW] `src/contracts/time-point-export.ts`

- `timePointDiffMarkdown`, `timePointDiffCsv`, `timePointDiffJson`, `timePointDiffFileName` (deterministic columns and names). CSV reuses the escaping helper.

#### [MODIFY] `src/contracts/compliance-export.ts`

- Move `escapeCsvCell` (RFC 4180 + formula-injection guard) and a `csvText(rows)` helper here from the dashboard (single source of truth); `packages/dashboard/src/lib/export.ts` re-exports it (no behavior change).

#### [NEW] `src/application/presenters/time-point-summary.ts`

- `buildTimePointSummary({ snapshot, report, kpis, disabledRules })` and `buildCompareIndex(summaries, now, limit)`; `dashboardKpis` is exported from the dashboard presenter for the collector to reuse.

### packages/collector

#### [NEW] `src/main/summaries.ts`

- Summary store: `writeSummary`, `readSummaries` (validated, invalid files skipped with a warning), `backfillSummaries` (newest 90 reports whose snapshot is still stored and whose summary is missing).

#### [MODIFY] `src/main/workflows.ts`, `src/main/detail.ts`, `src/main/demo.ts`, `src/main/demo-history.ts`

- `check` writes the summary of the judged snapshot (optional per-call overrides used by the demo scenarios).
- `writeDetail` backfills, writes `detail/compare/index.json` plus the newest 90 per-point files, removes stale per-point files; `--snapshot <id>` rewrites that point's summary.
- `pnpm demo` judges T1, T2, T3 in one store; root files unchanged except the three-point `compliance.history`.

### scripts and rules

- `scripts/fork-verify.ts`: `data/summaries` is a forbidden tracked path; compare files are validated through `checkDetailBundle` (schema, index <-> file consistency, `example.*` only, no evidence text).
- `.gitignore`, `.agents/rules/storage-and-data-routing.md`, `docs/DEPLOYMENT.md`, `docs/SETUP.md`: `data/summaries/`.

### Tests

- Core: table-driven 5 x 5 transition test, added / removed rules, dataset add / remove, empty report, identical reports (zero diff), score delta with differing assessed counts, KPI deltas, summary build from a real sample report, export goldens from the three sample points, CSV escaping.
- Collector: summary store, backfill, cap 90 and stale removal, bundle-check negative cases, demo golden (existing `sample-and-docs` golden covers `detail/compare/*`).
- Dashboard / E2E: expectations that depended on the one-point trend are updated deliberately; the trend chart keeps its table view; full `pnpm test:e2e` with axe clean.

### Docs

- `docs/DASHBOARD-FEATURES.md` F-015 (in progress; data and diff core available), `docs/BLUEPRINT.md` §9 and storage notes, `CHANGELOG.md`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- `pnpm test:e2e` (full suite)
- `pnpm demo` twice: the second run shows no diff (determinism).

### Manual Verification

- `git diff --stat data/sample`: only `dashboard.json` (history) changed among root files; new files only under `detail/compare/`.
