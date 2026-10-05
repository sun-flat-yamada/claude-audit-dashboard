import type {
  MonthlyCostRow,
  MonthlyReport,
  MonthlyReportIndex,
  MonthlyReportIndexEntry,
} from '@claude-audit/core/contracts';

export type { MonthlyCostRow, MonthlyReport, MonthlyReportIndex, MonthlyReportIndexEntry };

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2026-08` -> `August 2026` (fixed English names, no locale or time zone dependence). */
export function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const name = match ? MONTH_NAMES[Number(match[2]) - 1] : undefined;
  return match && name ? `${name} ${match[1]}` : month;
}

/** The entry for `id`, or the newest month (index order) when no id is given. */
export function selectEntry(
  index: MonthlyReportIndex,
  id: string | undefined,
): MonthlyReportIndexEntry | null {
  return id === undefined
    ? (index.reports[0] ?? null)
    : (index.reports.find((e) => e.id === id) ?? null);
}

/**
 * True when the group amounts add up to more than the organization total, i.e. members were
 * attributed to several groups. Used only to emphasise the notice: group amounts are never
 * summed for display.
 */
export function groupsOverlap(report: MonthlyReport): boolean {
  if (report.totalCost === null) return false;
  const sum = report.byGroup.reduce((acc, g) => acc + g.amount, 0);
  return sum > report.totalCost + 0.005;
}

/** Case-insensitive match on name or key; an empty query keeps every row. */
export function filterRows(rows: readonly MonthlyCostRow[], query: string): MonthlyCostRow[] {
  const q = query.trim().toLowerCase();
  return q === ''
    ? [...rows]
    : rows.filter((r) => r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q));
}
