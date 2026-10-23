import { describe, expect, it } from 'vitest';
import { fnv, snapshotOf } from '../../domain/__tests__/ledger-fixtures.js';
import { MemoryLedger } from './memory-ledger.js';
import { latestLedgerRecord, updateLedger } from '../use-cases/ledger.js';

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

describe('updateLedger breakdown checks', () => {
  const cost = (date: string, dimension: string, key: string | null, amount: number) => ({
    date,
    dimension,
    key,
    amount,
    listAmount: null,
    currency: 'USD',
  });

  it('reports a day whose model costs do not add up to the total once, newest finding first', async () => {
    const older = snapshotOf('2026-03-02T06:00:00Z', {
      cost: [cost('2026-03-01', 'total', null, 10), cost('2026-03-01', 'model', 'claude-a', 9)],
    });
    const newer = snapshotOf('2026-03-02T12:00:00Z', {
      cost: [cost('2026-03-01', 'total', null, 10), cost('2026-03-01', 'model', 'claude-a', 8)],
    });
    const result = await updateLedger([older, newer], {
      repository: new MemoryLedger(),
      hash: fnv,
    });
    expect(result.gaps).toEqual([
      { dataset: 'cost', dimension: 'model', date: '2026-03-01', total: 10, sum: 8 },
    ]);
    const clean = snapshotOf('2026-03-02T18:00:00Z', {
      cost: [cost('2026-03-01', 'total', null, 10), cost('2026-03-01', 'model', 'claude-a', 10)],
    });
    expect(
      (await updateLedger([clean], { repository: new MemoryLedger(), hash: fnv })).gaps,
    ).toEqual([]);
  });
});
