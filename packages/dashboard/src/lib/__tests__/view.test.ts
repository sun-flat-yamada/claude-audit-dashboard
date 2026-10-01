import { describe, expect, it, vi } from 'vitest';
import type { DashboardCheckResult, DashboardKpi } from '@claude-audit/core/contracts';
import sample from '../../../../../data/sample/dashboard.json';
import { asDashboardView, loadDashboard } from '../data';
import { formatMoney, formatTimestamp, shortDate } from '../format';
import { countByStatus, filterResults, formatKpi, humanize, sortResults } from '../view';

const result = (ruleId: string, status: string, severity: string): DashboardCheckResult => ({
  ruleId,
  ruleName: ruleId,
  category: 'access-control',
  severity,
  status,
  message: '',
  remediation: null,
  evidence: [],
});

const kpi = (
  unit: DashboardKpi['unit'],
  value: number | null,
  hint: string | null = null,
): DashboardKpi => ({
  id: 'k',
  label: 'K',
  unit,
  value,
  hint,
});

describe('view helpers', () => {
  it('sorts failing results first, then by severity and rule id', () => {
    const sorted = sortResults([
      result('B', 'pass', 'critical'),
      result('C', 'fail', 'low'),
      result('A', 'fail', 'critical'),
      result('D', 'skipped', 'high'),
      result('E', 'warning', 'medium'),
    ]);
    expect(sorted.map((r) => r.ruleId)).toEqual(['A', 'C', 'E', 'D', 'B']);
  });

  it('counts and filters by status', () => {
    const results = [
      result('A', 'fail', 'high'),
      result('B', 'pass', 'low'),
      result('C', 'fail', 'low'),
    ];
    expect(countByStatus(results)).toMatchObject({ all: 3, fail: 2, pass: 1, warning: 0 });
    expect(filterResults(results, 'pass').map((r) => r.ruleId)).toEqual(['B']);
    expect(filterResults(results, 'all')).toHaveLength(3);
  });

  it('formats KPI values by unit and shows an em dash when not collected', () => {
    expect(formatKpi(kpi('score', 70))).toBe('70');
    expect(formatKpi(kpi('count', 1284))).toBe('1,284');
    expect(formatKpi(kpi('count', 12_900))).toBe('12.9K');
    expect(formatKpi(kpi('percent', 66.66))).toBe('66.7%');
    expect(formatKpi(kpi('currency', 4775.88, 'USD'))).toBe('$4,776');
    expect(formatKpi(kpi('currency', 123_456, 'USD'))).toBe('$123.5K');
    expect(formatKpi(kpi('count', null))).toBe('—');
  });

  it('formats money, timestamps and ids for display', () => {
    expect(formatMoney(12_345, 'USD', true)).toBe('$12.3K');
    expect(formatTimestamp('2026-09-29T12:00:00.000Z')).toBe('2026-09-29 12:00 UTC');
    expect(formatTimestamp('2026-09-29')).toBe('2026-09-29');
    expect(shortDate('2026-09-29')).toBe('09-29');
    expect(humanize('api-key-management')).toBe('API key management');
    expect(humanize('access-control')).toBe('Access control');
  });
});

describe('dashboard data loading', () => {
  it('accepts the committed sample (published contract)', () => {
    expect(asDashboardView(sample).compliance.results.length).toBeGreaterThan(0);
  });

  it('rejects data written for another schema version', () => {
    expect(() => asDashboardView({ schemaVersion: 1 })).toThrow(/schemaVersion 1/);
    expect(() => asDashboardView(null)).toThrow(/Unsupported dashboard data/);
  });

  it('loads data/dashboard.json relative to the base URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(sample), { status: 200 }));
    const view = await loadDashboard('/base/', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('/base/data/dashboard.json');
    expect(view.schemaVersion).toBe(sample.schemaVersion);
  });

  it('reports HTTP errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('missing', { status: 404 }));
    await expect(loadDashboard('/', fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /HTTP 404/,
    );
  });
});
