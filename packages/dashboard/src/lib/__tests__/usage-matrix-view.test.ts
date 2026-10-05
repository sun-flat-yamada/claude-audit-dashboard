import { describe, expect, it } from 'vitest';
import {
  hasSpend,
  heatGrid,
  legendTicks,
  modelMix,
  modelTotals,
  periodCells,
  scaleRatio,
  type UsageMatrix,
} from '../usage-matrix-view';

const matrix = (over: Partial<UsageMatrix> = {}): UsageMatrix => ({
  schemaVersion: 1,
  generatedAt: '2026-09-29T12:00:00.000Z',
  asOf: null,
  window: { from: '2026-07-01T00:00:00.000Z', to: '2026-09-29T00:00:00.000Z' },
  currency: 'USD',
  months: ['2026-07', '2026-08'],
  models: [
    { key: 'opus', name: 'opus', total: 150 },
    { key: 'haiku', name: 'haiku', total: 50 },
  ],
  groups: [
    { key: 'g1', name: 'Engineering' },
    { key: 'g2', name: 'Finance' },
  ],
  omittedModels: 0,
  omittedGroups: 0,
  cells: [
    { month: '2026-07', model: 'opus', group: 'g1', cost: 60 },
    { month: '2026-07', model: 'opus', group: 'g2', cost: 40 },
    { month: '2026-08', model: 'opus', group: 'g1', cost: 40 },
    { month: '2026-08', model: 'haiku', group: 'g2', cost: 0 },
  ],
  mix: [
    { month: '2026-07', model: 'opus', cost: 80 },
    { month: '2026-08', model: 'opus', cost: 70 },
    { month: '2026-08', model: 'haiku', cost: 50 },
  ],
  monthTotals: [
    { month: '2026-07', cost: 80 },
    { month: '2026-08', cost: 120 },
  ],
  ...over,
});

describe('scaleRatio', () => {
  it('is linear from zero to the maximum', () => {
    expect(scaleRatio(0, 100)).toBe(0);
    expect(scaleRatio(25, 100)).toBe(0.25);
    expect(scaleRatio(100, 100)).toBe(1);
  });
  it('clamps and handles degenerate scales', () => {
    expect(scaleRatio(150, 100)).toBe(1);
    expect(scaleRatio(-5, 100)).toBe(0);
    expect(scaleRatio(5, 0)).toBe(0);
    expect(scaleRatio(Number.NaN, 10)).toBe(0);
    expect(scaleRatio(5, Number.POSITIVE_INFINITY)).toBe(0);
  });
  it('maps a single non-zero value and equal values to the top of the scale', () => {
    expect(scaleRatio(7, 7)).toBe(1);
    expect([3, 3, 3].map((v) => scaleRatio(v, 3))).toEqual([1, 1, 1]);
  });
});

describe('legendTicks', () => {
  it('has zero, middle and maximum', () => {
    expect(legendTicks(80)).toEqual([0, 40, 80]);
    expect(legendTicks(0)).toEqual([0, 0, 0]);
  });
});

describe('period sums', () => {
  it('adds months for all, and selects one month otherwise', () => {
    expect(periodCells(matrix(), 'all').get('opus\u0000g1')).toBe(100);
    expect(periodCells(matrix(), '2026-08').get('opus\u0000g1')).toBe(40);
    expect(modelTotals(matrix(), 'all').get('opus')).toBe(150);
    expect(modelTotals(matrix(), '2026-07').get('haiku')).toBeUndefined();
  });
});

describe('heatGrid', () => {
  it('builds cells in model and group order with ratio, share and no-spend cells', () => {
    const grid = heatGrid(matrix(), 'all', '');
    expect(grid.max).toBe(100);
    expect(grid.cells[0]?.map((c) => [c.cost, c.ratio])).toEqual([
      [100, 1],
      [40, 0.4],
    ]);
    expect(grid.cells[0]?.[0]?.shareOfModel).toBeCloseTo(66.67, 1);
    expect(grid.cells[1]?.map((c) => c.cost)).toEqual([null, 0]);
    expect(grid.models.find((m) => m.key === 'opus')?.total).toBe(150);
  });
  it('uses the selected month for the scale', () => {
    const grid = heatGrid(matrix(), '2026-08', '');
    expect(grid.max).toBe(40);
    expect(grid.cells[0]?.[0]?.ratio).toBe(1);
  });
  it('narrows models and groups by the search, and can match nothing', () => {
    const byGroup = heatGrid(matrix(), 'all', 'fin');
    expect(byGroup.groups.map((g) => g.name)).toEqual(['Finance']);
    expect(byGroup.models).toHaveLength(2);
    const byModel = heatGrid(matrix(), 'all', 'HAIKU');
    expect(byModel.models.map((m) => m.key)).toEqual(['haiku']);
    expect(byModel.groups).toHaveLength(2);
    const none = heatGrid(matrix(), 'all', 'zzz');
    expect(none.models).toEqual([]);
    expect(none.max).toBe(0);
  });
  it('has a zero scale when every cell is zero or missing', () => {
    const grid = heatGrid(matrix({ cells: [], mix: [] }), 'all', '');
    expect(grid.max).toBe(0);
    expect(grid.cells.flat().every((c) => c.ratio === 0 && c.cost === null)).toBe(true);
  });
});

describe('modelMix', () => {
  it('gives each lead model a segment and shares of the ungrouped month total', () => {
    const { series, months } = modelMix(matrix());
    expect(series.map((s) => s.key)).toEqual(['opus', 'haiku']);
    expect(months[1]?.segments.map((s) => [s.key, s.share.toFixed(1)])).toEqual([
      ['opus', '58.3'],
      ['haiku', '41.7'],
    ]);
    expect(months[0]?.segments[1]?.share).toBe(0);
  });
  it('folds the remaining models into Other and keeps shares at 100', () => {
    const { series, months } = modelMix(matrix(), 1);
    expect(series.map((s) => s.label)).toEqual(['opus', 'Other models']);
    const [opus, other] = months[1]?.segments ?? [];
    expect((opus?.share ?? 0) + (other?.share ?? 0)).toBeCloseTo(100);
    expect(other?.cost).toBe(50);
  });
  it('adds Other when models were omitted from the file, and tolerates a zero month', () => {
    const { series, months } = modelMix(
      matrix({ omittedModels: 3, monthTotals: [{ month: '2026-07', cost: 0 }] }),
    );
    expect(series.at(-1)?.key).toBe('__other__');
    expect(months[0]?.segments.every((s) => s.share === 0)).toBe(true);
  });
});

describe('hasSpend', () => {
  it('is false for an empty or all-zero matrix', () => {
    expect(hasSpend(matrix())).toBe(true);
    expect(hasSpend(matrix({ cells: [], mix: [] }))).toBe(false);
    expect(
      hasSpend(
        matrix({ cells: [{ month: '2026-07', model: 'opus', group: 'g1', cost: 0 }], mix: [] }),
      ),
    ).toBe(false);
  });
});
