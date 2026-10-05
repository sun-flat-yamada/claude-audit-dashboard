import { describe, expect, it } from 'vitest';
import {
  COMPARE_INDEX_PATH,
  COMPARE_POINT_LIMIT,
  DETAIL_MANIFEST_PATH,
  checkDetailBundle,
  compareIndexSchema,
  comparePointPath,
  detailManifestSchema,
  summaryStorePath,
  timePointSummarySchema,
  type DashboardKpi,
  type TimePointSummary,
} from '../../contracts/index.js';
import { summarize } from '../../domain/compliance/scoring.js';
import {
  COMPLIANCE_REPORT_SCHEMA_VERSION,
  type CheckResult,
  type ComplianceReport,
} from '../../domain/compliance/types.js';
import { buildDetailView } from '../presenters/detail-view.js';
import { DEFAULT_DETAIL_THRESHOLDS } from '../presenters/detail-view.js';
import { buildCompareIndex, buildTimePointSummary } from '../presenters/time-point-summary.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');

const result = (
  ruleId: string,
  status: CheckResult['status'],
  severity: CheckResult['severity'] = 'medium',
): CheckResult => ({
  ruleId,
  ruleName: `Rule ${ruleId}`,
  category: 'access-control',
  severity,
  status,
  message: 'alice.engineer@example.com has not signed in',
  evidence: [{ kind: 'user', id: 'user_1', label: 'alice.engineer@example.com' }],
  details: { secret: 'value' },
  remediation: null,
});

function report(results: CheckResult[]): ComplianceReport {
  return {
    schemaVersion: COMPLIANCE_REPORT_SCHEMA_VERSION,
    id: 'compliance-2026-09-29T12-00-00Z',
    snapshotId: '2026-09-29T12-00-00Z',
    generatedAt: NOW.toISOString(),
    summary: summarize(results),
    results,
  };
}

const kpis: DashboardKpi[] = [
  {
    id: 'score',
    label: 'Compliance score',
    value: 80,
    unit: 'score',
    hint: '2 of 4 rules assessed',
  },
  { id: 'mtd-cost', label: 'Month-to-date cost', value: 12.5, unit: 'currency', hint: 'USD' },
  { id: 'mau', label: 'Monthly active users', value: null, unit: 'count', hint: null },
];

const snapshot = {
  id: '2026-09-29T12-00-00Z',
  collectedAt: NOW.toISOString(),
  coverage: {
    members: { status: 'ok' as const, count: 40, source: 'admin-api', reason: 'private' },
    cost: { status: 'unavailable' as const, reason: 'no key' },
    adoption: { status: 'error' as const, reason: 'HTTP 500', count: 0 },
  },
};

const RESULTS = [
  result('AC-001', 'fail', 'high'),
  result('AC-002', 'pass'),
  result('UA-001', 'skipped'),
  result('UA-002', 'error'),
];

const build = (disabledRules: string[] = ['DG-001', 'AK-002', 'DG-001']) =>
  buildTimePointSummary({ snapshot, report: report(RESULTS), kpis, disabledRules });

describe('buildTimePointSummary', () => {
  it('records the score, the assessed count, rule statuses, datasets and KPIs', () => {
    const summary = build();
    expect(summary).toMatchObject({
      schemaVersion: 1,
      id: '2026-09-29T12-00-00Z',
      collectedAt: NOW.toISOString(),
      score: 95,
      assessed: 2,
      total: 4,
    });
    expect(summary.rules.map((r) => [r.id, r.status])).toEqual([
      ['AC-001', 'fail'],
      ['AC-002', 'pass'],
      ['UA-001', 'skipped'],
      ['UA-002', 'error'],
    ]);
    expect(summary.kpis).toEqual([
      { id: 'score', label: 'Compliance score', unit: 'score', value: 80 },
      { id: 'mtd-cost', label: 'Month-to-date cost', unit: 'currency', value: 12.5 },
      { id: 'mau', label: 'Monthly active users', unit: 'count', value: null },
    ]);
  });

  it('sorts datasets by name, unique-sorts disabled rules and keeps unknown counts null', () => {
    const summary = build();
    expect(summary.datasets).toEqual([
      { name: 'adoption', status: 'error', count: 0 },
      { name: 'cost', status: 'unavailable', count: null },
      { name: 'members', status: 'ok', count: 40 },
    ]);
    expect(summary.disabledRules).toEqual(['AK-002', 'DG-001']);
  });

  it('carries no evidence, message, detail, source or reason (no per-person data)', () => {
    const json = JSON.stringify(build());
    for (const leak of [
      'alice.engineer',
      'example.com',
      'secret',
      'admin-api',
      'private',
      'HTTP 500',
    ])
      expect(json, leak).not.toContain(leak);
    expect(timePointSummarySchema.safeParse(build()).success).toBe(true);
  });

  it('is deterministic and does not modify its input', () => {
    const input = report(RESULTS);
    const before = JSON.stringify(input);
    const a = buildTimePointSummary({ snapshot, report: input, kpis, disabledRules: [] });
    const b = buildTimePointSummary({ snapshot, report: input, kpis, disabledRules: [] });
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('summarizes an empty report', () => {
    const summary = buildTimePointSummary({
      snapshot: { ...snapshot, coverage: {} },
      report: report([]),
      kpis: [],
      disabledRules: [],
    });
    expect(summary).toMatchObject({ score: 100, assessed: 0, total: 0, rules: [], datasets: [] });
  });
});

const at = (n: number): TimePointSummary => ({
  ...build(),
  id: `2026-09-${String(n).padStart(2, '0')}T12-00-00Z`,
  collectedAt: `2026-09-${String(n).padStart(2, '0')}T12:00:00.000Z`,
});

describe('buildCompareIndex', () => {
  it('lists points newest first with their score and assessed count', () => {
    const index = buildCompareIndex([at(1), at(15), at(8)], NOW);
    expect(index.points.map((p) => p.id)).toEqual([
      '2026-09-15T12-00-00Z',
      '2026-09-08T12-00-00Z',
      '2026-09-01T12-00-00Z',
    ]);
    expect(index.points[0]).toEqual({
      id: '2026-09-15T12-00-00Z',
      collectedAt: '2026-09-15T12:00:00.000Z',
      state: 'summary',
      score: 95,
      assessed: 2,
    });
    expect(compareIndexSchema.safeParse(index).success).toBe(true);
  });

  it('keeps only the newest points up to the limit', () => {
    const many = Array.from({ length: COMPARE_POINT_LIMIT + 5 }, (_, i) => ({
      ...build(),
      id: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}T00-00-00Z`,
    }));
    const index = buildCompareIndex(many, NOW);
    expect(index.points).toHaveLength(COMPARE_POINT_LIMIT);
    expect(buildCompareIndex(many, NOW, 3).points).toHaveLength(3);
    expect(buildCompareIndex([], NOW).points).toEqual([]);
  });
});

describe('paths', () => {
  it('derives the store and published paths from the point id', () => {
    expect(summaryStorePath('2026-09-01T12-00-00Z')).toBe('summaries/2026-09-01T12-00-00Z.json');
    expect(comparePointPath('2026-09-01T12-00-00Z')).toBe(
      'detail/compare/2026-09-01T12-00-00Z.json',
    );
    expect(COMPARE_INDEX_PATH).toBe('detail/compare/index.json');
  });
});

function bundleFiles(summaries: TimePointSummary[] | null | undefined): Record<string, string> {
  const bundle = buildDetailView({
    now: NOW,
    source: 'demo',
    maskPii: true,
    snapshot: null,
    report: null,
    thresholds: DEFAULT_DETAIL_THRESHOLDS,
    summaries,
  });
  return {
    [DETAIL_MANIFEST_PATH]: JSON.stringify(bundle.manifest),
    ...Object.fromEntries(bundle.files.map((f) => [f.path, JSON.stringify(f.content)])),
  };
}

const compareEntry = (files: Record<string, string>) =>
  detailManifestSchema
    .parse(JSON.parse(files[DETAIL_MANIFEST_PATH] ?? ''))
    .files.find((f) => f.kind === 'compare');

describe('compare files in the detail bundle', () => {
  it('has no compare entry when the caller has no summaries to publish', () => {
    expect(compareEntry(bundleFiles(undefined))).toBeUndefined();
  });

  it('lists an unavailable entry without files when summaries are missing or unreadable', () => {
    for (const input of [[], null]) {
      const files = bundleFiles(input);
      expect(compareEntry(files)).toMatchObject({
        status: 'unavailable',
        path: COMPARE_INDEX_PATH,
      });
      expect(Object.keys(files).some((p) => p.startsWith('detail/compare/'))).toBe(false);
      expect(checkDetailBundle(files)).toEqual([]);
    }
  });

  it('publishes the index and one file per point, and the bundle passes the check', () => {
    const files = bundleFiles([at(1), at(15)]);
    expect(compareEntry(files)).toMatchObject({ status: 'ok', count: 2, schemaVersion: 1 });
    expect(
      Object.keys(files)
        .filter((p) => p.startsWith('detail/compare/'))
        .sort(),
    ).toEqual([
      'detail/compare/2026-09-01T12-00-00Z.json',
      'detail/compare/2026-09-15T12-00-00Z.json',
      'detail/compare/index.json',
    ]);
    expect(checkDetailBundle(files, { requireDemo: true })).toEqual([]);
  });

  it('publishes only the newest 90 points', () => {
    const many = Array.from({ length: COMPARE_POINT_LIMIT + 2 }, (_, i) => ({
      ...build(),
      id: `2026-01-01T00-${String(Math.floor(i / 60)).padStart(2, '0')}-${String(i % 60).padStart(2, '0')}Z`,
    }));
    const files = bundleFiles(many);
    expect(Object.keys(files).filter((p) => p.startsWith('detail/compare/'))).toHaveLength(
      COMPARE_POINT_LIMIT + 1,
    );
    expect(checkDetailBundle(files)).toEqual([]);
  });
});

describe('checkDetailBundle: compare negative cases', () => {
  const P1 = comparePointPath(at(1).id);
  const P15 = comparePointPath(at(15).id);
  const good = (): Record<string, string> => bundleFiles([at(1), at(15)]);
  const edit = (
    files: Record<string, string>,
    path: string,
    change: (json: Record<string, unknown>) => void,
  ): Record<string, string> => {
    const json = JSON.parse(files[path] ?? '{}') as Record<string, unknown>;
    change(json);
    return { ...files, [path]: JSON.stringify(json) };
  };

  it('reports a listed point whose file is missing', () => {
    const files = good();
    delete files[P1];
    expect(checkDetailBundle(files)).toEqual([`${P1}: listed in the compare index but missing`]);
  });

  it('reports a point file that the index does not list', () => {
    const files = { ...good(), [comparePointPath('2026-09-02T12-00-00Z')]: good()[P1] ?? '' };
    expect(checkDetailBundle(files)).toContain(
      'detail/compare/2026-09-02T12-00-00Z.json: not listed in the compare index',
    );
  });

  it('reports a missing index when point files exist', () => {
    const files = good();
    delete files[COMPARE_INDEX_PATH];
    expect(checkDetailBundle(files).some((e) => e.includes('compare/index.json'))).toBe(true);
  });

  it('rejects evidence, message or any other extra field (strict contract)', () => {
    const files = edit(good(), P1, (j) => {
      (j.rules as Record<string, unknown>[])[0] = {
        ...(j.rules as Record<string, unknown>[])[0],
        evidence: [{ label: 'alice.engineer@example.com' }],
      };
    });
    expect(checkDetailBundle(files)).toEqual([
      `${P1}: does not match the time-point summary contract`,
    ]);
  });

  it('rejects an unmasked-looking or non-example e-mail address and sensitive strings', () => {
    const mail = edit(good(), P1, (j) => {
      (j.rules as { name: string }[])[0]!.name = 'mail alice@corp.test';
    });
    expect(checkDetailBundle(mail).some((e) => e.includes('non-example.com e-mail'))).toBe(true);
    const url = edit(good(), P15, (j) => {
      (j.rules as { name: string }[])[0]!.name = 'see https://internal.example.net/x';
    });
    expect(checkDetailBundle(url).some((e) => e.includes('look like a secret'))).toBe(true);
  });

  it('reports counts that differ from the rows, duplicates and a disabled rule with a result', () => {
    const counts = edit(good(), P1, (j) => {
      j.assessed = 3;
    });
    expect(
      checkDetailBundle(counts).some((e) => e.includes('differs from its compare index')),
    ).toBe(true);
    expect(checkDetailBundle(counts).some((e) => e.includes('total or assessed'))).toBe(true);
    const dup = edit(good(), P1, (j) => {
      const rules = j.rules as unknown[];
      rules.push(rules[0]);
      j.total = rules.length;
      j.assessed = 3;
    });
    expect(checkDetailBundle(dup).some((e) => e.includes('duplicate rule or dataset rows'))).toBe(
      true,
    );
    const disabled = edit(good(), P1, (j) => {
      j.disabledRules = ['AC-001'];
    });
    expect(checkDetailBundle(disabled).some((e) => e.includes('disabled rule also has'))).toBe(
      true,
    );
  });

  it('reports an index that is not newest first, has a point id that differs from its file', () => {
    const order = edit(good(), COMPARE_INDEX_PATH, (j) => {
      (j.points as unknown[]).reverse();
    });
    expect(checkDetailBundle(order)).toContain(
      'detail/compare/index.json: points must be newest first',
    );
    const renamed = edit(good(), P1, (j) => {
      j.id = '2026-09-02T12-00-00Z';
    });
    expect(checkDetailBundle(renamed).length).toBeGreaterThan(0);
  });

  it('reports a manifest count that differs from the index and an archived point with a score', () => {
    const files = good();
    const manifest = JSON.parse(files[DETAIL_MANIFEST_PATH] ?? '{}') as {
      files: { kind: string; count: number }[];
    };
    manifest.files.find((f) => f.kind === 'compare')!.count = 5;
    expect(
      checkDetailBundle({ ...files, [DETAIL_MANIFEST_PATH]: JSON.stringify(manifest) }).some((e) =>
        e.includes('manifest count 5'),
      ),
    ).toBe(true);
    const archived = edit(good(), COMPARE_INDEX_PATH, (j) => {
      (j.points as { state: string }[])[0]!.state = 'archived';
    });
    expect(checkDetailBundle(archived).some((e) => e.includes('archived point'))).toBe(true);
  });
});
