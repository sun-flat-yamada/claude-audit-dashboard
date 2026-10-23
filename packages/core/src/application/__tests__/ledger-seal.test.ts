import { describe, expect, it } from 'vitest';
import { fnv, snapshotOf } from '../../domain/__tests__/ledger-fixtures.js';
import { planBackfill } from '../../domain/ledger/backfill.js';
import { addDays, toIsoDate, type DateRange } from '../../domain/util/time.js';
import { ledgerRevisionAlert, ledgerSealAlert, ledgerVerifyAlert } from '../ledger-alert.js';
import {
  DataUnavailableError,
  type BackfillSource,
  type Clock,
  type SealedMonthSink,
} from '../ports.js';
import { updateLedger } from '../use-cases/ledger.js';
import { sealLedgerMonth, type LedgerSealDeps } from '../use-cases/ledger-seal.js';
import { markRevisionsNotified, verifyLedger } from '../use-cases/ledger-verify.js';
import { MemoryLedger, MemoryLedgerStatus } from './memory-ledger.js';

const MONTH = '2026-09';
const SEAL_AT = new Date('2026-10-10T04:00:00.000Z');
const clock = (at: Date): Clock => ({ now: () => new Date(at.getTime()) });

const tokens = (date: string) => Number(date.slice(8, 10)) * 10;

const daysOf = (range: DateRange): string[] => {
  const days: string[] = [];
  for (let d = range.start; d < range.end; d = addDays(d, 1)) days.push(toIsoDate(d));
  return days;
};

const usageRows = (days: readonly string[], value = tokens) =>
  days.map((date) => ({ date, dimension: 'total', key: null, outputTokens: value(date) }));

/** Re-fetchable test sources; `value` and `fail` can be changed between runs. */
function sources(options: { value?: (date: string) => number; fail?: Set<string> } = {}) {
  const fetches: string[] = [];
  const guard = (dataset: string) => {
    fetches.push(dataset);
    if (options.fail?.has(dataset)) throw new DataUnavailableError(`no key for ${dataset}`);
  };
  const usage: BackfillSource = {
    dataset: 'usage',
    source: 'test usage',
    async fetch(range) {
      guard('usage');
      return { items: usageRows(daysOf(range), options.value), asOf: range.end.toISOString() };
    },
  };
  const activities: BackfillSource = {
    dataset: 'activities',
    source: 'test activities',
    async fetch() {
      guard('activities');
      return { items: [{ id: 'a1', createdAt: '2026-09-03T10:00:00.000Z', type: 'user_login' }] };
    },
  };
  const memberActivity: BackfillSource = {
    dataset: 'memberActivity',
    source: 'test users',
    async fetch(range) {
      guard('memberActivity');
      return {
        items: [{ userId: 'user_1', email: 'alice@example.com', active: true, lastActiveOn: null }],
        window: { from: range.start.toISOString(), to: range.end.toISOString() },
      };
    },
  };
  const all = new Map([usage, activities, memberActivity].map((s) => [s.dataset, s]));
  return { source: (dataset: string) => all.get(dataset as never), fetches };
}

const DATASETS = ['activities', 'usage', 'memberActivity'];

const request = (now = SEAL_AT) => ({
  month: MONTH,
  datasets: DATASETS,
  plan: planBackfill({
    from: MONTH,
    to: MONTH,
    now,
    datasets: DATASETS.map((dataset) => ({ dataset, limit: {} })),
  }),
});

/** A September ledger as the collections recorded it (rolling-window roll-up, members state). */
async function collectedLedger(value = tokens): Promise<MemoryLedger> {
  const ledger = new MemoryLedger();
  const days = daysOf({
    start: new Date('2026-09-01T00:00:00Z'),
    end: new Date('2026-10-01T00:00:00Z'),
  });
  await updateLedger(
    [
      snapshotOf(
        '2026-09-30T18:00:00.000Z',
        {
          usage: usageRows(days, value),
          activities: [{ id: 'a1', createdAt: '2026-09-03T10:00:00.000Z', type: 'user_login' }],
          memberActivity: [{ userId: 'user_1', email: 'alice@example.com', active: false }],
          members: [{ id: 'user_1', email: 'alice@example.com', role: 'user' }],
        },
        { usage: { asOf: '2026-09-30T06:00:00.000Z' } },
      ),
    ],
    { repository: ledger, hash: fnv },
  );
  return ledger;
}

function deps(
  ledger: MemoryLedger,
  status: MemoryLedgerStatus,
  src: ReturnType<typeof sources>,
  extra: Partial<LedgerSealDeps> = {},
): LedgerSealDeps {
  return {
    source: src.source,
    repository: ledger,
    hash: fnv,
    clock: clock(SEAL_AT),
    status,
    ...extra,
  };
}

describe('sealLedgerMonth', () => {
  it('seals a month that matches the API and hands it to the sinks', async () => {
    const ledger = await collectedLedger();
    const status = new MemoryLedgerStatus();
    const delivered: string[] = [];
    const sink: SealedMonthSink = { id: 'test', deliver: async (m) => void delivered.push(m) };
    const result = await sealLedgerMonth(
      request(),
      deps(ledger, status, sources(), { sinks: [sink] }),
    );
    expect(result.outcome).toBe('sealed');
    expect(result.reasons).toEqual([]);
    expect(Object.fromEntries(result.checks.map((c) => [c.dataset, c.status]))).toEqual({
      activities: 'match',
      usage: 'match',
      memberActivity: 'replaced',
      members: 'kept',
    });
    const manifest = await ledger.manifest(MONTH);
    expect(manifest?.sealed).toBe(true);
    expect(manifest?.seal).toEqual({
      sealedAt: SEAL_AT.toISOString(),
      datasets: {
        activities: {
          policy: 'compare',
          window: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' },
          fetched: 1,
        },
        usage: {
          policy: 'compare',
          window: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' },
          fetched: 30,
        },
        memberActivity: {
          policy: 'replace',
          window: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' },
          fetched: 1,
        },
        members: { policy: 'keep' },
      },
    });
    // The roll-up now holds the API's calendar-month value.
    const [rollup] = await ledger.read(MONTH, 'memberActivity');
    expect(rollup?.item).toMatchObject({ active: true });
    expect(rollup?.window?.from).toBe('2026-09-01T00:00:00.000Z');
    expect(delivered).toEqual([MONTH]);
    expect(status.status.seals[MONTH]).toEqual({
      attemptedAt: SEAL_AT.toISOString(),
      outcome: 'sealed',
      reasons: [],
    });
    expect(ledgerSealAlert(result)).toBeNull();
  });

  it('does not seal and writes nothing when a row differs', async () => {
    const ledger = await collectedLedger((date) => (date === '2026-09-05' ? 1 : tokens(date)));
    const status = new MemoryLedgerStatus();
    const writes = ledger.writes;
    const before = structuredClone(await ledger.manifest(MONTH));
    const result = await sealLedgerMonth(request(), deps(ledger, status, sources()));
    expect(result.outcome).toBe('not-sealed');
    expect(result.reasons).toEqual(['usage: 0 missing, 0 extra, 1 changed row(s) on 2026-09-05']);
    expect(ledger.writes).toBe(writes);
    expect(await ledger.manifest(MONTH)).toEqual(before);
    expect(status.status.seals[MONTH]?.outcome).toBe('not-sealed');
    const alert = ledgerSealAlert(result, 'https://dashboard.example.com');
    expect(alert).toMatchObject({ key: 'ledger-seal:2026-09:not-sealed', severity: 'high' });
    expect(alert?.lines.at(-1)).toMatch(/ledger backfill --from 2026-09 --to 2026-09 --force/);
    expect(JSON.stringify(alert)).not.toContain('alice@');
  });

  it('refuses to seal before the revision period ended', async () => {
    const ledger = await collectedLedger();
    const early = new Date('2026-10-08T23:59:00.000Z');
    await expect(
      sealLedgerMonth(request(early), {
        ...deps(ledger, new MemoryLedgerStatus(), sources()),
        clock: clock(early),
      }),
    ).rejects.toThrow(/can be sealed from 2026-10-09T00:00:00.000Z/);
  });

  it('is blocked by a recorded dataset that cannot be re-fetched, not by a missing one', async () => {
    const ledger = await collectedLedger();
    const blocked = await sealLedgerMonth(
      request(),
      deps(ledger, new MemoryLedgerStatus(), sources({ fail: new Set(['usage']) })),
    );
    expect(blocked.outcome).toBe('not-sealed');
    expect(blocked.reasons).toEqual(['usage: cannot be re-fetched (no key for usage)']);
    // adoption is neither recorded nor available: skipped, the seal goes ahead.
    const withAdoption = { ...request(), datasets: [...DATASETS, 'adoption'] };
    const sealed = await sealLedgerMonth(
      withAdoption,
      deps(ledger, new MemoryLedgerStatus(), sources()),
    );
    expect(sealed.outcome).toBe('sealed');
    expect(sealed.checks.find((c) => c.dataset === 'adoption')).toMatchObject({
      status: 'skipped',
      reason: 'the API no longer (or not yet) serves the whole month',
    });
  });

  it('re-verifies a sealed month: differences go to revisions/, the files stay', async () => {
    const ledger = await collectedLedger();
    const status = new MemoryLedgerStatus();
    await sealLedgerMonth(request(), deps(ledger, status, sources()));
    const sealedText = ledger.files.get(`${MONTH}/usage`);
    const revised = sources({ value: (d) => (d === '2026-09-30' ? 999 : tokens(d)) });
    const result = await sealLedgerMonth(request(), deps(ledger, status, revised));
    expect(result.outcome).toBe('revised');
    expect(result.revisions).toEqual([{ month: MONTH, dataset: 'usage', count: 1 }]);
    expect(ledger.files.get(`${MONTH}/usage`)).toBe(sealedText);
    expect((await ledger.manifest(MONTH))?.revisions?.usage?.count).toBe(1);
    expect(ledgerSealAlert(result)).toMatchObject({ key: 'ledger-seal:2026-09:revised' });
    // The same difference again adds nothing.
    const again = await sealLedgerMonth(request(), deps(ledger, status, revised));
    expect(again.revisions).toEqual([]);
    const matching = await sealLedgerMonth(request(), deps(ledger, status, sources()));
    expect(matching.outcome).toBe('verified');
  });

  it('reports a failing sink and keeps the month sealed', async () => {
    const ledger = await collectedLedger();
    const sink: SealedMonthSink = {
      id: 'broken',
      deliver: async () => {
        throw new Error('offline');
      },
    };
    const result = await sealLedgerMonth(
      request(),
      deps(ledger, new MemoryLedgerStatus(), sources(), { sinks: [sink] }),
    );
    expect(result.outcome).toBe('sealed');
    expect(result.sinkFailures).toEqual([{ id: 'broken', reason: 'offline' }]);
    expect((await ledger.manifest(MONTH))?.sealed).toBe(true);
    expect(ledgerSealAlert(result)?.key).toBe('ledger-seal:2026-09:sink');
  });
});

describe('updateLedger on a sealed month', () => {
  it('appends changing entries to revisions/ once and never rewrites the month', async () => {
    const ledger = await collectedLedger();
    await sealLedgerMonth(request(), deps(ledger, new MemoryLedgerStatus(), sources()));
    const files = new Map(ledger.files);
    const late = snapshotOf(
      '2026-10-12T00:00:00.000Z',
      {
        usage: usageRows(['2026-09-30'], () => 5),
        activities: [{ id: 'a9', createdAt: '2026-09-30T23:59:00.000Z', type: 'user_login' }],
      },
      { usage: { asOf: '2026-10-12T00:00:00.000Z' } },
    );
    const first = await updateLedger([late], { repository: ledger, hash: fnv });
    expect(first.sealed).toEqual([MONTH]);
    expect(first.revisions).toEqual([
      { month: MONTH, dataset: 'activities', count: 1 },
      { month: MONTH, dataset: 'usage', count: 1 },
    ]);
    const again = await updateLedger([late], { repository: ledger, hash: fnv });
    expect(again.revisions).toEqual([]);
    for (const [path, text] of files) expect(ledger.files.get(path), path).toBe(text);
  });
});

describe('verifyLedger', () => {
  const settings = { dailyDatasets: ['usage'], lagDays: 3, maxStaleHours: 24 };

  it('passes on a complete, fresh ledger', async () => {
    const ledger = await collectedLedger();
    const status = new MemoryLedgerStatus();
    const result = await verifyLedger({
      repository: ledger,
      status,
      clock: clock(new Date('2026-10-01T12:00:00.000Z')),
      settings,
    });
    expect(result.record).toMatchObject({ status: 'pass', findings: [], failingSince: null });
    expect(result.failingDays).toBe(0);
    expect(status.status.verify?.status).toBe('pass');
    expect(ledgerVerifyAlert(result, 7)).toBeNull();
  });

  it('fails on a missing day and on a stale collection, counting the failing days', async () => {
    const ledger = await collectedLedger();
    const path = `${MONTH}/usage`;
    await ledger.write(
      MONTH,
      'usage',
      (ledger.entries.get(path) ?? []).filter((e) => !e.key.startsWith('2026-09-12')),
    );
    await ledger.refreshManifest(MONTH);
    const status = new MemoryLedgerStatus();
    const run = (at: string) =>
      verifyLedger({ repository: ledger, status, clock: clock(new Date(at)), settings });
    const first = await run('2026-10-02T05:30:00.000Z');
    expect(first.record.findings.map((f) => f.message)).toEqual([
      'usage 2026-09: 1 day(s) without rows: 2026-09-12',
      'Last recorded collection 35.5h ago (max 24h)',
    ]);
    expect(first.failingDays).toBe(1);
    const later = await run('2026-10-08T05:30:00.000Z');
    expect(later.record.failingSince).toBe('2026-10-02T05:30:00.000Z');
    expect(later.failingDays).toBe(7);
    expect(ledgerVerifyAlert(first, 7)).toBeNull();
    expect(ledgerVerifyAlert(later, 7)).toMatchObject({
      key: 'ledger-verify:fail',
      severity: 'high',
    });
  });

  it('checks the hashes of sealed months and reports new revisions once marked', async () => {
    const ledger = await collectedLedger();
    const status = new MemoryLedgerStatus();
    await sealLedgerMonth(request(), deps(ledger, status, sources()));
    const now = clock(new Date('2026-10-12T01:00:00.000Z'));
    // Only the sealed month is checked here (October has no rows, the last record is old).
    const sealedOnly = { dailyDatasets: [], lagDays: 3, maxStaleHours: 72 };
    await updateLedger(
      [
        snapshotOf('2026-10-12T00:00:00.000Z', {
          activities: [{ id: 'a9', createdAt: '2026-09-30T23:59:00.000Z', type: 'user_login' }],
        }),
      ],
      { repository: ledger, hash: fnv },
    );
    const clean = await verifyLedger({
      repository: ledger,
      status,
      clock: now,
      settings: sealedOnly,
    });
    expect(clean.record.findings).toEqual([]);
    expect(clean.revisions).toEqual([{ month: MONTH, count: 1, notified: 0 }]);
    expect(ledgerRevisionAlert(clean.revisions)?.lines[0]).toBe(
      '2026-09: 1 new revision entr(ies) (1 in total), kept in revisions/',
    );
    await markRevisionsNotified(status, clean.revisions);
    ledger.files.set(`${MONTH}/usage`, `${ledger.files.get(`${MONTH}/usage`) ?? ''} `);
    const tampered = await verifyLedger({
      repository: ledger,
      status,
      clock: now,
      settings: sealedOnly,
    });
    expect(tampered.revisions).toEqual([]);
    expect(tampered.record.findings.map((f) => f.message)).toEqual([
      '2026-09 usage: content hash differs from MANIFEST.json',
    ]);
  });
});
