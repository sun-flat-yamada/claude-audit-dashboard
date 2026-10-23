import { describe, expect, it } from 'vitest';
import {
  buildLedgerManifest,
  canonicalJson,
  ledgerDatasetNames,
  ledgerEntriesOf,
  ledgerMonthOf,
  ledgerSpecFor,
  mergeLedgerEntries,
  parseLedgerEntries,
  serializeLedgerEntries,
  type LedgerEntry,
} from '../ledger/index.js';
import { ALL_DATASET_NAMES } from '../model/dataset.js';
import type { AuditSnapshot } from '../model/snapshot.js';
import { fnv, snapshotOf } from './ledger-fixtures.js';

/** Entries of `dataset` in `month` after merging the snapshots (in the given order). */
function ledgerOf(
  dataset: string,
  month: string,
  snapshots: readonly AuditSnapshot[],
): LedgerEntry[] {
  const entries = snapshots
    .flatMap((s) => ledgerEntriesOf(s, fnv).entries)
    .filter((e) => e.dataset === dataset && e.month === month)
    .map((e) => e.entry);
  return mergeLedgerEntries(dataset, entries);
}

const activity = (id: string, createdAt: string, note = 'a') => ({
  id,
  type: 'user_signed_in',
  createdAt,
  organizationId: null,
  actor: { kind: 'user_actor', id: 'u1', email: 'user_alice@example.com', ip: null },
  attributes: { note },
});

const usage = (date: string, outputTokens: number, key: string | null = null) => ({
  date,
  dimension: key ? 'model' : 'total',
  key,
  outputTokens,
});

describe('ledger dataset registry', () => {
  it('classifies every dataset, built-in or optional', () => {
    for (const name of ALL_DATASET_NAMES) expect(ledgerSpecFor(name), name).not.toBeNull();
    expect(ledgerDatasetNames()).toEqual([...ALL_DATASET_NAMES].sort());
    expect(ledgerSpecFor('activities')?.kind).toBe('event');
    expect(ledgerSpecFor('usage')?.kind).toBe('daily');
    expect(ledgerSpecFor('memberActivity')?.kind).toBe('rollup');
    expect(ledgerSpecFor('members')?.kind).toBe('state');
    expect(ledgerSpecFor('unknown')).toBeNull();
  });
});

describe('ledger months', () => {
  it('uses the UTC month of timestamps and the month of plain dates', () => {
    expect(ledgerMonthOf('2026-01-31')).toBe('2026-01');
    expect(ledgerMonthOf('2026-01-31T23:59:59.999Z')).toBe('2026-01');
    expect(ledgerMonthOf('2026-02-01T08:00:00+09:00')).toBe('2026-01');
    expect(ledgerMonthOf('not a date')).toBeNull();
    expect(ledgerMonthOf(undefined)).toBeNull();
  });
});

describe('event merge (activities)', () => {
  const first = snapshotOf('2026-01-31T18:00:00.000Z', {
    activities: [
      activity('act-1', '2026-01-31T17:00:00Z'),
      activity('act-2', '2026-01-31T23:59:59Z'),
    ],
  });
  // The overlap of the next window re-delivers act-2 (at-least-once), and a new one after midnight.
  const second = snapshotOf('2026-02-01T00:00:00.000Z', {
    activities: [
      activity('act-2', '2026-01-31T23:59:59Z', 'redelivered'),
      activity('act-3', '2026-02-01T00:00:00Z'),
    ],
  });

  it('keeps one entry per id, the first recorded one, in the month of createdAt', () => {
    const january = ledgerOf('activities', '2026-01', [first, second]);
    expect(january.map((e) => e.key)).toEqual(['act-1', 'act-2']);
    expect(january[1]?.recordedAt).toBe('2026-01-31T18:00:00.000Z');
    expect((january[1]?.item as { attributes: { note: string } }).attributes.note).toBe('a');
    expect(ledgerOf('activities', '2026-02', [first, second]).map((e) => e.key)).toEqual(['act-3']);
  });

  it('does not depend on the order or on repetition', () => {
    const forward = ledgerOf('activities', '2026-01', [first, second]);
    expect(ledgerOf('activities', '2026-01', [second, first, second])).toEqual(forward);
    expect(mergeLedgerEntries('activities', [...forward, ...forward])).toEqual(forward);
  });
});

describe('daily merge (usage, cost, adoption)', () => {
  const early = snapshotOf(
    '2026-02-02T00:00:00.000Z',
    { usage: [usage('2026-01-31', 10), usage('2026-01-31', 5, 'model-a'), usage('2026-02-01', 1)] },
    { usage: { asOf: '2026-02-01T20:00:00Z' } },
  );
  const revised = snapshotOf(
    '2026-02-02T06:00:00.000Z',
    { usage: [usage('2026-01-31', 12), usage('2026-02-01', 3)] },
    { usage: { asOf: '2026-02-02T04:00:00Z' } },
  );

  it('is unique by date + dimension + key and the newer asOf wins', () => {
    const january = ledgerOf('usage', '2026-01', [early, revised]);
    expect(january.map((e) => e.key)).toEqual(['2026-01-31|model|model-a', '2026-01-31|total|']);
    expect((january[1]?.item as { outputTokens: number }).outputTokens).toBe(12);
    expect(january[1]?.asOf).toBe('2026-02-02T04:00:00Z');
    const february = ledgerOf('usage', '2026-02', [revised, early]);
    expect(february.map((e) => (e.item as { outputTokens: number }).outputTokens)).toEqual([3]);
  });

  it('never lets an older watermark overwrite a newer one, whatever the order', () => {
    expect(ledgerOf('usage', '2026-01', [revised, early])).toEqual(
      ledgerOf('usage', '2026-01', [early, revised]),
    );
  });

  it('falls back to the collection time when the dataset has no asOf', () => {
    const a = snapshotOf('2026-03-01T00:00:00.000Z', { cost: [usage('2026-02-28', 1)] });
    const b = snapshotOf('2026-03-01T06:00:00.000Z', { cost: [usage('2026-02-28', 2)] });
    const [entry] = ledgerOf('cost', '2026-02', [b, a]);
    expect(entry?.asOf).toBe('2026-03-01T06:00:00.000Z');
    expect((entry?.item as { outputTokens: number }).outputTokens).toBe(2);
  });
});

describe('rollup merge (memberActivity, feature usage)', () => {
  const at = (collectedAt: string, users: number) =>
    snapshotOf(collectedAt, { skillUsage: [{ name: 'pdf', users }] });

  it('is unique by month + id; the latest collection of the month overwrites', () => {
    const snapshots = [at('2026-01-30T00:00:00.000Z', 1), at('2026-01-31T18:00:00.000Z', 2)];
    const january = ledgerOf('skillUsage', '2026-01', [...snapshots].reverse());
    expect(january).toHaveLength(1);
    expect((january[0]?.item as { users: number }).users).toBe(2);
    const february = ledgerOf('skillUsage', '2026-02', [
      ...snapshots,
      at('2026-02-01T00:00:00.000Z', 3),
    ]);
    expect((february[0]?.item as { users: number }).users).toBe(3);
  });
});

describe('state merge (members, settings, ...)', () => {
  const alice = { id: 'u1', email: 'user_alice@example.com', role: 'user' };
  const bob = { id: 'u2', email: 'user_bob@example.com', role: 'user' };
  const members = (collectedAt: string, rows: unknown[]) =>
    snapshotOf(collectedAt, { members: rows });

  it('adds no version while the content is unchanged (also when only the row order changes)', () => {
    const entries = ledgerOf('members', '2026-01', [
      members('2026-01-01T00:00:00.000Z', [alice, bob]),
      members('2026-01-01T06:00:00.000Z', [bob, alice]),
      members('2026-01-01T12:00:00.000Z', [alice, bob]),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.validFrom).toBe('2026-01-01T00:00:00.000Z');
    expect(entries[0]?.hash).toBe(fnv(canonicalJson(entries[0]?.item)));
  });

  it('appends a version per change, including a change back', () => {
    const snapshots = [
      members('2026-01-01T00:00:00.000Z', [alice]),
      members('2026-01-02T00:00:00.000Z', [alice, bob]),
      members('2026-01-03T00:00:00.000Z', [alice, bob]),
      members('2026-01-04T00:00:00.000Z', [alice]),
    ];
    const entries = ledgerOf('members', '2026-01', snapshots);
    expect(entries.map((e) => e.validFrom)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-04T00:00:00.000Z',
    ]);
    expect(ledgerOf('members', '2026-01', [...snapshots].reverse())).toEqual(entries);
  });

  it('starts every month with its own opening version', () => {
    const snapshots = [
      members('2026-01-31T18:00:00.000Z', [alice]),
      members('2026-02-01T00:00:00.000Z', [alice]),
    ];
    expect(ledgerOf('members', '2026-01', snapshots)).toHaveLength(1);
    expect(ledgerOf('members', '2026-02', snapshots).map((e) => e.validFrom)).toEqual([
      '2026-02-01T00:00:00.000Z',
    ]);
  });

  it('records an empty dataset as a state, but never a failed one', () => {
    const empty = snapshotOf('2026-01-05T00:00:00.000Z', { invites: [] });
    expect(ledgerEntriesOf(empty, fnv).entries).toHaveLength(1);
    const failed = snapshotOf(
      '2026-01-05T00:00:00.000Z',
      { invites: [], usage: [usage('2026-01-04', 1)] },
      { invites: { status: 'error' }, usage: { status: 'unavailable' } },
    );
    expect(ledgerEntriesOf(failed, fnv).entries).toEqual([]);
  });
});

describe('ledger entries of a snapshot', () => {
  it('reports rows without a usable time instead of filing them', () => {
    const snapshot = snapshotOf('2026-01-05T00:00:00.000Z', {
      activities: [activity('ok', '2026-01-04T00:00:00Z'), activity('bad', 'unknown')],
      notADataset: [{ id: 'x' }],
    });
    const { entries, rejected } = ledgerEntriesOf(snapshot, fnv);
    expect(entries.map((e) => e.entry.key)).toEqual(['ok']);
    expect(rejected).toEqual({ activities: 1 });
  });
});

describe('ledger files and manifest', () => {
  it('round-trips JSON Lines with sorted keys', () => {
    const entries = ledgerOf('activities', '2026-01', [
      snapshotOf('2026-01-02T00:00:00.000Z', {
        activities: [activity('a', '2026-01-01T00:00:00Z')],
      }),
    ]);
    const text = serializeLedgerEntries(entries);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.indexOf('"item"')).toBeLessThan(text.indexOf('"key"'));
    expect(parseLedgerEntries(text, 'x')).toEqual(entries);
    expect(() => parseLedgerEntries('{"key":1}\n', 'x.jsonl')).toThrow(
      /Malformed ledger entry 1 in x\.jsonl/,
    );
  });

  it('summarizes each dataset deterministically', () => {
    const snapshot = snapshotOf('2026-01-05T00:00:00.000Z', {
      activities: [activity('a', '2026-01-01T00:00:00Z'), activity('b', '2026-01-03T00:00:00Z')],
      members: [{ id: 'u1' }],
    });
    const files = ['members', 'activities'].map((dataset) => ({
      dataset,
      entries: ledgerOf(dataset, '2026-01', [snapshot]),
      sha256: `sha-${dataset}`,
    }));
    const manifest = buildLedgerManifest('2026-01', files);
    expect(Object.keys(manifest.datasets)).toEqual(['activities', 'members']);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      month: '2026-01',
      sealed: false,
      lastRecordedAt: '2026-01-05T00:00:00.000Z',
      datasets: {
        activities: {
          kind: 'event',
          count: 2,
          sha256: 'sha-activities',
          window: { from: '2026-01-01T00:00:00Z', to: '2026-01-03T00:00:00Z' },
        },
        members: {
          kind: 'state',
          count: 1,
          window: { from: '2026-01-05T00:00:00.000Z', to: '2026-01-05T00:00:00.000Z' },
        },
      },
    });
    expect(buildLedgerManifest('2026-01', [...files].reverse())).toEqual(manifest);
  });
});
