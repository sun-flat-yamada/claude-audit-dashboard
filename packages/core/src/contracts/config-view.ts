import { z } from 'zod';
import { DETAIL_DIR } from './detail-view.js';

/**
 * Read-only view of the EFFECTIVE configuration (F-014): which rules are disabled, the rule
 * parameters in effect, custom rules, the notification policy and the enabled data sources.
 *
 * The file is built from an explicit allowlist and carries no secrets or personal data: no API
 * keys, webhook URLs, SMTP settings or recipient addresses (channels are listed by kind with an
 * enabled flag only) and no file system paths. It is listed in the detail manifest (`kind:
 * config`) and published under the detail publication condition. Bump
 * `CONFIG_VIEW_SCHEMA_VERSION` on breaking changes.
 */
export const CONFIG_VIEW_SCHEMA_VERSION = 1 as const;

export const DETAIL_CONFIG_PATH = `${DETAIL_DIR}/config.json`;

/** Placeholder written instead of a value that looks like a secret, URL, address or path. */
export const CONFIG_REDACTED = '[hidden]';

const scalar = z.union([z.string(), z.number(), z.boolean()]);
export const configValueSchema = z.union([scalar, z.array(scalar)]);

export const CONFIG_RULE_ORIGINS = ['builtin', 'custom', 'override'] as const;
export const CONFIG_CHANNEL_KINDS = ['console', 'slack', 'discord', 'email'] as const;

const parameterSchema = z.object({
  key: z.string(),
  /** The value the rule runs with (configured, else the rule default). */
  value: configValueSchema,
  /** The rule default; null when the rule has no default for this key. */
  defaultValue: configValueSchema.nullable(),
  /** True when a configured value differs from the default. */
  overridden: z.boolean(),
});

const ruleSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  severity: z.string(),
  /** False for ids listed in `compliance.disabledRules`. */
  enabled: z.boolean(),
  /** `override` is a custom definition that replaces a built-in one with the same id. */
  origin: z.enum(CONFIG_RULE_ORIGINS),
  /** Dataset names the rule needs. */
  requires: z.array(z.string()),
  /** False when the configured parameters are rejected by the rule (it then reports an error). */
  paramsValid: z.boolean(),
  parameters: z.array(parameterSchema),
});

const customRuleSchema = z.object({
  id: z.string(),
  kind: z.enum(['setting-baseline', 'activity-watch']),
  name: z.string(),
  severity: z.string(),
  enabled: z.boolean(),
  /** True when the definition replaces a built-in rule with the same id. */
  replacesBuiltin: z.boolean(),
  /** One line describing what the rule checks. */
  summary: z.string(),
});

const channelSchema = z.object({ kind: z.enum(CONFIG_CHANNEL_KINDS), enabled: z.boolean() });

export const detailConfigSchema = z.object({
  schemaVersion: z.literal(CONFIG_VIEW_SCHEMA_VERSION),
  generatedAt: z.string(),
  rules: z.array(ruleSchema),
  customRules: z.array(customRuleSchema),
  /** Configured ids that match no rule (typos); ids only, in rule-id format. */
  unknownRuleIds: z.object({ disabled: z.array(z.string()), parameters: z.array(z.string()) }),
  sources: z.object({
    datasets: z.array(z.object({ name: z.string(), enabled: z.boolean() })),
    membersProvider: z.string(),
    memberActivityLookbackDays: z.number(),
    groupMemberRequestLimit: z.number(),
    activities: z.object({
      initialLookbackHours: z.number(),
      overlapMinutes: z.number(),
      lagMinutes: z.number(),
      pageSize: z.number(),
      includedTypeCount: z.number(),
      excludedTypeCount: z.number(),
    }),
  }),
  notifications: z.object({
    statuses: z.array(z.string()),
    minSeverity: z.string(),
    cooldownMinutes: z.number(),
    /** Kinds only. Webhook URLs, SMTP settings and recipients are never part of this file. */
    channels: z.array(channelSchema),
  }),
  retention: z.object({ snapshotDays: z.number() }),
  dashboard: z.object({ maskPii: z.boolean() }),
});

export type ConfigValue = z.infer<typeof configValueSchema>;
export type DetailConfig = z.infer<typeof detailConfigSchema>;
export type ConfigRule = DetailConfig['rules'][number];
export type ConfigParameter = ConfigRule['parameters'][number];
export type ConfigCustomRule = DetailConfig['customRules'][number];
export type ConfigChannel = DetailConfig['notifications']['channels'][number];

const SENSITIVE: readonly RegExp[] = [
  /:\/\//, // any URL (webhook, SMTP / API endpoint, repository)
  /@/, // e-mail address or user@host
  /\bsk-[A-Za-z0-9_-]{6,}/, // API key shapes
  /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{6,}/, // GitHub tokens
  /hooks\.slack\.com|discord(?:app)?\.com\/api|webhook/i, // chat webhooks
  /\b(?:AKIA|AIza)[A-Za-z0-9_-]{8,}/, // cloud key shapes
  /^(?:\/|~|[A-Za-z]:[\\/]|\\\\)|(?:^|\s)\/(?:home|Users|root|etc|var|tmp|mnt|opt)\//, // paths
  /(?=[A-Za-z0-9+/_=-]*\d)(?=[A-Za-z0-9+/_=-]*[A-Za-z])[A-Za-z0-9+/_=-]{32,}/, // opaque token
  /BEGIN [A-Z ]*PRIVATE KEY/,
];

/**
 * True when the text has the shape of a secret, URL, e-mail address, token or absolute path.
 * Used both to redact values while building the file and to reject them when validating it.
 */
export const looksSensitive = (text: string): boolean => SENSITIVE.some((p) => p.test(text));
