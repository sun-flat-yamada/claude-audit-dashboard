# Walkthrough: F-015 PR4 archived-snapshot comparison (#116)

## Summary

`pnpm build:detail` now lists archived snapshots without a stored summary in `detail/compare/index.json` as `state: 'archived'` (no score, no per-point file), sharing the 90-point cap with the live points. Integration tests prove that archive -> restore -> `build:detail --snapshot` yields a diff byte-identical to the never-archived one. No contract change, `data/sample/` unchanged.

## Changes Made

### Core

- `presenters/archive-view.ts`: `archivedSnapshotIds(entries)` (valid `<year>/<id>.json.gz` ids, newest first).
- `presenters/time-point-summary.ts`: `buildCompareIndex(summaries, now, limit, archivedIds)` merges both kinds (summary wins for a repeated id), one cap, deterministic.
- `presenters/detail-view.ts`: `DetailInput.archivedIds`; the index is `unavailable` only with neither summary nor archived id.

### Collector

- `main/detail.ts`: passes the archive ids of the data directory (a supplied listing, the demo's synthetic archive, is inventory only). Stale `detail/activity-<yyyy-mm>.json` files not listed by the new bundle are removed (a `--snapshot` build followed by a latest build left unlisted files; found by the new test).

### Tests

- Core: `time-point-summary.test.ts`, `archive-view.test.ts`.
- Collector: `main/__tests__/compare-archived.test.ts` (400-day weekly history, 133-point history for the cap, B1 fixture tenant, golden index).
- Dashboard: `pages/__tests__/CompareArchived.test.tsx` with `fixtures/compare-index-archived.json` (pinned by the collector test; `UPDATE_GOLDEN=1` rewrites it).

### Docs

`docs/DASHBOARD-FEATURES.md`, `docs/BLUEPRINT.md`, `docs/DEPLOYMENT.md`, `.agents/rules/storage-and-data-routing.md`, `CHANGELOG.md`.

## Verification Results

| Stage | Command | Result |
| :-- | :-- | :-- |
| Code-Data Decoupling | `pnpm fork:verify` | clean (exit 0) |
| TypeScript | `pnpm typecheck` | pass |
| Tests | `pnpm test` | core 316, collector 315, dashboard 439 passed |
| Secret scan | `pnpm secret-scan` | clean |
| Build | `pnpm build` | pass |
| Lint / format / audit | `pnpm lint && pnpm format:check && pnpm audit:deps` | pass |
| Sample determinism | `pnpm demo` | no diff in `data/` |
| E2E | `pnpm test:e2e` | not run: no sample data, route or UI text changed |
