/**
 * Leading columns of the compliance results export, shared by the collector report
 * (`pnpm report:compliance` CSV) and the dashboard download so both stay aligned. Additive: the
 * dashboard may append further columns after these but never reorders them.
 */
export const COMPLIANCE_EXPORT_COLUMNS = ['Rule', 'Name', 'Severity', 'Status', 'Message'] as const;

export type ComplianceExportColumn = (typeof COMPLIANCE_EXPORT_COLUMNS)[number];
