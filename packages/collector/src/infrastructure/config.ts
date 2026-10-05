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

/** Loads `default.json` and `custom-rules.json` (both optional) from the config directory. */
export async function loadConfig(
  configDir: string,
): Promise<{ config: AppConfig; customRules: CustomRules }> {
  const config = parseOrExplain(
    appConfigSchema,
    await readJsonFile(join(configDir, 'default.json')),
    'config/default.json',
  );
  const customRules = parseOrExplain(
    customRulesSchema,
    await readJsonFile(join(configDir, 'custom-rules.json')),
    'config/custom-rules.json',
  );
  return { config, customRules };
}

export const disabledDatasets = (config: AppConfig): DatasetName[] =>
  config.sources.disabled.filter(isDatasetName);
