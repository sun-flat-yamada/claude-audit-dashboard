import type {
  BackfillLimit,
  BackfillSource,
  CollectResult,
  DatasetName,
  DateRange,
} from '@claude-audit/core';
import {
  DataUnavailableError,
  Registry,
  addMinutes,
  earlierOf,
  startOfUtcDay,
} from '@claude-audit/core';
import type { AnalyticsApi } from './analytics-api.js';
import { ANALYTICS_EPOCH } from './analytics-api.js';
import { classify } from './classify-error.js';
import type { ActivityQuery, ComplianceApi } from './compliance-api.js';
import { FEATURE_PATHS, type FeatureUsageApi } from './feature-usage-api.js';
import { MEMBER_DAILY_PATH, type MemberDailyActivityApi } from './member-daily-api.js';

/**
 * Minimum time between two request starts of one backfill client. The limits are per
 * organization: Analytics 60 requests/minute (1.1 s: at most ~55), Compliance 600 requests/minute
 * (110 ms: at most ~546). A 429 with `retry-after` remains the backstop.
 */
export const BACKFILL_MIN_INTERVAL_MS = { analytics: 1100, compliance: 110 } as const;

/** `usage_report` / `cost_report`: `starting_at` within the last 365 days and not before 2026-01-01. */
export const REPORT_RETENTION_DAYS = 365;

/** Gateways the backfill reads; null when the key of that family is missing. */
export interface BackfillApis {
  analytics: AnalyticsApi | null;
  featureUsage: FeatureUsageApi | null;
  memberActivityDaily: MemberDailyActivityApi | null;
  compliance: ComplianceApi | null;
}

export interface BackfillSettings {
  activities: ActivityQuery & { lagMinutes: number };
}

type Fetch<A> = (
  api: A,
  range: DateRange,
  now: Date,
  settings: BackfillSettings,
) => Promise<CollectResult<unknown[]>>;

/** One backfillable dataset: what its API still serves and how one period is fetched. */
export interface BackfillDefinition extends BackfillSource {
  readonly limit: BackfillLimit;
}

const REPORT_LIMIT: BackfillLimit = {
  notBefore: ANALYTICS_EPOCH,
  retentionDays: REPORT_RETENTION_DAYS,
};
const ANALYTICS_LIMIT: BackfillLimit = { notBefore: ANALYTICS_EPOCH };

const MISSING_KEY: Readonly<Record<keyof BackfillApis, string>> = {
  analytics: 'ANTHROPIC_ANALYTICS_API_KEY',
  featureUsage: 'ANTHROPIC_ANALYTICS_API_KEY',
  memberActivityDaily: 'ANTHROPIC_ANALYTICS_API_KEY',
  compliance: 'ANTHROPIC_COMPLIANCE_API_KEY',
};

/** Adapts one gateway call: a missing key or access error is `unavailable`, like collection. */
function define<F extends keyof BackfillApis>(
  apis: BackfillApis,
  settings: BackfillSettings,
  spec: { dataset: DatasetName; source: string; family: F; limit: BackfillLimit },
  run: Fetch<NonNullable<BackfillApis[F]>>,
): BackfillDefinition {
  return {
    dataset: spec.dataset,
    source: spec.source,
    limit: spec.limit,
    async fetch(range, now) {
      const api = apis[spec.family] as NonNullable<BackfillApis[F]> | null;
      if (!api)
        throw new DataUnavailableError(
          `No key for ${spec.source} (set ANTHROPIC_ENTERPRISE_API_KEY or ${MISSING_KEY[spec.family]})`,
        );
      try {
        return await run(api, range, now, settings);
      } catch (error) {
        throw classify(error);
      }
    },
  };
}

/** Date-granular endpoints serve whole days: a period that starts today has nothing yet. */
const pastDaysOnly =
  <A>(run: Fetch<A>): Fetch<A> =>
  (api, range, now, settings) =>
    range.start.getTime() >= startOfUtcDay(now).getTime()
      ? Promise.resolve({ items: [] })
      : run(api, range, now, settings);

const FEATURE_DATASETS = [
  ['skillUsage', 'skills'],
  ['connectorUsage', 'connectors'],
  ['pluginUsage', 'plugins'],
  ['chatProjectUsage', 'projects'],
] as const;

/** The Analytics datasets: daily reports, adoption, roll-ups and the optional per-day users. */
function analyticsDefinitions(apis: BackfillApis, settings: BackfillSettings) {
  const analytics = (dataset: DatasetName, source: string, limit = ANALYTICS_LIMIT) => ({
    dataset,
    source,
    family: 'analytics' as const,
    limit,
  });
  return [
    define(
      apis,
      settings,
      analytics('usage', 'GET /v1/organizations/analytics/usage_report', REPORT_LIMIT),
      (a, r, now) => a.usageReport(r, now),
    ),
    define(
      apis,
      settings,
      analytics('cost', 'GET /v1/organizations/analytics/cost_report', REPORT_LIMIT),
      (a, r, now) => a.costReport(r, now),
    ),
    define(
      apis,
      settings,
      analytics('adoption', 'GET /v1/organizations/analytics/summaries'),
      pastDaysOnly((a, r, now) => a.listSummaries(r, now)),
    ),
    define(
      apis,
      settings,
      analytics('memberActivity', 'GET /v1/organizations/analytics/users'),
      pastDaysOnly((a, r, now) => a.listUserActivityIn(r, now)),
    ),
    define(
      apis,
      settings,
      {
        ...analytics('memberActivityDaily', `GET ${MEMBER_DAILY_PATH}?date`),
        family: 'memberActivityDaily',
      },
      (a, r, now) => a.listDailyActivityIn(r, now),
    ),
    ...FEATURE_DATASETS.map(([dataset, kind]) =>
      define(
        apis,
        settings,
        { ...analytics(dataset, `GET ${FEATURE_PATHS[kind]}`), family: 'featureUsage' },
        pastDaysOnly((a, r, now) => a.rollup(kind, r, now)),
      ),
    ),
  ];
}

/** Activity Feed: one `created_at` window per period, ending `lagMinutes` before now. */
function activitiesDefinition(apis: BackfillApis, settings: BackfillSettings) {
  return define(
    apis,
    settings,
    {
      dataset: 'activities',
      source: 'GET /v1/compliance/activities',
      family: 'compliance',
      limit: {},
    },
    async (api, range, now, { activities }) => {
      const window = {
        from: range.start,
        to: earlierOf(range.end, addMinutes(now, -activities.lagMinutes)),
      };
      if (window.to.getTime() <= window.from.getTime()) return { items: [] };
      return {
        items: await api.listActivities(window, activities),
        window: { from: window.from.toISOString(), to: window.to.toISOString() },
      };
    },
  );
}

/** Every dataset the ledger backfill can fetch (registry: adding one is one definition). */
export function createBackfillSources(
  apis: BackfillApis,
  settings: BackfillSettings,
): Registry<BackfillDefinition> {
  return new Registry<BackfillDefinition>((d) => d.dataset, 'backfill dataset').addAll([
    activitiesDefinition(apis, settings),
    ...analyticsDefinitions(apis, settings),
  ]);
}
