import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, judgeCapacity } from '@claude-audit/core';
import { detailArchiveSchema } from '@claude-audit/core/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../infrastructure/runtime.js';
import { createContainer } from '../container.js';
import { writeDetail } from '../detail.js';
import {
  CHANGE_PERIOD,
  HISTORY_BRANCH,
  HISTORY_START,
  buildHistoryRepo,
  commitWorkingTree,
  createHistory,
  git,
} from '../../__tests__/synthetic-history.js';
import { archiveSnapshots } from '../../adapters/storage/archive.js';
import { FileStore } from '../../adapters/storage/file-store.js';
import {
  archiveEntriesFromTree,
  measureRepository,
  type GitRunner,
} from '../../adapters/storage/git-size.js';
import { summarizeArchive } from '../../adapters/storage/archive-inventory.js';

// Real git repositories and long histories: slow under a parallel full run.
vi.setConfig({ testTimeout: 120_000 });

const MIB = 1024 ** 2;
const DAYS_LONG = 400;
const roots: string[] = [];
const tempDir = async (name: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`));
  roots.push(dir);
  return dir;
};
afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

const blobsOf = (m: { datasets: { dataset: string; blobs: number }[] }, name: string): number =>
  m.datasets.find((d) => d.dataset === name)?.blobs ?? 0;

describe('synthetic long history (400 days x 6 hours)', () => {
  let dir: string;
  let count: number;
  beforeAll(async () => {
    dir = await tempDir('long-history');
    const history = await createHistory({ days: DAYS_LONG });
    count = history.count;
    await buildHistoryRepo(dir, history);
  }, 180_000);

  it('records one commit per snapshot at the snapshot time (fixed clock)', async () => {
    expect(count).toBe(DAYS_LONG * 4);
    const m = await measureRepository(dir, { ref: HISTORY_BRANCH });
    expect(m.commits).toBe(count);
    expect(m.snapshots).toBe(count);
    expect(m.firstCommitAt).toBe(HISTORY_START.toISOString());
    expect(m.lastCommitAt).toBe(addDays(HISTORY_START, DAYS_LONG - 0.25).toISOString());
  });

  it('deduplicates: a dataset adds blobs only when its content changes', async () => {
    const m = await measureRepository(dir, { ref: HISTORY_BRANCH });
    const epochs = (name: keyof typeof CHANGE_PERIOD) =>
      Math.floor((count - 1) / CHANGE_PERIOD[name]) + 1;
    // Never changes: one blob for 1600 snapshots.
    expect(blobsOf(m, 'organizations')).toBe(1);
    // Changes at a fixed period: one blob per epoch.
    for (const name of ['settings', 'groups', 'credentials', 'credentialUsage', 'members'] as const)
      expect(blobsOf(m, name), name).toBe(epochs(name));
    // New content in every snapshot.
    expect(blobsOf(m, 'activities')).toBe(count);
    // Daily datasets: far fewer blobs than snapshots.
    expect(blobsOf(m, 'usage')).toBe(DAYS_LONG);
    const stored = m.datasets.reduce((sum, d) => sum + d.blobs, 0);
    expect(stored).toBeLessThan(0.5 * count * 13);
  });

  it('is deterministic: the same history gives the same commit ids', async () => {
    const small = await createHistory({ days: 5 });
    const a = await tempDir('det-a');
    const b = await tempDir('det-b');
    await buildHistoryRepo(a, small);
    await buildHistoryRepo(b, await createHistory({ days: 5 }));
    expect(git(a, ['rev-parse', HISTORY_BRANCH])).toBe(git(b, ['rev-parse', HISTORY_BRANCH]));
  });

  it('reports sizes, a window growth and a projected growth for a long history', async () => {
    const m = await measureRepository(dir, { ref: HISTORY_BRANCH, windowDays: 30 });
    expect(m.reachableBytes).toBeGreaterThan(m.windowGrowthBytes ?? Infinity);
    expect(m.windowGrowthBytes).toBeGreaterThan(0);
    // Keeps docs/CHANGE-PLAN.md section 9.4 (about 10 MiB for 400 days) honest.
    expect(m.reachableBytes).toBeGreaterThan(5 * MIB);
    expect(m.reachableBytes).toBeLessThan(20 * MIB);
    expect(m.objects.packedObjects).toBeGreaterThan(0);
    const all = await measureRepository(dir);
    expect(all.reachableBytes).toBe(m.reachableBytes);
    const short = await measureRepository(dir, { ref: HISTORY_BRANCH, windowDays: 1000 });
    expect(short.windowGrowthBytes).toBeNull();
  });

  it('judges thresholds on the measurement: triggers above, stays quiet below', async () => {
    const m = await measureRepository(dir, { ref: HISTORY_BRANCH });
    const totalMiB = m.reachableBytes / MIB;
    const base = { maxMonthlyGrowthMiB: 0, warnRatio: 0.8 };
    expect(judgeCapacity(m, { ...base, maxTotalMiB: totalMiB * 2 }).status).toBe('ok');
    expect(judgeCapacity(m, { ...base, maxTotalMiB: totalMiB * 1.1 }).status).toBe('warning');
    expect(judgeCapacity(m, { ...base, maxTotalMiB: totalMiB * 0.9 }).status).toBe('exceeded');
    const growthMiB = (judgeCapacity(m, { ...base, maxTotalMiB: 0 }).monthlyGrowthBytes ?? 0) / MIB;
    expect(growthMiB).toBeGreaterThan(0);
    const t = { maxTotalMiB: 0, warnRatio: 0.8 };
    expect(judgeCapacity(m, { ...t, maxMonthlyGrowthMiB: growthMiB * 2 }).status).toBe('ok');
    expect(judgeCapacity(m, { ...t, maxMonthlyGrowthMiB: growthMiB * 0.5 }).status).toBe(
      'exceeded',
    );
  });
});

describe('dedup of a repeated snapshot', () => {
  it('adds no dataset blob when a snapshot repeats unchanged datasets', async () => {
    const copy = await tempDir('repeat');
    await buildHistoryRepo(copy, await createHistory({ days: 30 }), { checkout: true });
    const before = await measureRepository(copy, { ref: HISTORY_BRANCH });
    const lastId = (await readdir(join(copy, 'data/snapshots'))).sort().at(-1) ?? '';
    const newId = '2030-01-01T00-00-00Z';
    // Same dataset files under a new id; only the manifest (id, time) is new content.
    await cp(join(copy, 'data/snapshots', lastId), join(copy, 'data/snapshots', newId), {
      recursive: true,
    });
    const manifest = join(copy, 'data/snapshots', newId, 'manifest.json');
    await writeFile(
      manifest,
      (await readFile(manifest, 'utf8'))
        .replaceAll(lastId, newId)
        .replace(/"collectedAt": ".*"/, '"collectedAt": "2030-01-01T00:00:00.000Z"'),
    );
    commitWorkingTree(copy, 'chore: audit data repeat', new Date('2030-01-01T00:00:00Z'));
    const after = await measureRepository(copy, { ref: HISTORY_BRANCH });
    expect(after.commits).toBe(before.commits + 1);
    expect(after.snapshots).toBe(before.snapshots + 1);
    for (const d of before.datasets) expect(blobsOf(after, d.dataset), d.dataset).toBe(d.blobs);
  }, 60_000);
});

describe('archive and the history size', () => {
  const DAYS = 120;
  let dir: string;
  let end: Date;
  beforeAll(async () => {
    dir = await tempDir('archive-history');
    const history = await createHistory({ days: DAYS });
    end = history.timeOf(history.count - 1);
    await buildHistoryRepo(dir, history, { checkout: true });
  }, 120_000);

  const treeBytes = async (root: string): Promise<number> => {
    const names = await readdir(root, { recursive: true, withFileTypes: true });
    const sizes = await Promise.all(
      names
        .filter((e) => e.isFile())
        .map(async (e) => (await stat(join(e.parentPath, e.name))).size),
    );
    return sizes.reduce((a, b) => a + b, 0);
  };

  it('shrinks the working tree but never the history', async () => {
    const before = await measureRepository(dir, { ref: HISTORY_BRANCH });
    const treeBefore = await treeBytes(join(dir, 'data'));
    const store = new FileStore(join(dir, 'data'));
    const archived = await archiveSnapshots(store, addDays(end, -60));
    expect(archived.length).toBeGreaterThan(200);
    commitWorkingTree(dir, 'chore: archive', addDays(end, 0.25));
    const after = await measureRepository(dir, { ref: HISTORY_BRANCH });
    // The archived directories are gone from the tree, and gzip makes the files smaller ...
    expect(await treeBytes(join(dir, 'data'))).toBeLessThan(treeBefore);
    // ... but every old blob is still reachable and the .json.gz blobs were added.
    expect(after.reachableBytes).toBeGreaterThan(before.reachableBytes);
    expect(after.commits).toBe(before.commits + 1);
    for (const d of before.datasets) expect(blobsOf(after, d.dataset)).toBe(d.blobs);
    expect(after.archive.snapshots).toBe(archived.length);
    expect(after.archive.bytes).toBeGreaterThan(0);
  });

  it('measures the same archive the dashboard inventory (B2-11) displays', async () => {
    const measured = await measureRepository(dir, { ref: HISTORY_BRANCH });
    const dataDir = join(dir, 'data');
    const listed = await summarizeArchive(new FileStore(dataDir));
    expect(measured.archiveSummary).toEqual(listed);
    expect(measured.archive).toEqual({
      snapshots: listed.totals.snapshots,
      bytes: listed.totals.bytes,
      years: listed.totals.years,
    });
    // The published file (detail/archive.json) shows exactly those figures.
    const c = await createContainer({
      env: { CONFIG_DIR: join(dir, 'no-config') },
      cwd: dir,
      dataDir,
      clock: fixedClock(end),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const files = await writeDetail(c);
    const published = detailArchiveSchema.parse(JSON.parse(files['detail/archive.json'] ?? ''));
    expect(published.years).toEqual(listed.years);
    expect(published.totals).toEqual(listed.totals);
    expect(published.totals.snapshots).toBe(measured.archive.snapshots);
  });
});

describe('measureRepository (inputs and errors)', () => {
  it('rejects a ref or data prefix that could be an option or a path trick', async () => {
    const dir = await tempDir('inputs');
    await expect(measureRepository(dir, { ref: '--output=/x' })).rejects.toThrow(/Invalid ref/);
    await expect(measureRepository(dir, { ref: 'a b' })).rejects.toThrow(/Invalid ref/);
    await expect(measureRepository(dir, { dataPrefix: '../x' })).rejects.toThrow(/prefix/);
  });

  it('fails for a directory that is not a repository', async () => {
    const dir = await tempDir('not-a-repo');
    await expect(measureRepository(dir, { ref: 'data/audit' })).rejects.toThrow(/git/);
  });

  it('measures an empty repository (no commits) as zero', async () => {
    const dir = await tempDir('empty');
    git(dir, ['init', '-q', '-b', HISTORY_BRANCH]);
    const m = await measureRepository(dir);
    expect(m).toMatchObject({ commits: 0, reachableBytes: 0, windowGrowthBytes: null });
    expect(m.archive).toEqual({ snapshots: 0, bytes: 0, years: 0 });
  });

  it('uses the injected git runner and parses the tip tree listing', async () => {
    const calls: string[] = [];
    const fake: GitRunner = async (_cwd, args) => {
      calls.push(args[0] ?? '');
      if (args[0] === 'count-objects')
        return 'count: 0\nsize: 0\nin-pack: 5\npacks: 1\nsize-pack: 4\n';
      if (args[0] === 'log') return 'a1 1700000000\n';
      if (args[0] === 'rev-list') return args.includes('--disk-usage') ? '4096\n' : '';
      return '';
    };
    const m = await measureRepository('/unused', { git: fake });
    expect(m).toMatchObject({ commits: 1, reachableBytes: 4096, windowGrowthBytes: null });
    expect(m.objects.packBytes).toBe(4096);
    expect(calls).toContain('ls-tree');
  });

  it('turns a tree listing into inventory entries, ignoring what is not a year file', () => {
    const rec = (size: number, path: string) =>
      `100644 blob abc ${String(size).padStart(7)}\t${path}`;
    const listing = [
      rec(10, 'data/archive/2025/2025-01-01T06-00-00Z.json.gz'),
      rec(7, 'data/archive/stray.json.gz'),
      rec(3, 'data/archive/2025/nested/x.json.gz'),
      rec(9, 'data/snapshots/x/manifest.json'),
    ].join('\0');
    expect(archiveEntriesFromTree(listing, 'data')).toEqual([
      { dir: '2025', name: '2025-01-01T06-00-00Z.json.gz', bytes: 10 },
      { dir: '', name: 'stray.json.gz', bytes: 7 },
      { dir: '', name: '2025/nested/x.json.gz', bytes: -1 },
    ]);
  });
});
