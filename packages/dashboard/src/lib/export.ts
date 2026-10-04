import { COMPLIANCE_EXPORT_COLUMNS, type DashboardCheckResult } from '@claude-audit/core/contracts';

/**
 * Pure, deterministic builders for the compliance results download. Column order is fixed: the
 * shared leading columns (same as `pnpm report:compliance`), then the dashboard-only extras.
 */

export const EXPORT_COLUMNS = [...COMPLIANCE_EXPORT_COLUMNS, 'Category', 'Remediation', 'Evidence'];

export type ExportFormat = 'csv' | 'json';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** RFC 4180 quoting plus a spreadsheet formula-injection guard (a leading `'` defuses the cell). */
export const csvCell = (value: string): string => {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

const evidenceText = (result: DashboardCheckResult): string =>
  result.evidence.map((e) => e.label).join('; ');

const rowOf = (r: DashboardCheckResult): string[] => [
  r.ruleId,
  r.ruleName,
  r.severity,
  r.status,
  r.message,
  r.category,
  r.remediation ?? '',
  evidenceText(r),
];

export const buildComplianceCsv = (results: readonly DashboardCheckResult[]): string =>
  [[...EXPORT_COLUMNS], ...results.map(rowOf)]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n') + '\r\n';

/** An array of objects keyed by the column names, in column order. */
export const buildComplianceJson = (results: readonly DashboardCheckResult[]): string =>
  JSON.stringify(
    results.map((r) => Object.fromEntries(rowOf(r).map((v, i) => [EXPORT_COLUMNS[i], v]))),
    null,
    2,
  ) + '\n';

/** `compliance-results-<yyyymmdd>[-<status>].<ext>`; the date is the collection time (UTC). */
export const exportFileName = (
  collectedAt: string | null,
  format: ExportFormat,
  status = 'all',
): string => {
  const day = collectedAt?.slice(0, 10).replaceAll('-', '') || 'unknown';
  const suffix = status === 'all' ? '' : `-${status}`;
  return `compliance-results-${day}${suffix}.${format}`;
};

export const MEDIA_TYPE: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

export const buildExport = (
  format: ExportFormat,
  results: readonly DashboardCheckResult[],
): string => (format === 'csv' ? buildComplianceCsv(results) : buildComplianceJson(results));
