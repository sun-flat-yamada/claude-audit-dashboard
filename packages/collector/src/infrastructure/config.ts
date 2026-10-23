import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CONTENT_VIEW_ACTIVITY_TYPES,
  SEVERITIES,
  customRulesSchema,
  isDatasetName,
  type CustomRules,
  type DatasetName,
} from '@claude-audit/core';
import { z } from 'zod';
import {
  CONFIG_OVERRIDES_VARIABLE,
  mergeConfigOverrides,
  parseConfigOverrides,
} from './config-overrides.js';

/** Placeholder defaults; derived from the synthetic history (docs/CHANGE-PLAN.md section 9). */
const CAPACITY_DEFAULTS = {
  maxTotalMiB: 1024,
  maxMonthlyGrowthMiB: 50,
  warnRatio: 0.8,
  windowDays: 30,
} as const;

const datasetName = z.string().refine(isDatasetName, { message: 'Unknown dataset name' });

/** `config/default.json`. Every field has a default, so an absent file is valid. */
export const appConfigSchema = z.object({
  dashboard: z
    .object({
      title: z.string().default('Claude Enterprise Audit Dashboard'),
      maskPii: z.boolean().default(true),
    })
    .prefault({}),
  sources: z
    .object({
      disabled: z.array(datasetName).default([]),
      members: z
        .object({ provider: z.enum(['admin', 'compliance']).default('admin') })
        .prefault({}),
      memberActivity: z
        .object({ lookbackDays: z.number().int().min(1).max(366).default(90) })
        .prefault({}),
      usageMatrix: z
        .object({
          /** Opt-in model x RBAC group cost collection (F-010); not a snapshot dataset. */
          enabled: z.boolean().default(false),
          lookbackDays: z.number().int().min(1).max(366).default(90),
        })
        .prefault({}),
      console: z
        .object({
          /** Opt-in linked Console organization datasets (B4); absent from coverage when off. */
          enabled: z.boolean().default(false),
          lookbackDays: z.number().int().min(1).max(366).default(30),
        })
        .prefault({}),
      claudeCode: z
        .object({
          /** Opt-in Claude Code Analytics dataset (B4); absent from coverage when off. */
          enabled: z.boolean().default(false),
          /** One request series per day, so keep it short (60 requests/minute). */
          lookbackDays: z.number().int().min(1).max(31).default(7),
        })
        .prefault({}),
      featureUsage: z
        .object({
          /**
           * Opt-in skill, connector, plugin and chat project adoption (AN-6, Analytics key);
           * absent from coverage when off. One range roll-up request series per endpoint.
           */
          enabled: z.boolean().default(false),
          lookbackDays: z.number().int().min(1).max(366).default(30),
        })
        .prefault({}),
      memberActivityDaily: z
        .object({
          /**
           * Opt-in per-day member activity for the monthly ledger (Analytics `users?date=`);
           * absent from coverage when off. One paced request series per day, oldest first.
           */
          enabled: z.boolean().default(false),
          /** Published days fetched per run (re-fetched while the API may still revise them). */
          lookbackDays: z.number().int().min(1).max(31).default(3),
        })
        .prefault({}),
      groups: z.object({ maxMemberRequests: z.number().int().min(0).default(200) }).prefault({}),
      activities: z
        .object({
          initialLookbackHours: z.number().int().positive().default(168),
          overlapMinutes: z.number().int().min(0).default(10),
          lagMinutes: z.number().int().min(1).default(2),
          pageSize: z.number().int().min(1).max(5000).default(5000),
          includeTypes: z.array(z.string()).default([]),
          excludeTypes: z.array(z.string()).default([...CONTENT_VIEW_ACTIVITY_TYPES]),
        })
        .prefault({}),
    })
    .prefault({}),
  compliance: z
    .object({
      disabledRules: z.array(z.string()).default([]),
      params: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
    })
    .prefault({}),
  notifications: z
    .object({
      statuses: z
        .array(z.enum(['fail', 'warning', 'error', 'skipped']))
        .default(['fail', 'warning']),
      minSeverity: z.enum(SEVERITIES).default('high'),
      cooldownMinutes: z.number().int().min(0).default(360),
    })
    .prefault({}),
  retention: z.object({ snapshotDays: z.number().int().min(1).default(365) }).prefault({}),
  /** Size limits of the data/audit history (`pnpm size`). 0 turns a limit off. */
  capacity: z
    .object({
      maxTotalMiB: z.number().min(0).default(CAPACITY_DEFAULTS.maxTotalMiB),
      maxMonthlyGrowthMiB: z.number().min(0).default(CAPACITY_DEFAULTS.maxMonthlyGrowthMiB),
      warnRatio: z.number().gt(0).max(1).default(CAPACITY_DEFAULTS.warnRatio),
      windowDays: z.number().int().min(1).max(366).default(CAPACITY_DEFAULTS.windowDays),
    })
    .prefault({}),
  /** Monthly ledger checks (`pnpm ledger verify`, #160). */
  ledger: z
    .object({
      verify: z
        .object({
          /** Daily datasets expected to have rows for every UTC day. */
          dailyDatasets: z.array(z.string()).default(['usage', 'cost']),
          /** The last days are not checked yet (publication lag of the Analytics API). */
          lagDays: z.number().int().min(0).max(31).default(3),
          /** Hours since the latest recorded collection before it is a finding. */
          maxStaleHours: z.number().positive().default(24),
          /** Notify once the verification has failed on this many consecutive UTC days. */
          notifyAfterDays: z.number().int().min(1).default(7),
        })
        .prefault({}),
      /**
       * Encryption of the ledger files at rest (#162 U8). Empty (the default) leaves them plain;
       * a non-empty list encrypts every written file to these public keys (`cadl-pub-...`, from
       * `pnpm ledger keygen`) and to the workflows' `LEDGER_PIPELINE_KEY`.
       */
      encryption: z.object({ recipients: z.array(z.string().min(1)).default([]) }).prefault({}),
      /**
       * External storage sealed months are copied to (#161 U7): `none` (the default, nothing is
       * copied), `filesystem`, `gdrive` or `sharepoint` (the registered kinds,
       * `adapters/ledger-sinks/registry.ts`). Identifiers come from repository variables.
       */
      sink: z.string().min(1).default('none'),
    })
    .prefault({}),
});

export type AppConfig = z.output<typeof appConfigSchema>;

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Cannot read ${path}: ${(error as Error).message}`, { cause: error });
  }
}

function parseOrExplain<S extends z.ZodType>(schema: S, value: unknown, file: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid ${file}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

const issuePath = (path: readonly PropertyKey[]): string =>
  path.length ? path.map(String).join('.') : '(root)';

/**
 * Validates the configuration with the overrides merged in. The message names each failing
 * field and the zod issue code only: zod messages can quote values, and the values come from
 * the overrides.
 */
function applyOverrides(fileConfig: unknown, raw: string | undefined): AppConfig | undefined {
  const overrides = parseConfigOverrides(raw);
  if (!overrides) return undefined;
  const parsed = appConfigSchema.safeParse(mergeConfigOverrides(fileConfig, overrides));
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.map((issue) => `  - ${issuePath(issue.path)} (${issue.code})`);
  throw new Error(
    `Invalid ${CONFIG_OVERRIDES_VARIABLE} (values not shown):\n${[...new Set(fields)].join('\n')}`,
  );
}

/**
 * Loads `default.json` and `custom-rules.json` (both optional) from the config directory. The
 * optional `overrides` (`AUDIT_CONFIG_OVERRIDES`, a JSON object) are deep-merged over
 * `default.json` (arrays replace) and the result is validated with the same schema.
 */
export async function loadConfig(
  configDir: string,
  overrides?: string,
): Promise<{ config: AppConfig; customRules: CustomRules }> {
  const fileConfig = await readJsonFile(join(configDir, 'default.json'));
  const fromFile = parseOrExplain(appConfigSchema, fileConfig, 'config/default.json');
  const config = applyOverrides(fileConfig, overrides) ?? fromFile;
  const customRules = parseOrExplain(
    customRulesSchema,
    await readJsonFile(join(configDir, 'custom-rules.json')),
    'config/custom-rules.json',
  );
  return { config, customRules };
}

export const disabledDatasets = (config: AppConfig): DatasetName[] =>
  config.sources.disabled.filter(isDatasetName);
