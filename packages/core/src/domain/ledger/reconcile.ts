import type { CostRow, UsageDimension, UsageRow } from '../model/entities.js';
import type { AuditSnapshot } from '../model/snapshot.js';
import { compareText } from './entry.js';

/** The fields every breakdown row of `usage` / `cost` shares. */
interface BreakdownRow {
  date: string;
  dimension: UsageDimension;
}

/** One day whose breakdown rows do not add up to its `total` row. */
export interface BreakdownGap {
  dataset: string;
  dimension: UsageDimension;
  date: string;
  total: number;
  sum: number;
}

/**
 * Days whose `dimension` rows do not add up to the `total` row of the same day (beyond
 * `tolerance`). Only days that have a total row are checked; a day with a positive total and no
 * breakdown row at all is a gap. Pure and independent of the row order.
 */
export function breakdownGaps<T extends BreakdownRow>(
  rows: readonly T[],
  dimension: UsageDimension,
  value: (row: T) => number,
  tolerance = 0,
): Omit<BreakdownGap, 'dataset'>[] {
  const totals = new Map<string, number>();
  const sums = new Map<string, number>();
  for (const row of rows) {
    if (row.dimension === 'total') totals.set(row.date, (totals.get(row.date) ?? 0) + value(row));
    else if (row.dimension === dimension)
      sums.set(row.date, (sums.get(row.date) ?? 0) + value(row));
  }
  return [...totals.entries()]
    .map(([date, total]) => ({ dimension, date, total, sum: sums.get(date) ?? 0 }))
    .filter((gap) => Math.abs(gap.total - gap.sum) > tolerance)
    .sort((a, b) => compareText(a.date, b.date));
}

/** Total tokens of a usage row (the four token counters). */
export const usageTokens = (row: UsageRow): number =>
  row.uncachedInputTokens +
  row.cacheReadInputTokens +
  row.cacheCreationInputTokens +
  row.outputTokens;

/** One additive breakdown the ledger checks against the total of the same day. */
interface BreakdownCheck {
  dataset: 'usage' | 'cost';
  dimension: UsageDimension;
  gaps(rows: readonly unknown[]): Omit<BreakdownGap, 'dataset'>[];
}

/**
 * The checks run on every recorded snapshot. Only the model breakdown is additive: product rows
 * can be, but group rows count a member in every group they held, so they can exceed the total.
 * Amounts are rounded to cents, so cost allows half a cent per day.
 */
const BREAKDOWN_CHECKS: readonly BreakdownCheck[] = [
  {
    dataset: 'cost',
    dimension: 'model',
    gaps: (rows) => breakdownGaps(rows as CostRow[], 'model', (r) => r.amount, 0.005),
  },
  {
    dataset: 'usage',
    dimension: 'model',
    gaps: (rows) => breakdownGaps(rows as UsageRow[], 'model', usageTokens),
  },
];

/** Breakdown gaps of one snapshot; only datasets collected `ok` are checked. */
export function snapshotBreakdownGaps(snapshot: AuditSnapshot): BreakdownGap[] {
  return BREAKDOWN_CHECKS.flatMap((check) => {
    const rows = snapshot.data[check.dataset];
    if (snapshot.coverage[check.dataset]?.status !== 'ok' || !Array.isArray(rows)) return [];
    return check.gaps(rows).map((gap) => ({ dataset: check.dataset, ...gap }));
  });
}
