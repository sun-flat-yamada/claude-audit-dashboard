import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { AuditSnapshot } from '@claude-audit/core';
import { initialState } from '@claude-audit/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveSnapshots } from '../archive.js';
import { FileStore, stableStringify } from '../file-store.js';
import {
  FsComplianceReportRepository,
  FsSnapshotRepository,
  FsStateRepository,
} from '../repositories.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'store-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const snapshot = (id: string, collectedAt: string): AuditSnapshot => ({
  schemaVersion: 2,
  id,
  collectedAt,
  coverage: {
    members: { status: 'ok', count: 2 },
    usage: { status: 'unavailable', reason: 'no key' },
  },
  data: {
    members: [
      {
        id: 'b',
        email: 'b@example.com',
        name: 'B',
        role: 'user',
        organizationId: null,
        joinedAt: null,
      },
      {
        id: 'a',
        email: 'a@example.com',
        name: 'A',
        role: 'owner',
        organizationId: null,
        joinedAt: null,
      },
    ],
  },
});

describe('FileStore', () => {
  it('serializes deterministically regardless of key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      stableStringify({ a: { c: [3, { e: 0, f: 1 }], d: 2 }, b: 1 }),
    );
    expect(stableStringify({ z: 1 }).endsWith('}\n')).toBe(true);
  });

  it('rejects paths outside the data directory and returns null / [] for missing entries', async () => {
    const store = new FileStore(dir);
    await expect(store.write('../evil.json', 'x')).rejects.toThrow(/escapes/);
    expect(await store.readJson('missing.json')).toBeNull();
    expect(await store.list('missing')).toEqual([]);
  });
});

describe('FsSnapshotRepository', () => {
  it('stores one file per dataset in a stable order plus a manifest', async () => {
    const store = new FileStore(dir);
    const repo = new FsSnapshotRepository(store);
    await repo.save(snapshot('2026-09-30T06-00-00Z', '2026-09-30T06:00:00.000Z'));
    const members = await readFile(
      join(dir, 'snapshots/2026-09-30T06-00-00Z/members.json'),
      'utf8',
    );
    expect(JSON.parse(members).map((m: { id: string }) => m.id)).toEqual(['a', 'b']);
    const loaded = await repo.latest();
    expect(loaded?.coverage.usage).toEqual({ status: 'unavailable', reason: 'no key' });
    expect(loaded?.data.members).toHaveLength(2);
    expect(loaded?.data.usage).toBeUndefined();
  });

  it('ignores interrupted snapshots and legacy v1 files, and filters by time', async () => {
    const store = new FileStore(dir);
    const repo = new FsSnapshotRepository(store);
    await repo.save(snapshot('2026-09-29T00-00-00Z', '2026-09-29T00:00:00.000Z'));
    await repo.save(snapshot('2026-09-30T00-00-00Z', '2026-09-30T00:00:00.000Z'));
    await store.write('snapshots/2026-09-30T06-00-00Z/members.json', '[]');
    await store.writeJson('snapshots/2026-09-28T00-00.json', { collected_at: 'v1' });
    expect((await repo.latest())?.id).toBe('2026-09-30T00-00-00Z');
    expect((await repo.since(new Date('2026-09-29T12:00:00Z'))).map((s) => s.id)).toEqual([
      '2026-09-30T00-00-00Z',
    ]);
  });
});

describe('reports and state', () => {
  it('keeps compliance reports in order and restarts state from unknown versions', async () => {
    const store = new FileStore(dir);
    const reports = new FsComplianceReportRepository(store);
    const report = (snapshotId: string, score: number) => ({
      schemaVersion: 2 as const,
      id: `compliance-${snapshotId}`,
      snapshotId,
      generatedAt: '2026-09-30T00:00:00Z',
      summary: { score } as never,
      results: [],
    });
    await reports.save(report('2026-09-29T00-00-00Z', 80));
    await reports.save(report('2026-09-30T00-00-00Z', 90));
    expect((await reports.latest())?.summary.score).toBe(90);
    expect((await reports.history(5)).map((r) => r.summary.score)).toEqual([80, 90]);

    const state = new FsStateRepository(store);
    await store.writeJson('state.json', { last_activity_id: 'legacy' });
    expect(await state.load()).toEqual(initialState());
  });
});

describe('archiveSnapshots', () => {
  it('compresses snapshots older than the cutoff and removes their directories', async () => {
    const store = new FileStore(dir);
    const repo = new FsSnapshotRepository(store);
    await repo.save(snapshot('2025-01-01T00-00-00Z', '2025-01-01T00:00:00.000Z'));
    await repo.save(snapshot('2026-09-30T00-00-00Z', '2026-09-30T00:00:00.000Z'));
    const archived = await archiveSnapshots(store, new Date('2026-01-01T00:00:00Z'));
    expect(archived).toEqual(['2025-01-01T00-00-00Z']);
    expect(await repo.ids()).toEqual(['2026-09-30T00-00-00Z']);
    const restored = JSON.parse(
      gunzipSync(await readFile(join(dir, 'archive/2025/2025-01-01T00-00-00Z.json.gz'))).toString(),
    );
    expect(restored.data.members).toHaveLength(2);
  });
});
