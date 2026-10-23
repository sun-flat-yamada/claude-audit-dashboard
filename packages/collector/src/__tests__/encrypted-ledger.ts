import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LedgerManifest, Logger } from '@claude-audit/core';
import { afterAll, expect } from 'vitest';
import { generateIdentity, generatePipelineKey } from '../adapters/storage/ledger-crypto.js';
import { fixedClock } from '../infrastructure/runtime.js';
import { createContainer } from '../main/container.js';
import { ledgerCommand } from '../main/ledger.js';
import { MOCK_KEY, backfillTenant } from './backfill-tenant.js';
import { fakeTimer } from './fake-timer.js';

/**
 * Shared setup of the encrypted-ledger tests (#162 U8, #174 U9): a synthetic tenant backfilled
 * into temporary data directories. Every key is generated at run time: no key material is ever
 * stored in the repository, and the environment is injected (never read from `process.env`), so
 * the tests behave the same locally, on CI and in a Claude Code cloud session.
 */

const roots: string[] = [];
export const tempDir = async (name: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`));
  roots.push(dir);
  return dir;
};
afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

export const NOW = new Date('2026-10-23T15:00:00.000Z');
// Generated at run time: no key material in the repository.
export const OWNER = generateIdentity();
export const SECOND = generateIdentity();
export const PIPELINE = generatePipelineKey();

export const logger = (): Logger & { lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`info ${m}`),
    warn: (m) => lines.push(`warn ${m}`),
    error: (m) => lines.push(`error ${m}`),
  };
};

export interface SetupOptions {
  recipients?: string[];
  pipelineKey?: string | undefined;
  ci?: string;
  claudeCodeRemote?: string;
}

export async function setup(dir: string, options: SetupOptions = {}) {
  const { timer, timing } = fakeTimer();
  const tenant = backfillTenant(NOW, () => timer.t);
  const log = logger();
  const overrides = options.recipients
    ? JSON.stringify({ ledger: { encryption: { recipients: options.recipients } } })
    : undefined;
  const c = await createContainer({
    env: {
      ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY,
      CONFIG_DIR: join(dir, 'no-config'),
      ...(overrides ? { AUDIT_CONFIG_OVERRIDES: overrides } : {}),
      ...(options.pipelineKey ? { LEDGER_PIPELINE_KEY: options.pipelineKey } : {}),
      ...(options.ci ? { CI: options.ci } : {}),
      ...(options.claudeCodeRemote ? { CLAUDE_CODE_REMOTE: options.claudeCodeRemote } : {}),
    },
    cwd: dir,
    dataDir: dir,
    clock: fixedClock(NOW),
    fetchImpl: tenant.fetch,
    httpTiming: timing,
    logger: log,
  });
  return { c, log };
}

export const encrypted = (dir: string) =>
  setup(dir, { recipients: [OWNER.recipient, SECOND.recipient], pipelineKey: PIPELINE });

export const manifestOf = async (dir: string, month: string) =>
  JSON.parse(await readFile(join(dir, 'ledger', month, 'MANIFEST.json'), 'utf8')) as LedgerManifest;

export const filesOf = async (dir: string, month: string) =>
  (await readdir(join(dir, 'ledger', month))).filter((n) => n !== 'MANIFEST.json').sort();

/** No log line carries key material or ledger content (e-mail addresses of the synthetic tenant). */
export function expectCleanLogs(lines: readonly string[]): void {
  for (const line of lines) {
    expect(line).not.toMatch(/CADL-SECRET-|CADL-PIPELINE-|@example\.|192\.0\.2\./);
  }
}

/** The tenant backfilled into a plain and an encrypted ledger, then the month sealed. */
export async function sealedPair() {
  const plainDir = await tempDir('ledger-plain');
  const encDir = await tempDir('ledger-enc');
  const plain = await setup(plainDir);
  const enc = await encrypted(encDir);
  for (const { c } of [plain, enc]) {
    await ledgerCommand.run(c, ['backfill', '--from', '2026-09', '--to', '2026-10']);
    await ledgerCommand.run(c, ['seal', '--month', '2026-09']);
  }
  return { plainDir, encDir, plain, enc };
}
