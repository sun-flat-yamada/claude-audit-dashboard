import {
  COMPLIANCE_EXPORT_COLUMNS,
  csvText,
  escapeCsvCell,
  type DashboardCheckResult,
} from '@claude-audit/core/contracts';
import type { StatusFilter } from './view';

/** Client-side export of the compliance results. Pure and deterministic: same input, same bytes. */

export type ExportFormat = 'csv' | 'json';

/** Columns appended after the shared ones; the shared prefix equals `pnpm report:compliance`. */
export const EXTRA_COLUMNS = ['Category', 'Remediation', 'Evidence'] as const;
export const EXPORT_COLUMNS: readonly string[] = [...COMPLIANCE_EXPORT_COLUMNS, ...EXTRA_COLUMNS];

/** The shared CSV cell escaping (formula-injection guard + RFC 4180), kept exported from here. */
export { escapeCsvCell };

const evidenceText = (result: DashboardCheckResult): string =>
  result.evidence.map((e) => e.label).join('; ');

const csvRow = (result: DashboardCheckResult): string[] => [
  result.ruleId,
  result.ruleName,
  result.severity,
  result.status,
  result.message,
  result.category,
  result.remediation ?? '',
  evidenceText(result),
];

/** CRLF line ends and a trailing CRLF, like the collector's CSV renderer. */
export const complianceCsv = (results: readonly DashboardCheckResult[]): string =>
  csvText([EXPORT_COLUMNS, ...results.map(csvRow)]);

/** Fixed key order (the CSV column order) so the file is byte-stable. */
export function complianceJson(
  results: readonly DashboardCheckResult[],
  filter: StatusFilter,
): string {
  const rows = results.map((r) => ({
    ruleId: r.ruleId,
    ruleName: r.ruleName,
    severity: r.severity,
    status: r.status,
    message: r.message,
    category: r.category,
    remediation: r.remediation,
    evidence: r.evidence.map((e) => ({ kind: e.kind, label: e.label })),
  }));
  return JSON.stringify({ filter, count: rows.length, results: rows }, null, 2) + '\n';
}

/** `yyyymmdd` from an ISO timestamp (string slice, no time zone dependence); `undated` otherwise. */
export function stampFrom(...candidates: Array<string | null>): string {
  for (const c of candidates) {
    const m = c === null ? null : /^(\d{4})-(\d{2})-(\d{2})/.exec(c);
    if (m) return `${m[1]}${m[2]}${m[3]}`;
  }
  return 'undated';
}

/** `compliance-results-<stamp>[-<filter>].<ext>`; the filter is named unless it is `all`. */
export function exportFileName(
  stamp: string,
  format: ExportFormat,
  filter: StatusFilter = 'all',
): string {
  const suffix = filter === 'all' ? '' : `-${filter}`;
  return `compliance-results-${stamp}${suffix}.${format}`;
}

export const MEDIA_TYPE: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

/** Saves text as a file through a temporary anchor; the object URL is released right after. */
export function downloadText(fileName: string, content: string, mediaType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
