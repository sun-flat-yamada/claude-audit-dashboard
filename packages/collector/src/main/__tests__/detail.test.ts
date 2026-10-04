import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDetailBundle, detailManifestSchema } from '@claude-audit/core/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_KEY, fakeAnthropic } from '../../__tests__/fake-anthropic.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { runCli } from '../cli.js';
import { detailThresholds } from '../detail.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'detail-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const readBundle = async (): Promise<Record<string, string>> => {
  const root = join(dir, 'data/detail');
  const names = await readdir(root);
  return Object.fromEntries(
    await Promise.all(
      names.map(async (n) => [`detail/${n}`, await readFile(join(root, n), 'utf8')] as const),
    ),
  );
};

async function run(env: Record<string, string>, config?: object, args = ['pipeline']) {
  const configDir = join(dir, 'config');
  await mkdir(configDir, { recursive: true });
  if (config) await writeFile(join(configDir, 'default.json'), JSON.stringify(config));
  const api = fakeAnthropic();
  const code = await runCli(args, {
    env: { CONFIG_DIR: configDir, ...env },
    cwd: dir,
    dataDir: join(dir, 'data'),
    clock: fixedClock(new Date('2026-09-30T12:00:00Z')),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    fetchImpl: api.fetch,
  });
  return code;
}

describe('detail command and pipeline', () => {
  it('pipeline writes a masked, consistent detail bundle next to dashboard.json', async () => {
    expect(await run({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY })).toBe(0);
    const bundle = await readBundle();
    const manifest = detailManifestSchema.parse(JSON.parse(bundle['detail/index.json'] ?? ''));
    expect(manifest.source).toBe('live');
    expect(manifest.maskPii).toBe(true);
    expect(manifest.files.every((f) => f.status === 'ok')).toBe(true);
    expect(checkDetailBundle(bundle)).toEqual([]);
    expect(await readFile(join(dir, 'data/dashboard.json'), 'utf8')).toContain(
      '"schemaVersion": 2',
    );
  });

  it('maskPii=false writes raw identifiers and the manifest says so', async () => {
    const env = { ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY };
    expect(await run(env, { dashboard: { maskPii: false } })).toBe(0);
    const bundle = await readBundle();
    const manifest = detailManifestSchema.parse(JSON.parse(bundle['detail/index.json'] ?? ''));
    expect(manifest.maskPii).toBe(false);
    expect(bundle['detail/members.json']).not.toContain('***');
    expect(bundle['detail/members.json']).not.toMatch(/"id": "u_[0-9a-f]{12}"/);
    expect(checkDetailBundle(bundle)).toEqual([]);
  });

  it('without keys every entry is unavailable and no entity file is written', async () => {
    expect(await run({})).toBe(0);
    const bundle = await readBundle();
    expect(Object.keys(bundle)).toEqual(['detail/index.json']);
    const manifest = detailManifestSchema.parse(JSON.parse(bundle['detail/index.json'] ?? ''));
    expect(manifest.files.every((f) => f.status === 'unavailable')).toBe(true);
  });

  it('`detail` alone rebuilds the files from stored data', async () => {
    expect(await run({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY }, undefined, ['collect'])).toBe(0);
    expect(await run({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY }, undefined, ['detail'])).toBe(0);
    expect(checkDetailBundle(await readBundle())).toEqual([]);
  });
});

describe('detailThresholds', () => {
  it('uses configured rule params and falls back to rule defaults for invalid values', () => {
    expect(detailThresholds({})).toEqual({ inactiveDays: 90, unusedDays: 30, maxAgeDays: 180 });
    expect(
      detailThresholds({
        'AC-001': { inactiveDays: 14 },
        'AK-001': { unusedDays: 0 },
        'AK-003': { maxAgeDays: '9' },
      }),
    ).toEqual({ inactiveDays: 14, unusedDays: 30, maxAgeDays: 180 });
  });
});
