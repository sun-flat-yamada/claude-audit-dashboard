import type {
  ActivityWindowConfig,
  CollectContext,
  CollectResult,
  DatasetCollector,
  DatasetMap,
  DatasetName,
} from '@claude-audit/core';
import {
  DataUnavailableError,
  activityCursorSchema,
  addDays,
  advanceActivityWindow,
  nextActivityWindow,
} from '@claude-audit/core';
import type { AdminApi } from './admin-api.js';
import type { AnalyticsApi } from './analytics-api.js';
import type { ActivityQuery, ComplianceApi } from './compliance-api.js';
import { ApiError } from './http-client.js';

/** Gateways per API family; null when no key is configured for that family. */
export interface AnthropicApis {
  compliance: ComplianceApi | null;
  admin: AdminApi | null;
  analytics: AnalyticsApi | null;
}

export interface SourceSettings {
  disabled: readonly DatasetName[];
  membersProvider: 'admin' | 'compliance';
  memberActivityLookbackDays: number;
  maxGroupMemberRequests: number;
  activities: ActivityWindowConfig & ActivityQuery;
}

type Family = keyof AnthropicApis;
type Api<F extends Family> = NonNullable<AnthropicApis[F]>;

const KEY_VARIABLE: Readonly<Record<Family, string>> = {
  compliance: 'ANTHROPIC_COMPLIANCE_API_KEY',
  admin: 'ANTHROPIC_ADMIN_API_KEY',
  analytics: 'ANTHROPIC_ANALYTICS_API_KEY',
};

/** 401 / 403 / 404 mean "not collectable with this key or plan", not a transient failure. */
const UNAVAILABLE_STATUS = new Set([401, 403, 404]);

export const classify = (error: unknown): unknown =>
  error instanceof ApiError && UNAVAILABLE_STATUS.has(error.status)
    ? new DataUnavailableError(error.message)
    : error;

/** Adapts one gateway call to a dataset collector, handling missing keys and access errors. */
function via<F extends Family, K extends DatasetName>(
  apis: AnthropicApis,
  family: F,
  dataset: K,
  source: string,
  run: (api: Api<F>, context: CollectContext) => Promise<CollectResult<DatasetMap[K]>>,
): DatasetCollector<K> {
  return {
    dataset,
    source,
    async collect(context) {
      const api = apis[family] as Api<F> | null;
      if (!api) {
        throw new DataUnavailableError(
          `No key for the ${family} API (set ANTHROPIC_ENTERPRISE_API_KEY or ${KEY_VARIABLE[family]})`,
        );
      }
      try {
        return await run(api, context);
      } catch (error) {
        throw classify(error);
      }
    },
  };
}

/** Tries each collector in order; only "unavailable" falls through to the next one. */
export function firstAvailable<K extends DatasetName>(
  dataset: K,
  collectors: readonly DatasetCollector<K>[],
): DatasetCollector<K> {
  return {
    dataset,
    source: collectors.map((c) => c.source).join(' → '),
    async collect(context) {
      const reasons: string[] = [];
      for (const collector of collectors) {
        try {
          return { ...(await collector.collect(context)), source: collector.source };
        } catch (error) {
          if (!(error instanceof DataUnavailableError)) throw error;
          reasons.push(`${collector.source}: ${error.message}`);
        }
      }
      throw new DataUnavailableError(reasons.join('; '));
    },
  };
}

const items = async <T>(promise: Promise<T>): Promise<{ items: T }> => ({ items: await promise });

function activities(apis: AnthropicApis, config: SourceSettings['activities']) {
  return via(
    apis,
    'compliance',
    'activities',
    'GET /v1/compliance/activities',
    async (api, context) => {
      const parsed = activityCursorSchema.safeParse(context.cursor);
      const cursor = parsed.success ? parsed.data : null;
      const window = nextActivityWindow(cursor, context.now, config);
      if (!window) return { items: [], cursor: cursor ?? undefined };
      const next = advanceActivityWindow(
        await api.listActivities(window, config),
        cursor,
        window,
        config,
      );
      return {
        items: next.items,
        cursor: next.cursor,
        window: { from: window.from.toISOString(), to: window.to.toISOString() },
      };
    },
  );
}

function members(apis: AnthropicApis, provider: SourceSettings['membersProvider']) {
  const admin = via(apis, 'admin', 'members', 'GET /v1/organizations/users', (api) =>
    items(api.listMembers()),
  );
  const directory = via(
    apis,
    'compliance',
    'members',
    'GET /v1/compliance/organizations/{id}/users',
    (api) => items(api.listDirectoryMembers()),
  );
  return provider === 'admin' ? firstAvailable('members', [admin, directory]) : directory;
}

/** Compliance API: directory of linked organizations, settings, key inventory, Activity Feed. */
const complianceCollectors = (
  apis: AnthropicApis,
  settings: SourceSettings,
): DatasetCollector[] => [
  via(apis, 'compliance', 'organizations', 'GET /v1/compliance/organizations', (api) =>
    items(api.listOrganizations()),
  ),
  via(apis, 'compliance', 'settings', 'GET /v1/compliance/organizations/{id}/settings', (api) =>
    items(api.listSettings()),
  ),
  via(
    apis,
    'compliance',
    'credentials',
    'GET /v1/compliance/organizations/{id}/settings#api_keys',
    (api) => items(api.listCredentials()),
  ),
  activities(apis, settings.activities),
];

/** Admin API user management (with Compliance fallbacks) and the Spend Limits API. */
const adminCollectors = (apis: AnthropicApis, settings: SourceSettings): DatasetCollector[] => [
  members(apis, settings.membersProvider),
  via(apis, 'admin', 'invites', 'GET /v1/organizations/invites', (api) => items(api.listInvites())),
  firstAvailable('groups', [
    via(apis, 'admin', 'groups', 'GET /v1/organizations/rbac_groups', (api) =>
      items(api.listGroups(settings.maxGroupMemberRequests)),
    ),
    via(apis, 'compliance', 'groups', 'GET /v1/compliance/groups', (api) =>
      items(api.listGroups()),
    ),
  ]),
  via(apis, 'admin', 'spendLimits', 'GET /v1/organizations/spend_limits/effective', (api) =>
    items(api.listSpendLimits()),
  ),
];

/** Enterprise Analytics API: per-user activity, adoption, usage and cost. */
const analyticsCollectors = (apis: AnthropicApis, settings: SourceSettings): DatasetCollector[] => [
  via(
    apis,
    'analytics',
    'memberActivity',
    'GET /v1/organizations/analytics/users',
    (api, { now }) => api.listUserActivity(addDays(now, -settings.memberActivityLookbackDays), now),
  ),
  via(apis, 'analytics', 'adoption', 'GET /v1/organizations/analytics/summaries', (api, c) =>
    api.listSummaries(c.range, c.now),
  ),
  via(apis, 'analytics', 'usage', 'GET /v1/organizations/analytics/usage_report', (api, c) =>
    api.usageReport(c.range, c.now),
  ),
  via(apis, 'analytics', 'cost', 'GET /v1/organizations/analytics/cost_report', (api, c) =>
    api.costReport(c.range, c.now),
  ),
];

/** Every Enterprise dataset backed by the Anthropic APIs, minus the ones disabled in config. */
export function createAnthropicCollectors(
  apis: AnthropicApis,
  settings: SourceSettings,
): DatasetCollector[] {
  return [
    ...complianceCollectors(apis, settings),
    ...adminCollectors(apis, settings),
    ...analyticsCollectors(apis, settings),
  ].filter((collector) => !settings.disabled.includes(collector.dataset));
}
