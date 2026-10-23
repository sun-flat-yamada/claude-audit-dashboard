import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLedgerEntries, type LedgerEntry, type Logger } from '@claude-audit/core';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { MOCK_KEY, backfillTenant, type TenantCall } from '../../__tests__/backfill-tenant.js';
import { fakeTimer } from '../../__tests__/fake-timer.js';
import { BACKFILL_MIN_INTERVAL_MS } from '../../adapters/anthropic/backfill-sources.js';
import { BACKFILL_PROGRESS } from '../../adapters/storage/backfill-progress.js';
import { gzipLedgerCodec } from '../../adapters/storage/ledger.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { createContainer } from '../container.js';
import { defaultBackfillDatasets, parseBackfillArgs } from '../ledger-backfill.js';
import { ledgerCommand } from '../ledger.js';

vi.setConfig({ testTimeout: 60_000 });

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

const logger = (): Logger & { lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`info ${m}`),
    warn: (m) => lines.push(`warn ${m}`),
    error: (m) => lines.push(`error ${m}`),
  };
};

interface Setup {
  now: Date;
  dir?: string;
  optional?: boolean;
  activityPageSize?: number;
}

async function setup({ now, dir: given, optional = true, activityPageSize }: Setup) {
  const dir = given ?? (await mkdtemp(join(tmpdir(), 'ledger-backfill-')));
  if (!given) roots.push(dir);
  const { timer, timing } = fakeTimer();
  const tenant = backfillTenant(now, () => timer.t);
  const log = logger();
  const c = await createContainer({
    env: { ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY, CONFIG_DIR: join(dir, 'no-config') },
    cwd: dir,
    dataDir: dir,
    clock: fixedClock(now),
    fetchImpl: tenant.fetch,
    httpTiming: timing,
    logger: log,
    configPatch: (config) => ({
      ...config,
      sources: {
        ...config.sources,
        memberActivityDaily: { enabled: optional, lookbackDays: 3 },
        featureUsage: { enabled: optional, lookbackDays: 30 },
        activities: { ...config.sources.activities, pageSize: activityPageSize ?? 5000 },
      },
    }),
  });
  return { c, dir, tenant, timer, log };
}

async function entries(dir: string, month: string, dataset: string): Promise<LedgerEntry[]> {
  const bytes = await readFile(join(dir, 'ledger', month, `${dataset}.jsonl.gz`));
  return parseLedgerEntries(gzipLedgerCodec.decode(bytes), dataset);
}

const datesOf = (list: LedgerEntry[]) =>
  [...new Set(list.map((e) => (e.item as { date?: string }).date))].sort();

/** Every UTC date from `from` up to and including `to`. */
function everyDate(from: string, to: string): string[] {
  const dates: string[] = [];
  for (
    let at = Date.parse(`${from}T00:00:00Z`);
    at <= Date.parse(`${to}T00:00:00Z`);
    at += 86_400_000
  )
    dates.push(new Date(at).toISOString().slice(0, 10));
  return dates;
}

const lastDayOf = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);

const MONTHS = [
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
  '2026-10',
];

const NOW = new Date('2026-10-23T15:00:00.000Z');

describe('ledger backfill on a synthetic tenant (#159)', () => {
  it('fills 2026-01 to the current month without a gap', async () => {
    const { c, dir, log } = await setup({ now: NOW });
    await ledgerCommand.run(c, ['backfill', '--from', '2026-01']);
    for (const month of MONTHS) {
      const last = month === '2026-10' ? '2026-10-23' : lastDayOf(month);
      const yesterday = month === '2026-10' ? '2026-10-22' : lastDayOf(month);
      const days = everyDate(`${month}-01`, last);
      for (const dataset of ['usage', 'cost'] as const) {
        const list = await entries(dir, month, dataset);
        expect(datesOf(list), `${month} ${dataset}`).toEqual(days);
        // total + product + group + two models per day
        expect(list).toHaveLength(days.length * 5);
      }
      expect(datesOf(await entries(dir, month, 'adoption'))).toEqual(
        everyDate(`${month}-01`, yesterday),
      );
      expect(datesOf(await entries(dir, month, 'memberActivityDaily'))).toEqual(
        everyDate(`${month}-01`, yesterday),
      );
      const activity = await entries(dir, month, 'activities');
      expect(activity.map((e) => (e.item as { createdAt: string }).createdAt.slice(0, 10))).toEqual(
        days,
      );
      // Roll-ups of a past month are filed under that month, over the whole month.
      const rollup = await entries(dir, month, 'memberActivity');
      expect(rollup.map((e) => e.key)).toEqual(['user_fx_backfill_01', 'user_fx_backfill_02']);
      expect(rollup[0]?.window?.from).toBe(`${month}-01T00:00:00.000Z`);
      for (const dataset of ['skillUsage', 'connectorUsage', 'pluginUsage', 'chatProjectUsage'])
        expect(await entries(dir, month, dataset), `${month} ${dataset}`).toHaveLength(1);
    }
    expect(log.lines.filter((l) => l.startsWith('warn '))).toEqual([]);
    expect(log.lines).toContainEqual(
      expect.stringMatching(/state datasets are not backfilled.*members.*settings/),
    );
    expect(log.lines).toContainEqual(
      expect.stringMatching(/Backfill: 100 fetched, 0 skipped, 0 unavailable, 0 failed/),
    );
    // The model rows of each day add up to the total: no reconciliation warning.
    const progress = JSON.parse(await readFile(join(dir, BACKFILL_PROGRESS), 'utf8')) as {
      units: Record<string, unknown>;
    };
    expect(Object.keys(progress.units)).toHaveLength(100);
    // No snapshot is written by a backfill.
    expect(await readdir(dir)).not.toContain('snapshots');
  });

  it('excludes usage / cost older than 365 days with a warning and keeps the rest', async () => {
    const later = new Date('2027-02-15T15:00:00.000Z');
    const { c, dir, log, tenant } = await setup({ now: later });
    await ledgerCommand.run(c, [
      'backfill',
      '--from',
      '2026-01',
      '--to',
      '2027-02',
      '--datasets',
      'usage,cost,adoption',
    ]);
    const warnings = log.lines.filter((l) => l.startsWith('warn '));
    expect(warnings).toEqual([
      'warn Backfill: usage 2026-01-01 .. 2026-02-15 excluded: older than the last 365 days usage_report / cost_report serve',
      'warn Backfill: cost 2026-01-01 .. 2026-02-15 excluded: older than the last 365 days usage_report / cost_report serve',
    ]);
    await expect(entries(dir, '2026-01', 'usage')).rejects.toThrow(/ENOENT/);
    expect(datesOf(await entries(dir, '2026-02', 'cost'))).toEqual(
      everyDate('2026-02-16', '2026-02-28'),
    );
    expect(datesOf(await entries(dir, '2026-01', 'adoption'))).toHaveLength(31);
    // The tenant rejects anything outside the limits with 400: none was sent.
    const starts = tenant.calls
      .filter((call) => call.url.pathname.endsWith('_report'))
      .map((call) => call.url.searchParams.get('starting_at') ?? '');
    expect(starts.sort()[0]).toBe('2026-02-16T00:00:00.000Z');
  });

  it('continues from where an interrupted run stopped', async () => {
    const { c, dir, tenant } = await setup({ now: NOW, optional: false });
    const march = (url: URL) =>
      url.pathname.endsWith('/cost_report') &&
      (url.searchParams.get('starting_at') ?? '').startsWith('2026-03');
    tenant.failAlways(march, 400);
    await expect(ledgerCommand.run(c, ['backfill', '--from', '2026-01'])).rejects.toThrow(
      /1 unit\(s\) failed \(2026-03 cost\); run it again to continue/,
    );
    const before = await readFile(join(dir, 'ledger', '2026-02', 'cost.jsonl.gz'));
    tenant.heal();
    tenant.calls.length = 0;
    await ledgerCommand.run(c, ['backfill', '--from', '2026-01']);
    const again = tenant.calls.map((call) => {
      const start =
        call.url.searchParams.get('starting_at') ??
        call.url.searchParams.get('starting_date') ??
        call.url.searchParams.get('created_at.gte') ??
        '';
      return `${call.url.pathname.split('/').at(-1) ?? ''} ${start.slice(0, 7)}`;
    });
    // Only the failed unit and the units of the current month (still revised) are fetched again.
    expect([...new Set(again)].sort()).toEqual([
      'activities 2026-10',
      'cost_report 2026-03',
      'cost_report 2026-10',
      'summaries 2026-10',
      'usage_report 2026-10',
      'users 2026-10',
    ]);
    expect(datesOf(await entries(dir, '2026-03', 'cost'))).toHaveLength(31);
    // The months fetched before keep their bytes.
    expect(await readFile(join(dir, 'ledger', '2026-02', 'cost.jsonl.gz'))).toEqual(before);
  });

  it('keeps every API family under its rate limit (replaced clock)', async () => {
    const { c, tenant, timer } = await setup({ now: NOW, activityPageSize: 1 });
    // One 429 with retry-after: 30 on the first summaries request.
    tenant.failOnce((url) => url.pathname.endsWith('/summaries'), 429, { 'retry-after': '30' });
    await ledgerCommand.run(c, ['backfill', '--from', '2026-08']);
    const byFamily = (family: TenantCall['family']) =>
      tenant.calls.filter((call) => call.family === family).map((call) => call.at);
    const maxPerMinute = (starts: number[]) =>
      Math.max(...starts.map((t0) => starts.filter((t) => t >= t0 && t < t0 + 60_000).length));
    const minGap = (starts: number[]) =>
      Math.min(...starts.slice(1).map((t, i) => t - (starts[i] ?? 0)));
    const analytics = byFamily('analytics');
    const compliance = byFamily('compliance');
    expect(analytics.length).toBeGreaterThan(60);
    expect(compliance.length).toBeGreaterThan(80);
    expect(minGap(analytics)).toBeGreaterThanOrEqual(BACKFILL_MIN_INTERVAL_MS.analytics);
    expect(minGap(compliance)).toBeGreaterThanOrEqual(BACKFILL_MIN_INTERVAL_MS.compliance);
    expect(maxPerMinute(analytics)).toBeLessThanOrEqual(60);
    expect(maxPerMinute(compliance)).toBeLessThanOrEqual(600);
    // The 429 was retried after the 30 seconds it asked for.
    const summaries = tenant.calls.filter((call) => call.url.pathname.endsWith('/summaries'));
    expect((summaries[1]?.at ?? 0) - (summaries[0]?.at ?? 0)).toBeGreaterThanOrEqual(30_000);
    expect(timer.slept).toContain(30_000);
  });
});

describe('ledger backfill arguments', () => {
  it('backfills the built-in datasets by default and the optional ones when enabled', async () => {
    const off = await setup({ now: NOW, optional: false });
    expect(defaultBackfillDatasets(off.c)).toEqual([
      'activities',
      'usage',
      'cost',
      'adoption',
      'memberActivity',
    ]);
    const on = await setup({ now: NOW });
    expect(defaultBackfillDatasets(on.c)).toContain('memberActivityDaily');
    expect(defaultBackfillDatasets(on.c)).toContain('chatProjectUsage');
  });

  it('validates the options', async () => {
    const { c } = await setup({ now: NOW });
    expect(
      parseBackfillArgs(c, ['--from', '2026-01', '--datasets', 'usage, cost', '--force']),
    ).toEqual({
      from: '2026-01',
      to: undefined,
      datasets: ['usage', 'cost'],
      force: true,
    });
    expect(() => parseBackfillArgs(c, [])).toThrow(/--from <yyyy-mm> is required/);
    expect(() => parseBackfillArgs(c, ['--from', '--to'])).toThrow(/--from requires a value/);
    expect(() => parseBackfillArgs(c, ['--from', '2026-01', '--datasets', 'members'])).toThrow(
      /Unknown backfill dataset: members/,
    );
    expect(() => parseBackfillArgs(c, ['--from', '2026-01', '--since'])).toThrow(
      /Unknown option\(s\): --since/,
    );
    await expect(
      ledgerCommand.run(c, ['backfill', '--from', '2026-01', '--to', '2026-12']),
    ).rejects.toThrow(/after the current month/);
  });

  it('reports a dataset without a key as unavailable and does not fail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ledger-backfill-nokey-'));
    roots.push(dir);
    const log = logger();
    const c = await createContainer({
      env: { ANTHROPIC_ANALYTICS_API_KEY: MOCK_KEY, CONFIG_DIR: join(dir, 'no-config') },
      cwd: dir,
      dataDir: dir,
      clock: fixedClock(NOW),
      fetchImpl: backfillTenant(NOW).fetch,
      httpTiming: fakeTimer().timing,
      logger: log,
    });
    await ledgerCommand.run(c, ['backfill', '--from', '2026-10', '--datasets', 'activities,usage']);
    expect(log.lines).toContainEqual(
      expect.stringMatching(/Backfill 2026-10 activities unavailable: No key for/),
    );
    expect(log.lines).toContainEqual(expect.stringMatching(/1 fetched, 0 skipped, 1 unavailable/));
  });
});
