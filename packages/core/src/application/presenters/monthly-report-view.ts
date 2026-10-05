import {
  MONTHLY_REPORT_SCHEMA_VERSION,
  monthlyReportPath,
  type MonthlyCostRow,
  type MonthlyReport,
  type MonthlyReportIndex,
  type MonthlyReportIndexEntry,
} from '../../contracts/monthly-report.js';
import { sortedByValue, sumBy, totalsBy } from '../../domain/util/collections.js';
import { percent, round } from '../../domain/util/numbers.js';
import type { Cell, ReportDocument, Section } from '../documents.js';

const UNATTRIBUTED = '(unattributed)';
type CostDimension = 'group' | 'model' | 'product';

interface RawCost {
  dimension: string;
  key: string | null;
  amount: number;
  currency: string;
}

const text = (cell: Cell | undefined): string =>
  cell === null || cell === undefined ? '' : `${cell}`;

function tableOf(document: ReportDocument, title: string): Cell[][] {
  const section = document.sections.find(
    (s): s is Extract<Section, { type: 'table' }> => s.type === 'table' && s.title === title,
  );
  return section?.rows ?? [];
}

/** Raw cost records: `[date, dimension, key, amount, list amount, currency]`. */
function rawCosts(document: ReportDocument): RawCost[] {
  return tableOf(document, 'Raw cost records').flatMap((row) => {
    const amount = row[3];
    return typeof amount === 'number'
      ? [
          {
            dimension: text(row[1]),
            key: row[2] === null || row[2] === undefined ? null : text(row[2]),
            amount,
            currency: text(row[5]) || 'USD',
          },
        ]
      : [];
  });
}

/** Display names in the report's own ranking order (same ranking as the "Cost by group" table). */
function ranked(rows: readonly RawCost[], dimension: string): [string, number][] {
  return sortedByValue(
    totalsBy(
      rows.filter((r) => r.dimension === dimension),
      (r) => r.key ?? UNATTRIBUTED,
      (r) => r.amount,
    ),
  );
}

function costRows(
  document: ReportDocument,
  rows: readonly RawCost[],
  dimension: CostDimension,
  total: number,
): MonthlyCostRow[] {
  const entries = ranked(rows, dimension);
  const titles = { group: 'Cost by group', model: 'Cost by model', product: 'Cost by product' };
  const names = tableOf(document, titles[dimension]).map((row) => text(row[0]));
  const labelled = names.length === entries.length;
  return entries.map(([key, amount], index) => ({
    key,
    name: labelled ? (names[index] ?? key) : key,
    amount: round(amount),
    share: percent(amount, total),
  }));
}

const notesOf = (document: ReportDocument): string[] =>
  document.sections.flatMap((s) => (s.type === 'text' && s.title === 'Notes' ? [s.body] : []));

const monthOf = (document: ReportDocument): string | null =>
  /^monthly-(\d{4}-\d{2})$/.exec(document.id)?.[1] ?? null;

/**
 * Maps the monthly `ReportDocument` to the small public schema. Numbers come from the raw cost
 * records (never from formatted strings); the organization total is the ungrouped `total`
 * dimension, group rows overlap and are not summed. Returns null for other report kinds.
 */
export function buildMonthlyReportView(document: ReportDocument, now: Date): MonthlyReport | null {
  const month = monthOf(document);
  if (document.kind !== 'monthly' || month === null) return null;
  const rows = rawCosts(document);
  const empty = rows.length === 0;
  const total = round(
    sumBy(
      rows.filter((r) => r.dimension === 'total'),
      (r) => r.amount,
    ),
  );
  const costs = (d: CostDimension) => (empty ? [] : costRows(document, rows, d, total));
  return {
    schemaVersion: MONTHLY_REPORT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    id: document.id,
    month,
    period: document.period,
    status: empty ? 'unavailable' : 'ok',
    reason: empty ? 'No cost records for this month (cost dataset not collected or empty)' : null,
    currency: rows[0]?.currency ?? 'USD',
    totalCost: empty ? null : total,
    byGroup: costs('group'),
    byModel: costs('model'),
    byProduct: costs('product'),
    notes: notesOf(document),
  };
}

export const monthlyIndexEntry = (report: MonthlyReport): MonthlyReportIndexEntry => ({
  id: report.id,
  month: report.month,
  path: monthlyReportPath(report.id),
  status: report.status,
  currency: report.currency,
  totalCost: report.totalCost,
  generatedAt: report.generatedAt,
});

/** Adds or replaces the entry of `report`; newest month first, one entry per id. */
export function mergeMonthlyIndex(
  existing: MonthlyReportIndex | null,
  report: MonthlyReport,
): MonthlyReportIndex {
  const others = (existing?.reports ?? []).filter((e) => e.id !== report.id);
  return {
    schemaVersion: MONTHLY_REPORT_SCHEMA_VERSION,
    generatedAt: report.generatedAt,
    reports: [...others, monthlyIndexEntry(report)].sort((a, b) => b.month.localeCompare(a.month)),
  };
}
