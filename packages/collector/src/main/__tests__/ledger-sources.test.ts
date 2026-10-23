import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLedgerEntries, type LedgerEntry } from '@claude-audit/core';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { TENANT_FIXTURE_URL } from '../../__tests__/fixture-sets.js';
import {
  FIXTURE_ENV,
  FIXTURE_NOW,
  createFixtureFetch,
  fixtureState,
} from '../../adapters/fixture/fixture-source.js';
import {
  optionalFixturesRoot,
  withOptionalFixtures,
} from '../../adapters/fixture/optional-fixture.js';
import { gzipLedgerCodec } from '../../adapters/storage/ledger.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { createContainer } from '../container.js';
import { writeDetail } from '../detail.js';
import { ledgerCommand } from '../ledger.js';
import { collect, writeDashboard } from '../workflows.js';

vi.setConfig({ testTimeout: 60_000 });

const fixtureDir = fileURLToPath(TENANT_FIXTURE_URL);
const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function entriesOf(dir: string, month: string, dataset: string): Promise<LedgerEntry[]> {
  const bytes = await readFile(join(dir, 'ledger', month, `${dataset}.jsonl.gz`));
  return parseLedgerEntries(gzipLedgerCodec.decode(bytes), dataset);
}

/** The fixture tenant with only the daily member activity source on, collected and recorded. */
async function collectAndRecord() {
  const dir = await mkdtemp(join(tmpdir(), 'ledger-sources-'));
  roots.push(dir);
  const replay = await withOptionalFixtures(
    await createFixtureFetch(fixtureDir),
    optionalFixturesRoot(fixtureDir),
  );
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const c = await createContainer({
    env: { ...FIXTURE_ENV, CONFIG_DIR: join(dir, 'no-config') },
    cwd: dir,
    dataDir: dir,
    clock: fixedClock(FIXTURE_NOW),
    fetchImpl: replay.fetch,
    logger,
    source: 'demo',
    configPatch: (config) => ({
      ...config,
      sources: { ...config.sources, memberActivityDaily: { enabled: true, lookbackDays: 1 } },
    }),
  });
  await c.state.save(fixtureState(FIXTURE_NOW));
  const snapshot = await collect(c);
  await ledgerCommand.run(c, ['update']);
  return { c, dir, snapshot, replay, logger };
}

describe('ledger-oriented fetching on the fixture tenant (#158)', () => {
  it('records the daily member activity of the latest published day, one entry per member', async () => {
    const { dir, snapshot, replay } = await collectAndRecord();
    // 2026-09-30 12:00 UTC is before 13:30: the newest published day is 2026-09-28.
    const daily = replay.calls.filter((u) => u.searchParams.has('date'));
    expect(daily.map((u) => [u.searchParams.get('date'), u.searchParams.get('page')])).toEqual([
      ['2026-09-28', null],
      ['2026-09-28', 'page_fx_daily_2'],
    ]);
    expect(snapshot.coverage.memberActivityDaily).toMatchObject({ status: 'ok', count: 3 });
    const entries = await entriesOf(dir, '2026-09', 'memberActivityDaily');
    expect(entries.map((e) => e.key)).toEqual([
      '2026-09-28|user_fx_daily_01',
      '2026-09-28|user_fx_daily_02',
      '2026-09-28|user_fx_daily_03',
    ]);
    expect(entries[2]?.item).toMatchObject({ active: false, lastActiveOn: null });
  });

  it('records the model-only cost and usage rows as daily ledger entries', async () => {
    const { dir, snapshot } = await collectAndRecord();
    const models = (snapshot.data.cost ?? []).filter((r) => r.dimension === 'model');
    expect(models.length).toBeGreaterThan(0);
    for (const dataset of ['cost', 'usage']) {
      const keys = (await entriesOf(dir, '2026-09', dataset)).map((e) => e.key);
      expect(
        keys.some((k) => /^2026-09-\d\d\|model\|/.test(k)),
        dataset,
      ).toBe(true);
      expect(
        keys.some((k) => /^2026-09-\d\d\|total\|$/.test(k)),
        dataset,
      ).toBe(true);
    }
  });

  it('never publishes the per-member rows (dashboard.json and detail/)', async () => {
    const { c } = await collectAndRecord();
    const published = [
      JSON.stringify(await writeDashboard(c)),
      ...Object.values(await writeDetail(c)),
    ].join('\n');
    expect(published).toContain('memberActivityDaily');
    expect(published).not.toContain('user_fx_daily_');
  });
});
