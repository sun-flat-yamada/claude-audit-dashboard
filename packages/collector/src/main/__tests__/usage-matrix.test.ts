import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dashboardViewSchema } from '@claude-audit/core/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURES, MOCK_KEY, fakeAnthropic } from '../../__tests__/fake-anthropic.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { runCli } from '../cli.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'usage-matrix-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const ON = { sources: { usageMatrix: { enabled: true } } };
const COST = '/v1/organizations/analytics/cost_report';
const warn = vi.fn();

async function run(env: Record<string, string>, config: object | undefined, overrides = {}) {
  const configDir = join(dir, 'config');
  await mkdir(configDir, { recursive: true });
  if (config) await writeFile(join(configDir, 'default.json'), JSON.stringify(config));
  const api = fakeAnthropic(overrides);
  const code = await runCli(['pipeline'], {
    env: { CONFIG_DIR: configDir, ...env },
    cwd: dir,
    dataDir: join(dir, 'data'),
    clock: fixedClock(new Date('2026-09-30T12:00:00Z')),
    logger: { info: vi.fn(), warn, error: vi.fn() },
    fetchImpl: api.fetch,
  });
  return { code, api };
}

const read = async (path: string): Promise<string> => readFile(join(dir, 'data', path), 'utf8');
const exists = async (path: string): Promise<boolean> =>
  read(path).then(
    () => true,
    () => false,
  );
const view = async () => dashboardViewSchema.parse(JSON.parse(await read('dashboard.json')));
const pairwise = (url: URL): boolean => url.searchParams.getAll('group_by[]').length > 1;

describe('optional model x group matrix', () => {
  it('is off by default: no request, no input file, modelMatrix null, no detail file', async () => {
    const { code, api } = await run({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY }, undefined);
    expect(code).toBe(0);
    expect(api.calls.some(pairwise)).toBe(false);
    expect(await exists('usage-matrix/input.json')).toBe(false);
    expect((await view()).modelMatrix).toBeNull();
    expect(await exists('detail/usage-matrix.json')).toBe(false);
  });

  it('collects, maps and publishes the matrix in dashboard.json when enabled', async () => {
    const { code, api } = await run({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY }, ON);
    expect(code).toBe(0);
    expect(api.calls.filter(pairwise).map((u) => u.pathname)).toEqual([COST]);
    const file = (await view()).modelMatrix;
    if (file?.status !== 'ok') throw new Error('expected an ok matrix');
    expect(file.months).toEqual(['2026-09']);
    expect(file.cells).toEqual([
      { month: '2026-09', model: 'claude-opus-5', group: 'rbac_group_01', cost: 412.8 },
    ]);
    expect(file.groups[0]?.name).toBe('Engineering');
    expect(await exists('detail/usage-matrix.json')).toBe(false);
  });

  it('keeps the pipeline going when the API rejects the pairwise request', async () => {
    const { code } = await run({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY }, ON, {
      [COST]: (url: URL) =>
        pairwise(url)
          ? {
              status: 400,
              body: {
                type: 'error',
                error: { type: 'invalid_request_error', message: 'group_by' },
              },
            }
          : (FIXTURES[COST] as (u: URL) => { body: unknown })(url),
    });
    expect(code).toBe(0);
    expect((await view()).modelMatrix).toMatchObject({
      status: 'unavailable',
      reason: expect.stringMatching(/rejected the model x group request \(HTTP 400\)/) as string,
    });
  });

  it('records schema drift as an error without stopping the pipeline', async () => {
    const { code } = await run({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY }, ON, {
      [COST]: (url: URL) =>
        pairwise(url)
          ? {
              body: { data: [{ starting_at: 'x', results: [{ amount: 'abc' }] }], next_page: null },
            }
          : (FIXTURES[COST] as (u: URL) => { body: unknown })(url),
    });
    expect(code).toBe(0);
    const stored = JSON.parse(await read('usage-matrix/input.json')) as { status: string };
    expect(stored.status).toBe('error');
    expect((await view()).modelMatrix).toMatchObject({
      status: 'error',
      reason: expect.stringMatching(/collection failed/) as string,
    });
  });

  it('is unavailable without an Analytics key', async () => {
    const { code } = await run({ ANTHROPIC_ADMIN_API_KEY: MOCK_KEY }, ON);
    expect(code).toBe(0);
    expect((await view()).modelMatrix).toMatchObject({
      status: 'unavailable',
      reason: expect.stringMatching(/no Analytics API key/) as string,
    });
  });

  it('treats an unreadable stored input as not collected', async () => {
    await run({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY }, ON);
    await writeFile(join(dir, 'data/usage-matrix/input.json'), '{ not json');
    const code = await runCli(['dashboard'], {
      env: { CONFIG_DIR: join(dir, 'config'), ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY },
      cwd: dir,
      dataDir: join(dir, 'data'),
      clock: fixedClock(new Date('2026-09-30T12:00:00Z')),
      logger: { info: vi.fn(), warn, error: vi.fn() },
    });
    expect(code).toBe(0);
    expect((await view()).modelMatrix).toMatchObject({
      status: 'error',
      reason: expect.stringMatching(/could not be read/) as string,
    });
  });
});
