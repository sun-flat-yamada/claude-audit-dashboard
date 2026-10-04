import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dashboardViewSchema } from '@claude-audit/core/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_KEY, fakeAnthropic } from '../../__tests__/fake-anthropic.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { runCli, extractCaptureRaw } from '../cli.js';
import { runFixtureTenant } from '../fixture.js';
import { sanitizeDirectory } from '../sanitize.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'capture-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function options(env: Record<string, string>, captureRawDir?: string) {
  return {
    env: { CONFIG_DIR: join(dir, 'no-config'), ...env },
    cwd: join(dir, 'repo'),
    dataDir: join(dir, 'data'),
    clock: fixedClock(new Date('2026-09-30T12:00:00Z')),
    logger: logger(),
    fetchImpl: fakeAnthropic().fetch,
    captureRawDir,
  };
}

describe('--capture-raw', () => {
  it('extracts the flag wherever it is and rejects a missing directory', () => {
    expect(extractCaptureRaw(['collect', '--capture-raw', '/x'])).toEqual({
      args: ['collect'],
      dir: '/x',
    });
    expect(extractCaptureRaw(['--capture-raw', '/x', 'pipeline'])).toEqual({
      args: ['pipeline'],
      dir: '/x',
    });
    expect(extractCaptureRaw(['collect'])).toEqual({ args: ['collect'] });
    expect(() => extractCaptureRaw(['collect', '--capture-raw'])).toThrow(/directory/);
  });

  it('writes one file per request, without the key, and warns that it holds tenant data', async () => {
    await mkdir(join(dir, 'repo'));
    const opts = options({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY });
    const out = join(dir, 'captured');
    expect(await runCli(['collect', '--capture-raw', out], opts)).toBe(0);
    const names = await readdir(out);
    expect(names.length).toBeGreaterThan(15);
    for (const name of names)
      expect(await readFile(join(out, name), 'utf8')).not.toContain(MOCK_KEY);
    expect(opts.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Raw response capture is ON'),
    );
  });

  it('is off by default', async () => {
    await mkdir(join(dir, 'repo'));
    const opts = options({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY });
    expect(await runCli(['collect'], opts)).toBe(0);
    expect(opts.logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('capture'));
    expect(await readdir(dir)).not.toContain('captured');
  });

  it('can be enabled by CAPTURE_RAW_DIR, but never in CI or inside the repository', async () => {
    await mkdir(join(dir, 'repo'));
    const out = join(dir, 'from-env');
    const env = { ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY, CAPTURE_RAW_DIR: out };
    expect(await runCli(['collect'], options(env))).toBe(0);
    expect((await readdir(out)).length).toBeGreaterThan(0);
    const inCi = options({ ...env, CI: 'true' });
    expect(await runCli(['collect'], inCi)).toBe(1);
    expect(inCi.logger.error).toHaveBeenCalledWith(expect.stringContaining('CI'));
    const inside = options(
      { ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY },
      join(dir, 'repo', 'captures'),
    );
    expect(await runCli(['collect'], inside)).toBe(1);
  });
});

describe('capture → sanitize → fixture tenant', () => {
  it('turns a captured run into fixtures that reproduce a complete dashboard', async () => {
    await mkdir(join(dir, 'repo'));
    const captured = join(dir, 'captured');
    expect(
      await runCli(
        ['collect', '--capture-raw', captured],
        options({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY }),
      ),
    ).toBe(0);
    const result = await sanitizeDirectory(captured, join(dir, 'fixtures'));
    expect(result.files).toBeGreaterThan(15);
    expect(result.emails).toBeGreaterThan(0);

    const text = (
      await Promise.all(
        (await readdir(join(dir, 'fixtures'))).map((n) =>
          readFile(join(dir, 'fixtures', n), 'utf8'),
        ),
      )
    ).join('\n');
    expect(text).not.toContain('Acme');
    expect(text).not.toContain('owner@example.com');
    expect(text).not.toContain('apikey_01Hx7k2mP9nQ4rS6tU8vW0xY');

    const files = await runFixtureTenant({
      fixtureDir: join(dir, 'fixtures'),
      cwd: join(dir, 'repo'),
    });
    const view = dashboardViewSchema.parse(JSON.parse(files['dashboard.json'] ?? ''));
    expect(view.coverage.every((c) => c.status === 'ok')).toBe(true);
  });

  it('refuses nested or non-empty output directories and an empty input', async () => {
    const input = join(dir, 'in');
    await mkdir(input);
    await expect(sanitizeDirectory(input, join(input, 'out'))).rejects.toThrow(/separate/);
    await expect(sanitizeDirectory(input, join(dir, 'out'))).rejects.toThrow(/No capture files/);
    await mkdir(join(dir, 'busy'));
    await writeFile(join(dir, 'busy', 'x.txt'), 'x');
    await expect(sanitizeDirectory(input, join(dir, 'busy'))).rejects.toThrow(/not empty/);
  });
});
