import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { transferManifestOf, type LedgerManifest, type Logger } from '@claude-audit/core';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { MOCK_KEY, backfillTenant } from '../../__tests__/backfill-tenant.js';
import { fakeTimer } from '../../__tests__/fake-timer.js';
import {
  FakeGoogle,
  FakeMicrosoft,
  GOOGLE,
  MICROSOFT,
  OIDC_JWT,
  OIDC_REQUEST_TOKEN,
  gdriveVariables,
  routed,
  sharepointVariables,
} from '../../adapters/ledger-sinks/__tests__/fake-cloud.js';
import { generateIdentity, generatePipelineKey } from '../../adapters/storage/ledger-crypto.js';
import { stableStringify } from '../../adapters/storage/file-store.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { createContainer } from '../container.js';
import { parsePushArgs } from '../ledger-push.js';
import { ledgerCommand } from '../ledger.js';

vi.setConfig({ testTimeout: 90_000 });

const roots: string[] = [];
const tempDir = async (name: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`));
  roots.push(dir);
  return dir;
};
afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

const NOW = new Date('2026-10-23T15:00:00.000Z');
const OWNER = generateIdentity();
const PIPELINE = generatePipelineKey();

const logger = (): Logger & { lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`info ${m}`),
    warn: (m) => lines.push(`warn ${m}`),
    error: (m) => lines.push(`error ${m}`),
  };
};

interface SetupOptions {
  ledger?: Record<string, unknown>;
  env?: Record<string, string>;
  cloud?: FakeGoogle | FakeMicrosoft;
}

async function setup(dir: string, options: SetupOptions = {}) {
  const { timer, timing } = fakeTimer();
  const tenant = backfillTenant(NOW, () => timer.t);
  const log = logger();
  const c = await createContainer({
    env: {
      ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY,
      CONFIG_DIR: join(dir, 'no-config'),
      ...(options.ledger
        ? { AUDIT_CONFIG_OVERRIDES: JSON.stringify({ ledger: options.ledger }) }
        : {}),
      ...options.env,
    },
    cwd: dir,
    dataDir: dir,
    clock: fixedClock(NOW),
    fetchImpl: options.cloud ? routed(options.cloud, tenant.fetch) : tenant.fetch,
    httpTiming: timing,
    logger: log,
  });
  return { c, log };
}

/** Files under `root` as `<relative path>` -> bytes. */
async function tree(root: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true }))
    if (entry.isFile())
      files.set(
        relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'),
        await readFile(join(entry.parentPath, entry.name)),
      );
  return files;
}

const manifestOf = async (dir: string, month: string) =>
  JSON.parse(await readFile(join(dir, 'ledger', month, 'MANIFEST.json'), 'utf8')) as LedgerManifest;

/** No log line carries a token, a storage ID, a URL or ledger content. */
function expectCleanLogs(lines: readonly string[]): void {
  const secrets = [
    OIDC_JWT,
    OIDC_REQUEST_TOKEN,
    ...Object.values(GOOGLE),
    ...Object.values(MICROSOFT),
  ];
  for (const line of lines) {
    for (const secret of secrets) expect(line).not.toContain(secret);
    expect(line).not.toMatch(/https?:\/\/|@example\.|192\.0\.2\./);
  }
}

async function backfill(c: Awaited<ReturnType<typeof setup>>['c']) {
  await ledgerCommand.run(c, ['backfill', '--from', '2026-09', '--to', '2026-10']);
}

describe('ledger push to the filesystem sink (#161 U7)', () => {
  it('copies a month when it is sealed, as stored, restorable by hand, idempotently', async () => {
    const dir = await tempDir('ledger-push');
    const copies = await tempDir('ledger-copies');
    const { c, log } = await setup(dir, {
      ledger: { sink: 'filesystem' },
      env: { LEDGER_SINK_DIR: copies },
    });
    await backfill(c);
    await ledgerCommand.run(c, ['seal', '--month', '2026-09', '--notify']);

    // The seal hook copied the month in the ledger's own layout.
    const local = await tree(join(dir, 'ledger', '2026-09'));
    const copied = await tree(join(copies, '2026-09'));
    expect([...copied.keys()].sort()).toEqual([...local.keys()].sort());
    for (const [name, bytes] of copied)
      if (name !== 'MANIFEST.json')
        expect(bytes.equals(local.get(name) ?? Buffer.alloc(0))).toBe(true);
    const manifest = await manifestOf(dir, '2026-09');
    expect(manifest.transfers).toEqual({
      filesystem: { transferredAt: NOW.toISOString(), files: copied.size },
    });
    expect(copied.get('MANIFEST.json')?.toString('utf8')).toBe(
      stableStringify(transferManifestOf(manifest)),
    );

    // A second push uploads nothing and leaves the manifest as it is.
    const before = await readFile(join(dir, 'ledger', '2026-09', 'MANIFEST.json'));
    await ledgerCommand.run(c, ['push', '--month', '2026-09']);
    expect(log.lines.at(-1)).toBe(
      `info Push 2026-09 to filesystem: 0 file(s) copied, ${String(copied.size)} already there, all verified against MANIFEST.json`,
    );
    expect((await readFile(join(dir, 'ledger', '2026-09', 'MANIFEST.json'))).equals(before)).toBe(
      true,
    );

    // Only sealed months are copied; --all copies every sealed month.
    await expect(ledgerCommand.run(c, ['push', '--month', '2026-10'])).rejects.toThrow(
      /not copied to filesystem: 2026-10/,
    );
    expect(log.lines).toContain(
      'error Push 2026-10 to filesystem failed: Ledger 2026-10 is not sealed: only sealed months are copied',
    );
    await ledgerCommand.run(c, ['push', '--all']);
    expect(log.lines.at(-1)).toMatch(/^info Push 2026-09 to filesystem: 0 file\(s\) copied/);

    // Restoring by hand: the copied month dropped into a fresh data directory verifies.
    const restored = await tempDir('ledger-restored');
    await cp(join(copies, '2026-09'), join(restored, 'ledger', '2026-09'), { recursive: true });
    const fresh = await setup(restored);
    await ledgerCommand.run(fresh.c, ['verify']);
    expect(fresh.log.lines.some((l) => /HASH/.test(l))).toBe(false);
    expect(await fresh.c.ledger().digests('2026-09')).toEqual(await c.ledger().digests('2026-09'));
    expectCleanLogs(log.lines);
  });

  it('changes nothing with the default sink none', async () => {
    const dir = await tempDir('ledger-none');
    const { c, log } = await setup(dir);
    expect(c.sealSinks).toEqual([]);
    expect(c.ledgerSink()).toBeNull();
    await backfill(c);
    await ledgerCommand.run(c, ['seal', '--month', '2026-09']);
    expect((await manifestOf(dir, '2026-09')).transfers).toBeUndefined();
    await ledgerCommand.run(c, ['push', '--month', '2026-09']);
    expect(log.lines.at(-1)).toBe('info Push: ledger.sink is none, no month is copied');
  });

  it('parses its arguments', () => {
    expect(parsePushArgs([])).toEqual({ month: undefined, all: false, notify: false });
    expect(parsePushArgs(['--month', '2026-09', '--notify'])).toEqual({
      month: '2026-09',
      all: false,
      notify: true,
    });
    expect(() => parsePushArgs(['--month'])).toThrow(/requires a value/);
    expect(() => parsePushArgs(['--month', '2026-9'])).toThrow(/must be a month/);
    expect(() => parsePushArgs(['--all', '--month', '2026-09'])).toThrow(/cannot be combined/);
    expect(() => parsePushArgs(['--force'])).toThrow(/Unknown option/);
  });
});

describe('ledger push to the cloud sinks (HTTP fakes)', () => {
  it('copies an encrypted month to SharePoint as stored bytes', async () => {
    const dir = await tempDir('ledger-sharepoint');
    const microsoft = new FakeMicrosoft();
    const { c, log } = await setup(dir, {
      ledger: { sink: 'sharepoint', encryption: { recipients: [OWNER.recipient] } },
      env: { ...sharepointVariables, LEDGER_PIPELINE_KEY: PIPELINE },
      cloud: microsoft,
    });
    await backfill(c);
    await ledgerCommand.run(c, ['seal', '--month', '2026-09']);
    const local = await tree(join(dir, 'ledger', '2026-09'));
    const names = [...local.keys()].filter((n) => n !== 'MANIFEST.json');
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n.endsWith('.jsonl.gz.enc'))).toBe(true);
    for (const name of names)
      expect(
        Buffer.from(microsoft.items.get(`claude-audit-ledger/2026-09/${name}`) ?? []).equals(
          local.get(name) ?? Buffer.alloc(0),
        ),
      ).toBe(true);
    expect((await manifestOf(dir, '2026-09')).transfers?.sharepoint?.files).toBe(names.length + 1);
    await ledgerCommand.run(c, ['push', '--month', '2026-09']);
    expect(log.lines.at(-1)).toMatch(/0 file\(s\) copied/);
    expect(microsoft.leakedAuth).toEqual([]);
    expectCleanLogs(log.lines);
  });

  it('reports and notifies a failed copy to Google Drive without secrets, and a re-run completes it', async () => {
    const dir = await tempDir('ledger-gdrive');
    const google = new FakeGoogle();
    const { c, log } = await setup(dir, {
      ledger: { sink: 'gdrive' },
      env: gdriveVariables,
      cloud: google,
    });
    await backfill(c);
    // Every upload of the seal hook and of the first push fails.
    for (let i = 0; i < 6; i += 1)
      google.failures.push({ match: (r) => r.url.includes('upload_id'), status: 500 });
    await ledgerCommand.run(c, ['seal', '--month', '2026-09', '--notify']);
    expect(
      log.lines.some((l) =>
        /^warn Seal 2026-09: sink gdrive failed: gdrive: 2026-09\/\S+ not copied after 3 attempt\(s\)/.test(
          l,
        ),
      ),
    ).toBe(true);
    await expect(ledgerCommand.run(c, ['push', '--month', '2026-09', '--notify'])).rejects.toThrow(
      'Ledger month(s) not copied to gdrive: 2026-09',
    );
    expect(log.lines.some((l) => l.includes('Ledger 2026-09 not copied to gdrive'))).toBe(true);
    expect((await manifestOf(dir, '2026-09')).transfers).toBeUndefined();
    expect([...google.files().keys()]).not.toContain('2026-09/MANIFEST.json');

    await ledgerCommand.run(c, ['push', '--month', '2026-09']);
    const local = await tree(join(dir, 'ledger', '2026-09'));
    expect([...google.files().keys()].sort()).toEqual(
      [...local.keys()].map((n) => `2026-09/${n}`).sort(),
    );
    expect((await manifestOf(dir, '2026-09')).transfers?.gdrive).toBeDefined();
    expectCleanLogs(log.lines);
  });
});
