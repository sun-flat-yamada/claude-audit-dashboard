import { describe, expect, it } from 'vitest';
import { activity, snapshot } from '../../../__tests__/fixtures.js';
import { buildRuleCatalog } from '../catalog.js';
import { activityWatchRule, unknownActivityTypes } from '../factories/activity-watch.js';
import { DEFAULT_ACTIVITY_WATCHES, DEFAULT_SETTING_BASELINES } from '../factories/defaults.js';
import { satisfies, settingBaselineRule } from '../factories/setting-baseline.js';
import { BUILTIN_RULES } from '../rules/index.js';
import { evaluate } from './helpers.js';

const settings = (org: string, values: Record<string, unknown>) => ({
  organizationId: org,
  organizationName: `Org ${org}`,
  values: Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { type: 'x', value }])),
});

describe('setting baselines', () => {
  it('evaluates every expectation kind', () => {
    expect(satisfies(true, { kind: 'equals', value: true })).toBe(true);
    expect(satisfies('scim_advanced', { kind: 'oneOf', values: ['scim_advanced'] })).toBe(true);
    expect(satisfies(null, { kind: 'max', value: 10 })).toBe(false);
    expect(satisfies(5, { kind: 'max', value: 10 })).toBe(true);
    expect(satisfies([], { kind: 'nonEmpty' })).toBe(false);
    const retention = { chat: { type: 'fixed', duration: 12, timescale: 'month' } };
    expect(satisfies(retention, { kind: 'retentionAtMostDays', days: 365 })).toBe(true);
    expect(
      satisfies({ chat: { type: 'indefinite' } }, { kind: 'retentionAtMostDays', days: 365 }),
    ).toBe(false);
    expect(satisfies({}, { kind: 'retentionAtMostDays', days: 365 })).toBe(false);
  });

  it('fails deviating organizations, ignores ones where the setting is not controllable', () => {
    const rule = settingBaselineRule({
      id: 'CF-900',
      name: 'IP allowlist',
      severity: 'medium',
      setting: 'ip_allowlist_enabled',
      expect: { kind: 'equals', value: true },
    });
    const result = evaluate(
      rule,
      snapshot({
        settings: [
          settings('a', { ip_allowlist_enabled: false }),
          settings('b', { ip_allowlist_enabled: true }),
          settings('c', {}),
        ],
      }),
    );
    expect(result).toMatchObject({
      status: 'fail',
      category: 'configuration',
      message: '1 of 2 organization(s) deviate on ip_allowlist_enabled',
    });
    expect(result.evidence[0]?.label).toBe('Org a: ip_allowlist_enabled = false');
    expect(evaluate(rule, snapshot({ settings: [settings('c', {})] })).status).toBe('skipped');
  });
});

describe('activity watches', () => {
  const watch = activityWatchRule({
    id: 'AM-900',
    name: 'Admin grants',
    severity: 'high',
    threshold: 2,
    match: [
      { types: ['org_sso_toggled'] },
      { types: ['claude_user_role_updated'], where: { attribute: 'current_role', in: ['owner'] } },
    ],
  });

  it('warns when matching events reach the threshold, honouring attribute filters', () => {
    const events = [
      activity('1', { type: 'org_sso_toggled' }),
      activity('2', { type: 'claude_user_role_updated', attributes: { current_role: 'owner' } }),
      activity('3', { type: 'claude_user_role_updated', attributes: { current_role: 'user' } }),
    ];
    const result = evaluate(watch, snapshot({ activities: events }));
    expect(result).toMatchObject({ status: 'warning', details: { count: 2 } });
    expect(result.evidence.map((e) => e.id)).toEqual(['1', '2']);
    expect(evaluate(watch, snapshot({ activities: events }), { threshold: 3 }).status).toBe('pass');
  });

  it('only references activity types the API reference lists', () => {
    expect(unknownActivityTypes(DEFAULT_ACTIVITY_WATCHES)).toEqual([]);
    expect(
      unknownActivityTypes([
        { id: 'AM-901', name: 'x', severity: 'low', match: [{ types: ['not_a_type'] }] },
      ]),
    ).toEqual(['not_a_type']);
  });
});

describe('buildRuleCatalog', () => {
  it('contains code, baseline and watch rules with unique ids', () => {
    const { rules } = buildRuleCatalog();
    const ids = rules.map((r) => r.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['AC-001', 'OP-002', 'CF-001', 'AM-001']));
    expect(BUILTIN_RULES).toHaveLength(14);
    expect(rules).toHaveLength(
      BUILTIN_RULES.length + DEFAULT_SETTING_BASELINES.length + DEFAULT_ACTIVITY_WATCHES.length,
    );
  });

  it('lets custom definitions override defaults by id and add new ones', () => {
    const { rules, settingBaselines } = buildRuleCatalog({
      settingBaselines: [
        {
          id: 'CF-005',
          name: 'Retention',
          severity: 'high',
          setting: 'data_retention_periods',
          expect: { kind: 'retentionAtMostDays', days: 90 },
        },
        {
          id: 'CF-100',
          name: 'Web search off',
          severity: 'low',
          setting: 'web_search_enabled',
          expect: { kind: 'equals', value: false },
        },
      ],
    });
    expect(settingBaselines.find((b) => b.id === 'CF-005')?.severity).toBe('high');
    expect(rules.some((r) => r.meta.id === 'CF-100')).toBe(true);
  });

  it('rejects invalid custom definitions', () => {
    expect(() =>
      buildRuleCatalog({
        settingBaselines: [
          {
            id: 'bad',
            name: 'x',
            severity: 'low',
            setting: 's',
            expect: { kind: 'equals', value: true },
          },
        ],
      }),
    ).toThrow();
  });
});
