import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, buildTimePointSummary, type Coverage, type Logger } from '@claude-audit/core';
import {
  COMPARE_INDEX_PATH,
  COMPARE_POINT_LIMIT,
  compareIndexSchema,
  comparePointPath,
  dashboardViewSchema,
  diffTimePoints,
  summaryStorePath,
  timePointDiffExport,
  timePointSummarySchema,
  type ChangeClass,
  type TimePointExportFormat,
  type TimePointSummary,
} from '@claude-audit/core/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDemoCollectors, demoState } from '../../adapters/demo/demo-source.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { createContainer, type Container } from '../container.js';
import { writeDetail } from '../detail.js';
import { backfillSummaries, readSummaries, saveSummary, summaryFor } from '../summaries.js';
import { check, collect } from '../workflows.js';

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const SAMPLE = join(ROOT, 'data/sample');
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), '__golden__');

const T1 = '2026-09-01T12-00-00Z';
const T2 = '2026-09-15T12-00-00Z';
const T3 = '2026-09-29T12-00-00Z';

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;

const published = async (id: string): Promise<TimePointSummary> =>
  timePointSummarySchema.parse(await readJson(join(SAMPLE, comparePointPath(id))));

describe('the three sample time points (data/sample)', () => {
  it('lists three points newest first in the compare index', async () => {
    const index = compareIndexSchema.parse(await readJson(join(SAMPLE, COMPARE_INDEX_PATH)));
    expect(index.points.map((p) => [p.id, p.state])).toEqual([
      [T3, 'summary'],
      [T2, 'summary'],
      [T1, 'summary'],
    ]);
    const reportOf = async (id: string) =>
      (await readJson(
        id === T3
          ? join(SAMPLE, 'compliance-report.json')
          : join(SAMPLE, `history/${id}/compliance-report.json`),
      )) as { summary: { score: number } };
    for (const point of index.points)
      expect(point.score, point.id).toBe((await reportOf(point.id)).summary.score);
  });

  it.each([T1, T2, T3])(
    'the published summary of %s equals the summary built from its real report',
    async (id) => {
      const dir = id === T3 ? SAMPLE : join(SAMPLE, `history/${id}`);
      const view = dashboardViewSchema.parse(await readJson(join(dir, 'dashboard.json')));
      const report = (await readJson(join(dir, 'compliance-report.json'))) as Parameters<
        typeof buildTimePointSummary
      >[0]['report'];
      const coverage: Coverage = Object.fromEntries(
        view.coverage.map((c) => [
          c.dataset,
          { status: c.status as 'ok', ...(c.count === null ? {} : { count: c.count }) },
        ]),
      );
      const committed = await published(id);
      const rebuilt = buildTimePointSummary({
        snapshot: { id, collectedAt: view.collectedAt ?? '', coverage },
        report,
        kpis: view.kpis,
        disabledRules: committed.disabledRules,
      });
      expect(rebuilt).toEqual(committed);
      // Statuses and counts only: nothing from the evidence of the report is published.
      const text = JSON.stringify(committed);
      for (const result of report.results)
        for (const evidence of result.evidence) expect(text).not.toContain(evidence.label);
    },
  );

  it('records the rules switched off at each point', async () => {
    expect((await published(T1)).disabledRules).toEqual(['AM-007', 'DG-001']);
    expect((await published(T2)).disabledRules).toEqual(['AK-002']);
    expect((await published(T3)).disabledRules).toEqual([]);
  });

  it('classifies the intended T1 -> T2 and T2 -> T3 changes of the sample', async () => {
    const [s1, s2, s3] = await Promise.all([published(T1), published(T2), published(T3)]);
    const classes = (diff: ReturnType<typeof diffTimePoints>): Record<string, ChangeClass> =>
      Object.fromEntries(diff.rules.changes.map((r) => [r.id, r.change]));
    const first = classes(diffTimePoints(s1, s2));
    expect(first).toMatchObject({
      'AK-003': 'regressed',
      'AM-006': 'regressed',
      'CF-006': 'improved',
      'AM-002': 'improved',
      'AC-004': 'unassessed',
      'UA-003': 'unassessed',
      'UA-004': 'unassessed',
      'UA-001': 'assessed',
      'DG-001': 'added',
      'AM-007': 'added',
      'AK-002': 'removed',
    });
    const second = classes(diffTimePoints(s2, s3));
    expect(second).toMatchObject({
      'CF-003': 'regressed',
      'UA-001': 'regressed',
      'AC-002': 'improved',
      'OP-002': 'improved',
      'AK-002': 'added',
    });
    const coverage = Object.fromEntries(
      diffTimePoints(s1, s2).coverage.changes.map((c) => [c.dataset, c.change]),
    );
    expect(coverage).toMatchObject({
      invites: 'regressed',
      spendLimits: 'regressed',
      groups: 'regressed',
    });
    const back = Object.fromEntries(
      diffTimePoints(s2, s3).coverage.changes.map((c) => [c.dataset, c.change]),
    );
    expect(back).toMatchObject({
      invites: 'improved',
      spendLimits: 'improved',
      groups: 'improved',
    });
    const kpis = Object.fromEntries(diffTimePoints(s1, s2).kpis.map((k) => [k.id, k.delta]));
    expect(kpis.members).toBe(9);
    expect(kpis['mtd-cost']).toBeGreaterThan(0);
  });
});

const PAIRS: [string, string, string][] = [
  ['t1-t2', T1, T2],
  ['t2-t3', T2, T3],
  ['t1-t3', T1, T3],
];
const FORMATS: TimePointExportFormat[] = ['md', 'csv', 'json'];

describe('diff export goldens built from the sample points', () => {
  it.each(
    PAIRS.flatMap(([name, base, target]) => FORMATS.map((f) => [name, base, target, f] as const)),
  )('%s as %s', async (name, base, target, format) => {
    const diff = diffTimePoints(await published(base), await published(target));
    await expect(timePointDiffExport(diff, format)).toMatchFileSnapshot(
      join(GOLDEN, `time-point-diff-${name}.${format}.golden`),
    );
  });

  it('a point compared with itself exports a zero diff', async () => {
    const same = await published(T2);
    const diff = diffTimePoints(same, same);
    expect(diff.hasChanges).toBe(false);
    expect(
      timePointDiffExport(diff, 'csv')
        .split('\r\n')
        .filter((l) => l.startsWith('rule,')),
    ).toEqual([]);
  });
});

const dirs: string[] = [];
const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'summaries-'));
  dirs.push(dir);
  return dir;
};
afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const NOW = new Date('2026-09-29T12:00:00.000Z');

function loggerSpy(): Logger & { warnings: string[] } {
  const warnings: string[] = [];
  return { info: () => {}, error: () => {}, warn: (m: string) => void warnings.push(m), warnings };
}

async function container(dir: string, now: Date = NOW, logger: Logger = loggerSpy()) {
  const c = await createContainer({
    env: {},
    cwd: ROOT,
    dataDir: dir,
    clock: fixedClock(now),
    collectors: createDemoCollectors(),
    source: 'demo',
    logger,
  });
  await c.state.save(demoState(now));
  return c;
}

async function judged(dir: string, now: Date = NOW): Promise<Container> {
  const c = await container(dir, now);
  await collect(c);
  await check(c);
  return c;
}

const compareFiles = async (dir: string): Promise<string[]> =>
  (await readdir(join(dir, 'detail/compare')).catch(() => [])).sort();

describe('summary store', () => {
  let dir: string;
  let c: Container;
  beforeAll(async () => {
    dir = await tempDir();
    c = await judged(dir);
  });

  it('`check` writes the summary next to the judged snapshot', async () => {
    const stored = timePointSummarySchema.parse(await c.store.readJson(summaryStorePath(T3)));
    const snapshot = await c.snapshots.latest();
    const report = await c.reports.latest();
    expect(stored).toEqual(summaryFor(snapshot!, report!, []));
    expect(stored.score).toBe(report?.summary.score);
    expect(stored.rules).toHaveLength(report?.results.length ?? -1);
  });

  it('applies per-call rule overrides to the summary', async () => {
    const other = await container(await tempDir(), addDays(NOW, -1));
    await collect(other);
    await check(other, { disabledRules: ['AC-001'] });
    const stored = await readSummaries(other);
    expect(stored[0]?.disabledRules).toEqual(['AC-001']);
    expect(stored[0]?.rules.some((r) => r.id === 'AC-001')).toBe(false);
  });

  it('writes the compare files with the detail build and a manifest entry', async () => {
    const files = await writeDetail(c);
    expect(
      Object.keys(files)
        .filter((p) => p.includes('compare/'))
        .sort(),
    ).toEqual([comparePointPath(T3), COMPARE_INDEX_PATH]);
    const manifest = JSON.parse(files['detail/index.json'] ?? '{}') as {
      files: { kind: string; status: string; count: number }[];
    };
    expect(manifest.files.find((f) => f.kind === 'compare')).toMatchObject({
      status: 'ok',
      count: 1,
    });
  });

  it('backfills the summary of a stored snapshot whose summary is missing, never overwriting', async () => {
    await rm(c.store.path(summaryStorePath(T3)));
    expect(await backfillSummaries(c)).toBe(1);
    const rebuilt = await c.store.readJson(summaryStorePath(T3));
    expect(timePointSummarySchema.parse(rebuilt).id).toBe(T3);
    expect(await backfillSummaries(c)).toBe(0);
    const edited = { ...(rebuilt as TimePointSummary), score: 1 };
    await saveSummary(c, edited);
    await backfillSummaries(c);
    expect(timePointSummarySchema.parse(await c.store.readJson(summaryStorePath(T3))).score).toBe(
      1,
    );
  });

  it('rewrites the detail files and backfills through `detail` alone', async () => {
    await rm(c.store.path('summaries'), { recursive: true, force: true });
    const files = await writeDetail(c);
    expect(files[comparePointPath(T3)]).toBeDefined();
    expect(await readSummaries(c)).toHaveLength(1);
  });

  it('skips a summary file that is not valid, with a warning', async () => {
    const dirty = await tempDir();
    const logger = loggerSpy();
    const d = await container(dirty, NOW, logger);
    await mkdir(join(dirty, 'summaries'), { recursive: true });
    await writeFile(join(dirty, summaryStorePath(T1)), '{"not":"a summary"}');
    await writeFile(join(dirty, summaryStorePath(T2)), 'not json');
    expect(await readSummaries(d)).toEqual([]);
    expect(logger.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('writes the summary of a restored snapshot chosen with --snapshot when its report is gone', async () => {
    const restored = await tempDir();
    const r = await judged(restored);
    await rm(r.store.path(summaryStorePath(T3)));
    await rm(r.store.path(`reports/compliance/${T3}.json`));
    await writeDetail(r, undefined, undefined, undefined, T3);
    const stored = timePointSummarySchema.parse(await r.store.readJson(summaryStorePath(T3)));
    expect(stored.id).toBe(T3);
    expect(stored.rules.length).toBeGreaterThan(0);
    expect((await compareFiles(restored)).includes(`${T3}.json`)).toBe(true);
  });
});

describe('cap and stale files', () => {
  it('publishes the newest 90 points only and removes files that fell out of the window', async () => {
    const dir = await tempDir();
    const c = await judged(dir);
    const base = timePointSummarySchema.parse(await c.store.readJson(summaryStorePath(T3)));
    const idAt = (day: number): string =>
      addDays(new Date('2026-01-01T00:00:00Z'), day)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z')
        .replaceAll(':', '-');
    for (let day = 0; day < COMPARE_POINT_LIMIT + 2; day += 1)
      await saveSummary(c, { ...base, id: idAt(day) });
    await writeDetail(c);
    const first = await compareFiles(dir);
    expect(first).toHaveLength(COMPARE_POINT_LIMIT + 1);
    const index = compareIndexSchema.parse(await readJson(join(dir, COMPARE_INDEX_PATH)));
    expect(index.points).toHaveLength(COMPARE_POINT_LIMIT);
    expect(index.points[0]?.id).toBe(T3);
    // The two oldest points are outside the window and are not published.
    expect(first).not.toContain(`${idAt(0)}.json`);
    // A point that is no longer selectable is removed, never left behind unlisted.
    await rm(c.store.path(summaryStorePath(idAt(50))));
    await writeDetail(c);
    const second = await compareFiles(dir);
    expect(second).not.toContain(`${idAt(50)}.json`);
    expect(second).toHaveLength(COMPARE_POINT_LIMIT + 1);
    expect(dirname(join(dir, COMPARE_INDEX_PATH))).toBe(join(dir, 'detail/compare'));
  });

  it('lists an unavailable compare entry and removes stale files when no summary exists', async () => {
    const dir = await tempDir();
    const c = await container(dir);
    const files = await writeDetail(c);
    expect(Object.keys(files).filter((p) => p.includes('compare/'))).toEqual([]);
    const manifest = JSON.parse(files['detail/index.json'] ?? '{}') as {
      files: { kind: string; status: string }[];
    };
    expect(manifest.files.find((f) => f.kind === 'compare')?.status).toBe('unavailable');
  });
});
