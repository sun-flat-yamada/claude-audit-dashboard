import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPTIONAL_DATASET_NAMES,
  type CheckStatus,
  type ComplianceReport,
} from '@claude-audit/core';
import { dashboardViewSchema } from '@claude-audit/core/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_TIME_POINTS } from '../../adapters/demo/demo-history.js';
import { DEMO_NOW } from '../../adapters/demo/demo-source.js';
import { silentLogger } from '../../infrastructure/runtime.js';
import { writeDemoSample } from '../demo.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

type Files = Record<string, string>;
type View = ReturnType<typeof dashboardViewSchema.parse>;

interface Point {
  report: ComplianceReport;
  view: View;
  /** Rule id -> status of this point (disabled rules are absent). */
  rules: Record<string, CheckStatus>;
  coverage: Record<string, string>;
  kpis: Record<string, number | null>;
}

async function generate(profile: 'default' | 'optional-sources'): Promise<Files> {
  const out = await mkdtemp(join(tmpdir(), 'history-'));
  try {
    return await writeDemoSample(out, { profile, cwd: ROOT, env: {}, logger: silentLogger });
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

/** The points, oldest first: the `history/` entries, then the root files (the latest point). */
function points(files: Files): Point[] {
  const ids = [
    ...new Set(
      Object.keys(files)
        .filter((name) => name.startsWith('history/'))
        .map((name) => name.split('/')[1] as string),
    ),
  ].sort();
  const pair = (dashboard: string | undefined, report: string | undefined): Point => {
    const view = dashboardViewSchema.parse(JSON.parse(dashboard ?? '{}'));
    const parsed = JSON.parse(report ?? '{}') as ComplianceReport;
    return {
      report: parsed,
      view,
      rules: Object.fromEntries(parsed.results.map((r) => [r.ruleId, r.status])),
      coverage: Object.fromEntries(view.coverage.map((c) => [c.dataset, c.status])),
      kpis: Object.fromEntries(view.kpis.map((k) => [k.id, k.value])),
    };
  };
  return [
    ...ids.map((id) =>
      pair(files[`history/${id}/dashboard.json`], files[`history/${id}/compliance-report.json`]),
    ),
    pair(files['dashboard.json'], files['compliance-report.json']),
  ];
}

/** One expected change of a rule between two consecutive points (`-` = rule not in the report). */
const RULE_CHANGES: readonly [rule: string, from: string, to: string, step: 1 | 2][] = [
  ['AK-003', 'pass', 'fail', 1],
  ['CF-003', 'pass', 'fail', 2],
  ['UA-001', 'pass', 'fail', 2],
  ['CF-006', 'fail', 'pass', 1],
  ['AC-002', 'fail', 'pass', 2],
  ['OP-002', 'fail', 'pass', 2],
  ['AM-002', 'warning', 'pass', 1],
  ['UA-002', 'warning', 'pass', 2],
  ['AM-006', 'pass', 'warning', 1],
  ['UA-002', 'pass', 'warning', 1],
  ['AC-004', 'pass', 'skipped', 1],
  ['UA-003', 'pass', 'skipped', 1],
  ['UA-004', 'pass', 'skipped', 1],
  ['UA-003', 'skipped', 'fail', 2],
  ['UA-004', 'skipped', 'warning', 2],
  ['UA-001', 'error', 'pass', 1],
  ['DG-001', '-', 'skipped', 1],
  ['AM-007', '-', 'pass', 1],
  ['AK-002', 'fail', '-', 1],
  ['AK-002', '-', 'fail', 2],
];

/** Dataset coverage changes: [dataset, status at T1, T2, T3]. */
const COVERAGE: readonly [string, string, string, string][] = [
  ['invites', 'ok', 'error', 'ok'],
  ['spendLimits', 'ok', 'unavailable', 'ok'],
  ['groups', 'unavailable', 'error', 'ok'],
];

describe('multi-time-point demo history (F-015)', () => {
  let files: Files;
  let pts: Point[];
  beforeAll(async () => {
    files = await generate('default');
    pts = points(files);
  });

  it('has three fixed-clock time points; the latest is the unchanged public sample', async () => {
    expect(pts).toHaveLength(3);
    expect(DEMO_TIME_POINTS.map((p) => p.now.toISOString())).toEqual([
      '2026-09-01T12:00:00.000Z',
      '2026-09-15T12:00:00.000Z',
      DEMO_NOW.toISOString(),
    ]);
    const ids = pts.map((p) => p.report.snapshotId);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(3);
    expect(pts[2]?.view.collectedAt).toBe(DEMO_NOW.toISOString());
    // The root files are the single-point sample of before the history existed.
    expect(pts[2]?.view.compliance.history).toHaveLength(1);
    expect(pts[2]?.report.summary.errors + (pts[2]?.report.summary.skipped ?? 0)).toBe(0);
    for (const point of pts) expect(point.view.source).toBe('demo');
  });

  it('each earlier point carries the score history up to itself', () => {
    expect(pts.map((p) => p.view.compliance.history.length)).toEqual([1, 2, 1]);
    expect(pts[1]?.view.compliance.history.map((h) => h.date)).toEqual([
      pts[0]?.report.generatedAt,
      pts[1]?.report.generatedAt,
    ]);
  });

  it.each(RULE_CHANGES)(
    '%s changes %s -> %s between T%i and the next point',
    (rule, from, to, step) => {
      const before = pts[step - 1]?.rules[rule] ?? '-';
      const after = pts[step]?.rules[rule] ?? '-';
      expect([before, after]).toEqual([from, to]);
    },
  );

  it('covers every status transition the issue requires', () => {
    const seen = new Set(RULE_CHANGES.map(([, from, to]) => `${from}>${to}`));
    for (const required of ['pass>fail', 'fail>pass', 'warning>pass', 'pass>skipped', 'error>pass'])
      expect(seen, required).toContain(required);
    // The table is the intended set, so it must match the generated reports exactly.
    for (const [rule, from, to, step] of RULE_CHANGES) {
      expect([pts[step - 1]?.rules[rule] ?? '-', pts[step]?.rules[rule] ?? '-']).toEqual([
        from,
        to,
      ]);
    }
  });

  it('adds and removes rules through disabledRules', () => {
    const ids = pts.map((p) => new Set(Object.keys(p.rules)));
    expect(ids[0]?.has('DG-001')).toBe(false);
    expect(ids[1]?.has('DG-001')).toBe(true);
    expect(ids[1]?.has('AK-002')).toBe(false);
    expect(ids[2]?.has('AK-002')).toBe(true);
    expect(ids[2]?.size).toBe(30);
  });

  it.each(COVERAGE)('dataset %s is %s, %s, %s', (dataset, a, b, c) => {
    expect(pts.map((p) => p.coverage[dataset])).toEqual([a, b, c]);
  });

  it('members, active users and cost rise and fall between points', () => {
    const series = (id: string) => pts.map((p) => p.kpis[id] as number);
    const [m1, m2, m3] = series('members') as [number, number, number];
    expect(m2).toBeGreaterThan(m1);
    expect(m3).toBeLessThan(m2);
    const [a1, a2, a3] = series('mau') as [number, number, number];
    expect(a2).toBeGreaterThan(a1);
    expect(a3).toBeLessThan(a2);
    const [c1, c2, c3] = series('mtd-cost') as [number, number, number];
    expect(c2).toBeGreaterThan(c1);
    expect(c3).toBeLessThan(c2);
  });

  it('reports an error at T1 and skipped rules at T2 in the summary', () => {
    expect(pts[0]?.report.summary.errors).toBe(1);
    expect(pts[1]?.report.summary.skipped).toBeGreaterThanOrEqual(4);
  });

  it('is deterministic', async () => {
    expect(await generate('default')).toEqual(files);
  });

  it('the committed history/ is exactly the generated file set', async () => {
    const generated = Object.keys(files)
      .filter((name) => name.startsWith('history/'))
      .sort();
    const root = join(ROOT, 'data/sample/history');
    const committed = (
      await Promise.all(
        (await readdir(root)).map(async (id) =>
          (await readdir(join(root, id))).map((name) => `history/${id}/${name}`),
        ),
      )
    )
      .flat()
      .sort();
    expect(committed).toEqual(generated);
    for (const name of generated)
      expect(await readFile(join(ROOT, 'data/sample', name), 'utf8'), name).toBe(files[name]);
  });
});

describe('multi-time-point demo history, optional-sources profile (B4)', () => {
  let standard: Point[];
  let optional: Point[];
  beforeAll(async () => {
    standard = points(await generate('default'));
    optional = points(await generate('optional-sources'));
  });

  it('enables the optional datasets only at the latest point', () => {
    for (const name of OPTIONAL_DATASET_NAMES) {
      expect(optional.map((p) => p.coverage[name])).toEqual([undefined, undefined, 'ok']);
    }
  });

  it('the earlier points equal the default profile (the sample stays the base)', () => {
    expect(optional.slice(0, 2).map((p) => p.report)).toEqual(
      standard.slice(0, 2).map((p) => p.report),
    );
  });
});
