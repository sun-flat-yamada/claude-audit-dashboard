import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPTIONAL_DATASET_NAMES } from '@claude-audit/core';
import {
  DETAIL_CONFIG_PATH,
  checkDetailBundle,
  dashboardViewSchema,
  detailConfigSchema,
} from '@claude-audit/core/contracts';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TENANT_FIXTURE_URL } from '../../__tests__/fixture-sets.js';
import { silentLogger } from '../../infrastructure/runtime.js';
import { runCli } from '../cli.js';
import { writeDemoSample, type DemoProfile } from '../demo.js';
import { runFixtureTenant } from '../fixture.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const fixtureDir = fileURLToPath(TENANT_FIXTURE_URL);

/** An e-mail address needs a dotted domain; plugin ids such as `name@marketplace` are not. */
const EMAIL = /[\w.+*-]+@[\w-]+(\.[\w-]+)+/g;

const parseView = (files: Record<string, string>) =>
  dashboardViewSchema.parse(JSON.parse(files['dashboard.json'] ?? '{}'));
const detailOf = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith('detail/')));
const coverageOf = (files: Record<string, string>) =>
  Object.fromEntries(parseView(files).coverage.map((c) => [c.dataset, c]));

async function demo(profile?: DemoProfile) {
  const out = await mkdtemp(join(tmpdir(), 'profile-'));
  try {
    return await writeDemoSample(out, { profile, cwd: ROOT, env: {}, logger: silentLogger });
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

describe('demo profiles', () => {
  let optional: Record<string, string>;
  let standard: Record<string, string>;
  beforeAll(async () => {
    [optional, standard] = await Promise.all([demo('optional-sources'), demo()]);
  });

  it('the default profile has no optional dataset and is the committed sample', async () => {
    expect(Object.keys(coverageOf(standard))).toHaveLength(13);
    for (const name of OPTIONAL_DATASET_NAMES)
      expect(coverageOf(standard)).not.toHaveProperty(name);
    expect(await demo('default')).toEqual(standard);
    for (const [name, content] of Object.entries(standard))
      expect(await readFile(join(ROOT, 'data/sample', name), 'utf8'), name).toBe(content);
  });

  it('the optional-sources profile collects all nine datasets and OP-002 passes', () => {
    const coverage = coverageOf(optional);
    for (const name of OPTIONAL_DATASET_NAMES) expect(coverage[name]?.status).toBe('ok');
    const op = parseView(optional).compliance.results.find((r) => r.ruleId === 'OP-002');
    expect(op).toMatchObject({ status: 'pass', message: 'All 22 datasets collected' });
  });

  it('is deterministic, valid, masked and synthetic (example.com only)', async () => {
    expect(await demo('optional-sources')).toEqual(optional);
    expect(parseView(optional).source).toBe('demo');
    expect(checkDetailBundle(detailOf(optional), { requireDemo: true })).toEqual([]);
    for (const email of Object.values(optional).join('\n').match(EMAIL) ?? [])
      expect(email).toMatch(/@example\.com$/);
  });

  it('the empty profile collects 13 datasets with zero items and a valid detail bundle', async () => {
    const emptyFiles = await demo('empty');
    const coverage = coverageOf(emptyFiles);
    expect(Object.keys(coverage)).toHaveLength(13);
    for (const meta of Object.values(coverage)) {
      expect(meta).toMatchObject({ status: 'ok', count: 0 });
    }
    expect(checkDetailBundle(detailOf(emptyFiles), { requireDemo: true })).toEqual([]);
    expect(emptyFiles).toHaveProperty('dashboard.json');
    expect(emptyFiles).toHaveProperty('detail/index.json');
    expect(emptyFiles).toHaveProperty('detail/members.json');
  });

  it('the unavailable profile marks datasets as unavailable/error and writes no detail bundle', async () => {
    const unavailFiles = await demo('unavailable');
    const coverage = coverageOf(unavailFiles);
    expect(Object.keys(coverage)).toHaveLength(13);
    expect(
      Object.values(coverage).every((m) => m.status === 'unavailable' || m.status === 'error'),
    ).toBe(true);
    expect(Object.keys(detailOf(unavailFiles))).toHaveLength(0);
    expect(unavailFiles).toHaveProperty('dashboard.json');
  });

  it('publishes the Claude Code aggregate only in the optional-sources profile (AN-4)', () => {
    expect(parseView(standard)).not.toHaveProperty('claudeCode');
    const cc = parseView(optional).claudeCode;
    expect(cc?.users).toBeGreaterThan(1);
    expect(cc?.apiKeys).toBeGreaterThan(0);
    expect(cc?.byTerminal.length).toBeGreaterThan(2);
    expect(cc?.byModel.length).toBeGreaterThan(1);
    expect(cc?.daily.length).toBeGreaterThan(2);
    const text = JSON.stringify(cc);
    for (const actor of [
      'alice.engineer',
      '@example.com',
      'ci-code-review-bot',
      'nightly-refactor',
    ])
      expect(text, actor).not.toContain(actor);
  });

  it('publishes the Console usage and cost aggregate only in the optional-sources profile (AN-5)', () => {
    expect(parseView(standard)).not.toHaveProperty('console');
    const c = parseView(optional).console;
    expect(c?.currency).toBe('USD');
    expect(c?.totalCost).toBeGreaterThan(0);
    expect(c?.daily.length).toBeGreaterThan(20);
    expect(c?.byModel.length).toBeGreaterThan(2);
    expect(c?.byWorkspace.map((s) => s.label)).toContain('Default workspace');
    expect(c?.byCostType.map((s) => s.key).sort()).toEqual([
      'code_execution',
      'tokens',
      'web_search',
    ]);
    expect(c?.cacheReadShare).toBeGreaterThan(0);
    expect(c?.workspaces?.active).toBeGreaterThan(1);
    expect(c?.apiKeys?.find((k) => k.status === 'active')?.count).toBeGreaterThan(1);
    const text = JSON.stringify(c);
    for (const secret of ['apikey_', 'production-backend', 'retired-experiment', 'user_demo'])
      expect(text, secret).not.toContain(secret);
  });

  it('publishes the feature adoption aggregate only in the optional-sources profile (AN-6)', () => {
    expect(parseView(standard)).not.toHaveProperty('features');
    const f = parseView(optional).features;
    expect(f?.window).not.toBeNull();
    expect(f?.skills?.total).toBeGreaterThan(5);
    expect(f?.connectors?.items.map((c) => c.label)).toContain('Example Wiki');
    expect(f?.connectors?.calls?.write).toBeGreaterThan(0);
    expect(f?.plugins?.items.some((p) => p.installs === null)).toBe(true);
    expect(f?.projects?.items[0]?.label).toMatch(/^Example /);
    const text = JSON.stringify(f);
    for (const personal of ['@example.com', 'user_', 'createdBy', 'createdAt'])
      expect(text, personal).not.toContain(personal);
  });

  it('lists the enabled optional datasets in the effective configuration', () => {
    const config = detailConfigSchema.parse(JSON.parse(optional[DETAIL_CONFIG_PATH] ?? '{}'));
    const names = config.sources.datasets.map((d) => d.name);
    for (const name of OPTIONAL_DATASET_NAMES)
      expect(config.sources.datasets.find((d) => d.name === name)?.enabled).toBe(true);
    expect(names).toHaveLength(22);
    const standardConfig = detailConfigSchema.parse(
      JSON.parse(standard[DETAIL_CONFIG_PATH] ?? '{}'),
    );
    expect(standardConfig.sources.datasets).toHaveLength(13);
  });

  it('publishes no per-person or per-key row of the optional sources (aggregate-only)', () => {
    const published = Object.entries(optional).filter(([name]) => name !== 'weekly-report.md');
    const text = published.map(([, content]) => content).join('\n');
    for (const secretish of [
      'ci-code-review-bot',
      'production-backend',
      'linesAdded',
      'toolAccepted',
    ])
      expect(text, secretish).not.toContain(secretish);
    // The datasets appear as coverage rows (status and record counts) and nowhere else: in the
    // dashboard, the time-point summary (dataset status and count) and the configuration view.
    const mentions = published.filter(([, content]) => content.includes('claudeCodeActivity'));
    expect(mentions.map(([name]) => name).sort()).toEqual([
      'dashboard.json',
      'detail/compare/2026-09-29T12-00-00Z.json',
      'detail/config.json',
    ]);
  });
});

describe('fixture tenant with the optional sources enabled', () => {
  it('processes the optional datasets together with the 13 built-in ones', async () => {
    const files = await runFixtureTenant({ fixtureDir, optionalSources: true });
    const coverage = coverageOf(files);
    expect(Object.values(coverage).every((c) => c.status === 'ok')).toBe(true);
    for (const name of OPTIONAL_DATASET_NAMES) expect(coverage[name]).toBeDefined();
    expect(Object.keys(coverage)).toHaveLength(22);
    expect(coverage.claudeCodeActivity?.count).toBe(4);
    const op = parseView(files).compliance.results.find((r) => r.ruleId === 'OP-002');
    expect(op?.message).toBe('All 22 datasets collected');
    expect(checkDetailBundle(detailOf(files), { requireDemo: true })).toEqual([]);
    expect(await runFixtureTenant({ fixtureDir, optionalSources: true })).toEqual(files);
  });

  it('leaves the default fixture run on the 13 datasets', async () => {
    const files = await runFixtureTenant({ fixtureDir });
    expect(Object.keys(coverageOf(files))).toHaveLength(13);
  });

  it('contains no real address and no key material', async () => {
    const files = await runFixtureTenant({ fixtureDir, optionalSources: true });
    const text = Object.values(files).join('\n');
    for (const email of text.match(EMAIL) ?? []) expect(email).toMatch(/@example\.com$/);
    expect(text).not.toMatch(/sk-ant-|fixture-console-key/);
  });
});

describe('CLI flags', () => {
  const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

  it('`demo --profile optional-sources` writes the profile, an unknown profile fails', async () => {
    const out = await mkdtemp(join(tmpdir(), 'cli-profile-'));
    try {
      const options = {
        env: {},
        cwd: out,
        dataDir: join(out, 'data'),
        logger: logger(),
      };
      expect(await runCli(['demo', '--profile', 'nope', '--out', join(out, 'x')], options)).toBe(1);
      const target = join(out, 'profile');
      expect(
        await runCli(['demo', '--profile', 'optional-sources', '--out', target], options),
      ).toBe(0);
      const view = dashboardViewSchema.parse(
        JSON.parse(await readFile(join(target, 'dashboard.json'), 'utf8')),
      );
      expect(view.coverage).toHaveLength(22);

      const emptyTarget = join(out, 'profile-empty');
      expect(await runCli(['demo', '--profile', 'empty', '--out', emptyTarget], options)).toBe(0);
      const emptyView = dashboardViewSchema.parse(
        JSON.parse(await readFile(join(emptyTarget, 'dashboard.json'), 'utf8')),
      );
      expect(emptyView.coverage).toHaveLength(13);

      const unavailTarget = join(out, 'profile-unavailable');
      expect(
        await runCli(['demo', '--profile', 'unavailable', '--out', unavailTarget], options),
      ).toBe(0);
      const unavailView = dashboardViewSchema.parse(
        JSON.parse(await readFile(join(unavailTarget, 'dashboard.json'), 'utf8')),
      );
      expect(unavailView.coverage).toHaveLength(13);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it('`fixture --optional-sources` writes to its own directory by default', async () => {
    const out = await mkdtemp(join(tmpdir(), 'cli-fixture-'));
    try {
      const code = await runCli(['fixture', '--optional-sources', '--fixtures', fixtureDir], {
        env: {},
        cwd: out,
        dataDir: join(out, 'data'),
        logger: logger(),
      });
      expect(code).toBe(0);
      const view = dashboardViewSchema.parse(
        JSON.parse(
          await readFile(join(out, 'data/fixture-optional-sources/dashboard.json'), 'utf8'),
        ),
      );
      expect(view.coverage).toHaveLength(22);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
