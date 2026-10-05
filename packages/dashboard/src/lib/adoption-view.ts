import type { DashboardAdoption } from '@claude-audit/core/contracts';

/** Pure helpers for the per-product active users of the adoption card (AN-2). */

export type ProductRow = NonNullable<DashboardAdoption['byProduct']>[number];

export interface TrendPoint {
  date: string;
  value: number;
}

/** Weekly active users of one product per day; days without a value for it are skipped. */
export const productTrend = (
  weekly: DashboardAdoption['productWeekly'],
  product: string,
): TrendPoint[] =>
  (weekly ?? []).flatMap((d) => {
    const value = d.wau[product];
    return value === undefined ? [] : [{ date: d.date, value }];
  });

/**
 * SVG polyline points for a sparkline in a `width` x `height` box. Every product shares the same
 * y scale (`max`), so line heights compare across rows; an empty trend has no points.
 */
export const sparklinePoints = (
  trend: readonly TrendPoint[],
  box: { width: number; height: number; max: number },
): string => {
  const { width, height, max } = box;
  const step = trend.length > 1 ? width / (trend.length - 1) : 0;
  const y = (value: number) => (max > 0 ? height - (value / max) * height : height);
  return trend.map((p, i) => `${(i * step).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
};

/** Rows of the "View as table" twin: one per day, one column per product (em dash when absent). */
export const productTrendRows = (
  weekly: DashboardAdoption['productWeekly'],
  products: readonly ProductRow[],
  format: (value: number) => string,
): string[][] =>
  (weekly ?? []).map((d) => [
    d.date,
    ...products.map((p) => {
      const value = d.wau[p.product];
      return value === undefined ? '—' : format(value);
    }),
  ]);

/** Accessible name of a sparkline: first and last value with their dates. */
export const trendLabel = (label: string, trend: readonly TrendPoint[]): string => {
  const first = trend[0];
  const last = trend.at(-1);
  if (!first || !last) return `${label}: no weekly trend`;
  if (trend.length === 1)
    return `${label} weekly active users: ${String(first.value)} on ${first.date}`;
  return `${label} weekly active users: ${String(first.value)} on ${first.date}, ${String(last.value)} on ${last.date}`;
};
