import type { ComparePoint, TimePointSummary } from '@claude-audit/core/contracts';
import { describe, expect, it } from 'vitest';
import {
  changedTotal,
  checkPoint,
  defaultSelection,
  filterRuleRows,
  formatDelta,
  formatKpiDelta,
  formatKpiValue,
  formatPointId,
  pointLabel,
  selectablePoints,
  unchangedRules,
  type RuleRow,
} from '../compare-view';

const point = (id: string, state: ComparePoint['state'] = 'summary'): ComparePoint => ({
  id,
  collectedAt: null,
  state,
  score: state === 'summary' ? 80 : null,
  assessed: null,
});
const A = '2026-09-29T12-00-00Z';
const B = '2026-09-15T12-00-00Z';
const C = '2026-09-01T12-00-00Z';
const POINTS = [point(A), point(B), point(C)];

describe('selection helpers', () => {
  it('lists only points with a summary', () => {
    expect(selectablePoints([point(A), point(B, 'archived')]).map((p) => p.id)).toEqual([A]);
  });

  it('classifies an id as ok, archived or unknown', () => {
    const points = [point(A), point(B, 'archived')];
    expect(checkPoint(points, A).status).toBe('ok');
    expect(checkPoint(points, B).status).toBe('archived');
    expect(checkPoint(points, 'nope')).toEqual({ status: 'unknown', id: 'nope' });
  });

  it.each([
    [{}, { base: B, target: A }],
    [{ target: B }, { base: C, target: B }],
    [{ target: C }, { base: A, target: C }],
    [{ base: C }, { base: C, target: A }],
    [
      { base: 'x', target: 'y' },
      { base: 'x', target: 'y' },
    ],
  ])('defaultSelection(%j) = %j', (query, expected) => {
    expect(defaultSelection(POINTS, query)).toEqual(expected);
  });

  it('skips archived points for the defaults and survives an empty index', () => {
    expect(defaultSelection([point(A), point(B, 'archived'), point(C)], {})).toEqual({
      base: C,
      target: A,
    });
    expect(defaultSelection([], {})).toEqual({ base: '', target: '' });
  });
});

const summaryOf = (rules: [string, TimePointSummary['rules'][number]['status']][]) =>
  ({
    rules: rules.map(([id, status]) => ({
      id,
      name: `Rule ${id}`,
      category: 'access-control',
      severity: id.startsWith('H') ? 'high' : 'low',
      status,
    })),
  }) as unknown as TimePointSummary;

describe('rule rows', () => {
  const base = summaryOf([
    ['L-1', 'pass'],
    ['H-1', 'fail'],
    ['H-2', 'pass'],
  ]);
  const target = summaryOf([
    ['L-1', 'pass'],
    ['H-1', 'fail'],
    ['H-2', 'fail'],
    ['H-3', 'pass'],
  ]);
  const changed: RuleRow[] = [
    {
      id: 'H-2',
      name: 'Rule H-2',
      category: 'access-control',
      severity: 'high',
      from: 'pass',
      to: 'fail',
      change: 'regressed',
    },
  ];

  it('derives the unchanged rules, most severe first', () => {
    expect(unchangedRules(base, target).map((r) => r.id)).toEqual(['H-1', 'L-1']);
  });

  it('shows changed rules for all, one class per chip and applies the search', () => {
    const unchanged = unchangedRules(base, target);
    expect(filterRuleRows(changed, unchanged, 'all', '').map((r) => r.id)).toEqual(['H-2']);
    expect(filterRuleRows(changed, unchanged, 'unchanged', '').map((r) => r.id)).toEqual([
      'H-1',
      'L-1',
    ]);
    expect(filterRuleRows(changed, unchanged, 'improved', '')).toEqual([]);
    expect(filterRuleRows(changed, unchanged, 'unchanged', ' l-1 ').map((r) => r.id)).toEqual([
      'L-1',
    ]);
    expect(filterRuleRows(changed, unchanged, 'all', 'ACCESS')).toHaveLength(1);
  });

  it('counts the changed rules, not the unchanged ones', () => {
    expect(
      changedTotal({
        regressed: 2,
        improved: 1,
        unchanged: 20,
        added: 1,
        removed: 0,
        assessed: 3,
        unassessed: 1,
      }),
    ).toBe(8);
  });
});

describe('figures', () => {
  it('formats KPI values and signed deltas by unit', () => {
    expect(formatKpiValue('count', 1234)).toBe('1,234');
    expect(formatKpiValue('count', null)).toBe('–');
    expect(formatKpiValue('percent', 66.7)).toBe('66.7%');
    expect(formatKpiValue('currency', 4775.88)).toBe('$4,775.88');
    expect(formatKpiValue('score', 70.5)).toBe('70.5');
    expect(formatKpiDelta('count', 9)).toBe('+9');
    expect(formatKpiDelta('count', -3)).toBe('−3');
    expect(formatKpiDelta('count', 0)).toBe('0');
    expect(formatKpiDelta('count', null)).toBe('–');
    expect(formatKpiDelta('percent', -2)).toBe('−2.0 pp');
    expect(formatKpiDelta('currency', -120)).toBe('−$120.00');
    expect(formatDelta(5)).toBe('+5');
    expect(formatDelta(-2)).toBe('−2');
    expect(formatDelta(0)).toBe('0');
  });

  it('formats point ids and option labels', () => {
    expect(formatPointId(A)).toBe('2026-09-29 12:00 UTC');
    expect(formatPointId('custom')).toBe('custom');
    expect(pointLabel(point(A))).toBe('2026-09-29 12:00 UTC · score 80');
    expect(pointLabel(point(B, 'archived'))).toBe('2026-09-15 12:00 UTC (archived, no summary)');
  });
});
