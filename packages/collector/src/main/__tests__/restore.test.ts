import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASET_NAMES, timestampId } from '@claude-audit/core';
import { checkDetailBundle, dashboardViewSchema } from '@claude-audit/core/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { TENANT_FIXTURE_URL } from '../../__tests__/fixture-sets.js';
import { createHistory } from '../../__tests__/synthetic-history.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { runCli } from '../cli.js';
import { createContainer, type ContainerOptions } from '../container.js';
import { check, collect } from '../workflows.js';
import {
  FIXTURE_ENV,
  FIXTURE_NOW,
  createFixtureFetch,
  fixtureState,
} from '../../adapters/fixture/fixture-source.js';
import { archiveSnapshots, restoreArchive } from '../../adapters/storage/archive.js';
import { FileStore } from '../../adapters/storage/file-store.js';
import { FsSnapshotRepository } from '../../adapters/storage/repositories.js';

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

/** Every file below `root` as relative path -> bytes. */
async function readTree(root: string): Promise<Map<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile());
  const pairs = await Promise.all(
    files.map(async (e): Promise<[string, string]> => {
      const full = join(e.parentPath, e.name);
      return [
        full.slice(root.length + 1).replaceAll('\\', '/'),
        (await readFile(full)).toString('base64'),
      ];
    }),
  );
  return new Map(pairs.sort(([a], [b]) => a.localeCompare(b)));
}

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

async function fixtureOptions(dataDir: string): Promise<ContainerOptions> {
  const replay = await createFixtureFetch(fixtureDir);
  return {
    env: { ...FIXTURE_ENV, CONFIG_DIR: join(dataDir, 'no-config') },
    cwd: dataDir,
    dataDir,
    clock: fixedClock(FIXTURE_NOW),
    fetchImpl: replay.fetch,
    logger: logger(),
    source: 'demo',
  };
}

/** The B1 fixture tenant collected and checked into `dataDir` (all datasets). */
async function collectFixture(dataDir: string): Promise<string> {
  const c = await createContainer(await fixtureOptions(dataDir));
  await c.state.save(fixtureState(FIXTURE_NOW));
  const snapshot = await collect(c);
  await check(c);
  return snapshot.id;
}

const AFTER = new Date(FIXTURE_NOW.getTime() + 86_400_000);

describe('archive -> restore round trip', () => {
  it('restores the B1 fixture tenant snapshot byte-identically, for every dataset', async () => {
    const dir = await tempDir('restore-fixture');
    const id = await collectFixture(dir);
    const original = await readTree(join(dir, 'snapshots', id));
    const datasets = [...original.keys()].filter((f) => f !== 'manifest.json');
    // The fixture tenant yields every dataset (the 12 collected ones plus the projection).
    expect(datasets.length).toBe(DATASET_NAMES.length);

    const store = new FileStore(dir);
    expect(await archiveSnapshots(store, AFTER)).toEqual([id]);
    await expect(readdir(join(dir, 'snapshots'))).resolves.toEqual([]);

    expect(await restoreArchive(store, store, id)).toEqual({ restored: [id], skipped: [] });
    expect(await readTree(join(dir, 'snapshots', id))).toEqual(original);
  });

  it('restores a year and a single id from the synthetic history, to another directory', async () => {
    const dir = await tempDir('restore-synthetic');
    const history = await createHistory({ days: 10 });
    const store = new FileStore(dir);
    const repository = new FsSnapshotRepository(store);
    const originals = new Map<string, Map<string, string>>();
    for (let i = 0; i < history.count; i += 1) {
      const snapshot = history.at(i);
      await repository.save(snapshot);
      originals.set(snapshot.id, await readTree(join(dir, 'snapshots', snapshot.id)));
    }
    const cutoff = history.timeOf(history.count - 4);
    const archived = await archiveSnapshots(store, cutoff);
    expect(archived.length).toBe(history.count - 4);
    expect(archived.every((id) => id < timestampId(cutoff))).toBe(true);

    const out = await tempDir('restore-out');
    const target = new FileStore(out);
    const [first] = archived;
    expect(await restoreArchive(store, target, first ?? '')).toMatchObject({ restored: [first] });
    const result = await restoreArchive(store, target, '2025');
    expect(result.skipped).toEqual([first]);
    expect(result.restored).toHaveLength(archived.length - 1);
    for (const id of archived) {
      expect(await readTree(join(out, 'snapshots', id)), id).toEqual(originals.get(id));
    }
    // The archive itself is untouched by a restore.
    expect((await readdir(join(dir, 'archive/2025'))).length).toBe(archived.length);
  });

  it('refuses a malformed selector, a missing archive and a corrupt or mismatched file', async () => {
    const dir = await tempDir('restore-errors');
    const store = new FileStore(dir);
    await expect(restoreArchive(store, store, '../etc')).rejects.toThrow(/snapshot id.*or a year/);
    await expect(restoreArchive(store, store, '2024')).rejects.toThrow(/No archived snapshots/);
    const id = '2024-05-01T06-00-00Z';
    await expect(restoreArchive(store, store, id)).rejects.toThrow(/not found/);
    await store.write(`archive/2024/${id}.json.gz`, 'not gzip');
    await expect(restoreArchive(store, store, id)).rejects.toThrow();
    const valid = { schemaVersion: 2, collectedAt: 'x', coverage: {}, data: {} };
    await store.write(
      `archive/2024/${id}.json.gz`,
      gzipSync(JSON.stringify({ ...valid, id: '2024-05-02T06-00-00Z' })),
    );
    await expect(restoreArchive(store, store, id)).rejects.toThrow(/not a valid snapshot archive/);
    await store.write(`archive/2024/${id}.json.gz`, gzipSync(JSON.stringify({ id })));
    await expect(restoreArchive(store, store, id)).rejects.toThrow(/not a valid snapshot archive/);
    await expect(readdir(join(dir, 'snapshots'))).rejects.toThrow();
  });
});

describe('restore and build:data targeting a snapshot', () => {
  let dir: string;
  let id: string;
  let baseline: { dashboard: string; detail: Map<string, string> };

  const options = async (dataDir: string) => ({ ...(await fixtureOptions(dataDir)) });
  const detailFiles = async (root: string) => {
    const tree = await readTree(join(root, 'detail'));
    return new Map([...tree].map(([name, content]) => [`detail/${name}`, content]));
  };

  beforeAll(async () => {
    dir = await tempDir('restore-regenerate');
    id = await collectFixture(dir);
    expect(await runCli(['dashboard', '--snapshot', id], await options(dir))).toBe(0);
    expect(await runCli(['detail', '--snapshot', id], await options(dir))).toBe(0);
    baseline = {
      dashboard: await readFile(join(dir, 'dashboard.json'), 'utf8'),
      detail: await detailFiles(dir),
    };
  }, 60_000);

  it('regenerates dashboard.json and the detail files from a restored snapshot', async () => {
    const store = new FileStore(dir);
    await archiveSnapshots(store, AFTER);
    await rm(join(dir, 'dashboard.json'));
    await rm(join(dir, 'detail'), { recursive: true });
    // `latest` finds nothing now: the snapshot only exists in the archive.
    expect(await new FsSnapshotRepository(store).latest()).toBeNull();

    expect(await runCli(['restore', id], await options(dir))).toBe(0);
    expect(await runCli(['dashboard', '--snapshot', id], await options(dir))).toBe(0);
    expect(await runCli(['detail', '--snapshot', id], await options(dir))).toBe(0);

    const dashboard = await readFile(join(dir, 'dashboard.json'), 'utf8');
    expect(dashboardViewSchema.parse(JSON.parse(dashboard)).coverage.length).toBeGreaterThan(10);
    expect(dashboard).toBe(baseline.dashboard);
    const detail = await detailFiles(dir);
    const decoded = Object.fromEntries(
      [...detail].map(([name, content]) => [name, Buffer.from(content, 'base64').toString('utf8')]),
    );
    expect(checkDetailBundle(decoded, { requireDemo: true })).toEqual([]);
    // Everything that comes from the snapshot is identical; only the archive inventory (which
    // now lists the archived snapshot) and the manifest that points to it may differ.
    for (const [name, content] of baseline.detail) {
      if (name === 'detail/archive.json' || name === 'detail/index.json') continue;
      expect(detail.get(name), name).toBe(content);
    }
  });

  it('builds from a snapshot restored into another directory without a stored report', async () => {
    const out = await tempDir('restore-fresh');
    expect(await runCli(['restore', id, '--out', out], await options(dir))).toBe(0);
    // The restored directory has no reports/compliance: the rules are evaluated in memory.
    const fresh = await options(out);
    expect(await runCli(['dashboard', '--snapshot', id], fresh)).toBe(0);
    expect(await readFile(join(out, 'dashboard.json'), 'utf8')).toBe(baseline.dashboard);
    await expect(readdir(join(out, 'reports'))).rejects.toThrow();
  });

  it('reports a snapshot that is not stored, and an invalid id, as errors', async () => {
    const out = await tempDir('restore-missing');
    const opts = await options(out);
    expect(await runCli(['dashboard', '--snapshot', '2020-01-01T00-00-00Z'], opts)).toBe(1);
    expect(opts.logger?.error).toHaveBeenCalledWith(expect.stringContaining('restore it first'));
    expect(await runCli(['detail', '--snapshot', '../x'], opts)).toBe(1);
    expect(await runCli(['dashboard', '--snapshot'], opts)).toBe(1);
    expect(await runCli(['restore'], opts)).toBe(1);
    expect(await runCli(['restore', '2020'], opts)).toBe(1);
  });
});
