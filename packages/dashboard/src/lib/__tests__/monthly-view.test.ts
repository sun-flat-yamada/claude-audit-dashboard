import { describe, expect, it } from 'vitest';
import {
  filterRows,
  groupsOverlap,
  monthLabel,
  selectEntry,
  type MonthlyReport,
  type MonthlyReportIndex,
} from '../monthly-view';

const row = (key: string, name: string, amount: number) => ({ key, name, amount, share: 0 });
const report = (groups: number[], totalCost: number | null): MonthlyReport => ({
  schemaVersion: 1,
  generatedAt: '2026-09-29T12:00:00.000Z',
  id: 'monthly-2026-08',
  month: '2026-08',
  period: null,
  status: 'ok',
  reason: null,
  currency: 'USD',
  totalCost,
  byGroup: groups.map((a, i) => row(`g${i}`, `Group ${i}`, a)),
  byModel: [],
  byProduct: [],
  notes: [],
});
const entry = (month: string) => ({
  id: `monthly-${month}`,
  month,
  path: `detail/monthly/monthly-${month}.json`,
  status: 'ok' as const,
  currency: 'USD',
  totalCost: 1,
  generatedAt: '2026-09-29T12:00:00.000Z',
});
const index = (months: string[]): MonthlyReportIndex => ({
  schemaVersion: 1,
  generatedAt: '2026-09-29T12:00:00.000Z',
  reports: months.map(entry),
});

describe('monthLabel', () => {
  it('names the month without locale or time zone', () => {
    expect(monthLabel('2026-01')).toBe('January 2026');
    expect(monthLabel('2026-12')).toBe('December 2026');
  });
  it('passes through unexpected values', () => {
    expect(monthLabel('latest')).toBe('latest');
    expect(monthLabel('2026-13')).toBe('2026-13');
  });
});

describe('selectEntry', () => {
  const idx = index(['2026-08', '2026-07']);
  it('defaults to the first (newest) entry and finds an id', () => {
    expect(selectEntry(idx, undefined)?.month).toBe('2026-08');
    expect(selectEntry(idx, 'monthly-2026-07')?.month).toBe('2026-07');
  });
  it('returns null for an unknown id or an empty index', () => {
    expect(selectEntry(idx, 'monthly-2020-01')).toBeNull();
    expect(selectEntry(index([]), undefined)).toBeNull();
  });
});

describe('groupsOverlap', () => {
  it('is true only when the group amounts exceed the organization total', () => {
    expect(groupsOverlap(report([70, 30, 20], 100))).toBe(true);
    expect(groupsOverlap(report([60, 40], 100))).toBe(false);
    expect(groupsOverlap(report([60, 40], 100.004))).toBe(false);
  });
  it('is false without a total or groups', () => {
    expect(groupsOverlap(report([5], null))).toBe(false);
    expect(groupsOverlap(report([], 100))).toBe(false);
  });
});

describe('filterRows', () => {
  const rows = [row('rbac_eng', 'Engineering', 1), row('rbac_legal', 'Legal', 2)];
  it('matches name or key case-insensitively; blank keeps all', () => {
    expect(filterRows(rows, ' ENGIN ')).toHaveLength(1);
    expect(filterRows(rows, 'rbac_legal')[0]?.name).toBe('Legal');
    expect(filterRows(rows, '  ')).toHaveLength(2);
    expect(filterRows(rows, 'zzz')).toEqual([]);
  });
});
