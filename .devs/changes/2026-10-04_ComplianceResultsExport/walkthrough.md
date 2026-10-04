# Walkthrough: B2-1 compliance results export

- New route `#/compliance` lists the results with the status filter and export buttons.
- Filtered export button appears only while a filter is active and names it; "Export all" always exports every result.
- CSV leading columns come from `COMPLIANCE_EXPORT_COLUMNS`, shared with the `pnpm report:compliance` CSV (parity asserted in `alerts-reports.test.ts`).

## Evidence

`pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build && pnpm lint && pnpm format:check && pnpm audit:deps` all pass (core 56, collector 98, dashboard 78 tests).
