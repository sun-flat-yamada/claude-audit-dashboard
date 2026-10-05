# Walkthrough: model x group aggregate in DashboardView v3 (#102)

D6 (a) is implemented and the staged file of D6 (b) is retired.

## What changed

- Contract: `DASHBOARD_VIEW_SCHEMA_VERSION` 3 with `modelMatrix` (`null` = collection off, `unavailable` / `error` with a reason, or the matrix). The zod schema checks that cells and mix rows only refer to listed models, groups and months. `contracts/usage-matrix.ts` and the manifest kind `usage-matrix` are removed; `DETAIL_SCHEMA_VERSION` is 2.
- Core: `buildModelMatrix()` and `buildDashboardView({ usageMatrix })`; the detail presenter no longer writes a matrix file.
- Collector: `writeDashboard` reads the stored `usage-matrix/input.json` (the `usage-matrix` step already runs before `dashboard` in `pnpm pipeline`); `pnpm demo` carries the synthetic 3-month matrix in `dashboard.json`; `data/sample/detail/usage-matrix.json` is deleted and the other detail files change only by `schemaVersion: 2`.
- Dashboard: `#/models` reads `view.modelMatrix` (no detail fetch); the Overview has a "Model spend" card (latest month, ungrouped, with a table view and a link to `#/models`; hidden while the collection is off).
- Publication: the matrix now follows the `dashboard.json` rule; no `PAGES_DETAIL_DATA` condition. It is aggregate-only and the same group names / per-group cost are already in `usage.byGroup`.

## Unchanged by design

`sources.usageMatrix.enabled` stays opt-in (default off). With it off, `dashboard.json` differs from v2 only by `schemaVersion: 3` and `modelMatrix: null`; the 13 datasets, coverage, OP-002 and the score are identical. The multi-`group_by` behavior of the Analytics API is still assumed (real-tenant confirmation: #29).

## Evidence

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build` pass; `pnpm lint`, `pnpm format:check`, `pnpm audit:deps` pass.
- `pnpm test:e2e`: 360 passed, 14 skipped by design (all data profiles, axe scans of every route in light and dark, the new Overview card, the stale-data profiles).
- Docs synced: `docs/BLUEPRINT.md`, `docs/DASHBOARD-FEATURES.md`, `docs/API-MAPPING.md`, `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`, `.agents/rules/storage-and-data-routing.md`, `CHANGELOG.md`.
