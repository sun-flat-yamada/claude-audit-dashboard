import { describe, expect, it } from 'vitest';
import {
  LEDGER_SEAL_POLICY,
  compareLedgerContent,
  hasDifference,
  revisionEntries,
  sealPolicyOf,
  sealReadyAt,
  type LedgerEntry,
} from '../ledger/index.js';

const usage = (date: string, tokens: number, asOf: string, recordedAt = asOf): LedgerEntry => ({
  key: `${date}|total|`,
  recordedAt,
  asOf,
  item: { date, dimension: 'total', key: null, outputTokens: tokens },
});

const activity = (id: string, createdAt: string, recordedAt: string): LedgerEntry => ({
  key: id,
  recordedAt,
  item: { id, createdAt, type: 'user_login' },
});

describe('seal policies', () => {
  it('compares events and daily rows, replaces roll-ups, keeps states', () => {
    expect(LEDGER_SEAL_POLICY).toEqual({
      event: 'compare',
      daily: 'compare',
      rollup: 'replace',
      state: 'keep',
    });
    expect(sealPolicyOf('activities')).toBe('compare');
    expect(sealPolicyOf('usage')).toBe('compare');
    expect(sealPolicyOf('memberActivity')).toBe('replace');
    expect(sealPolicyOf('members')).toBe('keep');
    expect(sealPolicyOf('ledgerHealth')).toBe('keep');
  });

  it('allows a seal from the month end plus the revision period', () => {
    expect(sealReadyAt('2026-09').toISOString()).toBe('2026-10-09T00:00:00.000Z');
    expect(sealReadyAt('2026-12').toISOString()).toBe('2027-01-09T00:00:00.000Z');
  });
});

describe('compareLedgerContent', () => {
  it('ignores the collection metadata', () => {
    const stored = [usage('2026-09-01', 10, '2026-09-02T06:00:00Z')];
    const fetched = [usage('2026-09-01', 10, '2026-10-10T04:00:00Z')];
    const difference = compareLedgerContent('usage', stored, fetched);
    expect(hasDifference(difference)).toBe(false);
  });

  it('counts missing, extra and changed rows with their days', () => {
    const stored = [
      usage('2026-09-01', 10, 'a'),
      usage('2026-09-02', 20, 'a'),
      usage('2026-09-04', 40, 'a'),
    ];
    const fetched = [
      usage('2026-09-01', 10, 'b'),
      usage('2026-09-02', 21, 'b'),
      usage('2026-09-03', 30, 'b'),
    ];
    expect(compareLedgerContent('usage', stored, fetched)).toEqual({
      dataset: 'usage',
      missing: 1,
      extra: 1,
      changed: 1,
      dates: ['2026-09-02', '2026-09-03', '2026-09-04'],
    });
  });

  it('dates events by their creation time and rejects unknown datasets', () => {
    const stored = [activity('a1', '2026-09-03T10:00:00Z', 'x')];
    const fetched = [...stored, activity('a2', '2026-09-05T23:59:00Z', 'y')];
    expect(compareLedgerContent('activities', stored, fetched).dates).toEqual(['2026-09-05']);
    expect(() => compareLedgerContent('nope', [], [])).toThrow(/not registered/);
  });
});

describe('revisionEntries', () => {
  const stored = [usage('2026-09-30', 10, '2026-10-02T06:00:00Z')];

  it('keeps only the entries that would change the sealed file', () => {
    // Same value with a newer watermark: no revision.
    expect(
      revisionEntries('usage', stored, [usage('2026-09-30', 10, '2026-10-12T06:00:00Z')]),
    ).toEqual([]);
    // Revised value: one revision (the newer watermark wins the merge).
    const revised = usage('2026-09-30', 12, '2026-10-12T06:00:00Z');
    expect(revisionEntries('usage', stored, [revised])).toEqual([revised]);
    // An older copy loses the merge: nothing changes.
    expect(
      revisionEntries('usage', stored, [usage('2026-09-30', 9, '2026-10-01T06:00:00Z')]),
    ).toEqual([]);
  });

  it('records late events and ignores duplicates', () => {
    const events = [activity('a1', '2026-09-03T10:00:00Z', '2026-09-03T12:00:00Z')];
    expect(
      revisionEntries('activities', events, [
        activity('a1', '2026-09-03T10:00:00Z', '2026-10-12T00:00:00Z'),
      ]),
    ).toEqual([]);
    const late = activity('a9', '2026-09-30T23:59:00Z', '2026-10-12T00:00:00Z');
    expect(revisionEntries('activities', events, [late])).toEqual([late]);
  });
});
