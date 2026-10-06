import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_DATASET_NAMES, OPTIONAL_DATASET_NAMES } from '@claude-audit/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TENANT_FIXTURE_URL } from '../../__tests__/fixture-sets.js';
import {
  CHANGE_PERIOD,
  HISTORY_BRANCH,
  buildHistoryRepo,
  createHistory,
} from '../../__tests__/synthetic-history.js';
import {
  FIXTURE_ENV,
  FIXTURE_NOW,
  createFixtureFetch,
  fixtureState,
} from '../../adapters/fixture/fixture-source.js';
import {
  FIXTURE_CONSOLE_KEY,
  optionalFixturesRoot,
  withOptionalFixtures,
} from '../../adapters/fixture/optional-fixture.js';
import { archiveSnapshots, restoreArchive } from '../../adapters/storage/archive.js';
import { FileStore } from '../../adapters/storage/file-store.js';
import { measureRepository } from '../../adapters/storage/git-size.js';
import { FsSnapshotRepository } from '../../adapters/storage/repositories.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { createContainer } from '../container.js';
import { check, collect } from '../workflows.js';

// Real git repositories and long histories: slow under a parallel full run.
vi.setConfig({ testTimeout: 120_000 });

const fixtureDir = fileURLToPath(TENANT_FIXTURE_URL);
const roots: string[] = [];
const tempDir = async (name: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`));
  roots.push(dir);
  return dir;
};
afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function readTree(root: string): Promise<Map<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const pairs = await Promise.all(
    entries
      .filter((e) => e.isFile())
      .map(async (e): Promise<[string, string]> => {
        const full = join(e.parentPath, e.name);
        return [full.slice(root.length + 1), (await readFile(full)).toString('base64')];
      }),
  );
  return new Map(pairs.sort(([a], [b]) => a.localeCompare(b)));
}

const AFTER = new Date(FIXTURE_NOW.getTime() + 86_400_000);

/** The B1 tenant plus the optional fixtures, every optional source on, collected into `dataDir`. */
async function collectWithOptionalSources(dataDir: string): Promise<string> {
  const replay = await withOptionalFixtures(
    await createFixtureFetch(fixtureDir),
    optionalFixturesRoot(fixtureDir),
  );
  const c = await createContainer({
    env: {
      ...FIXTURE_ENV,
      ANTHROPIC_CONSOLE_ADMIN_API_KEY: FIXTURE_CONSOLE_KEY,
      CONFIG_DIR: join(dataDir, 'no-config'),
    },
    cwd: dataDir,
    dataDir,
    clock: fixedClock(FIXTURE_NOW),
    fetchImpl: replay.fetch,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    source: 'demo',
    configPatch: (config) => ({
      ...config,
      sources: {
        ...config.sources,
        console: { enabled: true, lookbackDays: 30 },
        claudeCode: { enabled: true, lookbackDays: 1 },
        featureUsage: { enabled: true, lookbackDays: 30 },
      },
    }),
  });
  await c.state.save(fixtureState(FIXTURE_NOW));
  const snapshot = await collect(c);
  await check(c);
  return snapshot.id;
}

describe('B3 archive and restore with the optional datasets', () => {
  it('archives and restores a tenant snapshot byte-identically, optional datasets included', async () => {
    const dir = await tempDir('optional-restore');
    const id = await collectWithOptionalSources(dir);
    const original = await readTree(join(dir, 'snapshots', id));
    const files = [...original.keys()];
    for (const name of OPTIONAL_DATASET_NAMES) expect(files, name).toContain(`${name}.json`);
    expect(files.filter((f) => f !== 'manifest.json')).toHaveLength(ALL_DATASET_NAMES.length);

    const store = new FileStore(dir);
    expect(await archiveSnapshots(store, AFTER)).toEqual([id]);
    await expect(readdir(join(dir, 'snapshots'))).resolves.toEqual([]);
    expect(await restoreArchive(store, store, id)).toEqual({ restored: [id], skipped: [] });
    expect(await readTree(join(dir, 'snapshots', id))).toEqual(original);

    const restored = await new FsSnapshotRepository(store).latest();
    expect(restored?.data.claudeCodeActivity).toHaveLength(4);
    expect(restored?.coverage.consoleCost?.status).toBe('ok');
  });

  it('round-trips a synthetic history that carries the optional datasets', async () => {
    const dir = await tempDir('optional-synthetic');
    const history = await createHistory({ days: 10, optionalSources: true });
    const store = new FileStore(dir);
    const repository = new FsSnapshotRepository(store);
    const originals = new Map<string, Map<string, string>>();
    for (let i = 0; i < history.count; i += 1) {
      const snapshot = history.at(i);
      expect(Object.keys(snapshot.data).sort()).toEqual([...ALL_DATASET_NAMES].sort());
      await repository.save(snapshot);
      originals.set(snapshot.id, await readTree(join(dir, 'snapshots', snapshot.id)));
    }
    const archived = await archiveSnapshots(store, history.timeOf(history.count - 4));
    expect(archived).toHaveLength(history.count - 4);
    const out = await tempDir('optional-restore-out');
    await restoreArchive(store, new FileStore(out), '2025');
    for (const id of archived)
      expect(await readTree(join(out, 'snapshots', id)), id).toEqual(originals.get(id));
  });

  it('keeps the default history on the 13 built-in datasets', async () => {
    const history = await createHistory({ days: 2 });
    expect(Object.keys(history.at(0).data)).toHaveLength(13);
  });
});

describe('B3 size measurement counts the optional datasets', () => {
  const DAYS = 60;
  let repo: string;
  let count: number;
  beforeAll(async () => {
    repo = await tempDir('optional-size');
    const history = await createHistory({ days: DAYS, optionalSources: true });
    count = history.count;
    await buildHistoryRepo(repo, history);
  }, 120_000);

  it('reports blobs per optional dataset and deduplicates unchanged ones', async () => {
    const m = await measureRepository(repo, { ref: HISTORY_BRANCH });
    const blobs = (name: string) => m.datasets.find((d) => d.dataset === name)?.blobs;
    for (const name of OPTIONAL_DATASET_NAMES) expect(blobs(name), name).toBeGreaterThan(0);
    const epochs = (name: keyof typeof CHANGE_PERIOD) =>
      Math.floor((count - 1) / CHANGE_PERIOD[name]) + 1;
    expect(blobs('consoleWorkspaces')).toBe(epochs('consoleWorkspaces'));
    expect(blobs('consoleApiKeys')).toBe(epochs('consoleApiKeys'));
    // Rolling daily reports: one new blob per day, not per snapshot.
    for (const name of ['consoleUsage', 'consoleCost', 'claudeCodeActivity'])
      expect(blobs(name), name).toBe(DAYS);
    expect(m.datasets).toHaveLength(ALL_DATASET_NAMES.length);
    expect(m.snapshots).toBe(count);
  });

  it('measures more than the built-in history alone', async () => {
    const plain = await tempDir('optional-size-plain');
    await buildHistoryRepo(plain, await createHistory({ days: DAYS }));
    const withOptional = await measureRepository(repo, { ref: HISTORY_BRANCH });
    const without = await measureRepository(plain, { ref: HISTORY_BRANCH });
    expect(withOptional.reachableBytes).toBeGreaterThan(without.reachableBytes);
    expect(without.datasets).toHaveLength(13);
  });
});
