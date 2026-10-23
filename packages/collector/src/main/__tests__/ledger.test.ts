import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLedgerEntries, type LedgerEntry } from '@claude-audit/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  HISTORY_BRANCH,
  buildHistoryRepo,
  commitWorkingTree,
  createHistory,
} from '../../__tests__/synthetic-history.js';
import { archiveSnapshots } from '../../adapters/storage/archive.js';
import { FileStore } from '../../adapters/storage/file-store.js';
import { measureRepository } from '../../adapters/storage/git-size.js';
import { FsLedgerRepository, gzipLedgerCodec } from '../../adapters/storage/ledger.js';
import { FsSnapshotRepository } from '../../adapters/storage/repositories.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { createContainer, type Container } from '../container.js';
import { ledgerCommand, ledgerPipelineStep } from '../ledger.js';

// Hundreds of snapshots written, archived and merged: slow under a parallel full run.
vi.setConfig({ testTimeout: 180_000 });

const roots: string[] = [];
const tempDir = async (name: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`));
  roots.push(dir);
  return dir;
};
afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Every file below `root` as relative path -> base64 bytes. */
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

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

async function containerFor(dataDir: string): Promise<Container> {
  return createContainer({
    env: { CONFIG_DIR: join(dataDir, 'no-config') },
    cwd: dataDir,
    dataDir,
    clock: fixedClock(new Date('2025-04-01T00:00:00.000Z')),
    logger: logger(),
    source: 'demo',
  });
}

const ledger = (c: Container, args: string[]) => ledgerCommand.run(c, args);

async function entriesOf(dir: string, month: string, dataset: string): Promise<LedgerEntry[]> {
  const bytes = await readFile(join(dir, 'ledger', month, `${dataset}.jsonl.gz`));
  return parseLedgerEntries(gzipLedgerCodec.decode(bytes), dataset);
}

describe('ledger bootstrap and update on a synthetic history', () => {
  let dir: string;
  let c: Container;
  // 75 days at 6-hour runs: 300 snapshots, the first 150 archived.
  const DAYS = 75;

  beforeAll(async () => {
    dir = await tempDir('ledger-history');
    const history = await createHistory({ days: DAYS, optionalSources: true });
    const repository = new FsSnapshotRepository(new FileStore(dir));
    for (let i = 0; i < history.count; i += 1) await repository.save(history.at(i));
    await archiveSnapshots(new FileStore(dir), history.timeOf(150));
    c = await containerFor(dir);
    await ledger(c, ['bootstrap']);
  });

  it('files every month (the rolling daily rows reach back into December)', async () => {
    expect(await new FsLedgerRepository(c.store).months()).toEqual([
      '2024-12',
      '2025-01',
      '2025-02',
      '2025-03',
    ]);
  });

  it('has zero duplicate keys and a manifest that matches every file', async () => {
    const repository = new FsLedgerRepository(c.store);
    let activities = 0;
    for (const month of await repository.months()) {
      const manifest = await repository.manifest(month);
      expect(manifest?.sealed).toBe(false);
      for (const [dataset, meta] of Object.entries(manifest?.datasets ?? {})) {
        const entries = await entriesOf(dir, month, dataset);
        expect(new Set(entries.map((e) => e.key)).size, `${month}/${dataset}`).toBe(entries.length);
        expect(meta.count).toBe(entries.length);
        expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
        if (dataset === 'activities') activities += entries.length;
      }
    }
    // Three new activities per snapshot, each recorded once whether archived or stored.
    expect(activities).toBe(300 * 3);
  });

  it('records a state version only when the content changes', async () => {
    // members change every 28 snapshots (weekly): January opens on the 1st and changes 4 times.
    const members = await entriesOf(dir, '2025-01', 'members');
    expect(members.map((e) => e.validFrom?.slice(0, 10))).toEqual([
      '2025-01-01',
      '2025-01-08',
      '2025-01-15',
      '2025-01-22',
      '2025-01-29',
    ]);
    // organizations never change: one opening version per month.
    expect(await entriesOf(dir, '2025-02', 'organizations')).toHaveLength(1);
  });

  it('keeps one row per day and breakdown with the newest value', async () => {
    const usage = await entriesOf(dir, '2025-01', 'usage');
    const days = new Set(usage.map((e) => (e.item as { date: string }).date));
    expect(days.size).toBe(31);
  });

  it('is idempotent: bootstrap and update leave the ledger byte-identical', async () => {
    const before = await readTree(join(dir, 'ledger'));
    await ledger(c, ['bootstrap']);
    await ledger(c, ['update']);
    await ledger(c, ['update']);
    expect(await readTree(join(dir, 'ledger'))).toEqual(before);
  });

  it('never rewrites a sealed month', async () => {
    const path = join(dir, 'ledger', '2025-01', 'MANIFEST.json');
    const sealed = { ...JSON.parse(await readFile(path, 'utf8')), sealed: true };
    await writeFile(path, `${JSON.stringify(sealed, null, 2)}\n`);
    const before = await readTree(join(dir, 'ledger', '2025-01'));
    await ledger(c, ['bootstrap']);
    expect(await readTree(join(dir, 'ledger', '2025-01'))).toEqual(before);
    expect(c.logger.warn).toHaveBeenCalledWith(expect.stringContaining('2025-01'));
  });

  it('stops on an unreadable file without overwriting it; the pipeline step only warns', async () => {
    const path = join(dir, 'ledger', '2025-03', 'usage.jsonl.gz');
    await writeFile(path, 'not gzip');
    await expect(ledger(c, ['update'])).rejects.toThrow(/Unreadable ledger file/);
    await ledgerPipelineStep.run(c);
    expect(c.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Ledger update failed'));
    expect(await readFile(path, 'utf8')).toBe('not gzip');
  });

  it('rejects malformed arguments', async () => {
    await expect(ledger(c, [])).rejects.toThrow(/Usage: ledger/);
    await expect(ledger(c, ['update', '--snapshot'])).rejects.toThrow(/requires a value/);
    await expect(ledger(c, ['update', '--snapshot', '2020-01-01T00-00-00Z'])).rejects.toThrow(
      /Snapshot not found/,
    );
  });
});

describe('ledger update', () => {
  it('starts an empty ledger with the latest snapshot and catches up missed runs', async () => {
    const dir = await tempDir('ledger-update');
    const history = await createHistory({ days: 3 });
    const repository = new FsSnapshotRepository(new FileStore(dir));
    for (let i = 0; i < 4; i += 1) await repository.save(history.at(i));
    const c = await containerFor(dir);
    await ledger(c, ['update']);
    const first = await entriesOf(dir, '2025-01', 'activities');
    expect(first).toHaveLength(3);
    // Two runs whose ledger step did not happen: the next update records both.
    for (let i = 4; i < 7; i += 1) await repository.save(history.at(i));
    await ledger(c, ['update']);
    expect(await entriesOf(dir, '2025-01', 'activities')).toHaveLength(12);
  });
});

describe('pnpm size counts the ledger', () => {
  it('reports the ledger blobs, which are part of the reachable size', async () => {
    const dir = await tempDir('ledger-size');
    await buildHistoryRepo(dir, await createHistory({ days: 4 }), { checkout: true });
    const without = await measureRepository(dir, { ref: HISTORY_BRANCH });
    expect(without.ledger).toEqual({ blobs: 0, bytes: 0 });
    await ledger(await containerFor(join(dir, 'data')), ['bootstrap']);
    commitWorkingTree(dir, 'chore: ledger', new Date('2025-01-05T00:00:00.000Z'));
    const withLedger = await measureRepository(dir, { ref: HISTORY_BRANCH });
    expect(withLedger.ledger.blobs).toBeGreaterThan(0);
    expect(withLedger.reachableBytes).toBeGreaterThan(without.reachableBytes);
    expect(withLedger.datasets.map((d) => d.dataset)).not.toContain('ledger/');
  });
});
