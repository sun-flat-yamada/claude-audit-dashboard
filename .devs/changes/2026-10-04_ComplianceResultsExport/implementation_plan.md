# B2-1 F-003 Compliance results export (CSV / JSON)

Closes #53. Refs #37 (tracking). Plan source: `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` section B2-1 (owner accepted D1-D8; D7: export the filtered view plus an explicit "export all"). Prerequisite B2-0 is merged.

## Proposed Changes

- `core/contracts/compliance-export.ts`: `COMPLIANCE_EXPORT_COLUMNS` (additive, no schema bump); the collector findings table uses it.
- `dashboard/src/lib/export.ts`: pure CSV / JSON builders, RFC 4180 quoting, formula-injection guard, deterministic file names.
- `components/ExportButtons.tsx`, `pages/Compliance.tsx`, route `#/compliance`; `ComplianceResults` gets an optional `exportFrom` prop.
- Docs: DASHBOARD-FEATURES F-003, BLUEPRINT section 9.

## Verification Plan

Unit (escaping matrix, injection prefixes, column order, file names, empty), component (role / name selectors, Blob content, filter respected), parity (core report test: findings columns equal the shared constant), full quality gate.
