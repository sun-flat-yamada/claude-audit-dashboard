# Walkthrough: B2-1 F-003 compliance results export

## Summary

The Compliance results can be downloaded as CSV or JSON from the dashboard, for the currently filtered view (button names the filter) or for all results ("Export all"). Files are built in the browser from the already-masked `dashboard.json` rows. A new `#/compliance` page hosts the card (it stays on the Overview too). No schema version change and no `data/sample/` change.

## Changes Made

### packages/core

- `src/contracts/compliance-export.ts` (new, exported from `contracts/index.ts`): `COMPLIANCE_EXPORT_COLUMNS`.
- `src/application/use-cases/reports.ts`: the compliance report findings table uses the shared constant (output unchanged).

### packages/dashboard

- `src/lib/export.ts` (new): `escapeCsvCell` (formula-injection guard, then RFC 4180), `complianceCsv`, `complianceJson`, `stampFrom`, `exportFileName`, `downloadText`.
- `src/components/ExportButtons.tsx` (new), `ComplianceResults.tsx`, `sections.tsx`: group "Export compliance results" next to the status filter.
- `src/pages/Compliance.tsx` (new), `routes.tsx`, `pages/Overview.tsx`: route `#/compliance`, file-name stamp from `collectedAt`.
- Tests: `lib/__tests__/export.test.ts` (escaping matrix, injection prefixes, column order, file names, empty), `components/__tests__/ComplianceResults.test.tsx` (role / name selectors, Blob content, filter respected, export all, disabled states), deep-link case in `__tests__/app.test.tsx` for the sample and fixture sources.

### packages/collector

- `src/adapters/__tests__/compliance-export-parity.test.ts` (new): the `pnpm report:compliance` CSV header equals `COMPLIANCE_EXPORT_COLUMNS`.

### Docs

- `docs/DASHBOARD-FEATURES.md` F-003 row and section; `docs/BLUEPRINT.md` section 9 (screen table, display requirements).

## Verification Results

| Stage                    | Command                                             | Result           |
| :----------------------- | :-------------------------------------------------- | :--------------- |
| Code-Data Decoupling     | `pnpm fork:verify`                                  | Clean (exit 0)   |
| TypeScript Check         | `pnpm typecheck`                                    | Pass (exit 0)    |
| Unit & Integration Tests | `pnpm test`                                         | core 55, collector 99, dashboard 86 pass |
| Zero Secret / PII Scan   | `pnpm secret-scan`                                  | 0 leaks (exit 0) |
| Production Build         | `pnpm build`                                        | Built            |
| Lint / Format / Audit    | `pnpm lint && pnpm format:check && pnpm audit:deps` | Clean            |
