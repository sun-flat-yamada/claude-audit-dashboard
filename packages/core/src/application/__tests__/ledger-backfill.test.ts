import { describe, expect, it } from 'vitest';
import { fnv } from '../../domain/__tests__/ledger-fixtures.js';
import { planBackfill } from '../../domain/ledger/backfill.js';
import { addDays, toIsoDate, type DateRange } from '../../domain/util/time.js';
import {
  DataUnavailableError,
  type BackfillProgress,
  type BackfillProgressStore,
  type BackfillSource,
  type Clock,
} from '../ports.js';
import { backfillLedger } from '../use-cases/ledger-backfill.js';
import { MemoryLedger } from './memory-ledger.js';

class MemoryProgress implements BackfillProgressStore {
  value: BackfillProgress = { schemaVersion: 1, units: {} };
  saves = 0;
  load = async () => structuredClone(this.value);
  save = async (progress: BackfillProgress) => {
    this.saves += 1;
    this.value = structuredClone(progress);
  };
}

const NOW = new Date('2026-04-15T12:00:00.000Z');
const clock = (at: Date = NOW): Clock => ({ now: () => new Date(at.getTime()) });

/** A daily source: one total row per day of the requested range. */
function usageSource(calls: string[], fail?: (range: DateRange) => Error | null): BackfillSource {
  return {
    dataset: 'usage',
    source: 'test usage',
    async fetch(range) {
      calls.push(toIsoDate(range.start));
      const error = fail?.(range);
      if (error) throw error;
      const items = [];
      for (let d = range.start; d < range.end; d = addDays(d, 1))
        items.push({ date: toIsoDate(d), dimension: 'total', key: null, outputTokens: 1 });
      return { items, asOf: range.end.toISOString() };
    },
  };
}

const planOf = (now = NOW) =>
  planBackfill({
    from: '2026-01',
    to: '2026-04',
    now,
    datasets: [{ dataset: 'usage', limit: {} }],
  });

describe('backfillLedger', () => {
  it('merges every unit into its month and records the progress per unit', async () => {
    const ledger = new MemoryLedger();
    const progress = new MemoryProgress();
    const calls: string[] = [];
    const result = await backfillLedger(planOf(), {
      source: () => usageSource(calls),
      repository: ledger,
      hash: fnv,
      progress,
      clock: clock(),
    });
    expect(calls).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
    expect(result.outcomes.map((o) => o.status)).toEqual([
      'fetched',
      'fetched',
      'fetched',
      'fetched',
    ]);
    expect((await ledger.read('2026-01', 'usage')).map((e) => e.key)).toHaveLength(31);
    expect(await ledger.read('2026-04', 'usage')).toHaveLength(15);
    expect(progress.saves).toBe(4);
    expect(Object.keys(progress.value.units)).toEqual([
      '2026-01/usage',
      '2026-02/usage',
      '2026-03/usage',
      '2026-04/usage',
    ]);
    expect(result.ledger.manifests).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
  });

  it('resumes: a re-run skips final units and fetches the still-revised ones again', async () => {
    const ledger = new MemoryLedger();
    const progress = new MemoryProgress();
    await backfillLedger(planOf(), {
      source: () => usageSource([]),
      repository: ledger,
      hash: fnv,
      progress,
      clock: clock(),
    });
    const bytes = new Map(ledger.files);
    const calls: string[] = [];
    const again = await backfillLedger(planOf(), {
      source: () => usageSource(calls),
      repository: ledger,
      hash: fnv,
      progress,
      clock: clock(),
    });
    // January and February ended more than 8 days before NOW; March ended 14 days before NOW,
    // so it is final too; April (the current month) is fetched again.
    expect(calls).toEqual(['2026-04-01']);
    expect(again.outcomes.map((o) => o.status)).toEqual([
      'skipped',
      'skipped',
      'skipped',
      'fetched',
    ]);
    // Idempotent: the repeated unit changed nothing.
    expect(again.ledger.changed).toEqual([]);
    expect(ledger.files).toEqual(bytes);
    // --force fetches everything again.
    const forced: string[] = [];
    await backfillLedger(planOf(), {
      source: () => usageSource(forced),
      repository: ledger,
      hash: fnv,
      progress,
      clock: clock(),
      force: true,
    });
    expect(forced).toHaveLength(4);
  });

  it('continues after an interruption from the first unit that was not recorded', async () => {
    const ledger = new MemoryLedger();
    const progress = new MemoryProgress();
    const first = await backfillLedger(planOf(), {
      source: () =>
        usageSource([], (range) =>
          range.start.getUTCMonth() === 2 ? new Error('GET usage_report → 500') : null,
        ),
      repository: ledger,
      hash: fnv,
      progress,
      clock: clock(),
    });
    expect(first.outcomes.map((o) => o.status)).toEqual([
      'fetched',
      'fetched',
      'failed',
      'fetched',
    ]);
    expect(first.outcomes[2]).toMatchObject({ reason: 'GET usage_report → 500' });
    expect(progress.value.units['2026-03/usage']).toBeUndefined();
    const calls: string[] = [];
    await backfillLedger(planOf(), {
      source: () => usageSource(calls),
      repository: ledger,
      hash: fnv,
      progress,
      clock: clock(),
    });
    expect(calls).toEqual(['2026-03-01', '2026-04-01']);
    expect(await ledger.read('2026-03', 'usage')).toHaveLength(31);
  });

  it('reports a dataset that cannot be fetched here as unavailable, not as a failure', async () => {
    const result = await backfillLedger(planOf(), {
      source: (dataset) =>
        dataset === 'usage'
          ? {
              dataset: 'usage',
              source: 'x',
              fetch: () => Promise.reject(new DataUnavailableError('No key for the analytics API')),
            }
          : undefined,
      repository: new MemoryLedger(),
      hash: fnv,
      progress: new MemoryProgress(),
      clock: clock(),
    });
    expect(new Set(result.outcomes.map((o) => o.status))).toEqual(new Set(['unavailable']));
    const none = await backfillLedger(planOf(), {
      source: () => undefined,
      repository: new MemoryLedger(),
      hash: fnv,
      progress: new MemoryProgress(),
      clock: clock(),
    });
    expect(none.outcomes[0]).toMatchObject({ status: 'unavailable', reason: 'no backfill source' });
  });

  it('records backfilled daily rows with the newer watermark over an earlier collection', async () => {
    const ledger = new MemoryLedger();
    await backfillLedger(planOf(), {
      source: () => usageSource([]),
      repository: ledger,
      hash: fnv,
      progress: new MemoryProgress(),
      clock: clock(),
    });
    const [entry] = await ledger.read('2026-02', 'usage');
    expect(entry).toMatchObject({
      key: '2026-02-01|total|',
      recordedAt: NOW.toISOString(),
      asOf: '2026-03-01T00:00:00.000Z',
    });
  });
});
