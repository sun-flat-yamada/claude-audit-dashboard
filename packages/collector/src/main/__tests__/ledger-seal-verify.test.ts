import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SNAPSHOT_SCHEMA_VERSION,
  ledgerStatusSchema,
  timestampId,
  type LedgerManifest,
  type Logger,
} from '@claude-audit/core';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { MOCK_KEY, backfillTenant } from '../../__tests__/backfill-tenant.js';
import { fakeTimer } from '../../__tests__/fake-timer.js';
import { FsLedgerRepository, gzipLedgerCodec } from '../../adapters/storage/ledger.js';
import { LEDGER_STATUS, ledgerHealthCollector } from '../../adapters/storage/ledger-status.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { createContainer } from '../container.js';
import { parseSealArgs } from '../ledger-seal.js';
import { parseVerifyArgs } from '../ledger-verify.js';
import { ledgerCommand } from '../ledger.js';

vi.setConfig({ testTimeout: 60_000 });

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

const NOW = new Date('2026-10-23T15:00:00.000Z');

const logger = (): Logger & { lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`info ${m}`),
    warn: (m) => lines.push(`warn ${m}`),
    error: (m) => lines.push(`error ${m}`),
  };
};

async function setup(now = NOW, dir?: string) {
  const root = dir ?? (await mkdtemp(join(tmpdir(), 'ledger-seal-')));
  if (!dir) roots.push(root);
  const { timer, timing } = fakeTimer();
  const tenant = backfillTenant(now, () => timer.t);
  const log = logger();
  const c = await createContainer({
    env: { ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY, CONFIG_DIR: join(root, 'no-config') },
    cwd: root,
    dataDir: root,
    clock: fixedClock(now),
    fetchImpl: tenant.fetch,
    httpTiming: timing,
    logger: log,
  });
  return { c, dir: root, log };
}

const manifestOf = async (dir: string, month: string) =>
  JSON.parse(await readFile(join(dir, 'ledger', month, 'MANIFEST.json'), 'utf8')) as LedgerManifest;

const statusOf = async (dir: string) =>
  ledgerStatusSchema.parse(JSON.parse(await readFile(join(dir, LEDGER_STATUS), 'utf8')));

/** Rewrites one ledger file with `edit` applied, as a broken collection or a tamper would. */
async function editFile(
  c: Awaited<ReturnType<typeof setup>>['c'],
  month: string,
  dataset: string,
  edit: (entries: Awaited<ReturnType<FsLedgerRepository['read']>>) => typeof entries,
  refresh = true,
) {
  const repository = new FsLedgerRepository(c.store);
  await repository.write(month, dataset, edit(await repository.read(month, dataset)));
  if (refresh) await repository.refreshManifest(month);
}

describe('ledger seal and verify on a synthetic tenant (#160)', () => {
  it('seals a month that matches the API, verifies the ledger and reports a healthy row', async () => {
    const { c, dir, log } = await setup();
    await ledgerCommand.run(c, ['backfill', '--from', '2026-09', '--to', '2026-10']);
    await ledgerCommand.run(c, ['seal', '--month', '2026-09', '--notify']);
    const manifest = await manifestOf(dir, '2026-09');
    expect(manifest.sealed).toBe(true);
    expect(manifest.seal?.sealedAt).toBe(NOW.toISOString());
    expect(Object.keys(manifest.seal?.datasets ?? {}).sort()).toEqual([
      'activities',
      'adoption',
      'cost',
      'memberActivity',
      'usage',
    ]);
    expect(manifest.seal?.datasets.usage).toMatchObject({ policy: 'compare', fetched: 150 });
    expect((await statusOf(dir)).seals['2026-09']?.outcome).toBe('sealed');
    expect(log.lines).toContain('info Seal 2026-09: sealed');
    // A matching seal sends nothing.
    expect(log.lines.some((l) => l.includes('Sent "'))).toBe(false);

    await ledgerCommand.run(c, ['verify', '--notify']);
    const status = await statusOf(dir);
    expect(status.verify).toMatchObject({ status: 'pass', findings: [], failingSince: null });
    expect(log.lines).toContainEqual('info Ledger verify pass: 2 month(s), 1 sealed, 0 finding(s)');
    const { items } = await ledgerHealthCollector(c.store).collect({
      now: NOW,
      range: { start: NOW, end: NOW },
      cursor: undefined,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.months.map((m) => [m.month, m.sealed])).toEqual([
      ['2026-09', true],
      ['2026-10', false],
    ]);
  });

  it('fails verify on a removed day and refuses to seal a changed month, with notifications', async () => {
    const { c, dir, log } = await setup();
    await ledgerCommand.run(c, ['backfill', '--from', '2026-09', '--to', '2026-10']);
    await editFile(c, '2026-10', 'usage', (list) =>
      list.filter((e) => !e.key.startsWith('2026-10-05|')),
    );
    await ledgerCommand.run(c, ['verify']);
    const status = await statusOf(dir);
    expect(status.verify?.status).toBe('fail');
    expect(status.verify?.findings).toEqual([
      {
        check: 'gap',
        month: '2026-10',
        dataset: 'usage',
        message: 'usage 2026-10: 1 day(s) without rows: 2026-10-05',
        dates: ['2026-10-05'],
      },
    ]);

    await editFile(c, '2026-09', 'cost', (list) =>
      list.map((e) =>
        e.key === '2026-09-07|total|' ? { ...e, item: { ...(e.item as object), amount: 1 } } : e,
      ),
    );
    await expect(ledgerCommand.run(c, ['seal', '--month', '2026-09', '--notify'])).rejects.toThrow(
      /Ledger 2026-09 was not sealed/,
    );
    expect((await manifestOf(dir, '2026-09')).sealed).toBe(false);
    expect((await statusOf(dir)).seals['2026-09']).toMatchObject({
      outcome: 'not-sealed',
      reasons: ['cost: 0 missing, 0 extra, 1 changed row(s) on 2026-09-07'],
    });
    expect(log.lines).toContainEqual(
      expect.stringMatching(/^info \[high\] Ledger 2026-09 not sealed: 1 dataset\(s\) differ/),
    );
  });

  it('keeps a sealed month: later entries go to revisions/, a tampered file fails verify', async () => {
    const first = await setup();
    await ledgerCommand.run(first.c, ['backfill', '--from', '2026-09', '--to', '2026-10']);
    await ledgerCommand.run(first.c, ['seal', '--month', '2026-09']);
    const sealedUsage = await readFile(join(first.dir, 'ledger', '2026-09', 'usage.jsonl.gz'));

    // A later collection still sees a revised value for the last day of the sealed month.
    const later = new Date('2026-10-24T06:00:00.000Z');
    const { c, dir, log } = await setup(later, first.dir);
    await c.snapshots.save({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      id: timestampId(later),
      collectedAt: later.toISOString(),
      coverage: { usage: { status: 'ok', asOf: later.toISOString() } },
      data: {
        usage: [
          {
            date: '2026-09-30',
            dimension: 'total',
            key: null,
            uncachedInputTokens: 1,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            outputTokens: 1,
            webSearchRequests: 0,
            requests: null,
          },
        ],
      },
    });
    await ledgerCommand.run(c, ['update']);
    expect(await readFile(join(dir, 'ledger', '2026-09', 'usage.jsonl.gz'))).toEqual(sealedUsage);
    const revision = gzipLedgerCodec.decode(
      await readFile(join(dir, 'ledger', '2026-09', 'revisions', 'usage.jsonl.gz')),
    );
    expect(revision.trim().split('\n')).toHaveLength(1);
    expect((await manifestOf(dir, '2026-09')).revisions?.usage?.count).toBe(1);
    expect(log.lines).toContainEqual(
      'warn Ledger: 1 usage entr(ies) for sealed 2026-09 added to revisions/',
    );

    await ledgerCommand.run(c, ['verify', '--notify']);
    expect(log.lines).toContainEqual(
      expect.stringMatching(
        /^info \[medium\] Sealed ledger month\(s\) changed afterwards: 2026-09/,
      ),
    );
    expect((await statusOf(dir)).notifiedRevisions).toEqual({ '2026-09': 1 });

    const costPath = join(dir, 'ledger', '2026-09', 'cost.jsonl.gz');
    await writeFile(costPath, gzipLedgerCodec.encode('{"item":{},"key":"x","recordedAt":"r"}\n'));
    await ledgerCommand.run(c, ['verify']);
    expect((await statusOf(dir)).verify?.findings.map((f) => f.message)).toContain(
      '2026-09 cost: content hash differs from MANIFEST.json',
    );
  });

  it('validates the arguments and refuses an early seal', async () => {
    expect(parseSealArgs([])).toEqual({ month: undefined, notify: false });
    expect(parseSealArgs(['--month', '2026-09', '--notify'])).toEqual({
      month: '2026-09',
      notify: true,
    });
    expect(() => parseSealArgs(['--month'])).toThrow(/requires a value/);
    expect(() => parseSealArgs(['--force'])).toThrow(/Unknown option/);
    expect(parseVerifyArgs(['--json'])).toEqual({ notify: false, json: true });
    expect(() => parseVerifyArgs(['--month'])).toThrow(/Unknown option/);
    const { c } = await setup();
    await expect(ledgerCommand.run(c, ['seal', '--month', '2026-10'])).rejects.toThrow(
      /2026-10 can be sealed from 2026-11-09/,
    );
    await expect(ledgerCommand.run(c, ['seal', '--month', '2026-9'])).rejects.toThrow(
      /--month must be a month/,
    );
  });
});
