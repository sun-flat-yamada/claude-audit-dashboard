# B2-1 F-003 Compliance results export (CSV / JSON)

Closes #53. Refs #37 (tracking). Plan source: `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` section B2-1 (owner accepted D1-D8; D7: export the filtered view plus an explicit "export all" button). Prerequisite B2-0 (#49, PR #50) is merged.

## User Review Required

> [!IMPORTANT]
> Additive contract change only: `COMPLIANCE_EXPORT_COLUMNS` in `@claude-audit/core/contracts` (no `DASHBOARD_VIEW_SCHEMA_VERSION` bump). The collector compliance report uses the same constant, so the dashboard export and `pnpm report:compliance` cannot drift. `data/sample/` is untouched.

> [!WARNING]
> Exported files leave the browser and are opened in spreadsheets: every CSV cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` (after which RFC 4180 quoting applies). Exported values are the already-masked `dashboard.json` values; nothing new is exposed.

## Proposed Changes

### packages/core

#### [NEW] `src/contracts/compliance-export.ts` (exported from `contracts/index.ts`)

- `COMPLIANCE_EXPORT_COLUMNS = ['Rule', 'Name', 'Severity', 'Status', 'Message']`.

#### [MODIFY] `src/application/use-cases/reports.ts`

- `findingsSection` uses the shared constant for its columns (values and order unchanged).

### packages/dashboard

#### [NEW] `src/lib/export.ts`

- Pure builders: `escapeCsvCell` (injection guard + RFC 4180), `complianceCsv(results)` (shared columns first, then `Category`, `Remediation`, `Evidence`; CRLF; trailing CRLF), `complianceJson(results)` (stable key order, 2-space indent), `exportFileName(stamp, format, filter)`, `stampFrom(collectedAt, generatedAt)`.

#### [NEW] `src/components/ExportButtons.tsx`

- Group "Export compliance results" with "Export CSV (<filter>)", "Export JSON (<filter>)", "Export all CSV", "Export all JSON". Download through a Blob and a temporary anchor; buttons disabled when there is nothing to export.

#### [MODIFY] `src/components/ComplianceResults.tsx`, `src/components/sections.tsx`

- Render the export buttons next to the status filter; pass the file-name stamp.

#### [NEW] `src/pages/Compliance.tsx`, [MODIFY] `src/routes.tsx`

- Route `#/compliance` ("Compliance" in the nav) with the full results card.

### packages/collector

- Parity test: the CSV rendered from the compliance report starts with `COMPLIANCE_EXPORT_COLUMNS` and the dashboard CSV header starts with the same list.

### Tests

- `src/lib/__tests__/export.test.ts`: escaping matrix (comma, newline, CR, quote, each injection prefix, tab, plain), column order, file names, empty results, JSON shape.
- `src/components/__tests__/ExportButtons.test.tsx`, `ComplianceResults` export cases: role + accessible-name selectors, Blob content via mocked `URL.createObjectURL`, filter respected, export all ignores the filter.
- Route test for `#/compliance` in `src/__tests__/app.test.tsx`.

### Docs

- `docs/DASHBOARD-FEATURES.md` F-003 row and section; `docs/BLUEPRINT.md` section 9.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- Targeted: `pnpm --filter @claude-audit/dashboard test`

### Manual Verification

- Open `#/compliance` on the demo data, export with a status filter and with "Export all", open the CSV in a spreadsheet.
