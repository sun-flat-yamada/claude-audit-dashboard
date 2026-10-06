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
import { writeDemoSample } from '../demo.js';
import { runFixtureTenant } from '../fixture.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const fixtureDir = fileURLToPath(TENANT_FIXTURE_URL);

const parseView = (files: Record<string, string>) =>
  dashboardViewSchema.parse(JSON.parse(files['dashboard.json'] ?? '{}'));
const detailOf = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith('detail/')));
const coverageOf = (files: Record<string, string>) =>
  Object.fromEntries(parseView(files).coverage.map((c) => [c.dataset, c]));

async function demo(profile?: 'default' | 'optional-sources') {
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

  it('the optional-sources profile collects all five datasets and OP-002 passes', () => {
    const coverage = coverageOf(optional);
    for (const name of OPTIONAL_DATASET_NAMES) expect(coverage[name]?.status).toBe('ok');
    const op = parseView(optional).compliance.results.find((r) => r.ruleId === 'OP-002');
    expect(op).toMatchObject({ status: 'pass', message: 'All 18 datasets collected' });
  });

  it('is deterministic, valid, masked and synthetic (example.com only)', async () => {
    expect(await demo('optional-sources')).toEqual(optional);
    expect(parseView(optional).source).toBe('demo');
    expect(checkDetailBundle(detailOf(optional), { requireDemo: true })).toEqual([]);
    for (const email of Object.values(optional)
      .join('\n')
      .match(/[\w.+*-]+@[\w.-]+/g) ?? [])
      expect(email).toMatch(/@example\.com$/);
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

  it('lists the enabled optional datasets in the effective configuration', () => {
    const config = detailConfigSchema.parse(JSON.parse(optional[DETAIL_CONFIG_PATH] ?? '{}'));
    const names = config.sources.datasets.map((d) => d.name);
    for (const name of OPTIONAL_DATASET_NAMES)
      expect(config.sources.datasets.find((d) => d.name === name)?.enabled).toBe(true);
    expect(names).toHaveLength(18);
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
    // The datasets appear as coverage rows (status and record counts) and nowhere else.
    const mentions = published.filter(([, content]) => content.includes('claudeCodeActivity'));
    expect(mentions.map(([name]) => name).sort()).toEqual(['dashboard.json', 'detail/config.json']);
  });
});

describe('fixture tenant with the optional sources enabled', () => {
  it('processes the optional datasets together with the 13 built-in ones', async () => {
    const files = await runFixtureTenant({ fixtureDir, optionalSources: true });
    const coverage = coverageOf(files);
    expect(Object.values(coverage).every((c) => c.status === 'ok')).toBe(true);
    for (const name of OPTIONAL_DATASET_NAMES) expect(coverage[name]).toBeDefined();
    expect(Object.keys(coverage)).toHaveLength(18);
    expect(coverage.claudeCodeActivity?.count).toBe(4);
    const op = parseView(files).compliance.results.find((r) => r.ruleId === 'OP-002');
    expect(op?.message).toBe('All 18 datasets collected');
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
    for (const email of text.match(/[\w.+*-]+@[\w.-]+/g) ?? [])
      expect(email).toMatch(/@example\.com$/);
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
      expect(view.coverage).toHaveLength(18);
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
      expect(view.coverage).toHaveLength(18);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
