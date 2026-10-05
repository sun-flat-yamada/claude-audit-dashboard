import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  HISTORY_BRANCH,
  buildHistoryRepo,
  createHistory,
} from '../../__tests__/synthetic-history.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { runCli } from '../cli.js';

// Real git repositories and long histories: slow under a parallel full run.
vi.setConfig({ testTimeout: 120_000 });

const NOW = new Date('2026-09-30T12:00:00Z');
const roots: string[] = [];
let repo: string;

const tempDir = async (name: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`));
  roots.push(dir);
  return dir;
};

beforeAll(async () => {
  repo = await tempDir('size-repo');
  await buildHistoryRepo(repo, await createHistory({ days: 60 }));
}, 60_000);
afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A fresh run environment: config directory with `capacity` limits, data directory, fake Slack. */
async function run(args: string[], capacity: Record<string, number> = {}, now = NOW, ok = true) {
  const root = await tempDir('size-run');
  const configDir = join(root, 'config');
  await mkdir(configDir);
  await writeFile(join(configDir, 'default.json'), JSON.stringify({ capacity }));
  return exec(root, args, now, ok);
}

async function exec(root: string, args: string[], now: Date, ok: boolean) {
  const fetchImpl = vi.fn(async () => new Response('ok', { status: ok ? 200 : 500 }));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const code = await runCli(args, {
    env: {
      CONFIG_DIR: join(root, 'config'),
      SLACK_WEBHOOK_URL: 'https://hooks.example.com/services/T0/B0/not-a-real-hook',
    },
    cwd: root,
    dataDir: join(root, 'data'),
    clock: fixedClock(now),
    logger,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const sent = fetchImpl.mock.calls.map(
    (call) => (call as unknown as [string, { body: string }])[1].body,
  );
  return { code, logger, sent, root };
}

const base = ['size', '--repo', '', '--ref', HISTORY_BRANCH];
const args = (...extra: string[]) => base.map((a) => (a === '' ? repo : a)).concat(extra);

describe('pnpm size', () => {
  it('prints totals, growth, archive and per-dataset rows; quiet when within limits', async () => {
    const { code, logger, sent } = await run(args('--notify'));
    expect(code).toBe(0);
    const text = logger.info.mock.calls.map((c) => String(c[0])).join('\n');
    expect(text).toMatch(/Capacity ok: .* reachable in 240 commits \(240 snapshots\)/);
    expect(text).toContain('growth per 30 days');
    expect(text).toMatch(/organizations\s+1 blobs/);
    expect(sent).toEqual([]);
  });

  it('notifies once through the configured transport when a limit is exceeded', async () => {
    const first = await run(args('--notify'), { maxTotalMiB: 0.001 });
    expect(first.code).toBe(0);
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0]).toContain('data/audit size exceeded');
    expect(first.sent[0]).toContain('EXCEEDED');
    // Sizes and counts only: no path of the measured repository leaks into the alert.
    expect(first.sent[0]).not.toContain(repo);
    const state = JSON.parse(await readFile(join(first.root, 'data/state.json'), 'utf8')) as {
      notifications: { lastSent: Record<string, string>; history: { key: string }[] };
    };
    expect(Object.keys(state.notifications.lastSent)).toEqual(['capacity:exceeded']);
    expect(state.notifications.history.map((h) => h.key)).toEqual(['capacity:exceeded']);
  });

  it('does not repeat the alert within the cooldown, and repeats after it', async () => {
    const root = await tempDir('size-cooldown');
    await mkdir(join(root, 'config'));
    await writeFile(
      join(root, 'config/default.json'),
      JSON.stringify({ capacity: { maxTotalMiB: 0.001 } }),
    );
    expect((await exec(root, args('--notify'), NOW, true)).sent).toHaveLength(1);
    const soon = await exec(root, args('--notify'), new Date(NOW.getTime() + 3_600_000), true);
    expect(soon.sent).toHaveLength(0);
    expect(soon.logger.info).toHaveBeenCalledWith(expect.stringContaining('cooldown'));
    const later = await exec(root, args('--notify'), new Date(NOW.getTime() + 7 * 3_600_000), true);
    expect(later.sent).toHaveLength(1);
  });

  it('does not notify without --notify, and warns instead of alerting below the limit', async () => {
    const silent = await run(args(), { maxTotalMiB: 0.001 });
    expect(silent.sent).toEqual([]);
    expect(silent.logger.info.mock.calls.join('\n')).toContain('[EXCEEDED]');
    const warning = await run(args('--notify'), {
      maxTotalMiB: 2,
      warnRatio: 0.5,
      maxMonthlyGrowthMiB: 0,
    });
    expect(warning.sent).toHaveLength(1);
    expect(warning.sent[0]).toContain('data/audit size warning');
  });

  it('prints JSON with --json', async () => {
    const { logger } = await run(args('--json'));
    const parsed = JSON.parse(String(logger.info.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(parsed).toMatchObject({ commits: 240, snapshots: 240, status: 'ok' });
    expect(typeof parsed.reachableBytes).toBe('number');
  });

  it('fails on a measurement error, but only warns with --warn-only (collection never fails)', async () => {
    const missing = ['size', '--repo', join(tmpdir(), 'claude-audit-no-such-repo')];
    const strict = await run(missing);
    expect(strict.code).toBe(1);
    const lenient = await run([...missing, '--warn-only']);
    expect(lenient.code).toBe(0);
    expect(lenient.logger.error).not.toHaveBeenCalled();
    expect(lenient.logger.warn).toHaveBeenCalledWith(expect.stringContaining('skipped'));
  });

  it('treats a failing notification channel as a warning with --warn-only', async () => {
    const limits = { maxTotalMiB: 0.001 };
    const strict = await run(args('--notify'), limits, NOW, false);
    expect(strict.code).toBe(1);
    const lenient = await run(args('--notify', '--warn-only'), limits, NOW, false);
    expect(lenient.code).toBe(0);
    expect(lenient.logger.warn).toHaveBeenCalledWith(expect.stringContaining('skipped'));
  });

  it('rejects invalid capacity configuration and flags without a value', async () => {
    expect((await run(args(), { warnRatio: 2 })).code).toBe(1);
    expect((await run(args(), { maxTotalMiB: -1 })).code).toBe(1);
    expect((await run(['size', '--repo'])).code).toBe(1);
    expect((await run(['size', '--ref', '--json'])).code).toBe(1);
  });
});
