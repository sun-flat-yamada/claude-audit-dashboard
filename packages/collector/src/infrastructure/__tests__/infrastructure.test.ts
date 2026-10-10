import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { readEnvironment } from '../env.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'config-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readEnvironment', () => {
  it('falls back to the enterprise key per family and ignores blank secrets', () => {
    const env = readEnvironment(
      {
        ANTHROPIC_ENTERPRISE_API_KEY: 'shared',
        ANTHROPIC_ANALYTICS_API_KEY: 'analytics',
        ANTHROPIC_ADMIN_API_KEY: '  ',
      },
      '/repo',
    );
    expect(env.keys).toEqual({ compliance: 'shared', analytics: 'analytics', admin: 'shared' });
    expect(readEnvironment({}, '/repo').keys).toEqual({
      compliance: undefined,
      analytics: undefined,
      admin: undefined,
    });
  });

  it('resolves directories against INIT_CWD (pnpm) and parses SMTP settings', () => {
    const env = readEnvironment(
      {
        INIT_CWD: '/repo',
        DATA_DIR: 'data',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465',
        ALERT_EMAIL_TO: 'a@example.com, b@example.com',
      },
      '/repo/packages/collector',
    );
    expect(env.dataDir).toBe(resolve('/repo/data'));
    expect(env.configDir).toBe(resolve('/repo/config'));
    expect(env.smtp).toMatchObject({
      port: 465,
      secure: true,
      to: ['a@example.com', 'b@example.com'],
    });
    expect(() =>
      readEnvironment({ SMTP_HOST: 'x', ALERT_EMAIL_TO: 'a@example.com', SMTP_PORT: 'abc' }),
    ).toThrow(/SMTP_PORT/);
  });
});

describe('Console Admin key (optional sources)', () => {
  it('is read from its own variable and never falls back to another key', () => {
    expect(
      readEnvironment({ ANTHROPIC_ENTERPRISE_API_KEY: 'shared', ANTHROPIC_ADMIN_API_KEY: 'admin' })
        .keys.console,
    ).toBeUndefined();
    expect(
      readEnvironment({
        ANTHROPIC_ENTERPRISE_API_KEY: 'shared',
        ANTHROPIC_CONSOLE_ADMIN_API_KEY: 'console',
      }).keys,
    ).toMatchObject({ admin: 'shared', console: 'console' });
    expect(readEnvironment({ ANTHROPIC_CONSOLE_ADMIN_API_KEY: '  ' }).keys.console).toBeUndefined();
  });

  it('is off by default and validated when configured', async () => {
    const { config } = await loadConfig(join(dir, 'missing'));
    expect(config.sources.console).toEqual({ enabled: false, lookbackDays: 30 });
    expect(config.sources.claudeCode).toEqual({ enabled: false, lookbackDays: 7 });
    expect(config.sources.featureUsage).toEqual({ enabled: false, lookbackDays: 30 });
    await writeFile(
      join(dir, 'default.json'),
      JSON.stringify({
        sources: {
          console: { enabled: true },
          claudeCode: { enabled: true, lookbackDays: 31 },
          featureUsage: { enabled: true, lookbackDays: 90 },
          disabled: ['consoleCost', 'chatProjectUsage'],
        },
      }),
    );
    const loaded = (await loadConfig(dir)).config.sources;
    expect(loaded.console).toEqual({ enabled: true, lookbackDays: 30 });
    expect(loaded.claudeCode).toEqual({ enabled: true, lookbackDays: 31 });
    expect(loaded.featureUsage).toEqual({ enabled: true, lookbackDays: 90 });
    expect(loaded.disabled).toEqual(['consoleCost', 'chatProjectUsage']);
    await writeFile(
      join(dir, 'default.json'),
      JSON.stringify({ sources: { claudeCode: { lookbackDays: 90 } } }),
    );
    await expect(loadConfig(dir)).rejects.toThrow(/default\.json/);
  });
});

describe('loadConfig', () => {
  it('fills defaults when files are absent', async () => {
    const { config, customRules } = await loadConfig(dir);
    expect(config.sources.activities.excludeTypes).toContain('claude_chat_viewed');
    expect(config.notifications).toEqual({
      statuses: ['fail', 'warning'],
      minSeverity: 'high',
      cooldownMinutes: 360,
    });
    expect(customRules).toEqual({ settingBaselines: [], activityWatches: [] });
  });

  it('explains invalid configuration and custom rules', async () => {
    await writeFile(join(dir, 'default.json'), JSON.stringify({ sources: { disabled: ['nope'] } }));
    await expect(loadConfig(dir)).rejects.toThrow(/config\/default.json[\s\S]*Unknown dataset/);
    await writeFile(join(dir, 'default.json'), '{}');
    await writeFile(
      join(dir, 'custom-rules.json'),
      JSON.stringify({ settingBaselines: [{ id: 'X' }] }),
    );
    await expect(loadConfig(dir)).rejects.toThrow(/custom-rules.json/);
  });
});
