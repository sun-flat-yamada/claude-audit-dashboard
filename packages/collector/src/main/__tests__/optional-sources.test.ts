import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASET_NAMES, OPTIONAL_DATASET_NAMES, type DatasetName } from '@claude-audit/core';
import { dashboardViewSchema, type DashboardView } from '@claude-audit/core/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TENANT_FIXTURE_URL } from '../../__tests__/fixture-sets.js';
import { createFixtureFetch } from '../../adapters/fixture/fixture-source.js';
import { withOptionalFixtures } from '../../adapters/fixture/optional-fixture.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { runCli } from '../cli.js';

const tenantDir = fileURLToPath(TENANT_FIXTURE_URL);
const NOW = new Date('2026-09-30T12:00:00Z');
const ENTERPRISE = 'fixture-enterprise-key-not-used';
const CONSOLE = 'fixture-console-key-not-used';

let root: string;
let dir: string;
let runs = 0;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'optional-sources-'));
  runs = 0;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

type Override = (url: URL) => Response;

interface Outcome {
  code: number;
  view: DashboardView;
  /** `x-api-key` header per requested path, in request order. */
  keys: [string, string][];
  coverage: Record<string, { status: string; reason: string | null; count: number | null }>;
  op002: { status: string; message: string; evidence: string[] };
}

/** Pipeline on the B1 tenant fixtures plus the optional-API fixtures, with fault injection. */
async function run(
  env: Record<string, string>,
  sources: object | undefined,
  overrides: Record<string, Override> = {},
): Promise<Outcome> {
  // A fresh working directory per run: collector state (cursors) must not carry over.
  dir = join(root, `run-${String((runs += 1))}`);
  const configDir = join(dir, 'config');
  await mkdir(configDir, { recursive: true });
  if (sources) await writeFile(join(configDir, 'default.json'), JSON.stringify({ sources }));
  const replay = await withOptionalFixtures(
    await createFixtureFetch(tenantDir),
    join(tenantDir, '..'),
  );
  const keys: [string, string][] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    keys.push([url.pathname, String((init?.headers as Record<string, string>)['x-api-key'])]);
    return overrides[url.pathname]?.(url) ?? replay.fetch(input);
  }) as typeof fetch;
  const code = await runCli(['pipeline'], {
    env: { CONFIG_DIR: configDir, ...env },
    cwd: dir,
    dataDir: join(dir, 'data'),
    clock: fixedClock(NOW),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    fetchImpl,
  });
  const view = dashboardViewSchema.parse(
    JSON.parse(await readFile(join(dir, 'data', 'dashboard.json'), 'utf8')),
  );
  const op = view.compliance.results.find((r) => r.ruleId === 'OP-002');
  return {
    code,
    view,
    keys,
    coverage: Object.fromEntries(view.coverage.map((c) => [c.dataset, c])),
    op002: {
      status: op?.status ?? 'missing',
      message: op?.message ?? '',
      evidence: (op?.evidence ?? []).map((e) => `${e.kind}:${e.label}`),
    },
  };
}

const ON = {
  console: { enabled: true, lookbackDays: 30 },
  claudeCode: { enabled: true, lookbackDays: 1 },
};
const KEYS = { ANTHROPIC_ENTERPRISE_API_KEY: ENTERPRISE, ANTHROPIC_CONSOLE_ADMIN_API_KEY: CONSOLE };
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const CONSOLE_PATHS = [
  '/v1/organizations/workspaces',
  '/v1/organizations/api_keys',
  '/v1/organizations/usage_report/messages',
  '/v1/organizations/cost_report',
  '/v1/organizations/usage_report/claude_code',
];

const optionalOf = (o: Outcome) => OPTIONAL_DATASET_NAMES.map((n) => o.coverage[n]?.status);

describe('(a) default configuration: nothing changes for existing users', () => {
  it('registers no optional dataset, even when a Console key is present', async () => {
    const withKey = await run(KEYS, undefined);
    const without = await run({ ANTHROPIC_ENTERPRISE_API_KEY: ENTERPRISE }, undefined);
    expect(withKey.code).toBe(0);
    expect(Object.keys(withKey.coverage).sort()).toEqual(
      [...DATASET_NAMES].filter((n) => withKey.coverage[n]).sort(),
    );
    for (const name of OPTIONAL_DATASET_NAMES) expect(withKey.coverage).not.toHaveProperty(name);
    expect(withKey.keys.some(([path]) => CONSOLE_PATHS.includes(path))).toBe(false);
    // Identical coverage, OP-002 and score with and without the Console key.
    expect(withKey.coverage).toEqual(without.coverage);
    expect(withKey.op002).toEqual(without.op002);
    expect(withKey.view.compliance.score).toBe(without.view.compliance.score);
    expect(withKey.view.compliance.results).toEqual(without.view.compliance.results);
  });

  it('keeps the OP-002 verdict of the 13 built-in datasets', async () => {
    const out = await run(KEYS, undefined);
    expect(Object.keys(out.coverage)).toHaveLength(13);
    expect(out.op002).toEqual({
      status: 'pass',
      message: 'All 13 datasets collected',
      evidence: [],
    });
  });

  it('does not enable a source because its flag is set to the default explicitly', async () => {
    const explicit = await run(KEYS, {
      console: { enabled: false },
      claudeCode: { enabled: false },
    });
    expect(Object.keys(explicit.coverage)).toHaveLength(13);
  });
});

describe('(b) enabled with a valid key', () => {
  it('collects all five datasets and OP-002 covers them', async () => {
    const out = await run(KEYS, ON);
    expect(out.code).toBe(0);
    expect(optionalOf(out)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(out.coverage.consoleWorkspaces?.count).toBe(3);
    expect(out.coverage.consoleApiKeys?.count).toBe(2);
    expect(out.coverage.consoleUsage?.count).toBe(4);
    expect(out.coverage.consoleCost?.count).toBe(4);
    expect(out.coverage.claudeCodeActivity?.count).toBe(4);
    expect(out.op002).toMatchObject({ status: 'pass', message: 'All 18 datasets collected' });
  });

  it('uses the Console key only for the optional endpoints and the Enterprise key for the rest', async () => {
    const out = await run(KEYS, ON);
    for (const [path, key] of out.keys)
      expect(key).toBe(CONSOLE_PATHS.includes(path) ? CONSOLE : ENTERPRISE);
    expect(out.keys.some(([path]) => path === '/v1/organizations/workspaces')).toBe(true);
  });

  it('enables each source independently', async () => {
    const claudeOnly = await run(KEYS, { claudeCode: { enabled: true, lookbackDays: 1 } });
    expect(optionalOf(claudeOnly)).toEqual([undefined, undefined, undefined, undefined, 'ok']);
    const consoleOnly = await run(KEYS, { console: { enabled: true } });
    expect(optionalOf(consoleOnly)).toEqual(['ok', 'ok', 'ok', 'ok', undefined]);
  });

  it('honors sources.disabled for an optional dataset', async () => {
    const out = await run(KEYS, { ...ON, disabled: ['consoleCost'] });
    expect(out.coverage).not.toHaveProperty('consoleCost');
    expect(out.coverage.consoleUsage?.status).toBe('ok');
  });
});

describe('(c) enabled without usable access: unavailable, the rest continues', () => {
  const rest = (o: Outcome) =>
    (DATASET_NAMES as DatasetName[]).filter((n) => o.coverage[n]).map((n) => o.coverage[n]?.status);

  it('marks all five unavailable when no Console key is set, naming the variable', async () => {
    const out = await run({ ANTHROPIC_ENTERPRISE_API_KEY: ENTERPRISE }, ON);
    expect(out.code).toBe(0);
    expect(optionalOf(out)).toEqual(Array(5).fill('unavailable'));
    for (const name of OPTIONAL_DATASET_NAMES)
      expect(out.coverage[name]?.reason).toContain('ANTHROPIC_CONSOLE_ADMIN_API_KEY');
    expect(rest(out).every((s) => s === 'ok')).toBe(true);
    // The Enterprise key is never sent to the Console endpoints.
    expect(out.keys.some(([path]) => CONSOLE_PATHS.includes(path))).toBe(false);
    expect(out.op002.status).toBe('fail');
    expect(out.op002.message).toBe('5 of 18 dataset(s) not collected');
    expect(out.op002.evidence).toHaveLength(5);
    expect(out.op002.evidence[0]).toContain('unavailable:');
  });

  it('fails OP-002 only because of the enabled sources, and lowers the score', async () => {
    const off = await run({ ANTHROPIC_ENTERPRISE_API_KEY: ENTERPRISE }, undefined);
    const on = await run({ ANTHROPIC_ENTERPRISE_API_KEY: ENTERPRISE }, ON);
    expect(off.op002.status).toBe('pass');
    expect(on.view.compliance.score).toBeLessThan(off.view.compliance.score);
  });

  it.each([401, 403, 404])(
    'marks the datasets unavailable on HTTP %i and keeps going',
    async (status) => {
      const denied: Override = () =>
        json({ type: 'error', error: { type: 'permission_error', message: 'denied' } }, status);
      const out = await run(
        KEYS,
        ON,
        Object.fromEntries(CONSOLE_PATHS.map((path) => [path, denied])),
      );
      expect(out.code).toBe(0);
      expect(optionalOf(out)).toEqual(Array(5).fill('unavailable'));
      expect(out.coverage.consoleUsage?.reason).toContain(String(status));
      expect(rest(out).every((s) => s === 'ok')).toBe(true);
      expect(out.op002.status).toBe('fail');
    },
  );

  it('marks only the denied endpoint unavailable', async () => {
    const out = await run(KEYS, ON, {
      '/v1/organizations/usage_report/claude_code': () =>
        json({ error: { type: 'permission_error', message: 'denied' } }, 403),
    });
    expect(optionalOf(out)).toEqual(['ok', 'ok', 'ok', 'ok', 'unavailable']);
  });
});

describe('(d) enabled with a schema mismatch: error, the rest continues', () => {
  it('reports an error (not unavailable) naming the endpoint', async () => {
    const out = await run(KEYS, ON, {
      '/v1/organizations/usage_report/messages': () =>
        json({
          data: [{ starting_at: '2026-09-28T00:00:00Z', results: [{ output_tokens: 1 }] }],
          has_more: false,
        }),
      '/v1/organizations/usage_report/claude_code': () => json({ rows: [] }),
    });
    expect(out.code).toBe(0);
    expect(out.coverage.consoleUsage?.status).toBe('error');
    expect(out.coverage.consoleUsage?.reason).toContain('schema drift');
    expect(out.coverage.claudeCodeActivity?.status).toBe('error');
    expect(out.coverage.consoleWorkspaces?.status).toBe('ok');
    expect(out.coverage.members?.status).toBe('ok');
    expect(out.op002.status).toBe('fail');
    expect(out.op002.message).toBe('2 of 18 dataset(s) not collected');
  });

  it('reports another API error (400) as an error, not as unavailable', async () => {
    const out = await run(KEYS, ON, {
      '/v1/organizations/cost_report': () =>
        json({ error: { type: 'invalid_request_error', message: 'bad window' } }, 400),
    });
    expect(out.coverage.consoleCost?.status).toBe('error');
    expect(out.coverage.consoleUsage?.status).toBe('ok');
  });
});
