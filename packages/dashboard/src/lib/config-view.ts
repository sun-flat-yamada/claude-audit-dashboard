import type { ConfigRule, ConfigValue, DetailConfig } from '@claude-audit/core/contracts';

export type RuleFilter = 'all' | 'enabled' | 'disabled' | 'custom';
export const RULE_FILTERS: readonly RuleFilter[] = ['all', 'enabled', 'disabled', 'custom'];

export const isCustomRule = (rule: Pick<ConfigRule, 'origin'>): boolean =>
  rule.origin !== 'builtin';

/** Display text of a parameter value; lists are comma separated, an empty list reads "none". */
export function formatConfigValue(value: ConfigValue): string {
  if (Array.isArray(value)) return value.length === 0 ? 'none' : value.map(String).join(', ');
  return String(value);
}

const includesQuery = (query: string, ...texts: readonly (string | number | boolean)[]): boolean =>
  query === '' || texts.some((t) => String(t).toLowerCase().includes(query));

const normalize = (query: string): string => query.trim().toLowerCase();

export function countRules(rules: readonly ConfigRule[]): Record<RuleFilter, number> {
  return {
    all: rules.length,
    enabled: rules.filter((r) => r.enabled).length,
    disabled: rules.filter((r) => !r.enabled).length,
    custom: rules.filter(isCustomRule).length,
  };
}

const ruleTexts = (r: ConfigRule): string[] => [
  r.id,
  r.name,
  r.category,
  r.severity,
  r.origin,
  r.enabled ? 'enabled' : 'disabled',
  ...r.requires,
];

export function filterRules(
  rules: readonly ConfigRule[],
  query: string,
  filter: RuleFilter,
): ConfigRule[] {
  const q = normalize(query);
  return rules.filter((r) => {
    if (filter === 'enabled' && !r.enabled) return false;
    if (filter === 'disabled' && r.enabled) return false;
    if (filter === 'custom' && !isCustomRule(r)) return false;
    return includesQuery(q, ...ruleTexts(r));
  });
}

/** Rules with at least one parameter (or rejected parameters) matching the search text. */
export function filterParameterRules(rules: readonly ConfigRule[], query: string): ConfigRule[] {
  const q = normalize(query);
  return rules
    .filter((r) => r.parameters.length > 0 || !r.paramsValid)
    .filter(
      (r) =>
        includesQuery(q, r.id, r.name) ||
        r.parameters.some((p) => includesQuery(q, p.key, formatConfigValue(p.value))),
    );
}

export function filterCustomRules(
  customRules: DetailConfig['customRules'],
  query: string,
): DetailConfig['customRules'] {
  const q = normalize(query);
  return customRules.filter((r) => includesQuery(q, r.id, r.name, r.kind, r.severity, r.summary));
}

export const CHANNEL_LABEL: Record<
  DetailConfig['notifications']['channels'][number]['kind'],
  string
> = {
  console: 'Console log',
  slack: 'Slack',
  discord: 'Discord',
  email: 'E-mail',
};

export interface Setting {
  label: string;
  value: string;
}

export function notificationSettings(n: DetailConfig['notifications']): Setting[] {
  return [
    { label: 'Notify on statuses', value: n.statuses.join(', ') || 'none' },
    { label: 'Minimum severity', value: n.minSeverity },
    { label: 'Cooldown', value: `${n.cooldownMinutes} minutes` },
  ];
}

export function collectionSettings(s: DetailConfig['sources']): Setting[] {
  const a = s.activities;
  return [
    { label: 'Member provider', value: s.membersProvider },
    { label: 'Member activity look-back', value: `${s.memberActivityLookbackDays} days` },
    { label: 'Group member request limit', value: String(s.groupMemberRequestLimit) },
    { label: 'Activity initial look-back', value: `${a.initialLookbackHours} hours` },
    { label: 'Activity overlap', value: `${a.overlapMinutes} minutes` },
    { label: 'Activity lag', value: `${a.lagMinutes} minutes` },
    { label: 'Activity page size', value: String(a.pageSize) },
    {
      label: 'Included activity types',
      value: a.includedTypeCount === 0 ? 'all' : String(a.includedTypeCount),
    },
    { label: 'Excluded activity types', value: String(a.excludedTypeCount) },
  ];
}

export function otherSettings(view: DetailConfig): Setting[] {
  return [
    { label: 'Snapshot retention', value: `${view.retention.snapshotDays} days` },
    { label: 'Personal data masking (maskPii)', value: view.dashboard.maskPii ? 'On' : 'Off' },
  ];
}

export interface ConfigSections {
  rules: ConfigRule[];
  parameterRules: ConfigRule[];
  customRules: DetailConfig['customRules'];
  channels: DetailConfig['notifications']['channels'];
  policy: Setting[];
  datasets: DetailConfig['sources']['datasets'];
  collection: Setting[];
  other: Setting[];
}

const matchSettings = (settings: Setting[], q: string): Setting[] =>
  settings.filter((s) => includesQuery(q, s.label, s.value));

/** Every section narrowed by the search text; the rule filter applies to the rules table only. */
export function filterConfig(
  view: DetailConfig,
  query: string,
  filter: RuleFilter,
): ConfigSections {
  const q = normalize(query);
  return {
    rules: filterRules(view.rules, query, filter),
    parameterRules: filterParameterRules(view.rules, query),
    customRules: filterCustomRules(view.customRules, query),
    channels: view.notifications.channels.filter((c) =>
      includesQuery(q, CHANNEL_LABEL[c.kind], c.kind, c.enabled ? 'enabled' : 'disabled'),
    ),
    policy: matchSettings(notificationSettings(view.notifications), q),
    datasets: view.sources.datasets.filter((d) =>
      includesQuery(q, d.name, d.enabled ? 'enabled' : 'disabled'),
    ),
    collection: matchSettings(collectionSettings(view.sources), q),
    other: matchSettings(otherSettings(view), q),
  };
}

export const sectionTotal = (s: ConfigSections): number =>
  s.rules.length +
  s.parameterRules.length +
  s.customRules.length +
  s.channels.length +
  s.policy.length +
  s.datasets.length +
  s.collection.length +
  s.other.length;
