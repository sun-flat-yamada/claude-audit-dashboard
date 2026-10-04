/**
 * Leading columns of every compliance results export, in order. Shared by the collector's
 * compliance report (`pnpm report:compliance` CSV) and the dashboard's client-side export so the
 * two cannot drift apart. Additive: not part of `dashboardViewSchema`.
 */
export const COMPLIANCE_EXPORT_COLUMNS = ['Rule', 'Name', 'Severity', 'Status', 'Message'] as const;
