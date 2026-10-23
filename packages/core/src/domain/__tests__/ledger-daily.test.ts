import { describe, expect, it } from 'vitest';
import {
  breakdownGaps,
  ledgerEntriesOf,
  ledgerSpecFor,
  mergeLedgerEntries,
  snapshotBreakdownGaps,
  usageTokens,
  type LedgerEntry,
} from '../ledger/index.js';
import type { CostRow, UsageRow } from '../model/entities.js';
import type { AuditSnapshot } from '../model/snapshot.js';
import { fnv, snapshotOf } from './ledger-fixtures.js';

function ledgerOf(dataset: string, month: string, snapshots: readonly AuditSnapshot[]) {
  const entries: LedgerEntry[] = snapshots
    .flatMap((s) => ledgerEntriesOf(s, fnv).entries)
    .filter((e) => e.dataset === dataset && e.month === month)
    .map((e) => e.entry);
  return mergeLedgerEntries(dataset, entries);
}

const memberDay = (date: string, userId: string, messages: number) => ({
  date,
  userId,
  email: `${userId}@example.com`,
  active: messages > 0,
  lastActiveOn: messages > 0 ? date : null,
  engagement: { chat: { messages } },
});

const cost = (date: string, dimension: CostRow['dimension'], key: string | null, amount: number) =>
  ({ date, dimension, key, amount, listAmount: null, currency: 'USD' }) satisfies CostRow;

const usage = (
  date: string,
  dimension: UsageRow['dimension'],
  key: string | null,
  output: number,
) =>
  ({
    date,
    dimension,
    key,
    uncachedInputTokens: 10,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: output,
    webSearchRequests: 0,
    requests: null,
  }) satisfies UsageRow;

describe('memberActivityDaily in the ledger', () => {
  it('is a daily dataset keyed by date and member', () => {
    expect(ledgerSpecFor('memberActivityDaily')?.kind).toBe('daily');
  });

  it('files rows by their day and keeps the newest collection of a day (revisions)', () => {
    const first = snapshotOf('2026-02-01T18:00:00Z', {
      memberActivityDaily: [
        memberDay('2026-01-31', 'user_a', 3),
        memberDay('2026-01-31', 'user_b', 0),
        memberDay('2026-01-30', 'user_a', 1),
      ],
    });
    const revised = snapshotOf('2026-02-02T18:00:00Z', {
      memberActivityDaily: [
        memberDay('2026-02-01', 'user_a', 2),
        memberDay('2026-01-31', 'user_a', 4),
      ],
    });
    for (const order of [
      [first, revised],
      [revised, first],
    ]) {
      const january = ledgerOf('memberActivityDaily', '2026-01', order);
      expect(january.map((e) => e.key)).toEqual([
        '2026-01-30|user_a',
        '2026-01-31|user_a',
        '2026-01-31|user_b',
      ]);
      expect(january[1]?.item).toMatchObject({ engagement: { chat: { messages: 4 } } });
      expect(january[1]?.recordedAt).toBe('2026-02-02T18:00:00Z');
      expect(ledgerOf('memberActivityDaily', '2026-02', order).map((e) => e.key)).toEqual([
        '2026-02-01|user_a',
      ]);
    }
  });
});

describe('model-only usage and cost in the ledger', () => {
  it('records the model rows of usage and cost under date|model|<model>', () => {
    const snapshot = snapshotOf('2026-01-20T06:00:00Z', {
      cost: [cost('2026-01-19', 'total', null, 10), cost('2026-01-19', 'model', 'claude-a', 10)],
      usage: [usage('2026-01-19', 'model', 'claude-a', 5)],
    });
    expect(ledgerOf('cost', '2026-01', [snapshot]).map((e) => e.key)).toEqual([
      '2026-01-19|model|claude-a',
      '2026-01-19|total|',
    ]);
    expect(ledgerOf('usage', '2026-01', [snapshot]).map((e) => e.key)).toEqual([
      '2026-01-19|model|claude-a',
    ]);
  });
});

describe('breakdownGaps', () => {
  const rows = [
    cost('2026-01-02', 'model', 'claude-b', 2.25),
    cost('2026-01-01', 'total', null, 12.5),
    cost('2026-01-01', 'model', 'claude-a', 10),
    cost('2026-01-01', 'model', 'claude-b', 2.5),
    cost('2026-01-01', 'group', 'rbac_group_a', 30),
    cost('2026-01-02', 'total', null, 5),
    cost('2026-01-02', 'model', 'claude-a', 2.5),
    cost('2026-01-03', 'total', null, 1),
  ];

  it('the model rows add up to the total row of each day', () => {
    const matching = rows.filter((r) => r.date === '2026-01-01');
    expect(breakdownGaps(matching, 'model', (r) => r.amount, 0.005)).toEqual([]);
    // The group rows overlap (a member counts in every group), so they are never checked here.
    expect(breakdownGaps(matching, 'group', (r) => r.amount)).toHaveLength(1);
  });

  it('reports days whose model rows differ from the total, or are missing, in date order', () => {
    expect(breakdownGaps(rows, 'model', (r) => r.amount, 0.005)).toEqual([
      { dimension: 'model', date: '2026-01-02', total: 5, sum: 4.75 },
      { dimension: 'model', date: '2026-01-03', total: 1, sum: 0 },
    ]);
  });

  it('checks the ok usage and cost datasets of a snapshot', () => {
    const snapshot = snapshotOf(
      '2026-01-04T06:00:00Z',
      {
        cost: rows,
        usage: [usage('2026-01-01', 'total', null, 30), usage('2026-01-01', 'model', 'a', 20)],
      },
      {},
    );
    expect(snapshotBreakdownGaps(snapshot).map((g) => `${g.dataset} ${g.date}`)).toEqual([
      'cost 2026-01-02',
      'cost 2026-01-03',
      'usage 2026-01-01',
    ]);
    expect(usageTokens(usage('2026-01-01', 'total', null, 30))).toBe(40);
    const failed = snapshotOf(
      '2026-01-04T06:00:00Z',
      { cost: rows },
      { cost: { status: 'error' } },
    );
    expect(snapshotBreakdownGaps(failed)).toEqual([]);
  });
});
