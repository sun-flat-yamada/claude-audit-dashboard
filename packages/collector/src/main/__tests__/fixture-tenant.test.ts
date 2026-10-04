import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDetailBundle, dashboardViewSchema } from '@claude-audit/core/contracts';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TENANT_FIXTURE_URL } from '../../__tests__/fixture-sets.js';
import { rawCaptureEntrySchema } from '../../adapters/anthropic/raw-capture.js';
import { TENANT_FIXTURE_DIR } from '../../adapters/fixture/fixture-source.js';
import { runCli } from '../cli.js';
import { runFixtureTenant } from '../fixture.js';

const fixtureDir = fileURLToPath(TENANT_FIXTURE_URL);

let files: Record<string, string>;
beforeAll(async () => {
  files = await runFixtureTenant({ fixtureDir });
});

describe('fixture tenant (collect → check → dashboard on the tenant-shape fixtures)', () => {
  it('produces a valid dashboard.json and compliance report with every dataset collected', () => {
    const view = dashboardViewSchema.parse(JSON.parse(files['dashboard.json'] ?? ''));
    expect(view.source).toBe('demo');
    expect(view.generatedAt).toBe('2026-09-30T12:00:00.000Z');
    expect(view.coverage.length).toBeGreaterThanOrEqual(12);
    expect(view.coverage.every((c) => c.status === 'ok')).toBe(true);
    const status = (id: string) => view.compliance.results.find((r) => r.ruleId === id)?.status;
    expect(status('OP-002')).toBe('pass');
    // V2 shape: keys seen in the Activity Feed match the key inventory, so AK-001 is decided.
    expect(status('AK-001')).toBe('fail');
    expect(status('CF-003')).toBe('fail');
    expect(status('AM-001')).toBe('warning');
  });

  it('produces a valid, masked detail bundle', () => {
    const detail = Object.fromEntries(
      Object.entries(files).filter(([name]) => name.startsWith('detail/')),
    );
    expect(Object.keys(detail)).toContain('detail/index.json');
    expect(checkDetailBundle(detail, { requireDemo: true })).toEqual([]);
  });

  it('is deterministic: the same fixtures give byte-identical output', async () => {
    expect(await runFixtureTenant({ fixtureDir })).toEqual(files);
  });

  it('contains no addresses other than example.com and no raw tenant values', () => {
    const text = Object.values(files).join('\n');
    for (const email of text.match(/[\w.+*-]+@[\w.-]+/g) ?? []) {
      expect(email).toMatch(/@example\.com$/);
    }
    expect(text).not.toContain('initech');
  });

  it('is available as the `fixture` command', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fixture-out-'));
    try {
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const code = await runCli(['fixture', '--out', out, '--fixtures', fixtureDir], {
        env: {},
        cwd: out,
        dataDir: join(out, 'data'),
        logger,
      });
      expect(code).toBe(0);
      expect((await readdir(out)).sort()).toEqual([
        'compliance-report.json',
        'dashboard.json',
        'detail',
      ]);
      expect(await readFile(join(out, 'dashboard.json'), 'utf8')).toBe(files['dashboard.json']);
      expect(
        await runCli(['fixture'], { env: {}, cwd: out, dataDir: join(out, 'data'), logger }),
      ).toBe(1);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});

describe('tenant fixture files', () => {
  it('lives where the checks look for it', () => {
    expect(TENANT_FIXTURE_DIR).toBe(
      'packages/collector/src/adapters/anthropic/__tests__/fixtures/tenant',
    );
    expect(fixtureDir.endsWith(`${TENANT_FIXTURE_DIR}/`)).toBe(true);
  });

  it('are capture-shaped, synthetic and free of keys, real addresses and non-documentation IPs', async () => {
    const names = (await readdir(fixtureDir)).filter((n) => n.endsWith('.json'));
    expect(names.length).toBeGreaterThanOrEqual(20);
    for (const name of names) {
      const text = await readFile(join(fixtureDir, name), 'utf8');
      expect(rawCaptureEntrySchema.safeParse(JSON.parse(text)).success).toBe(true);
      expect(text).not.toMatch(/sk-ant-|ghp_|github_pat_/);
      for (const email of text.match(/[\w.+*-]+@[\w.-]+/g) ?? []) {
        expect(email).toMatch(/^user\d+@example\.com$/);
      }
      for (const ip of text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []) {
        expect(ip).toMatch(/^192\.0\.2\.\d{1,3}$/);
      }
    }
  });
});
