import { describe, expect, it } from 'vitest';
import { dashboardViewSchema } from '../../contracts/index.js';
import { buildDashboardView } from '../presenters/dashboard-view.js';
import { buildDetailView, DEFAULT_DETAIL_THRESHOLDS } from '../presenters/detail-view.js';
import {
  aggregateMatrixRows,
  buildModelMatrix,
  buildUsageMatrixView,
  type MatrixCostRow,
  type UsageMatrixInput,
} from '../presenters/usage-matrix-view.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const row = (
  date: string,
  model: string | null,
  group: string | null,
  amount: number,
): MatrixCostRow => ({ date, model, group, amount, currency: 'USD' });

const PAIRS = [
  row('2026-08-30', 'opus', 'g1', 10),
  row('2026-08-31', 'opus', 'g1', 5.5),
  row('2026-09-01', 'opus', 'g1', 20),
  row('2026-09-01', 'opus', 'g2', 20),
  row('2026-09-01', 'haiku', 'g2', 4),
  row('2026-09-02', 'haiku', null, 1),
  row('2026-09-02', null, 'g1', 2),
];
const BY_MODEL = [
  row('2026-08-30', 'opus', null, 10),
  row('2026-08-31', 'opus', null, 5.5),
  row('2026-09-01', 'opus', null, 30),
  row('2026-09-01', 'haiku', null, 4),
  row('2026-09-02', 'haiku', null, 1),
  row('2026-09-02', null, null, 2),
];

const okInput = (
  pairs = PAIRS,
  byModel = BY_MODEL,
): Extract<UsageMatrixInput, { status: 'ok' }> => ({
  status: 'ok',
  asOf: '2026-09-29T08:00:00Z',
  window: { from: '2026-08-30T00:00:00.000Z', to: '2026-09-29T00:00:00.000Z' },
  data: aggregateMatrixRows(pairs, byModel),
});

describe('aggregateMatrixRows', () => {
  it('rolls days up to months and is independent of the input order', () => {
    const a = aggregateMatrixRows(PAIRS, BY_MODEL);
    const b = aggregateMatrixRows([...PAIRS].reverse(), [...BY_MODEL].reverse());
    expect(b).toEqual(a);
    expect(a.cells).toContainEqual({ month: '2026-08', model: 'opus', group: 'g1', cost: 15.5 });
    expect(a.cells).toContainEqual({ month: '2026-09', model: null, group: 'g1', cost: 2 });
    expect(a.mix).toContainEqual({ month: '2026-09', model: 'opus', cost: 30 });
    expect(a.currency).toBe('USD');
  });

  it('is empty for no rows and defaults the currency', () => {
    expect(aggregateMatrixRows([], [])).toEqual({ currency: 'USD', cells: [], mix: [] });
  });
});

describe('buildUsageMatrixView', () => {
  const groupNames = new Map([
    ['g1', 'Engineering'],
    ['g2', 'Finance'],
  ]);
  const view = buildUsageMatrixView(okInput(), groupNames);

  it('is valid, ascending by month and names groups from the directory', () => {
    expect(view.status).toBe('ok');
    expect(view.months).toEqual(['2026-08', '2026-09']);
    expect(view.groups.map((g) => g.name)).toEqual(['Engineering', 'Finance', 'No group']);
    expect(view.models.map((m) => m.key)).toEqual(['opus', 'haiku', '(unknown)']);
  });

  it('takes model totals and month totals from the ungrouped mix, not from group cells', () => {
    const opus = view.models.find((m) => m.key === 'opus');
    expect(opus?.total).toBe(45.5);
    const cellSum = view.cells.filter((c) => c.model === 'opus').reduce((n, c) => n + c.cost, 0);
    expect(cellSum).toBeGreaterThan(opus?.total ?? 0);
    expect(view.monthTotals).toEqual([
      { month: '2026-08', cost: 15.5 },
      { month: '2026-09', cost: 37 },
    ]);
  });

  it('keeps unknown ids as names and maps null keys to fixed keys', () => {
    const v = buildUsageMatrixView(okInput(), new Map());
    expect(v.groups.map((g) => g.name)).toEqual(['g1', 'g2', 'No group']);
    expect(v.cells).toContainEqual({ month: '2026-09', model: '(unknown)', group: 'g1', cost: 2 });
  });

  it('caps models and groups and counts the omitted ones', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      row('2026-09-01', `model-${String(i).padStart(2, '0')}`, `g${String(i)}`, 100 - i),
    );
    const v = buildUsageMatrixView(
      okInput(
        many,
        many.map((r) => ({ ...r, group: null })),
      ),
      new Map(),
    );
    expect(v.models).toHaveLength(12);
    expect(v.groups).toHaveLength(30);
    expect(v.omittedModels).toBe(28);
    expect(v.omittedGroups).toBe(10);
    expect(v.cells.every((c) => v.models.some((m) => m.key === c.model))).toBe(true);
    expect(v.monthTotals[0]?.cost).toBe(many.reduce((n, r) => n + r.amount, 0));
  });

  it('handles an empty matrix', () => {
    const v = buildUsageMatrixView(okInput([], []), new Map());
    expect(v).toMatchObject({ months: [], models: [], groups: [], cells: [], mix: [] });
  });
});

describe('buildModelMatrix', () => {
  const names = new Map([['g1', 'Engineering']]);

  it('is null while the collection is off and an error entry when the input is unreadable', () => {
    expect(buildModelMatrix(undefined, names)).toBeNull();
    expect(buildModelMatrix(null, names)).toEqual({
      status: 'error',
      reason: 'the matrix input could not be read',
    });
  });

  it('carries the reason of an unavailable or failed collection', () => {
    expect(
      buildModelMatrix({ status: 'unavailable', reason: 'API rejected group_by (400)' }, names),
    ).toEqual({ status: 'unavailable', reason: 'API rejected group_by (400)' });
    expect(buildModelMatrix({ status: 'error', reason: 'boom' }, names)).toEqual({
      status: 'error',
      reason: 'boom',
    });
  });
});

describe('modelMatrix in the dashboard view (v3)', () => {
  const build = (usageMatrix: UsageMatrixInput | null | undefined) =>
    buildDashboardView({
      now: NOW,
      title: 'T',
      source: 'demo',
      maskPii: true,
      snapshot: null,
      report: null,
      history: [],
      insights: [],
      usageMatrix,
    });

  it('is null when the collection is off and the view stays valid', () => {
    const view = build(undefined);
    expect(view.schemaVersion).toBe(3);
    expect(view.modelMatrix).toBeNull();
    expect(dashboardViewSchema.parse(view)).toEqual(view);
  });

  it('carries unavailable and collected matrices and validates them', () => {
    const off = build({ status: 'unavailable', reason: 'no key' });
    expect(dashboardViewSchema.parse(off).modelMatrix).toEqual({
      status: 'unavailable',
      reason: 'no key',
    });
    const on = build(okInput());
    expect(dashboardViewSchema.parse(on).modelMatrix).toMatchObject({ status: 'ok' });
  });

  it('rejects cells that refer to an unlisted model, group or month', () => {
    const view = build(okInput());
    if (view.modelMatrix?.status !== 'ok') throw new Error('fixture');
    const broken = {
      ...view,
      modelMatrix: {
        ...view.modelMatrix,
        cells: view.modelMatrix.cells.map((c) => ({ ...c, group: 'ghost' })),
      },
    };
    expect(dashboardViewSchema.safeParse(broken).success).toBe(false);
    const dup = {
      ...view,
      modelMatrix: {
        ...view.modelMatrix,
        groups: [...view.modelMatrix.groups, ...view.modelMatrix.groups],
      },
    };
    expect(dashboardViewSchema.safeParse(dup).success).toBe(false);
  });

  it('is no longer published as a detail file', () => {
    const bundle = buildDetailView({
      now: NOW,
      source: 'demo',
      maskPii: true,
      snapshot: null,
      report: null,
      thresholds: DEFAULT_DETAIL_THRESHOLDS,
    });
    expect(bundle.manifest.files.map((f) => f.kind)).not.toContain('usage-matrix');
    expect(bundle.manifest.schemaVersion).toBe(2);
  });
});
