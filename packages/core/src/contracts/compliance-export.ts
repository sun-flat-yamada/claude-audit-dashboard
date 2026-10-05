/**
 * Leading columns of every compliance results export, in order. Shared by the collector's
 * compliance report (`pnpm report:compliance` CSV) and the dashboard's client-side export so the
 * two cannot drift apart. Additive: not part of `dashboardViewSchema`.
 */
export const COMPLIANCE_EXPORT_COLUMNS = ['Rule', 'Name', 'Severity', 'Status', 'Message'] as const;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * One CSV cell: the spreadsheet formula-injection guard first (a leading `'` before `=`, `+`,
 * `-`, `@`, tab or CR), then RFC 4180 quoting. Shared by every CSV export (compliance results,
 * time-point diff) so they cannot drift apart.
 */
export function escapeCsvCell(value: string | null): string {
  const text = value ?? '';
  const safe = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * CRLF line ends and a trailing CRLF, like the collector's CSV renderer. A finite number is
 * written as is: it cannot be a formula, and the guard must not turn `-15` into text.
 */
export const csvText = (rows: readonly (readonly (string | number | null)[])[]): string =>
  rows
    .map((row) =>
      row.map((cell) => (typeof cell === 'number' ? String(cell) : escapeCsvCell(cell))).join(','),
    )
    .join('\r\n') + '\r\n';
