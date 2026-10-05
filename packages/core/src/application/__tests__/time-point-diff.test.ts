import { describe, expect, it } from 'vitest';
import {
  RULE_STATUSES,
  classifyCoverageChange,
  classifyStatusChange,
  diffTimePoints,
  escapeCsvCell,
  timePointDiffCsv,
  timePointDiffExport,
  timePointDiffFileName,
  timePointDiffJson,
  timePointDiffMarkdown,
  type ChangeClass,
  type RuleStatus,
  type TimePointSummary,
} from '../../contracts/index.js';

const rule = (id: string, status: RuleStatus, severity = 'medium') => ({
  id,
  name: `Rule ${id}`,
  category: 'access-control',
  severity,
  status,
});

const kpi = (id: string, value: number | null, unit: 'count' | 'currency' = 'count') => ({
  id,
  label: `KPI ${id}`,
  unit,
  value,
});

function summary(overrides: Partial<TimePointSummary> = {}): TimePointSummary {
  const rules = overrides.rules ?? [rule('AC-001', 'pass'), rule('AC-002', 'fail', 'high')];
  return {
    schemaVersion: 1,
    id: '2026-09-01T12-00-00Z',
    collectedAt: '2026-09-01T12:00:00.000Z',
    score: 95,
    assessed: rules.filter((r) => r.status !== 'skipped' && r.status !== 'error').length,
    total: rules.length,
    rules,
    disabledRules: [],
    datasets: [
      { name: 'members', status: 'ok', count: 10 },
      { name: 'cost', status: 'ok', count: 30 },
    ],
    kpis: [kpi('members', 10), kpi('mtd-cost', 100.5, 'currency')],
    ...overrides,
  };
}

const target = (overrides: Partial<TimePointSummary> = {}): TimePointSummary =>
  summary({
    id: '2026-09-15T12-00-00Z',
    collectedAt: '2026-09-15T12:00:00.000Z',
    ...overrides,
  });

/** Rows: the status at the base; columns: the status at the target (RULE_STATUSES order). */
const TABLE: Record<RuleStatus, ChangeClass[]> = {
  //          pass         warning      fail         skipped      error
  pass: ['unchanged', 'regressed', 'regressed', 'unassessed', 'unassessed'],
  warning: ['improved', 'unchanged', 'regressed', 'unassessed', 'unassessed'],
  fail: ['improved', 'improved', 'unchanged', 'unassessed', 'unassessed'],
  skipped: ['assessed', 'assessed', 'assessed', 'unchanged', 'regressed'],
  error: ['assessed', 'assessed', 'assessed', 'improved', 'unchanged'],
};

const CELLS = RULE_STATUSES.flatMap((from) =>
  RULE_STATUSES.map((to, i) => [from, to, TABLE[from][i]] as const),
);

describe('classifyStatusChange (5 x 5 table)', () => {
  it('covers all 25 transitions', () => {
    expect(CELLS).toHaveLength(25);
  });

  it.each(CELLS)('%s -> %s is %s', (from, to, expected) => {
    expect(classifyStatusChange(from, to)).toBe(expected);
  });
});

describe('classifyCoverageChange', () => {
  it.each([
    ['ok', 'ok', 'unchanged'],
    ['ok', 'unavailable', 'regressed'],
    ['ok', 'error', 'regressed'],
    ['unavailable', 'ok', 'improved'],
    ['unavailable', 'error', 'regressed'],
    ['error', 'ok', 'improved'],
    ['error', 'unavailable', 'improved'],
    ['error', 'error', 'unchanged'],
  ] as const)('%s -> %s is %s', (from, to, expected) => {
    expect(classifyCoverageChange(from, to)).toBe(expected);
  });
});

describe('diffTimePoints: rules', () => {
  it.each(CELLS.filter(([, , expected]) => expected !== 'unchanged'))(
    'reports %s -> %s as %s with both statuses',
    (from, to, expected) => {
      const diff = diffTimePoints(
        summary({ rules: [rule('X-1', from)] }),
        target({ rules: [rule('X-1', to)] }),
      );
      expect(diff.rules.changes).toEqual([
        {
          id: 'X-1',
          name: 'Rule X-1',
          category: 'access-control',
          severity: 'medium',
          from,
          to,
          change: expected,
        },
      ]);
      expect(diff.rules.counts[expected]).toBe(1);
    },
  );

  it('lists added and removed rules with the missing side null', () => {
    const diff = diffTimePoints(
      summary({ rules: [rule('OLD-1', 'pass', 'low'), rule('KEEP-1', 'pass')] }),
      target({ rules: [rule('KEEP-1', 'pass'), rule('NEW-1', 'fail', 'critical')] }),
    );
    expect(diff.rules.changes.map((r) => [r.id, r.from, r.to, r.change])).toEqual([
      ['NEW-1', null, 'fail', 'added'],
      ['OLD-1', 'pass', null, 'removed'],
    ]);
    expect(diff.rules.counts).toMatchObject({ added: 1, removed: 1, unchanged: 1 });
  });

  it('orders changes by class, then severity, then id', () => {
    const base = summary({
      rules: [
        rule('B-1', 'pass', 'low'),
        rule('A-1', 'pass', 'low'),
        rule('C-1', 'pass', 'critical'),
        rule('D-1', 'fail', 'high'),
        rule('E-1', 'pass', 'high'),
      ],
    });
    const next = target({
      rules: [
        rule('B-1', 'fail', 'low'),
        rule('A-1', 'fail', 'low'),
        rule('C-1', 'fail', 'critical'),
        rule('D-1', 'pass', 'high'),
        rule('E-1', 'skipped', 'high'),
      ],
    });
    expect(diffTimePoints(base, next).rules.changes.map((r) => `${r.change}:${r.id}`)).toEqual([
      'regressed:C-1',
      'regressed:A-1',
      'regressed:B-1',
      'unassessed:E-1',
      'improved:D-1',
    ]);
  });

  it('treats an empty report as every rule added or removed', () => {
    const empty = summary({ rules: [], assessed: 0, total: 0, score: 100 });
    const full = target({ rules: [rule('AC-001', 'pass'), rule('AC-002', 'fail')] });
    const forward = diffTimePoints(empty, full);
    expect(forward.rules.counts).toMatchObject({ added: 2, removed: 0, unchanged: 0 });
    expect(diffTimePoints(full, empty).rules.counts).toMatchObject({ added: 0, removed: 2 });
    expect(diffTimePoints(empty, empty).hasChanges).toBe(false);
  });
});

describe('diffTimePoints: identical summaries', () => {
  it('has no change at all when compared with itself', () => {
    const point = summary();
    const diff = diffTimePoints(point, point);
    expect(diff.hasChanges).toBe(false);
    expect(diff.rules.changes).toEqual([]);
    expect(diff.coverage.changes).toEqual([]);
    expect(diff.score).toMatchObject({ delta: 0, assessedDelta: 0 });
    expect(diff.kpis.every((k) => k.delta === 0)).toBe(true);
    expect(diff.rules.counts.unchanged).toBe(2);
  });

  it('does not modify its inputs', () => {
    const a = summary();
    const b = target({ score: 80 });
    const before = JSON.stringify([a, b]);
    diffTimePoints(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});

describe('diffTimePoints: score', () => {
  it('reports the score delta next to the change of the assessed count', () => {
    const base = summary({
      score: 100,
      rules: [rule('A', 'pass'), rule('B', 'skipped'), rule('C', 'skipped')],
    });
    const next = target({
      score: 80,
      rules: [rule('A', 'pass'), rule('B', 'fail', 'high'), rule('C', 'pass')],
    });
    expect(diffTimePoints(base, next).score).toEqual({
      base: 100,
      target: 80,
      delta: -20,
      baseAssessed: 1,
      targetAssessed: 3,
      assessedDelta: 2,
      baseTotal: 3,
      targetTotal: 3,
    });
  });

  it('reports a higher score reached with fewer assessed rules', () => {
    const base = summary({ score: 70, rules: [rule('A', 'fail', 'critical'), rule('B', 'pass')] });
    const next = target({ score: 100, rules: [rule('A', 'skipped'), rule('B', 'pass')] });
    const { score, rules } = diffTimePoints(base, next);
    expect(score).toMatchObject({ delta: 30, assessedDelta: -1 });
    expect(rules.changes.map((r) => r.change)).toEqual(['unassessed']);
  });
});

describe('diffTimePoints: dataset coverage', () => {
  it('reports status changes, added and removed datasets', () => {
    const base = summary({
      datasets: [
        { name: 'cost', status: 'ok', count: 30 },
        { name: 'groups', status: 'unavailable', count: null },
        { name: 'invites', status: 'ok', count: 4 },
        { name: 'members', status: 'ok', count: 10 },
        { name: 'old-dataset', status: 'ok', count: 1 },
      ],
    });
    const next = target({
      datasets: [
        { name: 'consoleCost', status: 'ok', count: 7 },
        { name: 'cost', status: 'error', count: null },
        { name: 'groups', status: 'ok', count: 5 },
        { name: 'invites', status: 'ok', count: 9 },
        { name: 'members', status: 'ok', count: 12 },
      ],
    });
    const { coverage } = diffTimePoints(base, next);
    expect(coverage.changes.map((c) => [c.dataset, c.from, c.to, c.change])).toEqual([
      ['cost', 'ok', 'error', 'regressed'],
      ['consoleCost', null, 'ok', 'added'],
      ['old-dataset', 'ok', null, 'removed'],
      ['groups', 'unavailable', 'ok', 'improved'],
    ]);
    expect(coverage.changes.find((c) => c.dataset === 'consoleCost')?.countDelta).toBeNull();
    expect(coverage.counts).toMatchObject({ regressed: 1, improved: 1, added: 1, removed: 1 });
    expect(coverage.counts.unchanged).toBe(2);
  });

  it('records the count delta of a changed dataset', () => {
    const base = summary({ datasets: [{ name: 'cost', status: 'error', count: 3 }] });
    const next = target({ datasets: [{ name: 'cost', status: 'ok', count: 10 }] });
    expect(diffTimePoints(base, next).coverage.changes[0]).toMatchObject({
      fromCount: 3,
      toCount: 10,
      countDelta: 7,
    });
  });
});

describe('diffTimePoints: KPIs', () => {
  it('computes deltas, rounds to two decimals and keeps null for a missing side', () => {
    const base = summary({
      kpis: [
        kpi('members', 10),
        kpi('mtd-cost', 0.1, 'currency'),
        kpi('mau', null),
        kpi('gone', 1),
      ],
    });
    const next = target({
      kpis: [kpi('members', 8), kpi('mtd-cost', 0.3, 'currency'), kpi('mau', 20), kpi('new', 5)],
    });
    expect(diffTimePoints(base, next).kpis.map((k) => [k.id, k.base, k.target, k.delta])).toEqual([
      ['members', 10, 8, -2],
      ['mtd-cost', 0.1, 0.3, 0.2],
      ['mau', null, 20, null],
      ['new', null, 5, null],
      ['gone', 1, null, null],
    ]);
  });

  it('counts a KPI that only changed from null to a value as a change', () => {
    const base = summary({ kpis: [kpi('mau', null)] });
    const next = target({ kpis: [kpi('mau', 3)] });
    const identical = { ...summary(), id: next.id, collectedAt: next.collectedAt };
    expect(diffTimePoints(base, { ...identical, kpis: [kpi('mau', 3)] }).hasChanges).toBe(true);
  });
});

describe('time-point diff exports', () => {
  const base = summary({
    rules: [rule('AC-001', 'pass'), rule('=EVIL', 'pass'), rule('PIPE-1', 'warning')],
    datasets: [{ name: 'cost', status: 'ok', count: 30 }],
  });
  const next = target({
    score: 80,
    rules: [
      rule('AC-001', 'fail', 'high'),
      { ...rule('=EVIL', 'fail'), name: '=HYPERLINK("http://x","y")' },
      { ...rule('PIPE-1', 'pass'), name: 'a | b, "c"' },
    ],
    datasets: [{ name: 'cost', status: 'error', count: null }],
  });
  const diff = diffTimePoints(base, next);

  it('names files from the two point ids', () => {
    expect(timePointDiffFileName(diff, 'md')).toBe(
      'time-point-diff-20260901T120000Z-20260915T120000Z.md',
    );
    expect(timePointDiffFileName(diff, 'csv')).toMatch(/\.csv$/);
    expect(timePointDiffFileName(diff, 'json')).toMatch(/\.json$/);
  });

  it('writes a CSV with a fixed header, CRLF and the shared escaping', () => {
    const csv = timePointDiffCsv(diff);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Section,Id,Name,Severity,Base,Target,Change,Delta');
    expect(lines.at(-1)).toBe('');
    expect(csv).toContain(
      `rule,'=EVIL,"'=HYPERLINK(""http://x"",""y"")",medium,pass,fail,regressed,`,
    );
    expect(csv).toContain('"a | b, ""c"""');
    expect(csv).toContain('score,score,Compliance score,,95,80,decreased,-15');
    expect(csv).toContain('dataset,cost,cost,,ok,error,regressed,');
    expect(lines.filter((l) => l.startsWith('kpi,'))).toHaveLength(2);
  });

  it('escapes the same cells as the shared helper', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
  });

  it('writes JSON with a fixed key order and a trailing newline', () => {
    const json = timePointDiffJson(diff);
    expect(json.endsWith('}\n')).toBe(true);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      'schemaVersion',
      'base',
      'target',
      'hasChanges',
      'score',
      'rules',
      'coverage',
      'kpis',
    ]);
    expect(timePointDiffJson(diff)).toBe(json);
  });

  it('escapes Markdown table separators and states an empty comparison', () => {
    const md = timePointDiffMarkdown(diff);
    expect(md).toContain('a \\| b, "c"');
    expect(md).toContain('## Rule changes (3)');
    const same = timePointDiffMarkdown(diffTimePoints(base, base));
    expect(same).toContain('- Changes: none');
    expect(same).toContain('No rule changed.');
    expect(same).toContain('No dataset changed.');
  });

  it('dispatches on the format', () => {
    expect(timePointDiffExport(diff, 'csv')).toBe(timePointDiffCsv(diff));
    expect(timePointDiffExport(diff, 'json')).toBe(timePointDiffJson(diff));
    expect(timePointDiffExport(diff, 'md')).toBe(timePointDiffMarkdown(diff));
  });
});
