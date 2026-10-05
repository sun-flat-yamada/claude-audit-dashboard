# Walkthrough: B2-11 F-013 Archive inventory view

## Summary

`#/archive` shows what `pnpm archive` moved to `archive/<year>/<id>.json.gz`: per-year snapshot counts, compressed sizes, oldest / newest snapshot, totals and the retention setting. The aggregation is a pure core function (`summarizeArchiveEntries`) that B3 (#38) can reuse for capacity measurement; the collector lists the archive directory behind a small port and writes `detail/archive.json`, a new manifest kind with its own `schemaVersion`. Closes #71 (sub-issue of #37). Real-archive verification stays in B3 (#38); the unit is verified with the synthetic sample and temporary directories only.

## Changes Made

### packages/core

- `contracts/archive-view.ts`: `ARCHIVE_VIEW_SCHEMA_VERSION = 1`, `detailArchiveSchema` (snapshot ids validated by shape, years, counts, bytes; no field for names or paths).
- `application/presenters/archive-view.ts`: `summarizeArchiveEntries()` (order-independent, ignores and counts unrelated / malformed / wrong-year entries, repeated id counts once) and `buildArchiveView()`.
- `application/presenters/detail-view.ts`, `contracts/detail-view.ts`, `contracts/detail-bundle.ts`: manifest `kind: archive` (`unavailable` with a fixed reason when listing fails), schema validation, count and totals-vs-years consistency check.

### packages/collector

- `adapters/storage/archive-inventory.ts`: `ArchiveListing` port, `listArchiveEntries()`, `summarizeArchive()`; `FileStore.size()`.
- `main/detail.ts`: lists the archive and writes `detail/archive.json`; `main/demo.ts`: deterministic synthetic archive (84 snapshots, 2023 to 2025, one unrelated file).
- `data/sample/detail/archive.json` added, `detail/index.json` gains the entry; every other sample file is byte-identical.

### packages/dashboard

- `pages/Archive.tsx`, `lib/archive-view.ts` (byte formatting, id formatting, search), route `/archive` and nav entry, status badges (icon + label + color). Reuses `DetailControls.tsx`.

### Docs

`docs/DASHBOARD-FEATURES.md` F-013, `docs/BLUEPRINT.md` sections 6.3 / 9 and the detail file description, `docs/DEPLOYMENT.md`, `docs/SETUP.md`, `.agents/rules/storage-and-data-routing.md`.

## Verification Results

| Stage                    | Command                          | Result                                    |
| :----------------------- | :------------------------------- | :---------------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`               | Clean (exit 0)                            |
| TypeScript Check         | `pnpm typecheck`                 | Pass (exit 0)                             |
| Unit & Integration Tests | `pnpm test`                      | 506/506 pass (core 115, collector 114, dashboard 277) |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | 0 leaks (exit 0)                          |
| Production Build         | `pnpm build`                     | Built                                     |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | Clean                                     |
| Dependency audit (CI)    | `pnpm audit:deps`                | Clean (exit 0)                            |
| Sample                   | `pnpm demo`                      | Only `detail/index.json` changed, `detail/archive.json` added |
