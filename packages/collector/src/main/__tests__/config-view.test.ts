import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DETAIL_CONFIG_PATH,
  DETAIL_MANIFEST_PATH,
  checkDetailBundle,
  detailConfigSchema,
  detailManifestSchema,
} from '@claude-audit/core/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_NOW, createDemoCollectors } from '../../adapters/demo/demo-source.js';
import { fixedClock, silentLogger } from '../../infrastructure/runtime.js';
import { createContainer } from '../container.js';
import { writeDetail } from '../detail.js';
import { collect } from '../workflows.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'config-view-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// Synthetic placeholders only.
const SECRETS = [
  'https://hooks.slack.com/services/T0000/B0000/mockmockmockmock',
  'https://discord.com/api/webhooks/1234/mockmockmock',
  'smtp.corp.internal',
  'smtp-user-mock',
  'smtp-pass-mock-value',
  'sk-ant-api-mock000000000000000000000000',
  'alerts.person@corp.test',
  'team.lead@corp.test',
];
const ENV = {
  ANTHROPIC_ENTERPRISE_API_KEY: SECRETS[5] as string,
  SLACK_WEBHOOK_URL: SECRETS[0] as string,
  DISCORD_WEBHOOK_URL: SECRETS[1] as string,
  SMTP_HOST: SECRETS[2] as string,
  SMTP_USER: SECRETS[3] as string,
  SMTP_PASS: SECRETS[4] as string,
  ALERT_EMAIL_FROM: SECRETS[6] as string,
  ALERT_EMAIL_TO: SECRETS[7] as string,
};

async function container(env: NodeJS.ProcessEnv, config?: object, customRules?: object) {
  const configDir = join(dir, 'config');
  await mkdir(configDir, { recursive: true });
  if (config) await writeFile(join(configDir, 'default.json'), JSON.stringify(config));
  if (customRules)
    await writeFile(join(configDir, 'custom-rules.json'), JSON.stringify(customRules));
  const c = await createContainer({
    env: { CONFIG_DIR: configDir, ...env },
    cwd: dir,
    dataDir: join(dir, 'data'),
    clock: fixedClock(DEMO_NOW),
    collectors: createDemoCollectors(),
    logger: silentLogger,
    source: 'demo',
  });
  await collect(c);
  return c;
}

describe('effective configuration file (detail/config.json)', () => {
  it('reports the loaded configuration and listed channels without any secret', async () => {
    const c = await container(
      ENV,
      {
        compliance: { disabledRules: ['AC-001'], params: { 'AK-003': { maxAgeDays: 120 } } },
        notifications: { minSeverity: 'medium' },
        sources: { disabled: ['usage'] },
      },
      {
        activityWatches: [
          {
            id: 'AM-009',
            name: 'Key creation',
            severity: 'low',
            match: [{ types: ['api_key_created'] }],
          },
        ],
      },
    );
    const files = await writeDetail(c);
    const text = files[DETAIL_CONFIG_PATH] ?? '';
    const view = detailConfigSchema.parse(JSON.parse(text));
    expect(view.rules.find((r) => r.id === 'AC-001')?.enabled).toBe(false);
    expect(view.rules.find((r) => r.id === 'AK-003')?.parameters[0]).toMatchObject({
      value: 120,
      defaultValue: 180,
      overridden: true,
    });
    expect(view.customRules.map((r) => r.id)).toEqual(['AM-009']);
    expect(view.sources.datasets.find((d) => d.name === 'usage')?.enabled).toBe(false);
    expect(view.notifications.minSeverity).toBe('medium');
    expect(view.notifications.channels).toEqual([
      { kind: 'console', enabled: true },
      { kind: 'slack', enabled: true },
      { kind: 'discord', enabled: true },
      { kind: 'email', enabled: true },
    ]);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toContain(dir);
    // Written to disk as listed in the manifest, and the bundle validates.
    expect(await readFile(join(dir, 'data', DETAIL_CONFIG_PATH), 'utf8')).toBe(text);
    const manifest = detailManifestSchema.parse(JSON.parse(files[DETAIL_MANIFEST_PATH] ?? ''));
    expect(manifest.files.find((f) => f.kind === 'config')).toMatchObject({
      path: DETAIL_CONFIG_PATH,
      status: 'ok',
    });
    expect(checkDetailBundle(files)).toEqual([]);
  });

  it('shows channels as disabled when nothing is configured', async () => {
    const c = await container({});
    const view = detailConfigSchema.parse(
      JSON.parse((await writeDetail(c))[DETAIL_CONFIG_PATH] ?? ''),
    );
    expect(view.notifications.channels.filter((ch) => ch.enabled).map((ch) => ch.kind)).toEqual([
      'console',
    ]);
  });
});
