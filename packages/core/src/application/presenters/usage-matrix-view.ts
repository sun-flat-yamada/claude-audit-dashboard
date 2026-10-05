import {
  MATRIX_GROUP_LIMIT,
  MATRIX_MODEL_LIMIT,
  MATRIX_NO_GROUP,
  MATRIX_UNKNOWN_MODEL,
  type DashboardModelMatrix,
  type DashboardModelMatrixData,
} from '../../contracts/dashboard-view.js';
import { round } from '../../domain/util/numbers.js';

/** One daily cost row of the collected pairwise (or per-model) report; keys null when absent. */
export interface MatrixCostRow {
  date: string;
  model: string | null;
  group: string | null;
  amount: number;
  currency: string;
}

/** Monthly aggregation of the collected rows; the stored input of the matrix view. */
export interface UsageMatrixAggregate {
  currency: string;
  cells: { month: string; model: string | null; group: string | null; cost: number }[];
  mix: { month: string; model: string | null; cost: number }[];
}

export type UsageMatrixInput =
  | {
      status: 'ok';
      asOf: string | null;
      window: { from: string; to: string };
      data: UsageMatrixAggregate;
    }
  | { status: 'unavailable' | 'error'; reason: string };

const monthOf = (date: string): string => date.slice(0, 7);

function sumBy<T>(items: readonly T[], keyOf: (item: T) => string, valueOf: (item: T) => number) {
  const sums = new Map<string, number>();
  for (const item of items) sums.set(keyOf(item), (sums.get(keyOf(item)) ?? 0) + valueOf(item));
  return sums;
}

const part = (key: string, index: number): string => key.split('|')[index] ?? '';

/**
 * Rolls daily rows up to months. `pairs` are model x group rows (overlapping across groups),
 * `byModel` the ungrouped per-model rows. Deterministic: sorted by month, model, group.
 */
export function aggregateMatrixRows(
  pairs: readonly MatrixCostRow[],
  byModel: readonly MatrixCostRow[],
): UsageMatrixAggregate {
  const nul = '\u0000';
  const pairSums = sumBy(
    pairs,
    (r) => `${monthOf(r.date)}|${r.model ?? nul}|${r.group ?? nul}`,
    (r) => r.amount,
  );
  const mixSums = sumBy(
    byModel,
    (r) => `${monthOf(r.date)}|${r.model ?? nul}`,
    (r) => r.amount,
  );
  const key = (k: string, i: number): string | null => (part(k, i) === nul ? null : part(k, i));
  return {
    currency: pairs[0]?.currency ?? byModel[0]?.currency ?? 'USD',
    cells: [...pairSums.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, cost]) => ({
        month: part(k, 0),
        model: key(k, 1),
        group: key(k, 2),
        cost: round(cost, 2),
      })),
    mix: [...mixSums.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, cost]) => ({ month: part(k, 0), model: key(k, 1), cost: round(cost, 2) })),
  };
}

const modelKey = (model: string | null): string => model ?? MATRIX_UNKNOWN_MODEL;
const groupKey = (group: string | null): string => group ?? MATRIX_NO_GROUP;

/** Highest value first, ties by key, so the output never depends on input order. */
const byValueDesc = (a: [string, number], b: [string, number]): number =>
  b[1] - a[1] || a[0].localeCompare(b[0]);

/**
 * Builds the `modelMatrix` data. Model totals and the mix are the ungrouped values; group
 * cells are kept as reported (they overlap) and are only ranked, never summed into a figure.
 * At most {@link MATRIX_MODEL_LIMIT} models and {@link MATRIX_GROUP_LIMIT} groups are kept.
 */
export function buildUsageMatrixView(
  input: Extract<UsageMatrixInput, { status: 'ok' }>,
  groupNames: ReadonlyMap<string, string>,
): DashboardModelMatrixData {
  const { data } = input;
  const mix = data.mix.map((m) => ({ month: m.month, model: modelKey(m.model), cost: m.cost }));
  const cells = data.cells.map((c) => ({
    month: c.month,
    model: modelKey(c.model),
    group: groupKey(c.group),
    cost: c.cost,
  }));
  const modelTotals = [
    ...sumBy(
      mix,
      (m) => m.model,
      (m) => m.cost,
    ).entries(),
  ].sort(byValueDesc);
  const groupSpend = [
    ...sumBy(
      cells,
      (c) => c.group,
      (c) => c.cost,
    ).entries(),
  ].sort(byValueDesc);
  const models = modelTotals.slice(0, MATRIX_MODEL_LIMIT);
  const groups = groupSpend.slice(0, MATRIX_GROUP_LIMIT);
  const modelKeys = new Set(models.map(([k]) => k));
  const groupKeys = new Set(groups.map(([k]) => k));
  const months = [...new Set([...mix, ...cells].map((r) => r.month))].sort();
  return {
    status: 'ok',
    asOf: input.asOf,
    window: input.window,
    currency: data.currency,
    months,
    models: models.map(([key, total]) => ({ key, name: key, total: round(total, 2) })),
    groups: groups.map(([key]) => ({
      key,
      name: key === MATRIX_NO_GROUP ? 'No group' : (groupNames.get(key) ?? key),
    })),
    omittedModels: modelTotals.length - models.length,
    omittedGroups: groupSpend.length - groups.length,
    cells: cells.filter((c) => modelKeys.has(c.model) && groupKeys.has(c.group)),
    mix: mix.filter((m) => modelKeys.has(m.model)),
    monthTotals: [
      ...sumBy(
        mix,
        (m) => m.month,
        (m) => m.cost,
      ).entries(),
    ]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cost]) => ({ month, cost: round(cost, 2) })),
  };
}

/**
 * The `modelMatrix` field of the dashboard view. `undefined` means the optional collection is off
 * (null in the view); `null` means it is on but the stored input could not be read.
 */
export function buildModelMatrix(
  input: UsageMatrixInput | null | undefined,
  groupNames: ReadonlyMap<string, string>,
): DashboardModelMatrix | null {
  if (input === undefined) return null;
  if (input === null) return { status: 'error', reason: 'the matrix input could not be read' };
  if (input.status !== 'ok') return { status: input.status, reason: input.reason };
  return buildUsageMatrixView(input, groupNames);
}
