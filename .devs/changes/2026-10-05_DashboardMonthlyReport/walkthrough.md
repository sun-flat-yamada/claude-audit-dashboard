# Walkthrough: B2-7 F-009 Monthly cost report viewer

## Summary

`#/reports/monthly` (and `#/reports/monthly/<id>`) now shows the monthly cost report: month selector from an index, organization total (ungrouped), chargeback table per RBAC group, cost by model and product, notes, and the V7 overlap notice. The data is a small mapped public schema (D8) produced by the collector's `report monthly` and by `pnpm demo` (three synthetic months). Closes #67, refs #37.

## Changes Made

### packages/core

- `contracts/monthly-report.ts`: `MONTHLY_REPORT_SCHEMA_VERSION = 1`, month file and index schemas, path helpers.
- `application/presenters/monthly-report-view.ts`: pure mapper from the monthly `ReportDocument` (numbers from the raw cost records, group names from the report's group table) and index merge.
- `contracts/detail-bundle.ts`: `detail/monthly/*` is validated (index <-> files, schema, `example.*` e-mails only) and no longer reported as unlisted.

### packages/collector

- `main/monthly-report.ts` (writer, zod at the write site, index read-merge-write), `main/commands.ts` (`report monthly` writes it), `main/demo.ts` (2026-06..2026-08), `data/sample/detail/monthly/*` generated.

### packages/dashboard

- `lib/monthly-view.ts`, `pages/MonthlyReport.tsx`, routes and nav entry. Reuses `DetailControls`, `Badges`, `Card`.

### Staging, publication, docs

- `stage-data.mjs` and `deploy-pages.yml` already copy `detail/` whole, so monthly files follow the B2-2 rule (sample always; live only with `PAGES_DETAIL_DATA=true`); a stage-data test pins it. Docs: `DASHBOARD-FEATURES.md`, `BLUEPRINT.md`, `DEPLOYMENT.md`, `SETUP.md`, `storage-and-data-routing.md`.

## Decisions and limits

- D2 for monthly files: conservative (gated by `PAGES_DETAIL_DATA`), since the plan only recommended `PAGES_DATA_SOURCE=live` alone conditionally and calls cost confidential.
- No export (the plan does not list one for B2-7) and no chart (tables only).
- The fixture tenant does not produce monthly files; the page shows "not published" there.

## Verification Results

| Stage                | Command                                                                              | Result            |
| :------------------- | :----------------------------------------------------------------------------------- | :---------------- |
| Quality gate         | `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build` | Pass (exit 0)     |
| Lint                 | `pnpm lint`                                                                          | Pass (exit 0)     |
| Format               | `pnpm format:check`                                                                  | Pass (exit 0)     |
| Dependency audit     | `pnpm audit:deps`                                                                    | Pass (exit 0)     |
| Golden               | `pnpm demo` twice, no change to existing `data/sample` files                         | Stable            |
| Tests                | core 92, collector 109, dashboard 227                                                | All pass          |
