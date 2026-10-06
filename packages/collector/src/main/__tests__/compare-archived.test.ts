import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timestampId, type Clock } from '@claude-audit/core';
import {
  COMPARE_POINT_LIMIT,
  checkDetailBundle,
  compareIndexSchema,
  diffTimePoints,
  timePointDiffExport,
  timePointSummarySchema,
  type CompareIndex,
  type TimePointExportFormat,
  type TimePointSummary,
} from '@claude-audit/core/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  FIXTURE_ENV,
  FIXTURE_NOW,
  createFixtureFetch,
  fixtureState,
} from '../../adapters/fixture/fixture-source.js';
import { FsSnapshotRepository } from '../../adapters/storage/repositories.js';
import { FileStore } from '../../adapters/storage/file-store.js';
import { TENANT_FIXTURE_URL } from '../../__tests__/fixture-sets.js';
import { createHistory, type SyntheticHistory } from '../../__tests__/synthetic-history.js';
import { runCli } from '../cli.js';
import { createContainer, type ContainerOptions } from '../container.js';
import { check, collect } from '../workflows.js';

/**
 * F-015 PR4: comparison with archived snapshots (B3 `archive` / `restore` -> compare). A long
 * synthetic history (> 365 days) is judged snapshot by snapshot, archived with a short
 * retention, and the compare index, the restored points and their diffs are checked against the
 * run in which nothing was ever archived.
 */

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const DAY_MS = 86_400_000;
const FORMATS: readonly TimePointExportFormat[] = ['md', 'csv', 'json'];
const roots: string[] = [];
const tempDir = async (name: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`));
  roots.push(dir);
  return dir;
};
afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const mutableClock = (start: Date): Clock & { set(date: Date): void } => {
  let current = start;
  return { now: () => new Date(current.getTime()), set: (date) => void (current = date) };
};

function options(dataDir: string, now: Date, extra: Partial<ContainerOptions> = {}) {
  return {
    env: { CONFIG_DIR: join(dataDir, 'no-config') },
    cwd: dataDir,
    dataDir,
    clock: mutableClock(now),
    logger: quiet(),
    source: 'demo',
    ...extra,
  } satisfies ContainerOptions;
}

/** Saves and judges every snapshot of the history (report + summary, like `check`). */
async function judgeHistory(dataDir: string, history: SyntheticHistory): Promise<string[]> {
  const clock = mutableClock(history.timeOf(0));
  const c = await createContainer({ ...options(dataDir, history.timeOf(0)), clock });
  const repository = new FsSnapshotRepository(new FileStore(dataDir));
  const ids: string[] = [];
  for (let i = 0; i < history.count; i += 1) {
    const snapshot = history.at(i);
    await repository.save(snapshot);
    clock.set(history.timeOf(i));
    await check(c);
    ids.push(snapshot.id);
  }
  return ids;
}

const cli = async (dataDir: string, now: Date, ...args: string[]): Promise<number> =>
  runCli(args, options(dataDir, now));

const readSummary = async (dir: string, id: string): Promise<TimePointSummary> =>
  timePointSummarySchema.parse(
    JSON.parse(await readFile(join(dir, `summaries/${id}.json`), 'utf8')),
  );
const readPublished = async (dir: string, id: string): Promise<TimePointSummary> =>
  timePointSummarySchema.parse(
    JSON.parse(await readFile(join(dir, `detail/compare/${id}.json`), 'utf8')),
  );
const readIndex = async (dir: string): Promise<CompareIndex> =>
  compareIndexSchema.parse(
    JSON.parse(await readFile(join(dir, 'detail/compare/index.json'), 'utf8')),
  );

/** `detail/**` as the path -> text record `checkDetailBundle` takes. */
async function detailBundle(dir: string): Promise<Record<string, string>> {
  const entries = await readdir(join(dir, 'detail'), { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile());
  const pairs = await Promise.all(
    files.map(async (e): Promise<[string, string]> => {
      const full = join(e.parentPath, e.name);
      return [`detail/${full.slice(join(dir, 'detail').length + 1)}`, await readFile(full, 'utf8')];
    }),
  );
  return Object.fromEntries(pairs);
}

const exportsOf = (base: TimePointSummary, target: TimePointSummary): string[] => {
  const diff = diffTimePoints(base, target);
  return [JSON.stringify(diff), ...FORMATS.map((f) => timePointDiffExport(diff, f))];
};

const archivedIdsOf = async (dir: string): Promise<string[]> =>
  (await readdir(join(dir, 'archive'), { recursive: true }))
    .filter((f) => f.endsWith('.json.gz'))
    .map((f) => f.slice(f.lastIndexOf('/') + 1, -'.json.gz'.length))
    .sort();

// ─── Weekly history (57 points over 400 days): archived listing, restore, diffs ────────────────

describe('archived points of a 400-day history', () => {
  let history: SyntheticHistory;
  let end: Date;
  let reference: string; // never archived
  let kept: string; // archived, summaries kept
  let lost: string; // archived, summaries of the archived points deleted
  let ids: string[];
  let archived: string[];
  let live: string[];
  let recent: string;
  let referenceDiff: string[];
  let referenceSummary: TimePointSummary;

  beforeAll(async () => {
    history = await createHistory({ days: 400, intervalHours: 168 });
    end = history.timeOf(history.count - 1);
    reference = await tempDir('compare-reference');
    ids = await judgeHistory(reference, history);
    recent = ids.at(-1) ?? '';

    kept = await tempDir('compare-kept');
    await cp(reference, kept, { recursive: true });
    expect(await cli(kept, end, 'archive', '--days', '300')).toBe(0);
    archived = await archivedIdsOf(kept);
    live = ids.filter((id) => !archived.includes(id));
    expect(archived.length).toBeGreaterThan(5);
    expect(live.length).toBeGreaterThan(20);
    // The span really is longer than a year, and the archive holds the oldest points.
    expect(
      history.timeOf(history.count - 1).getTime() - history.timeOf(0).getTime(),
    ).toBeGreaterThan(365 * DAY_MS);
    expect(archived).toEqual(ids.slice(0, archived.length));

    lost = await tempDir('compare-lost');
    await cp(kept, lost, { recursive: true });
    await Promise.all(archived.map((id) => rm(join(lost, `summaries/${id}.json`))));
    // One archived point also lost its report (restored later with `detail --snapshot`).
    await rm(join(lost, `reports/compliance/${archived[0] ?? ''}.json`));

    // The pre-archive diff: the oldest point against the newest, nothing ever archived.
    const oldest = archived[0] ?? '';
    referenceSummary = await readSummary(reference, oldest);
    referenceDiff = exportsOf(referenceSummary, await readSummary(reference, recent));
  });

  it('(1) lists archived points without a summary as archived, newest first, without a file', async () => {
    expect(await cli(lost, end, 'detail')).toBe(0);
    const index = await readIndex(lost);
    expect(index.points.map((p) => p.id)).toEqual([...ids].reverse());
    const states = new Map(index.points.map((p) => [p.id, p.state]));
    expect(live.every((id) => states.get(id) === 'summary')).toBe(true);
    expect(archived.every((id) => states.get(id) === 'archived')).toBe(true);
    const point = index.points.find((p) => p.id === archived[0]);
    expect(point).toEqual({
      id: archived[0],
      collectedAt: null,
      state: 'archived',
      score: null,
      assessed: null,
    });
    const files = await readdir(join(lost, 'detail/compare'));
    expect(files.sort()).toEqual(['index.json', ...live.map((id) => `${id}.json`)].sort());
    // Deterministic: a second build writes the same index.
    const first = await readFile(join(lost, 'detail/compare/index.json'), 'utf8');
    expect(await cli(lost, end, 'detail')).toBe(0);
    expect(await readFile(join(lost, 'detail/compare/index.json'), 'utf8')).toBe(first);
  });

  it('(7) passes the PII / secret bundle check with archived entries', async () => {
    expect(await cli(lost, end, 'detail')).toBe(0);
    const bundle = await detailBundle(lost);
    expect(checkDetailBundle(bundle, { requireDemo: true })).toEqual([]);
    expect(JSON.stringify(bundle)).not.toMatch(/sk-ant-|@(?!example\.)[a-z0-9-]+\.[a-z]/i);
  });

  /** The diff of `id` against the newest point, restored vs never archived, byte for byte. */
  async function expectSameDiff(id: string): Promise<void> {
    const expected = exportsOf(
      await readSummary(reference, id),
      await readSummary(reference, recent),
    );
    expect(await readFile(join(lost, `summaries/${id}.json`), 'utf8')).toBe(
      await readFile(join(reference, `summaries/${id}.json`), 'utf8'),
    );
    expect(exportsOf(await readPublished(lost, id), await readPublished(lost, recent))).toEqual(
      expected,
    );
  }
  const stateOf = async (id: string) =>
    (await readIndex(lost)).points.find((p) => p.id === id)?.state;

  it('(2)(3) restores a point whose report is stored: the next build backfills its summary', async () => {
    const id = archived[1] ?? '';
    expect(await cli(lost, end, 'detail')).toBe(0);
    expect(await stateOf(id)).toBe('archived');
    expect(await cli(lost, end, 'restore', id)).toBe(0);
    expect(await cli(lost, end, 'detail')).toBe(0);
    expect(await stateOf(id)).toBe('summary');
    await expectSameDiff(id);
  });

  it('(2)(3) restores a point without a stored report: build:detail --snapshot makes it comparable', async () => {
    const id = archived[0] ?? '';
    expect(await cli(lost, end, 'restore', id)).toBe(0);
    // Restoring alone is not enough: there is no report to backfill from.
    expect(await cli(lost, end, 'detail')).toBe(0);
    expect(await stateOf(id)).toBe('archived');

    expect(await cli(lost, end, 'detail', '--snapshot', id)).toBe(0);
    const point = (await readIndex(lost)).points.find((p) => p.id === id);
    expect(point).toMatchObject({ id, state: 'summary', score: referenceSummary.score });
    // The summary rebuilt from the restored snapshot is the one the pipeline wrote.
    await expectSameDiff(id);
    // The other archived points stay archived until they are restored too.
    expect(
      (await readIndex(lost)).points.filter((p) => p.state === 'archived').map((p) => p.id),
    ).toEqual(archived.slice(2).reverse());

    // The documented procedure ends with a build of the latest data again: the restored point
    // stays comparable (its summary is persistent) and the published bundle is clean.
    expect(await cli(lost, end, 'detail')).toBe(0);
    expect(await stateOf(id)).toBe('summary');
    await expectSameDiff(id);
    expect(checkDetailBundle(await detailBundle(lost), { requireDemo: true })).toEqual([]);
  });

  it('(4) keeps an archived point comparable when its summary survived', async () => {
    expect(await cli(kept, end, 'detail')).toBe(0);
    const index = await readIndex(kept);
    expect(index.points.every((p) => p.state === 'summary')).toBe(true);
    expect(index.points.map((p) => p.id)).toEqual([...ids].reverse());
    const id = archived[0] ?? '';
    await expect(readdir(join(kept, 'snapshots', id))).rejects.toThrow();
    const published = await readPublished(kept, id);
    expect(published).toEqual(referenceSummary);
    expect(exportsOf(published, await readPublished(kept, recent))).toEqual(referenceDiff);
    expect(checkDetailBundle(await detailBundle(kept), { requireDemo: true })).toEqual([]);
  });
});

// ─── Cap: 133 points, live and archived mixed ──────────────────────────────────────────────────

describe('the 90-point cap with live and archived points', () => {
  it('(5) shares one cap, newest first, live points before older archived ones', async () => {
    const history = await createHistory({ days: 400, intervalHours: 72 });
    const end = history.timeOf(history.count - 1);
    const dir = await tempDir('compare-cap');
    const ids = await judgeHistory(dir, history);
    expect(ids.length).toBeGreaterThan(COMPARE_POINT_LIMIT + 30);
    expect(await cli(dir, end, 'archive', '--days', '200')).toBe(0);
    const archived = await archivedIdsOf(dir);
    const live = ids.filter((id) => !archived.includes(id));
    expect(live.length).toBeLessThan(COMPARE_POINT_LIMIT);
    expect(live.length + archived.length).toBe(ids.length);
    await Promise.all(archived.map((id) => rm(join(dir, `summaries/${id}.json`))));

    expect(await cli(dir, end, 'detail')).toBe(0);
    const index = await readIndex(dir);
    expect(index.points).toHaveLength(COMPARE_POINT_LIMIT);
    expect(index.points.map((p) => p.id)).toEqual([...ids].reverse().slice(0, COMPARE_POINT_LIMIT));
    const stateRun = index.points.map((p) => p.state);
    expect(stateRun.filter((s) => s === 'summary')).toHaveLength(live.length);
    expect(stateRun.slice(0, live.length).every((s) => s === 'summary')).toBe(true);
    expect(stateRun.slice(live.length).every((s) => s === 'archived')).toBe(true);
    // Only the live points have a file; the oldest archived ids are cut by the cap.
    expect((await readdir(join(dir, 'detail/compare'))).length).toBe(live.length + 1);
    expect(checkDetailBundle(await detailBundle(dir), { requireDemo: true })).toEqual([]);
  });
});

// ─── B1 fixture tenant round trip ──────────────────────────────────────────────────────────────

describe('B1 fixture tenant', () => {
  it('(6) archives, restores and compares two real collected points', async () => {
    const fixtureDir = fileURLToPath(TENANT_FIXTURE_URL);
    const dir = await tempDir('compare-fixture');
    const replay = await createFixtureFetch(fixtureDir);
    const later = new Date(FIXTURE_NOW.getTime() + DAY_MS);
    const at = (now: Date) =>
      options(dir, now, {
        env: { ...FIXTURE_ENV, CONFIG_DIR: join(dir, 'no-config') },
        fetchImpl: replay.fetch,
      });
    const firstId = timestampId(FIXTURE_NOW);
    for (const now of [FIXTURE_NOW, later]) {
      const c = await createContainer(at(now));
      await c.state.save(fixtureState(now));
      await collect(c);
      await check(c);
    }
    const secondId = timestampId(later);
    const before = await readSummary(dir, firstId);
    const newest = await readSummary(dir, secondId);
    const expected = exportsOf(before, newest);

    // Archive the first point and lose its summary.
    const archiveTime = new Date(later.getTime() + DAY_MS / 2);
    expect(await runCli(['archive', '--days', '1'], at(archiveTime))).toBe(0);
    expect(await archivedIdsOf(dir)).toEqual([firstId]);
    await rm(join(dir, `summaries/${firstId}.json`));
    expect(await runCli(['detail'], at(archiveTime))).toBe(0);
    expect((await readIndex(dir)).points.map((p) => [p.id, p.state])).toEqual([
      [secondId, 'summary'],
      [firstId, 'archived'],
    ]);

    expect(await runCli(['restore', firstId], at(archiveTime))).toBe(0);
    expect(await runCli(['detail', '--snapshot', firstId], at(archiveTime))).toBe(0);
    expect((await readIndex(dir)).points.map((p) => p.state)).toEqual(['summary', 'summary']);
    expect(
      exportsOf(await readPublished(dir, firstId), await readPublished(dir, secondId)),
    ).toEqual(expected);
    expect(checkDetailBundle(await detailBundle(dir), { requireDemo: true })).toEqual([]);
  });
});

// ─── Golden index shared with the dashboard's component test ───────────────────────────────────

/** The index the Compare page test renders; both sides are pinned to this one file. */
const GOLDEN_INDEX = fileURLToPath(
  new URL(
    '../../../../dashboard/src/pages/__tests__/fixtures/compare-index-archived.json',
    import.meta.url,
  ),
);

describe('golden compare index with archived points', () => {
  it('equals the committed index the dashboard test uses (UPDATE_GOLDEN=1 rewrites it)', async () => {
    const history = await createHistory({ days: 40, intervalHours: 168 });
    const end = history.timeOf(history.count - 1);
    const dir = await tempDir('compare-golden');
    const ids = await judgeHistory(dir, history);
    expect(await cli(dir, end, 'archive', '--days', '20')).toBe(0);
    const archived = await archivedIdsOf(dir);
    expect(archived).toHaveLength(2);
    await Promise.all(archived.map((id) => rm(join(dir, `summaries/${id}.json`))));
    expect(await cli(dir, end, 'detail')).toBe(0);
    const text = await readFile(join(dir, 'detail/compare/index.json'), 'utf8');
    const index = compareIndexSchema.parse(JSON.parse(text));
    expect(index.points.map((p) => [p.id, p.state])).toEqual(
      [...ids].reverse().map((id) => [id, archived.includes(id) ? 'archived' : 'summary']),
    );
    if (process.env['UPDATE_GOLDEN'] === '1') await writeFile(GOLDEN_INDEX, text);
    expect(text).toBe(await readFile(GOLDEN_INDEX, 'utf8'));
  });
});
