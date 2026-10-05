# B2-7 F-009 Monthly cost report viewer (#/reports/monthly)

Closes #67. Refs #37 (tracking). Plan source: `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` section B2-7. Owner accepted D1-D8; D8: the public data is a small mapped schema, not the full `ReportDocument`. Prerequisites B2-0 (#49) and B2-2 (#57, PR #58) are merged; the patterns of B2-4, B2-5, B2-3 and B2-10 are reused.

## User Review Required

> [!IMPORTANT]
> D2 for monthly cost files: the plan only recommends "yes (under `PAGES_DATA_SOURCE=live` alone) only if it contains no per-person data" and calls cost figures confidential. This unit takes the conservative option: the mapped files live under `detail/monthly/` and are published exactly like the other detail files (`PAGES_DATA_SOURCE=live` **and** `PAGES_DETAIL_DATA=true`, Private Pages only). Relaxing this later is a one-line workflow change.

> [!WARNING]
> Chargeback group rows overlap (a member counts in every group they belong to; CHANGE-PLAN section 10 V7). The organization total is taken from the ungrouped `total` dimension; group amounts are never summed anywhere (no total row, no sum figure). The notice about the overlap is always shown next to the group table, and is emphasised when the shares add up to more than 100%.

## Proposed Changes

### packages/core (pure)

- `[NEW] contracts/monthly-report.ts` (exported from `contracts/index.ts`): `MONTHLY_REPORT_SCHEMA_VERSION = 1`, `monthlyReportIndexSchema` (`detail/monthly/index.json`: id, month, currency, total, status per month, newest first) and `monthlyReportSchema` (`detail/monthly/<id>.json`: period, status `ok|unavailable` + reason, currency, `totalCost`, `byGroup` / `byModel` / `byProduct` rows with amount and share, notes), path helpers.
- `[NEW] application/presenters/monthly-report-view.ts`: `buildMonthlyReportView(document, now)` maps the monthly `ReportDocument` (numbers from the "Raw cost records" section, group names zipped from the "Cost by group" table, notes) and `mergeMonthlyIndex(existing, view)`.
- `[MODIFY] contracts/detail-bundle.ts`: `detail/monthly/*` is validated as part of the bundle (index <-> files consistency, schema, `example.*` e-mails only) and is no longer reported as "not listed in the manifest".

### packages/collector

- `[NEW] main/monthly-report.ts`: `writeMonthlyView(c, document)` parses with the contract at the single write site, updates the index (read-merge-write through the store) and returns path -> content.
- `[MODIFY] main/commands.ts`: `report monthly` also writes the mapped files. `main/demo.ts`: three synthetic months (2026-06, 2026-07, 2026-08; the demo groups already overlap) are generated and written to `data/sample/detail/monthly/`. The existing Markdown / HTML / CSV / JSON reports are unchanged.

### Staging / publication

- `stage-data.mjs` and `deploy-pages.yml` already copy the whole `detail/` directory (sample, fixtures, live gated by `PAGES_DETAIL_DATA`), so `detail/monthly/` follows the B2-2 rule without a script change; a stage-data test pins this. Docs state it. `scripts/fork-verify.ts` already runs `checkDetailBundle` over `data/sample/detail` recursively, which now covers the monthly files.

### packages/dashboard

- `[NEW] lib/monthly-view.ts` (pure helpers: month label, overlap detection, row filter), `pages/MonthlyReport.tsx` (month selector from the index, KPI, chargeback table per RBAC group, model and product tables, overlap notice, notes), routes `/reports/monthly` (newest month) and `/reports/monthly/:id`, nav entry "Monthly report". Reuses `DetailControls.tsx`, `Badges`, `Card`.
- States: loading, not published, not collected (reason from the file), error, empty (no month in the index), no match (search), unknown month.
- Not in this unit: CSV/JSON export (the plan does not ask for it for B2-7) and a chart (tables are the primary view; a chart would need a table twin).

### Tests

- core: mapper (overlap, null key, empty cost -> unavailable, wrong kind), index merge, bundle check incl. negative cases; collector: writer + index merge on disk, demo golden, `report monthly` command; dashboard: helper unit, component tests (every state, `maskPii` on / off of the detail manifest, overlap notice, month selector, deep link), stage-data.

### Docs

`docs/DASHBOARD-FEATURES.md` F-009, `docs/BLUEPRINT.md` sections 4.2 / 9, `docs/DEPLOYMENT.md`, `docs/SETUP.md`, `.agents/rules/storage-and-data-routing.md`.

## Verification Plan

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- `pnpm demo` then `git diff --exit-code data/sample` is clean.
- Manual: `DASHBOARD_DATA_SOURCE=sample pnpm dev`, open `#/reports/monthly` at 390 px in both themes.
