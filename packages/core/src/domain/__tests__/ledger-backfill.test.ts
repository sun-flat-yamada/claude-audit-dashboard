import { describe, expect, it } from 'vitest';
import {
  BACKFILL_REVISION_DAYS,
  backfillMonths,
  isFinalBackfill,
  planBackfill,
  retentionStart,
  type BackfillDatasetLimit,
} from '../ledger/backfill.js';
import { ledgerEntriesOf } from '../ledger/ledger.js';
import { addDays } from '../util/time.js';
import { fnv, snapshotOf } from './ledger-fixtures.js';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');
const REPORT: BackfillDatasetLimit['limit'] = { notBefore: EPOCH, retentionDays: 365 };
const ANALYTICS: BackfillDatasetLimit['limit'] = { notBefore: EPOCH };

const iso = (range: { start: Date; end: Date }) => [
  range.start.toISOString(),
  range.end.toISOString(),
];

describe('backfill months', () => {
  it('lists every month from --from to --to across a year boundary', () => {
    expect(backfillMonths('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(backfillMonths('2026-03', '2026-03')).toEqual(['2026-03']);
  });

  it('rejects malformed and reversed months', () => {
    expect(() => backfillMonths('2026-1', '2026-02')).toThrow(/--from must be a month/);
    expect(() => backfillMonths('2026-01', '2026-13')).toThrow(/--to must be a month/);
    expect(() => backfillMonths('2026-03', '2026-02')).toThrow(/after --to/);
  });
});

describe('retention start', () => {
  it('is the first whole UTC day inside the last N days', () => {
    expect(retentionStart(365, new Date('2026-12-31T10:00:00Z')).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(retentionStart(365, new Date('2027-01-01T00:00:00Z')).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(retentionStart(365, new Date('2027-01-01T00:00:01Z')).toISOString()).toBe(
      '2026-01-02T00:00:00.000Z',
    );
  });
});

describe('planBackfill', () => {
  const now = new Date('2026-10-23T09:00:00.000Z');

  it('splits 2026-01 .. the current month into one unit per month and dataset', () => {
    const plan = planBackfill({
      from: '2026-01',
      to: '2026-10',
      now,
      datasets: [
        { dataset: 'usage', limit: REPORT },
        { dataset: 'activities', limit: {} },
      ],
    });
    expect(plan.months).toHaveLength(10);
    expect(plan.units).toHaveLength(20);
    expect(plan.excluded).toEqual([]);
    // Month order first, then the dataset order of the request.
    expect(plan.units.slice(0, 3).map((u) => `${u.month}/${u.dataset}`)).toEqual([
      '2026-01/usage',
      '2026-01/activities',
      '2026-02/usage',
    ]);
    expect(iso(plan.units[2]?.range ?? { start: now, end: now })).toEqual([
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ]);
    // The current month ends now.
    expect(plan.units.at(-1)?.range.end.toISOString()).toBe(now.toISOString());
  });

  it('truncates usage / cost to the last 365 days and reports the cut-off range', () => {
    const later = new Date('2027-02-15T12:00:00.000Z');
    const plan = planBackfill({
      from: '2026-01',
      to: '2027-02',
      now: later,
      datasets: [
        { dataset: 'cost', limit: REPORT },
        { dataset: 'adoption', limit: ANALYTICS },
      ],
    });
    expect(plan.excluded.map((e) => [e.dataset, e.reason, ...iso(e.range)])).toEqual([
      ['cost', 'retention', '2026-01-01T00:00:00.000Z', '2026-02-16T00:00:00.000Z'],
    ]);
    const cost = plan.units.filter((u) => u.dataset === 'cost');
    expect(cost[0]?.month).toBe('2026-02');
    expect(iso(cost[0]?.range ?? { start: later, end: later })).toEqual([
      '2026-02-16T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ]);
    // Analytics datasets without a documented retention keep every month from 2026-01.
    expect(plan.units.filter((u) => u.dataset === 'adoption')).toHaveLength(14);
  });

  it('excludes the months before the Analytics epoch, then the retention cut', () => {
    const plan = planBackfill({
      from: '2025-11',
      to: '2027-03',
      now: new Date('2027-03-10T00:00:00.000Z'),
      datasets: [
        { dataset: 'usage', limit: REPORT },
        { dataset: 'activities', limit: {} },
      ],
    });
    expect(plan.excluded.map((e) => [e.dataset, e.reason, ...iso(e.range)])).toEqual([
      ['usage', 'epoch', '2025-11-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
      ['usage', 'retention', '2026-01-01T00:00:00.000Z', '2026-03-10T00:00:00.000Z'],
    ]);
    expect(plan.units.filter((u) => u.dataset === 'usage').map((u) => u.month)[0]).toBe('2026-03');
    // The Activity Feed has no bound: every month is requested.
    expect(plan.units.filter((u) => u.dataset === 'activities')).toHaveLength(17);
  });

  it('drops a unit that is entirely excluded and rejects a month after the current one', () => {
    const plan = planBackfill({
      from: '2025-12',
      to: '2025-12',
      now,
      datasets: [{ dataset: 'adoption', limit: ANALYTICS }],
    });
    expect(plan.units).toEqual([]);
    expect(plan.excluded).toHaveLength(1);
    expect(() => planBackfill({ from: '2026-10', to: '2026-11', now, datasets: [] })).toThrow(
      /after the current month/,
    );
  });
});

describe('isFinalBackfill (resume rule)', () => {
  const range = {
    start: new Date('2026-01-01T00:00:00.000Z'),
    end: new Date('2026-02-01T00:00:00.000Z'),
  };
  const record = (completedAt: Date, from = range.start, to = range.end) => ({
    from: from.toISOString(),
    to: to.toISOString(),
    completedAt: completedAt.toISOString(),
  });

  it('is final once fetched after the revision period of the covered range', () => {
    expect(isFinalBackfill(record(addDays(range.end, BACKFILL_REVISION_DAYS)), range)).toBe(true);
    expect(isFinalBackfill(record(addDays(range.end, BACKFILL_REVISION_DAYS - 1)), range)).toBe(
      false,
    );
  });

  it('is not final when the record does not cover the range', () => {
    const late = addDays(range.end, 60);
    expect(isFinalBackfill(record(late, addDays(range.start, 3)), range)).toBe(false);
    expect(isFinalBackfill(record(late, range.start, addDays(range.end, -1)), range)).toBe(false);
    // A record covering a wider range (an earlier truncation moved later) still counts.
    expect(isFinalBackfill(record(late), { start: addDays(range.start, 5), end: range.end })).toBe(
      true,
    );
  });
});

describe('roll-up filing of a backfilled month', () => {
  const rollup = (window?: { from: string; to: string }) =>
    ledgerEntriesOf(
      {
        ...snapshotOf('2026-10-23T09:00:00.000Z', { memberActivity: [{ userId: 'u1' }] }),
        coverage: { memberActivity: { status: 'ok', window } },
      },
      fnv,
    ).entries.map((e) => e.month);

  it('files a window that ended in an earlier month under that month', () => {
    expect(rollup({ from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' })).toEqual([
      '2026-01',
    ]);
  });

  it('keeps the collection month for a window ending at the collection (regular runs)', () => {
    expect(rollup({ from: '2026-07-25T00:00:00.000Z', to: '2026-10-23T09:00:00.000Z' })).toEqual([
      '2026-10',
    ]);
    expect(rollup()).toEqual(['2026-10']);
    expect(rollup({ from: 'x', to: 'not a time' })).toEqual(['2026-10']);
  });
});
