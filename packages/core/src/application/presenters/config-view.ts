import type { z } from 'zod';
import {
  CONFIG_REDACTED,
  CONFIG_VIEW_SCHEMA_VERSION,
  looksSensitive,
  type ConfigCustomRule,
  type ConfigParameter,
  type ConfigRule,
  type ConfigValue,
  type DetailConfig,
} from '../../contracts/config-view.js';
import { customRulesSchema, type CustomRules } from '../../domain/compliance/catalog.js';
import type { Rule } from '../../domain/compliance/define-rule.js';
import {
  DEFAULT_ACTIVITY_WATCHES,
  DEFAULT_SETTING_BASELINES,
} from '../../domain/compliance/factories/defaults.js';
import { describeExpectation } from '../../domain/compliance/factories/setting-baseline.js';
import { DATASET_NAMES } from '../../domain/model/dataset.js';

/** Largest list shown for one parameter value, and longest text kept. */
const MAX_ITEMS = 20;
const MAX_TEXT = 160;
const RULE_ID = /^[A-Z]{2,}-\d{3}$/;

/**
 * The only configuration the view can carry. Every field is named here on purpose: the mapper
 * never receives the loaded config object, so secrets that live next to it (webhook URLs, SMTP
 * settings, recipients, API keys, paths) have no field to travel in. Channels are booleans.
 */
export interface ConfigViewInput {
  now: Date;
  /** Every rule the engine evaluates (code rules and data-driven rules). */
  rules: readonly Rule[];
  /** The `custom-rules.json` content (definitions added or replaced by the operator). */
  customRules: CustomRules;
  disabledRules: readonly string[];
  /** Configured parameters per rule id; only keys the rule declares are shown. */
  ruleParams: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  disabledDatasets: readonly string[];
  membersProvider: string;
  memberActivityLookbackDays: number;
  groupMemberRequestLimit: number;
  activities: {
    initialLookbackHours: number;
    overlapMinutes: number;
    lagMinutes: number;
    pageSize: number;
    includedTypeCount: number;
    excludedTypeCount: number;
  };
  notifications: {
    statuses: readonly string[];
    minSeverity: string;
    cooldownMinutes: number;
    channels: { slack: boolean; discord: boolean; email: boolean };
  };
  snapshotDays: number;
  maskPii: boolean;
}

/** Text safe to publish: truncated, or the placeholder when it looks like a secret / URL / path. */
export function safeText(text: string, max: number = MAX_TEXT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (looksSensitive(flat)) return CONFIG_REDACTED;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const safeScalar = (value: unknown): string | number | boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : CONFIG_REDACTED;
  return typeof value === 'string' ? safeText(value) : CONFIG_REDACTED;
};

/** Scalars and lists of scalars pass (redacted per item); objects and the rest become `[hidden]`. */
export function safeValue(value: unknown): ConfigValue {
  return Array.isArray(value) ? value.slice(0, MAX_ITEMS).map(safeScalar) : safeScalar(value);
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

type Params = Readonly<Record<string, unknown>>;

function defaultsOf(rule: Rule): Params | null {
  const parsed = (rule.params as z.ZodType).safeParse({});
  return parsed.success && typeof parsed.data === 'object' && parsed.data !== null
    ? (parsed.data as Params)
    : null;
}

/** Effective parameters: the rule's own parse of the configured values (keys it declares only). */
function parametersOf(
  rule: Rule,
  configured: Params | undefined,
): { valid: boolean; list: ConfigParameter[] } {
  const defaults = defaultsOf(rule);
  const parsed = (rule.params as z.ZodType).safeParse(configured ?? {});
  if (!parsed.success || typeof parsed.data !== 'object' || parsed.data === null)
    return { valid: false, list: [] };
  const list = Object.entries(parsed.data as Params).map(([key, value]) => {
    const fallback = defaults && key in defaults ? defaults[key] : undefined;
    return {
      key: safeText(key, 60),
      value: safeValue(value),
      defaultValue: fallback === undefined ? null : safeValue(fallback),
      overridden: fallback !== undefined && !sameValue(value, fallback),
    };
  });
  return { valid: true, list };
}

interface Origins {
  custom: ReadonlySet<string>;
  replaced: ReadonlySet<string>;
}

function originsOf(custom: z.output<typeof customRulesSchema>): Origins {
  const ids = [...custom.settingBaselines, ...custom.activityWatches].map((d) => d.id);
  const defaults = new Set(
    [...DEFAULT_SETTING_BASELINES, ...DEFAULT_ACTIVITY_WATCHES].map((d) => d.id),
  );
  return { custom: new Set(ids), replaced: new Set(ids.filter((id) => defaults.has(id))) };
}

function ruleRow(rule: Rule, input: ConfigViewInput, origins: Origins): ConfigRule {
  const { valid, list } = parametersOf(rule, input.ruleParams[rule.meta.id]);
  const origin = origins.replaced.has(rule.meta.id)
    ? 'override'
    : origins.custom.has(rule.meta.id)
      ? 'custom'
      : 'builtin';
  return {
    id: safeText(rule.meta.id, 20),
    name: safeText(rule.meta.name),
    category: safeText(rule.meta.category, 40),
    severity: safeText(rule.meta.severity, 20),
    enabled: !input.disabledRules.includes(rule.meta.id),
    origin,
    requires: rule.requires.map((name) => safeText(name, 40)),
    paramsValid: valid,
    parameters: list,
  };
}

const joined = (items: readonly string[]): string =>
  safeText(items.map((item) => safeText(item, 60)).join(', '), 200);

function customRows(
  custom: z.output<typeof customRulesSchema>,
  input: ConfigViewInput,
  origins: Origins,
): ConfigCustomRule[] {
  const common = (id: string, name: string, severity: string) => ({
    id: safeText(id, 20),
    name: safeText(name),
    severity: safeText(severity, 20),
    enabled: !input.disabledRules.includes(id),
    replacesBuiltin: origins.replaced.has(id),
  });
  return [
    ...custom.settingBaselines.map((d) => ({
      ...common(d.id, d.name, d.severity),
      kind: 'setting-baseline' as const,
      summary: safeText(`${safeText(d.setting, 80)} ${describeExpectation(d.expect)}`, 200),
    })),
    ...custom.activityWatches.map((d) => ({
      ...common(d.id, d.name, d.severity),
      kind: 'activity-watch' as const,
      summary: safeText(
        `Activity types ${joined(d.match.flatMap((m) => m.types))}; threshold ${d.threshold}`,
        240,
      ),
    })),
  ];
}

/** Only ids in rule-id format are echoed; anything else is dropped, never published. */
const unknownIds = (ids: Iterable<string>, known: ReadonlySet<string>): string[] =>
  [...new Set(ids)].filter((id) => RULE_ID.test(id) && !known.has(id)).sort();

function sourcesOf(input: ConfigViewInput): DetailConfig['sources'] {
  return {
    datasets: DATASET_NAMES.map((name) => ({
      name,
      enabled: !input.disabledDatasets.includes(name),
    })),
    membersProvider: safeText(input.membersProvider, 40),
    memberActivityLookbackDays: input.memberActivityLookbackDays,
    groupMemberRequestLimit: input.groupMemberRequestLimit,
    activities: { ...input.activities },
  };
}

function notificationsOf(input: ConfigViewInput): DetailConfig['notifications'] {
  const { channels, statuses, minSeverity, cooldownMinutes } = input.notifications;
  return {
    statuses: statuses.map((s) => safeText(s, 20)),
    minSeverity: safeText(minSeverity, 20),
    cooldownMinutes,
    channels: [
      { kind: 'console', enabled: true },
      { kind: 'slack', enabled: channels.slack },
      { kind: 'discord', enabled: channels.discord },
      { kind: 'email', enabled: channels.email },
    ],
  };
}

/** Builds the effective-configuration view. Pure and deterministic for the same input. */
export function buildConfigView(input: ConfigViewInput): DetailConfig {
  const custom = customRulesSchema.parse(input.customRules);
  const origins = originsOf(custom);
  const known = new Set(input.rules.map((r) => r.meta.id));
  return {
    schemaVersion: CONFIG_VIEW_SCHEMA_VERSION,
    generatedAt: input.now.toISOString(),
    rules: input.rules.map((rule) => ruleRow(rule, input, origins)),
    customRules: customRows(custom, input, origins),
    unknownRuleIds: {
      disabled: unknownIds(input.disabledRules, known),
      parameters: unknownIds(Object.keys(input.ruleParams), known),
    },
    sources: sourcesOf(input),
    notifications: notificationsOf(input),
    retention: { snapshotDays: input.snapshotDays },
    dashboard: { maskPii: input.maskPii },
  };
}
