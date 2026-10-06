import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATASET_NAMES,
  OPTIONAL_DATASET_NAMES,
  datasetsOfSource,
  type DatasetName,
} from '@claude-audit/core';
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

/** The B4 datasets (Console, Claude Code); feature usage (AN-6) is checked on its own below. */
const B4_DATASETS = [...datasetsOfSource('console'), ...datasetsOfSource('claudeCode')];
const FEATURE_DATASETS = datasetsOfSource('featureUsage');
const FEATURE_PATHS = [
  '/v1/organizations/analytics/skills',
  '/v1/organizations/analytics/connectors',
  '/v1/organizations/analytics/plugins',
  '/v1/organizations/analytics/apps/chat/projects',
];

const optionalOf = (o: Outcome) => B4_DATASETS.map((n) => o.coverage[n]?.status);
const featuresOf = (o: Outcome) => FEATURE_DATASETS.map((n) => o.coverage[n]?.status);

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
    expect(withKey.keys.some(([path]) => FEATURE_PATHS.includes(path))).toBe(false);
    expect(withKey.view).not.toHaveProperty('features');
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
      featureUsage: { enabled: false },
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
    for (const name of B4_DATASETS)
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

const FEATURES_ON = { featureUsage: { enabled: true, lookbackDays: 30 } };
const ENTERPRISE_ONLY = { ANTHROPIC_ENTERPRISE_API_KEY: ENTERPRISE };

describe('AN-6 feature usage (sources.featureUsage.enabled)', () => {
  const rest = (o: Outcome) =>
    (DATASET_NAMES as DatasetName[]).filter((n) => o.coverage[n]).map((n) => o.coverage[n]?.status);

  it('(a) is off by default: no request, no coverage row, no aggregate', async () => {
    const out = await run(ENTERPRISE_ONLY, undefined);
    for (const name of FEATURE_DATASETS) expect(out.coverage).not.toHaveProperty(name);
    expect(out.keys.some(([path]) => FEATURE_PATHS.includes(path))).toBe(false);
    expect(out.view).not.toHaveProperty('features');
    expect(out.op002.message).toBe('All 13 datasets collected');
  });

  it('(b) collects the four roll-ups with the Analytics key and publishes the aggregate', async () => {
    const out = await run(ENTERPRISE_ONLY, FEATURES_ON);
    expect(out.code).toBe(0);
    expect(featuresOf(out)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(out.coverage.skillUsage?.count).toBe(4);
    expect(out.coverage.connectorUsage?.count).toBe(3);
    expect(out.coverage.pluginUsage?.count).toBe(2);
    expect(out.coverage.chatProjectUsage?.count).toBe(2);
    expect(out.op002).toMatchObject({ status: 'pass', message: 'All 17 datasets collected' });
    for (const [path, key] of out.keys)
      if (FEATURE_PATHS.includes(path)) expect(key).toBe(ENTERPRISE);
    const f = out.view.features;
    expect(f?.skills?.items[0]?.label).toBe('Example Brand Voice');
    expect(f?.connectors?.calls).toEqual({ read: 1030, write: 97, unclassified: 78 });
    expect(f?.projects?.items.map((p) => p.label)).toEqual([
      'Example Onboarding Handbook',
      'Example RFP Responses',
    ]);
    // The project creator never reaches the snapshot or the published view.
    const snapshotDir = join(dir, 'data', 'snapshots');
    const [id] = await readdir(snapshotDir);
    const stored = await readFile(join(snapshotDir, id ?? '', 'chatProjectUsage.json'), 'utf8');
    for (const text of [stored, JSON.stringify(out.view)])
      expect(text).not.toMatch(/user_alice|user_01DemoAlice|created_?[bB]y/);
  });

  it('(c) without an Analytics key all four are unavailable and the rest continues', async () => {
    const out = await run({ ANTHROPIC_COMPLIANCE_API_KEY: ENTERPRISE }, FEATURES_ON);
    expect(out.code).toBe(0);
    expect(featuresOf(out)).toEqual(Array(4).fill('unavailable'));
    expect(out.coverage.skillUsage?.reason).toContain('ANTHROPIC_ANALYTICS_API_KEY');
    expect(out.view).not.toHaveProperty('features');
  });

  it.each([401, 403, 404])(
    '(c) marks the datasets unavailable on HTTP %i and keeps going',
    async (status) => {
      const denied: Override = () =>
        json({ type: 'error', error: { type: 'permission_error', message: 'denied' } }, status);
      const out = await run(
        ENTERPRISE_ONLY,
        FEATURES_ON,
        Object.fromEntries(FEATURE_PATHS.map((path) => [path, denied])),
      );
      expect(out.code).toBe(0);
      expect(featuresOf(out)).toEqual(Array(4).fill('unavailable'));
      expect(out.coverage.pluginUsage?.reason).toContain(String(status));
      expect(rest(out).every((s) => s === 'ok')).toBe(true);
      expect(out.op002.status).toBe('fail');
      expect(out.op002.message).toBe('4 of 17 dataset(s) not collected');
      expect(out.view).not.toHaveProperty('features');
    },
  );

  it('(c) a single denied endpoint leaves the other sections published', async () => {
    const out = await run(ENTERPRISE_ONLY, FEATURES_ON, {
      '/v1/organizations/analytics/apps/chat/projects': () =>
        json({ error: { type: 'permission_error', message: 'denied' } }, 403),
    });
    expect(featuresOf(out)).toEqual(['ok', 'ok', 'ok', 'unavailable']);
    expect(out.view.features?.projects).toBeNull();
    expect(out.view.features?.skills?.total).toBe(4);
  });

  it('(d) reports schema drift as an error naming the endpoint', async () => {
    const out = await run(ENTERPRISE_ONLY, FEATURES_ON, {
      '/v1/organizations/analytics/skills': () =>
        json({ data: [{ skill_name: 'xlsx' }], next_page: null }),
    });
    expect(out.code).toBe(0);
    expect(out.coverage.skillUsage?.status).toBe('error');
    expect(out.coverage.skillUsage?.reason).toContain('schema drift');
    expect(out.coverage.connectorUsage?.status).toBe('ok');
    expect(out.coverage.members?.status).toBe('ok');
    expect(out.op002.message).toBe('1 of 17 dataset(s) not collected');
  });
});
