import { describe, expect, it } from 'vitest';
import {
  CONFIG_REDACTED,
  checkDetailBundle,
  detailConfigSchema,
  looksSensitive,
} from '../../contracts/index.js';
import { buildRuleCatalog } from '../../domain/compliance/catalog.js';
import {
  buildConfigView,
  safeText,
  safeValue,
  type ConfigViewInput,
} from '../presenters/config-view.js';
import { buildDetailView, DEFAULT_DETAIL_THRESHOLDS } from '../presenters/detail-view.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');

const input = (over: Partial<ConfigViewInput> = {}): ConfigViewInput => ({
  now: NOW,
  rules: buildRuleCatalog().rules,
  customRules: {},
  disabledRules: [],
  ruleParams: {},
  disabledDatasets: [],
  membersProvider: 'admin',
  memberActivityLookbackDays: 90,
  groupMemberRequestLimit: 200,
  activities: {
    initialLookbackHours: 168,
    overlapMinutes: 10,
    lagMinutes: 2,
    pageSize: 5000,
    includedTypeCount: 0,
    excludedTypeCount: 8,
  },
  notifications: {
    statuses: ['fail', 'warning'],
    minSeverity: 'high',
    cooldownMinutes: 360,
    channels: { slack: false, discord: false, email: false },
  },
  snapshotDays: 365,
  maskPii: true,
  ...over,
});

const build = (over: Partial<ConfigViewInput> = {}) =>
  detailConfigSchema.parse(buildConfigView(input(over)));
const rule = (id: string, over: Partial<ConfigViewInput> = {}) => {
  const found = build(over).rules.find((r) => r.id === id);
  if (!found) throw new Error(`rule ${id} missing`);
  return found;
};

describe('buildConfigView', () => {
  it('lists every rule with defaults as effective parameters', () => {
    const view = build();
    expect(view.rules.length).toBe(buildRuleCatalog().rules.length);
    const ac001 = rule('AC-001');
    expect(ac001).toMatchObject({ enabled: true, origin: 'builtin', paramsValid: true });
    expect(ac001.parameters).toEqual([
      { key: 'inactiveDays', value: 90, defaultValue: 90, overridden: false },
    ]);
    expect(view.customRules).toEqual([]);
    expect(view.sources.datasets.every((d) => d.enabled)).toBe(true);
  });

  it('marks disabled rules, overridden parameters and unknown ids', () => {
    const over = {
      disabledRules: ['DG-001', 'XX-123', 'not a rule id'],
      ruleParams: { 'AC-001': { inactiveDays: 45 }, 'ZZ-999': { a: 1 }, 'bad id': {} },
    };
    expect(rule('DG-001', over).enabled).toBe(false);
    expect(rule('AC-002', over).enabled).toBe(true);
    expect(rule('AC-001', over).parameters).toEqual([
      { key: 'inactiveDays', value: 45, defaultValue: 90, overridden: true },
    ]);
    expect(build(over).unknownRuleIds).toEqual({ disabled: ['XX-123'], parameters: ['ZZ-999'] });
  });

  it('shows only parameters the rule declares and flags rejected values', () => {
    const over = { ruleParams: { 'AC-001': { inactiveDays: 'soon', extra: 'https://x.test' } } };
    const bad = rule('AC-001', over);
    expect(bad.paramsValid).toBe(false);
    expect(bad.parameters).toEqual([]);
    const extra = rule('AC-001', { ruleParams: { 'AC-001': { inactiveDays: 30, extra: 'a' } } });
    expect(extra.parameters.map((p) => p.key)).toEqual(['inactiveDays']);
  });

  it('reports custom rules, replaced built-ins and disabled sources', () => {
    const customRules = {
      settingBaselines: [
        {
          id: 'CF-010',
          name: 'Web Search Off',
          severity: 'low' as const,
          setting: 'web_search_enabled',
          expect: { kind: 'equals' as const, value: false },
        },
        {
          id: 'CF-001',
          name: 'SSO strict',
          severity: 'critical' as const,
          setting: 'sso_claude_ai_enforced',
          expect: { kind: 'equals' as const, value: true },
        },
      ],
      activityWatches: [
        {
          id: 'AM-009',
          name: 'Key creation',
          severity: 'medium' as const,
          match: [{ types: ['api_key_created'] }],
          threshold: 3,
        },
      ],
    };
    const over = {
      rules: buildRuleCatalog(customRules).rules,
      customRules,
      disabledRules: ['AM-009'],
      disabledDatasets: ['usage'],
    };
    const view = build(over);
    expect(rule('CF-010', over).origin).toBe('custom');
    expect(rule('CF-001', over).origin).toBe('override');
    expect(rule('AC-001', over).origin).toBe('builtin');
    expect(view.customRules.map((r) => [r.id, r.kind, r.replacesBuiltin, r.enabled])).toEqual([
      ['CF-010', 'setting-baseline', false, true],
      ['CF-001', 'setting-baseline', true, true],
      ['AM-009', 'activity-watch', false, false],
    ]);
    expect(view.customRules[0]?.summary).toBe('web_search_enabled = false');
    expect(view.customRules[2]?.summary).toBe('Activity types api_key_created; threshold 3');
    expect(view.sources.datasets.find((d) => d.name === 'usage')?.enabled).toBe(false);
  });

  it('lists notification channels by kind with an enabled flag only', () => {
    const view = build({
      notifications: {
        ...input().notifications,
        channels: { slack: true, discord: false, email: true },
      },
    });
    expect(view.notifications.channels).toEqual([
      { kind: 'console', enabled: true },
      { kind: 'slack', enabled: true },
      { kind: 'discord', enabled: false },
      { kind: 'email', enabled: true },
    ]);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildConfigView(input()))).toBe(JSON.stringify(buildConfigView(input())));
  });
});

describe('secret and PII safety', () => {
  const WEBHOOK = 'https://hooks.slack.com/services/T0000/B0000/mockmockmockmock';
  const DISCORD = 'https://discord.com/api/webhooks/1234/mockmockmock';
  const KEY = 'sk-ant-api-mock000000000000000000000000';
  const EMAIL = 'recipient.person@corp.test';
  const PATH = '/home/someone/secrets/.env';
  const SMTP = 'smtp.corp.internal';

  /** Seeds every free-text and value slot, plus extra properties a caller might pass by mistake. */
  const hostile = () => {
    const customRules = {
      settingBaselines: [
        {
          id: 'CF-010',
          name: `Named ${DISCORD}`,
          severity: 'low' as const,
          setting: `${KEY}`,
          expect: { kind: 'oneOf' as const, values: [EMAIL, PATH, WEBHOOK, 'plain'] },
          description: WEBHOOK,
          remediation: EMAIL,
        },
      ],
      activityWatches: [
        { id: 'AM-009', name: EMAIL, severity: 'low' as const, match: [{ types: [KEY, 'login'] }] },
      ],
    };
    const leaky = {
      ...input({
        rules: buildRuleCatalog(customRules).rules,
        customRules,
        disabledRules: [WEBHOOK, EMAIL, 'DG-001'],
        ruleParams: {
          'UA-002': { currency: WEBHOOK, monthlyBudget: 5 },
          'OP-002': { ignore: [EMAIL, KEY, PATH, 'adoption'] },
          [WEBHOOK]: { a: 1 },
          'AC-001': { inactiveDays: 30, [KEY]: KEY },
        },
        membersProvider: EMAIL,
        notifications: { ...input().notifications, minSeverity: WEBHOOK },
      }),
      slackWebhookUrl: WEBHOOK,
      discordWebhookUrl: DISCORD,
      smtp: { host: SMTP, user: EMAIL, pass: KEY, to: [EMAIL] },
      env: { ANTHROPIC_ENTERPRISE_API_KEY: KEY },
    };
    return leaky as ConfigViewInput;
  };

  it('never emits webhook URLs, keys, e-mail addresses, paths or SMTP hosts', () => {
    const text = JSON.stringify(buildConfigView(hostile()));
    for (const secret of [WEBHOOK, DISCORD, KEY, EMAIL, PATH, SMTP, 'hooks.slack', 'discord.com']) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/https?:|@|sk-ant|\/home\//);
    expect(text).toContain(CONFIG_REDACTED);
    // The rest of the configuration is still reported.
    expect(text).toContain('"DG-001"');
    expect(text).toContain('adoption');
  });

  it('passes the bundle check; the same content with a leak does not', () => {
    const files = (config: unknown) => {
      const bundle = buildDetailView({
        now: NOW,
        source: 'demo',
        maskPii: true,
        snapshot: null,
        report: null,
        thresholds: DEFAULT_DETAIL_THRESHOLDS,
        config: hostile(),
      });
      const text = JSON.stringify(config);
      return {
        'detail/index.json': JSON.stringify(bundle.manifest),
        'detail/config.json': text,
      };
    };
    const clean = buildConfigView(hostile());
    const onlyConfigProblems = (config: unknown) =>
      checkDetailBundle(files(config), { requireDemo: true }).filter((p) =>
        p.startsWith('detail/config.json'),
      );
    expect(onlyConfigProblems(clean)).toEqual([]);
    const leaked = { ...clean, notifications: { ...clean.notifications, minSeverity: WEBHOOK } };
    expect(onlyConfigProblems(leaked).join()).toMatch(/look like a secret/);
    const mailed = {
      ...clean,
      rules: clean.rules.map((r, i) => (i === 0 ? { ...r, name: EMAIL } : r)),
    };
    expect(onlyConfigProblems(mailed).join()).toMatch(/look like a secret/);
    const pathed = {
      ...clean,
      dashboard: { maskPii: true },
      customRules: [{ ...(clean.customRules[0] ?? {}), summary: PATH }],
    };
    expect(onlyConfigProblems(pathed).length).toBeGreaterThan(0);
  });

  it('safeText / safeValue keep ordinary text and hide the rest', () => {
    expect(safeText('  Members   Without Spend Limit ')).toBe('Members Without Spend Limit');
    expect(safeText('x'.repeat(300)).length).toBe(160);
    for (const bad of [
      WEBHOOK,
      EMAIL,
      KEY,
      PATH,
      'C:\\Users\\a\\x',
      '~/.ssh/id',
      'ghp_abcdefghijklmnop',
      ['AKIA', 'ABCDEFGHIJKLMNOP'].join(''),
    ])
      expect(safeText(bad)).toBe(CONFIG_REDACTED);
    expect(safeValue(['a', EMAIL, 3, true, { nested: 1 }, null])).toEqual([
      'a',
      CONFIG_REDACTED,
      3,
      true,
      CONFIG_REDACTED,
      CONFIG_REDACTED,
    ]);
    expect(safeValue(Number.NaN)).toBe(CONFIG_REDACTED);
    expect(looksSensitive('org_sso_group_role_mappings_updated')).toBe(false);
    expect(looksSensitive('read:compliance_user_data')).toBe(false);
  });
});

describe('detail manifest', () => {
  it('lists the config file with its own schema version and rule count', () => {
    const bundle = buildDetailView({
      now: NOW,
      source: 'demo',
      maskPii: true,
      snapshot: null,
      report: null,
      thresholds: DEFAULT_DETAIL_THRESHOLDS,
      config: input(),
    });
    const entry = bundle.manifest.files.find((f) => f.kind === 'config');
    expect(entry).toMatchObject({ path: 'detail/config.json', status: 'ok', schemaVersion: 1 });
    expect(entry?.count).toBe(buildRuleCatalog().rules.length);
    expect(bundle.files.some((f) => f.path === 'detail/config.json')).toBe(true);
  });

  it('omits the config file when no configuration is supplied', () => {
    const bundle = buildDetailView({
      now: NOW,
      source: 'live',
      maskPii: true,
      snapshot: null,
      report: null,
      thresholds: DEFAULT_DETAIL_THRESHOLDS,
    });
    expect(bundle.manifest.files.some((f) => f.kind === 'config')).toBe(false);
  });
});
