# B2-11 F-013 Archive inventory view (#/archive)

Closes #71. Refs #37 (tracking). Plan source: `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` section B2-11. Owner accepted D1-D8. Prerequisite B2-0 is merged; the patterns of B2-7 (monthly) and B2-12 (configuration) are reused.

## User Review Required

> [!IMPORTANT]
> The inventory is an aggregate: per year, the number of archived snapshots, the compressed bytes and the oldest / newest snapshot id, plus totals and the retention setting. Only snapshot ids (`yyyy-mm-ddThh-mm-ssZ`), years, counts and byte sizes can appear in the output (the contract validates the id shape); file names that do not parse as `<snapshot id>.json.gz` are ignored and only counted. Per the instruction for this unit the file is a **detail file** (`detail/archive.json`, a manifest `kind: archive`) and follows the detail publication rule (D2: `PAGES_DATA_SOURCE=live` and `PAGES_DETAIL_DATA=true`), instead of the plan's earlier idea of publishing it with `dashboard.json`.

> [!WARNING]
> Real-archive verification and capacity measurement are B3 (#38). The aggregation is pure and order-independent so B3 can reuse it unchanged. The `pnpm demo` archive is synthetic (deterministic ids and sizes, written to the sample only; the temporary demo data directory holds no real archive), so the other sample files stay byte-identical.

## Proposed Changes

### packages/core (pure)

- `[NEW] contracts/archive-view.ts` (exported from `contracts/index.ts`): `ARCHIVE_VIEW_SCHEMA_VERSION = 1`, `DETAIL_ARCHIVE_PATH = detail/archive.json`, `detailArchiveSchema` (years, totals, retention, ignored count).
- `[MODIFY] contracts/detail-view.ts`: `DETAIL_KINDS` gains `archive`.
- `[NEW] application/presenters/archive-view.ts`: `summarizeArchiveEntries(entries)` (pure aggregation, reused by B3) and `buildArchiveView(input)`.
- `[MODIFY] application/presenters/detail-view.ts`, `contracts/detail-bundle.ts`: manifest entry (`ok`, or `unavailable` with a fixed reason when listing failed), schema validation, count and total / per-year consistency check.

### packages/collector

- `[NEW] adapters/storage/archive-inventory.ts`: port `ArchiveListing` (`list`, `size`), `listArchiveEntries(store)` and `summarizeArchive(store)`.
- `[MODIFY] adapters/storage/file-store.ts`: `size(relPath)` helper.
- `[MODIFY] main/detail.ts`: lists the archive and passes it to `buildDetailView`; `main/demo.ts`: synthetic multi-year archive in the demo work directory.

### packages/dashboard

- `[NEW] lib/archive-view.ts` (byte formatting, search, date helpers), `pages/Archive.tsx`, route `/archive` + nav entry "Archive". Reuses `DetailControls.tsx`, `Badges`, `Card`.
- States: loading, not published, not collected (reason from the manifest), error, empty (no archives yet), no match.

### Tests

core: aggregation (empty, single year, multi-year, unsorted, large sizes, unrelated / malformed / year-mismatch entries), bundle check negatives; collector: adapter on a real temporary directory, writer, demo golden; dashboard: helpers, component tests for every state, stage-data, deep link.

### Docs

`docs/DASHBOARD-FEATURES.md` F-013, `docs/BLUEPRINT.md` sections 6.3 / 9, `docs/DEPLOYMENT.md`, `docs/SETUP.md`, `.agents/rules/storage-and-data-routing.md`.

## Verification Plan

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- `pnpm demo` then `git diff --exit-code data/sample` is clean; only `detail/index.json` changes and `detail/archive.json` is added.
- Manual: `DASHBOARD_DATA_SOURCE=sample pnpm dev`, open `#/archive` at 390 px in both themes.
