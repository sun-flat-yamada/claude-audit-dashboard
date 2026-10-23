import { describe, expect, it } from 'vitest';
import { fnv, snapshotOf } from '../../domain/__tests__/ledger-fixtures.js';
import {
  buildLedgerManifest,
  serializeLedgerEntries,
  type LedgerEntry,
  type LedgerManifest,
} from '../../domain/ledger/index.js';
import type { LedgerRepository } from '../ports.js';
import { latestLedgerRecord, updateLedger } from '../use-cases/ledger.js';

/** In-memory repository holding the serialized text, like the file adapter (minus the codec). */
class MemoryLedger implements LedgerRepository {
  readonly files = new Map<string, string>();
  readonly entries = new Map<string, LedgerEntry[]>();
  readonly manifests = new Map<string, LedgerManifest>();
  writes = 0;

  months = async () => [...new Set([...this.entries.keys()].map((k) => k.slice(0, 7)))].sort();
  read = async (month: string, dataset: string) => this.entries.get(`${month}/${dataset}`) ?? [];
  manifest = async (month: string) => this.manifests.get(month) ?? null;

  async write(month: string, dataset: string, entries: readonly LedgerEntry[]) {
    const text = serializeLedgerEntries(entries);
    const path = `${month}/${dataset}`;
    if (this.files.get(path) === text) return false;
    this.writes += 1;
    this.files.set(path, text);
    this.entries.set(path, JSON.parse(`[${text.trim().split('\n').join(',')}]`) as LedgerEntry[]);
    return true;
  }

  async refreshManifest(month: string) {
    const files = [...this.entries]
      .filter(([path]) => path.startsWith(`${month}/`))
      .map(([path, entries]) => ({
        dataset: path.slice(8),
        entries,
        sha256: fnv(this.files.get(path) ?? ''),
      }));
    const next = buildLedgerManifest(month, files, this.manifests.get(month)?.sealed ?? false);
    if (JSON.stringify(next) === JSON.stringify(this.manifests.get(month))) return false;
    this.manifests.set(month, next);
    return true;
  }
}

const day = (i: number) => new Date(Date.UTC(2026, 0, 28) + i * 6 * 3_600_000).toISOString();

/** 24 snapshots (6 days, 4 per day) across the January / February boundary. */
const history = Array.from({ length: 24 }, (_, i) =>
  snapshotOf(day(i), {
    activities: [
      { id: `act-${String(i)}`, createdAt: day(i) },
      ...(i > 0 ? [{ id: `act-${String(i - 1)}`, createdAt: day(i - 1) }] : []),
    ],
    usage: [0, 1, 2].map((back) => ({
      date: day(i - back * 4).slice(0, 10),
      dimension: 'total',
      key: null,
      outputTokens: i,
    })),
    members: [{ id: 'u1' }, ...(i >= 12 ? [{ id: 'u2' }] : [])],
  }),
);

describe('updateLedger', () => {
  it('is idempotent: a second run with the same input changes nothing', async () => {
    const ledger = new MemoryLedger();
    const first = await updateLedger(history, { repository: ledger, hash: fnv });
    expect(first.snapshots).toBe(24);
    expect(first.manifests).toEqual(['2026-01', '2026-02']);
    const files = new Map(ledger.files);
    const writes = ledger.writes;
    const second = await updateLedger(history, { repository: ledger, hash: fnv });
    expect(second.changed).toEqual([]);
    expect(second.manifests).toEqual([]);
    expect(ledger.writes).toBe(writes);
    expect(ledger.files).toEqual(files);
  });

  it('gives the same ledger for any batch size and order', async () => {
    const whole = new MemoryLedger();
    await updateLedger(history, { repository: whole, hash: fnv });
    const batched = new MemoryLedger();
    await updateLedger([...history].reverse(), { repository: batched, hash: fnv, batchSize: 5 });
    expect(batched.files).toEqual(whole.files);
    expect(batched.manifests).toEqual(whole.manifests);
  });

  it('keeps unique keys and records only state changes', async () => {
    const ledger = new MemoryLedger();
    await updateLedger(history, { repository: ledger, hash: fnv });
    for (const [path, entries] of ledger.entries) {
      expect(new Set(entries.map((e) => e.key)).size, path).toBe(entries.length);
    }
    // u2 joins at snapshot 12 (2026-01-31T00:00Z); February opens with its own version.
    expect(ledger.entries.get('2026-01/members')?.map((e) => e.validFrom)).toEqual([
      day(0),
      day(12),
    ]);
    expect(ledger.entries.get('2026-02/members')?.map((e) => e.validFrom)).toEqual([day(16)]);
    expect(await latestLedgerRecord(ledger)).toBe(day(23));
  });

  it('never rewrites a sealed month and reports it', async () => {
    const ledger = new MemoryLedger();
    await updateLedger(history.slice(0, 16), { repository: ledger, hash: fnv });
    const january = ledger.manifests.get('2026-01');
    if (!january) throw new Error('no manifest');
    ledger.manifests.set('2026-01', { ...january, sealed: true });
    const before = ledger.files.get('2026-01/usage');
    const result = await updateLedger(history, { repository: ledger, hash: fnv });
    expect(result.sealed).toEqual(['2026-01']);
    expect(ledger.files.get('2026-01/usage')).toBe(before);
    expect(result.changed.every((path) => path.startsWith('2026-02/'))).toBe(true);
  });
});
