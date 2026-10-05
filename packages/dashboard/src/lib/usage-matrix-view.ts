import type { DetailUsageMatrix } from '@claude-audit/core/contracts';

export type UsageMatrix = DetailUsageMatrix;

/** Period selector value: every month of the file added up, or one `yyyy-mm`. */
export type Period = 'all' | string;

export const OTHER_KEY = '__other__';

const cellKey = (model: string, group: string): string => `${model}\u0000${group}`;

/** `0..1` position of `value` on a linear scale from 0 to `max`; 0 for no / invalid scale. */
export function scaleRatio(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) return 0;
  return Math.min(1, value / max);
}

/** Legend stops: the zero-anchored scale's minimum, midpoint and maximum. */
export const legendTicks = (max: number): [number, number, number] => [0, max / 2, max];

const inPeriod = (month: string, period: Period): boolean => period === 'all' || month === period;

/** Case-insensitive match on name or key; an empty query keeps everything. */
const matches = (row: { key: string; name: string }, query: string): boolean => {
  const q = query.trim().toLowerCase();
  return q === '' || row.name.toLowerCase().includes(q) || row.key.toLowerCase().includes(q);
};

export interface HeatCell {
  model: string;
  group: string;
  /** Null when the API reported no spend row for this pair in the period. */
  cost: number | null;
  /** Share of the model's ungrouped spend in the period (0 without a cost). */
  shareOfModel: number;
  ratio: number;
}

export interface HeatGrid {
  models: { key: string; name: string; total: number }[];
  groups: { key: string; name: string }[];
  /** `cells[row][column]`, in the order of `models` and `groups`. */
  cells: HeatCell[][];
  /** Largest cell cost shown; the top of the color scale. */
  max: number;
}

/** Ungrouped spend per model in the period (from the mix, never from group cells). */
export function modelTotals(matrix: UsageMatrix, period: Period): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of matrix.mix)
    if (inPeriod(row.month, period)) totals.set(row.model, (totals.get(row.model) ?? 0) + row.cost);
  return totals;
}

/** Cells of the period: months are additive over time, groups are not additive with each other. */
export function periodCells(matrix: UsageMatrix, period: Period): Map<string, number> {
  const sums = new Map<string, number>();
  for (const c of matrix.cells)
    if (inPeriod(c.month, period))
      sums.set(cellKey(c.model, c.group), (sums.get(cellKey(c.model, c.group)) ?? 0) + c.cost);
  return sums;
}

/**
 * Narrows one dimension by the query. A query that hits only the other dimension leaves this one
 * whole (searching a group name keeps every model); a query that hits neither leaves nothing.
 */
function narrow<T extends { key: string; name: string }>(
  rows: readonly T[],
  query: string,
  otherHit: boolean,
): T[] {
  if (query.trim() === '') return [...rows];
  const hits = rows.filter((r) => matches(r, query));
  if (hits.length > 0) return hits;
  return otherHit ? [...rows] : [];
}

/** The grid for a period, with models and groups narrowed by the search query. */
export function heatGrid(matrix: UsageMatrix, period: Period, query: string): HeatGrid {
  const totals = modelTotals(matrix, period);
  const sums = periodCells(matrix, period);
  const modelHit = matrix.models.some((m) => matches(m, query));
  const groupHit = matrix.groups.some((g) => matches(g, query));
  const models = narrow(matrix.models, query, groupHit).map((m) => ({
    key: m.key,
    name: m.name,
    total: totals.get(m.key) ?? 0,
  }));
  const groups = narrow(matrix.groups, query, modelHit);
  const shown = models.flatMap((m) => groups.map((g) => sums.get(cellKey(m.key, g.key))));
  const max = Math.max(0, ...shown.map((v) => v ?? 0));
  return {
    models,
    groups,
    max,
    cells: models.map((m) =>
      groups.map((g) => {
        const cost = sums.get(cellKey(m.key, g.key)) ?? null;
        return {
          model: m.key,
          group: g.key,
          cost,
          shareOfModel: cost !== null && m.total > 0 ? (cost / m.total) * 100 : 0,
          ratio: scaleRatio(cost ?? 0, max),
        };
      }),
    ),
  };
}

export interface MixSegment {
  key: string;
  label: string;
  cost: number;
  /** Percent of the month's ungrouped total. */
  share: number;
}

export interface MixMonth {
  month: string;
  total: number;
  segments: MixSegment[];
}

/**
 * Model mix per month: the `top` models by spend over the whole file get their own segment (in
 * that fixed order, so a color follows the model), everything else is "Other". Shares are of the
 * ungrouped month total, so they add up to 100 (0 for a month without spend).
 */
export function modelMix(
  matrix: UsageMatrix,
  top = 3,
): { series: { key: string; label: string }[]; months: MixMonth[] } {
  const lead = matrix.models.slice(0, top);
  const hasOther = matrix.models.length > top || matrix.omittedModels > 0;
  const series = [
    ...lead.map((m) => ({ key: m.key, label: m.name })),
    ...(hasOther ? [{ key: OTHER_KEY, label: 'Other models' }] : []),
  ];
  const months = matrix.months.map((month): MixMonth => {
    const total = matrix.monthTotals.find((t) => t.month === month)?.cost ?? 0;
    const costOf = (model: string): number =>
      matrix.mix.find((r) => r.month === month && r.model === model)?.cost ?? 0;
    const leadCosts = lead.map((m) => costOf(m.key));
    const other = Math.max(0, total - leadCosts.reduce((a, b) => a + b, 0));
    const costs = [...leadCosts, ...(hasOther ? [other] : [])];
    return {
      month,
      total,
      segments: series.map((s, i) => ({
        key: s.key,
        label: s.label,
        cost: costs[i] ?? 0,
        share: total > 0 ? ((costs[i] ?? 0) / total) * 100 : 0,
      })),
    };
  });
  return { series, months };
}

/** Whether the file has any spend to show at all. */
export const hasSpend = (matrix: UsageMatrix): boolean =>
  matrix.mix.some((r) => r.cost > 0) || matrix.cells.some((c) => c.cost > 0);
