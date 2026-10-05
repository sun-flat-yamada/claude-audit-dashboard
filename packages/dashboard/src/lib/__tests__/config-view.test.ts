import type { ConfigRule, DetailConfig } from '@claude-audit/core/contracts';
import { describe, expect, it } from 'vitest';
import {
  collectionSettings,
  countRules,
  filterConfig,
  filterCustomRules,
  filterParameterRules,
  filterRules,
  formatConfigValue,
  notificationSettings,
  sectionTotal,
} from '../config-view';

const rule = (id: string, over: Partial<ConfigRule> = {}): ConfigRule => ({
  id,
  name: `Rule ${id}`,
  category: 'access-control',
  severity: 'medium',
  enabled: true,
  origin: 'builtin',
  requires: ['members'],
  paramsValid: true,
  parameters: [],
  ...over,
});

const view: DetailConfig = {
  schemaVersion: 1,
  generatedAt: '2026-09-29T12:00:00.000Z',
  rules: [
    rule('AC-001', {
      parameters: [{ key: 'inactiveDays', value: 45, defaultValue: 90, overridden: true }],
    }),
    rule('DG-001', { enabled: false, category: 'data-governance', requires: ['groups'] }),
    rule('CF-010', { origin: 'custom', requires: ['settings'] }),
    rule('UA-002', { paramsValid: false }),
  ],
  customRules: [
    {
      id: 'CF-010',
      kind: 'setting-baseline',
      name: 'Web Search Off',
      severity: 'low',
      enabled: true,
      replacesBuiltin: false,
      summary: 'web_search_enabled = false',
    },
  ],
  unknownRuleIds: { disabled: [], parameters: [] },
  sources: {
    datasets: [
      { name: 'members', enabled: true },
      { name: 'usage', enabled: false },
    ],
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
  },
  notifications: {
    statuses: ['fail', 'warning'],
    minSeverity: 'high',
    cooldownMinutes: 360,
    channels: [
      { kind: 'console', enabled: true },
      { kind: 'slack', enabled: false },
    ],
  },
  retention: { snapshotDays: 365 },
  dashboard: { maskPii: true },
};

describe('config view helpers', () => {
  it('formats values and lists', () => {
    expect(formatConfigValue(['a', 'b'])).toBe('a, b');
    expect(formatConfigValue([])).toBe('none');
    expect(formatConfigValue(false)).toBe('false');
    expect(formatConfigValue(12)).toBe('12');
  });

  it('counts and filters rules by state and text', () => {
    expect(countRules(view.rules)).toEqual({ all: 4, enabled: 3, disabled: 1, custom: 1 });
    expect(filterRules(view.rules, '', 'disabled').map((r) => r.id)).toEqual(['DG-001']);
    expect(filterRules(view.rules, '', 'custom').map((r) => r.id)).toEqual(['CF-010']);
    expect(filterRules(view.rules, 'GOVERNANCE', 'all').map((r) => r.id)).toEqual(['DG-001']);
    expect(filterRules(view.rules, 'settings', 'all').map((r) => r.id)).toEqual(['CF-010']);
    expect(filterRules(view.rules, 'nothing', 'all')).toEqual([]);
  });

  it('keeps rules with parameters (or rejected ones) and searches keys and values', () => {
    expect(filterParameterRules(view.rules, '').map((r) => r.id)).toEqual(['AC-001', 'UA-002']);
    expect(filterParameterRules(view.rules, 'inactivedays').map((r) => r.id)).toEqual(['AC-001']);
    expect(filterParameterRules(view.rules, '45').map((r) => r.id)).toEqual(['AC-001']);
  });

  it('filters custom rules, channels, datasets and settings', () => {
    expect(filterCustomRules(view.customRules, 'web_search')).toHaveLength(1);
    expect(filterCustomRules(view.customRules, 'zzz')).toHaveLength(0);
    const slack = filterConfig(view, 'slack', 'all');
    expect(slack.channels.map((c) => c.kind)).toEqual(['slack']);
    expect(slack.rules).toEqual([]);
    expect(filterConfig(view, 'disabled', 'all').datasets.map((d) => d.name)).toEqual(['usage']);
    expect(filterConfig(view, 'retention', 'all').other).toHaveLength(1);
  });

  it('reports no section for an unmatched search', () => {
    expect(sectionTotal(filterConfig(view, 'qqqq', 'all'))).toBe(0);
    expect(sectionTotal(filterConfig(view, '', 'all'))).toBeGreaterThan(10);
  });

  it('describes policy and collection settings', () => {
    expect(notificationSettings(view.notifications)).toEqual([
      { label: 'Notify on statuses', value: 'fail, warning' },
      { label: 'Minimum severity', value: 'high' },
      { label: 'Cooldown', value: '360 minutes' },
    ]);
    expect(collectionSettings(view.sources).map((s) => s.value)).toContain('all');
  });
});
