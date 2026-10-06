import { describe, expect, it } from 'vitest';
import { checkDetailBundle, detailArchiveSchema } from '../../contracts/index.js';
import {
  archivedSnapshotIds,
  buildArchiveView,
  summarizeArchiveEntries,
  type ArchiveEntry,
} from '../presenters/archive-view.js';
import { buildDetailView, DEFAULT_DETAIL_THRESHOLDS } from '../presenters/detail-view.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const entry = (id: string, bytes: number, dir = id.slice(0, 4)): ArchiveEntry => ({
  dir,
  name: `${id}.json.gz`,
  bytes,
});
const A = '2024-03-01T06-00-00Z';
const B = '2024-11-15T06-00-00Z';
const C = '2025-01-02T06-00-00Z';
const D = '2026-05-09T06-00-00Z';

describe('archivedSnapshotIds', () => {
  it('lists the valid ids newest first, once, and skips what the inventory ignores', () => {
    const entries = [
      entry(B, 10),
      entry(A, 10),
      entry(A, 20),
      entry(D, 10),
      entry(C, 10, '2024'),
      { dir: '2024', name: 'notes.txt', bytes: 5 },
      entry('2024-05-01T06-00-00Z', -1),
      { dir: '', name: `${A}.json.gz`, bytes: 1 },
    ];
    expect(archivedSnapshotIds(entries)).toEqual([D, B, A]);
    expect(archivedSnapshotIds([])).toEqual([]);
  });
});

describe('summarizeArchiveEntries', () => {
  it('is empty for no entries', () => {
    expect(summarizeArchiveEntries([])).toEqual({
      years: [],
      totals: { snapshots: 0, bytes: 0, years: 0, oldest: null, newest: null },
      ignoredEntries: 0,
    });
  });

  it('summarizes a single year', () => {
    const s = summarizeArchiveEntries([entry(B, 200), entry(A, 100)]);
    expect(s.years).toEqual([{ year: '2024', snapshots: 2, bytes: 300, oldest: A, newest: B }]);
    expect(s.totals).toEqual({ snapshots: 2, bytes: 300, years: 1, oldest: A, newest: B });
  });

  it('summarizes several years, newest year first', () => {
    const s = summarizeArchiveEntries([entry(A, 1), entry(C, 2), entry(D, 4), entry(B, 8)]);
    expect(s.years.map((y) => [y.year, y.snapshots, y.bytes])).toEqual([
      ['2026', 1, 4],
      ['2025', 1, 2],
      ['2024', 2, 9],
    ]);
    expect(s.totals).toMatchObject({ snapshots: 4, bytes: 15, years: 3, oldest: A, newest: D });
  });

  it('does not depend on the input order', () => {
    const list = [entry(A, 1), entry(C, 2), entry(D, 4), entry(B, 8)];
    const expected = summarizeArchiveEntries(list);
    expect(summarizeArchiveEntries([...list].reverse())).toEqual(expected);
    expect(summarizeArchiveEntries([list[2]!, list[0]!, list[3]!, list[1]!])).toEqual(expected);
  });

  it('adds up large sizes exactly', () => {
    const tb = 2 ** 40;
    const s = summarizeArchiveEntries([entry(A, 3 * tb), entry(B, 5 * tb + 7), entry(C, tb)]);
    expect(s.totals.bytes).toBe(9 * tb + 7);
    expect(Number.isSafeInteger(s.totals.bytes)).toBe(true);
  });

  it('ignores and counts unrelated, malformed and mismatched entries without naming them', () => {
    const s = summarizeArchiveEntries([
      entry(A, 10),
      { dir: '2024', name: 'notes.txt', bytes: 5 },
      { dir: '2024', name: 'tmp.json.gz.tmp', bytes: 5 },
      { dir: '2024', name: 'alice@example.com.json.gz', bytes: 5 },
      { dir: '2024', name: `${C}.json.gz`, bytes: 5 },
      { dir: '', name: `${A}.json.gz`, bytes: 5 },
      { dir: '2024', name: `${B}.json.gz`, bytes: -1 },
      { dir: '2024', name: `${B}.json.gz`, bytes: Number.NaN },
    ]);
    expect(s.totals).toMatchObject({ snapshots: 1, bytes: 10 });
    expect(s.ignoredEntries).toBe(7);
    expect(JSON.stringify(s)).not.toMatch(/notes|alice|tmp/);
  });

  it('counts a repeated id once and keeps the larger size', () => {
    const s = summarizeArchiveEntries([entry(A, 10), entry(A, 30)]);
    expect(s.totals).toMatchObject({ snapshots: 1, bytes: 30 });
  });
});

describe('buildArchiveView and the bundle check', () => {
  const view = (entries: readonly ArchiveEntry[] | null) =>
    buildDetailView({
      now: NOW,
      source: 'demo',
      maskPii: true,
      snapshot: null,
      report: null,
      thresholds: DEFAULT_DETAIL_THRESHOLDS,
      archive: { snapshotDays: 365, entries },
    });
  const only = (problems: string[]) => problems.filter((p) => p.includes('archive'));

  it('builds a schema-valid document with the retention setting', () => {
    const doc = buildArchiveView({ now: NOW, snapshotDays: 365, entries: [entry(A, 1)] });
    expect(detailArchiveSchema.parse(doc).snapshotDays).toBe(365);
    expect(doc.generatedAt).toBe(NOW.toISOString());
  });

  it('lists the archive in the manifest and passes the bundle check', () => {
    const bundle = view([entry(A, 100), entry(D, 50)]);
    const file = bundle.files.find((f) => f.path === 'detail/archive.json');
    const listed = bundle.manifest.files.find((f) => f.kind === 'archive');
    expect(listed).toMatchObject({ status: 'ok', count: 2, schemaVersion: 1 });
    const files = {
      'detail/index.json': JSON.stringify(bundle.manifest),
      'detail/archive.json': JSON.stringify(file?.content),
    };
    expect(only(checkDetailBundle(files, { requireDemo: true }))).toEqual([]);
    const skewed = JSON.stringify({
      ...file?.content,
      totals: { ...(file?.content as { totals: object }).totals, bytes: 1 },
    });
    expect(
      only(checkDetailBundle({ ...files, 'detail/archive.json': skewed }, { requireDemo: true })),
    ).toEqual(['detail/archive.json: totals differ from the per-year rows']);
  });

  it('rejects an id or name that is not a snapshot id', () => {
    const bundle = view([entry(A, 100)]);
    const doc = bundle.files[0]?.content as { years: { oldest: string }[] };
    const bad = JSON.stringify({
      ...doc,
      years: doc.years.map((y) => ({ ...y, oldest: 'alice@example.com' })),
    });
    expect(
      only(
        checkDetailBundle(
          { 'detail/index.json': JSON.stringify(bundle.manifest), 'detail/archive.json': bad },
          { requireDemo: true },
        ),
      ).join(),
    ).toMatch(/does not match the detail contract/);
  });

  it('reports an unlistable archive as unavailable with a fixed reason and no file', () => {
    const bundle = view(null);
    expect(bundle.files).toEqual([]);
    expect(bundle.manifest.files.find((f) => f.kind === 'archive')).toMatchObject({
      status: 'unavailable',
      reason: 'the archive could not be listed',
      count: null,
    });
  });

  it('publishes nothing when the caller has no archive input', () => {
    const bundle = buildDetailView({
      now: NOW,
      source: 'demo',
      maskPii: true,
      snapshot: null,
      report: null,
      thresholds: DEFAULT_DETAIL_THRESHOLDS,
    });
    expect(bundle.manifest.files.some((f) => f.kind === 'archive')).toBe(false);
  });
});
