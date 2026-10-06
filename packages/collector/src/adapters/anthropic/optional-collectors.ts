import type {
  CollectContext,
  CollectResult,
  DatasetCollector,
  DatasetMap,
  DatasetName,
  OptionalDatasetName,
  OptionalSource,
} from '@claude-audit/core';
import { DataUnavailableError, OPTIONAL_SOURCES, addDays, startOfUtcDay } from '@claude-audit/core';
import type { ClaudeCodeApi } from './claude-code-api.js';
import { classify } from './collectors.js';
import type { ConsoleAdminApi } from './console-admin-api.js';
import { FEATURE_PATHS, type FeatureUsageApi } from './feature-usage-api.js';

/**
 * Gateways of the optional sources; null when their key is missing (a Console Admin key for
 * `console` / `claudeCode`, the Analytics key for `featureUsage`).
 */
export interface OptionalApis {
  console: ConsoleAdminApi | null;
  claudeCode: ClaudeCodeApi | null;
  featureUsage: FeatureUsageApi | null;
}

export interface SourceFlag {
  enabled: boolean;
  lookbackDays: number;
}

export interface OptionalSettings {
  disabled: readonly DatasetName[];
  console: SourceFlag;
  claudeCode: SourceFlag;
  featureUsage: SourceFlag;
}

export const CONSOLE_KEY_VARIABLE = 'ANTHROPIC_CONSOLE_ADMIN_API_KEY';

const noConsoleKey = (source: string): string =>
  `No Console Admin API key for ${source} (set ${CONSOLE_KEY_VARIABLE}; ` +
  'the Enterprise keys do not work for this API)';

/** Feature usage reads the Analytics API with the same key as the built-in analytics datasets. */
const noAnalyticsKey = (source: string): string =>
  `No key for the analytics API for ${source} ` +
  '(set ANTHROPIC_ENTERPRISE_API_KEY or ANTHROPIC_ANALYTICS_API_KEY with read:analytics)';

/**
 * Adapts one gateway call to a dataset collector. A missing key or a 401 / 403 / 404 becomes
 * `unavailable` with the reason (OP-002 then reports the misconfiguration); anything else, such
 * as schema drift, stays an error.
 */
function via<A, K extends OptionalDatasetName>(
  api: A | null,
  dataset: K,
  source: string,
  run: (api: A, context: CollectContext) => Promise<CollectResult<DatasetMap[K]>>,
  missingKey: (source: string) => string = noConsoleKey,
): DatasetCollector<K> {
  return {
    dataset,
    source,
    async collect(context) {
      if (!api) throw new DataUnavailableError(missingKey(source));
      try {
        return await run(api, context);
      } catch (error) {
        throw classify(error);
      }
    },
  };
}

const items = async <T>(promise: Promise<T>): Promise<{ items: T }> => ({ items: await promise });

/** Reports cover the last `lookbackDays` full days plus today (UTC). */
const rangeOf = (flag: SourceFlag, now: Date) => ({
  start: startOfUtcDay(addDays(now, -flag.lookbackDays)),
  end: now,
});

function consoleCollectors(api: ConsoleAdminApi | null, flag: SourceFlag): DatasetCollector[] {
  return [
    via(api, 'consoleWorkspaces', 'GET /v1/organizations/workspaces', (a) =>
      items(a.listWorkspaces()),
    ),
    via(api, 'consoleApiKeys', 'GET /v1/organizations/api_keys', (a) => items(a.listApiKeys())),
    via(api, 'consoleUsage', 'GET /v1/organizations/usage_report/messages', (a, { now }) =>
      a.usageReport(rangeOf(flag, now), now),
    ),
    via(api, 'consoleCost', 'GET /v1/organizations/cost_report', (a, { now }) =>
      a.costReport(rangeOf(flag, now), now),
    ),
  ];
}

function claudeCodeCollectors(api: ClaudeCodeApi | null, flag: SourceFlag): DatasetCollector[] {
  return [
    via(api, 'claudeCodeActivity', 'GET /v1/organizations/usage_report/claude_code', (a, { now }) =>
      a.listActivity(flag.lookbackDays, now),
    ),
  ];
}

function featureUsageCollectors(api: FeatureUsageApi | null, flag: SourceFlag): DatasetCollector[] {
  const days = flag.lookbackDays;
  return [
    via(
      api,
      'skillUsage',
      `GET ${FEATURE_PATHS.skills}`,
      (a, c) => a.skills(days, c.now),
      noAnalyticsKey,
    ),
    via(
      api,
      'connectorUsage',
      `GET ${FEATURE_PATHS.connectors}`,
      (a, c) => a.connectors(days, c.now),
      noAnalyticsKey,
    ),
    via(
      api,
      'pluginUsage',
      `GET ${FEATURE_PATHS.plugins}`,
      (a, c) => a.plugins(days, c.now),
      noAnalyticsKey,
    ),
    via(
      api,
      'chatProjectUsage',
      `GET ${FEATURE_PATHS.projects}`,
      (a, c) => a.projects(days, c.now),
      noAnalyticsKey,
    ),
  ];
}

const isEnabled = (source: OptionalSource, settings: OptionalSettings): boolean =>
  settings[source].enabled;

/**
 * The collectors of the optional sources, registered ONLY for sources enabled in config (and
 * not listed in `sources.disabled`). With all of them off the list is empty, so nothing is added to
 * coverage and OP-002 and the score of existing tenants are unchanged.
 */
export function createOptionalCollectors(
  apis: OptionalApis,
  settings: OptionalSettings,
): DatasetCollector[] {
  return [
    ...consoleCollectors(apis.console, settings.console),
    ...claudeCodeCollectors(apis.claudeCode, settings.claudeCode),
    ...featureUsageCollectors(apis.featureUsage, settings.featureUsage),
  ].filter(
    (collector) =>
      isEnabled(OPTIONAL_SOURCES[collector.dataset as OptionalDatasetName], settings) &&
      !settings.disabled.includes(collector.dataset),
  );
}
