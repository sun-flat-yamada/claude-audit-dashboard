import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dashboardViewSchema } from '@claude-audit/core/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_KEY, fakeAnthropic } from '../../__tests__/fake-anthropic.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { runCli } from '../cli.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cli-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function options(env: Record<string, string>, fetchImpl?: typeof fetch) {
  return {
    env: { CONFIG_DIR: join(dir, 'no-config'), ...env },
    cwd: dir,
    dataDir: join(dir, 'data'),
    clock: fixedClock(new Date('2026-09-30T12:00:00Z')),
    logger: logger(),
    fetchImpl,
  };
}

describe('claude-audit CLI', () => {
  it('runs the pipeline against the Enterprise APIs and writes a valid dashboard', async () => {
    const api = fakeAnthropic();
    const opts = options({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY }, api.fetch);
    expect(await runCli(['pipeline'], opts)).toBe(0);
    const view = dashboardViewSchema.parse(
      JSON.parse(await readFile(join(dir, 'data/dashboard.json'), 'utf8')),
    );
    expect(view.source).toBe('live');
    expect(view.coverage.every((c) => c.status === 'ok')).toBe(true);
    expect(view.compliance.results.find((r) => r.ruleId === 'CF-003')?.status).toBe('fail');
    expect(view.compliance.results.find((r) => r.ruleId === 'AM-001')?.status).toBe('warning');
    expect(JSON.stringify(view)).not.toContain('owner@example.com');
    expect(api.calls.every((u) => u.origin === 'https://api.anthropic.com')).toBe(true);
  });

  it('keeps going without keys and reports the gaps through OP-002', async () => {
    const opts = options({});
    expect(await runCli(['pipeline'], opts)).toBe(0);
    const view = JSON.parse(await readFile(join(dir, 'data/dashboard.json'), 'utf8'));
    expect(
      view.compliance.results.find((r: { ruleId: string }) => r.ruleId === 'OP-002')?.status,
    ).toBe('fail');
    expect(
      view.compliance.results.find((r: { ruleId: string }) => r.ruleId === 'AC-001')?.status,
    ).toBe('skipped');
    expect(opts.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('ANTHROPIC_ENTERPRISE_API_KEY'),
    );
  });

  it('generates reports in every format and sends the alert digest once per cooldown', async () => {
    const api = fakeAnthropic();
    const opts = options({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY }, api.fetch);
    await runCli(['pipeline'], opts);
    expect(await runCli(['report', 'monthly', '--month', '2026-09'], opts)).toBe(0);
    const csv = await readFile(
      join(dir, 'data/reports/monthly/monthly-2026-09.raw-cost-records.csv'),
      'utf8',
    );
    expect(csv.split('\r\n')[0]).toBe('Date,Dimension,Key,Amount,List amount,Currency');
    expect(await runCli(['notify'], opts)).toBe(0);
    expect(opts.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Claude Enterprise audit:'),
    );
    opts.logger.info.mockClear();
    await runCli(['notify'], opts);
    expect(opts.logger.info).toHaveBeenCalledWith('Nothing new to notify');
  });

  it('prints usage for unknown commands and fails clearly without data', async () => {
    const opts = options({});
    expect(await runCli(['nope'], opts)).toBe(2);
    expect(await runCli(['check'], opts)).toBe(1);
    expect(opts.logger.error).toHaveBeenCalledWith('No snapshot found: run `collect` first');
    expect(await runCli(['report'], opts)).toBe(1);
  });
});
