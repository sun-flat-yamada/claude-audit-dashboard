import { describe, expect, it } from 'vitest';
import { checkDetailBundle, detailUsageMatrixSchema } from '../../contracts/index.js';
import { buildDetailView, DEFAULT_DETAIL_THRESHOLDS } from '../presenters/detail-view.js';
import {
  aggregateMatrixRows,
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
  const view = buildUsageMatrixView(okInput(), groupNames, NOW);

  it('is valid, ascending by month and names groups from the directory', () => {
    expect(detailUsageMatrixSchema.parse(view)).toEqual(view);
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
    const v = buildUsageMatrixView(okInput(), new Map(), NOW);
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
      NOW,
    );
    expect(v.models).toHaveLength(12);
    expect(v.groups).toHaveLength(30);
    expect(v.omittedModels).toBe(28);
    expect(v.omittedGroups).toBe(10);
    expect(v.cells.every((c) => v.models.some((m) => m.key === c.model))).toBe(true);
    expect(v.monthTotals[0]?.cost).toBe(many.reduce((n, r) => n + r.amount, 0));
  });

  it('handles an empty matrix', () => {
    const v = buildUsageMatrixView(okInput([], []), new Map(), NOW);
    expect(v).toMatchObject({ months: [], models: [], groups: [], cells: [], mix: [] });
  });
});

describe('detail manifest and bundle check', () => {
  const build = (usageMatrix: UsageMatrixInput | null | undefined) =>
    buildDetailView({
      now: NOW,
      source: 'demo',
      maskPii: true,
      snapshot: null,
      report: null,
      thresholds: DEFAULT_DETAIL_THRESHOLDS,
      usageMatrix,
    });

  it('has no entry when the collection is off', () => {
    expect(build(undefined).manifest.files.some((f) => f.kind === 'usage-matrix')).toBe(false);
  });

  it('lists an unavailable matrix with its reason and no file', () => {
    const bundle = build({ status: 'unavailable', reason: 'API rejected group_by (400)' });
    expect(bundle.files).toEqual([]);
    expect(bundle.manifest.files.find((f) => f.kind === 'usage-matrix')).toMatchObject({
      status: 'unavailable',
      reason: 'API rejected group_by (400)',
      count: null,
    });
    expect(build(null).manifest.files.find((f) => f.kind === 'usage-matrix')?.reason).toMatch(
      /could not be read/,
    );
  });

  it('lists a collected matrix, passes the check and rejects inconsistent files', () => {
    const bundle = build(okInput());
    const file = bundle.files[0];
    expect(bundle.manifest.files.find((f) => f.kind === 'usage-matrix')).toMatchObject({
      kind: 'usage-matrix',
      status: 'ok',
      count: file ? (file.content as { cells: unknown[] }).cells.length : -1,
    });
    const files = {
      'detail/index.json': JSON.stringify(bundle.manifest),
      'detail/usage-matrix.json': JSON.stringify(file?.content),
    };
    expect(checkDetailBundle(files, { requireDemo: true })).toEqual([]);
    const doc = file?.content as { cells: { group: string }[] };
    const stray = JSON.stringify({
      ...doc,
      cells: doc.cells.map((c) => ({ ...c, group: 'ghost' })),
    });
    expect(
      checkDetailBundle({ ...files, 'detail/usage-matrix.json': stray }, { requireDemo: true }),
    ).toEqual([
      'detail/usage-matrix.json: cells or mix rows refer to an unlisted model, group or month',
    ]);
    const mail = JSON.stringify({ ...doc, currency: 'bob@corp.test' });
    expect(
      checkDetailBundle(
        { ...files, 'detail/usage-matrix.json': mail },
        { requireDemo: true },
      ).join(),
    ).toMatch(/non-example.com e-mail/);
  });
});
