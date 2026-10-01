import { DataUnavailableError, gatherDatasets, type DatasetCollector } from '@claude-audit/core';
import { describe, expect, it } from 'vitest';
import { MOCK_KEY, fakeAnthropic } from '../../../__tests__/fake-anthropic.js';
import { AdminApi } from '../admin-api.js';
import { AnalyticsApi } from '../analytics-api.js';
import {
  createAnthropicCollectors,
  firstAvailable,
  type AnthropicApis,
  type SourceSettings,
} from '../collectors.js';
import { ComplianceApi } from '../compliance-api.js';
import { HttpClient } from '../http-client.js';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const context = { now: NOW, range: { start: new Date('2026-08-31T00:00:00Z'), end: NOW } };

const settings: SourceSettings = {
  disabled: [],
  membersProvider: 'admin',
  memberActivityLookbackDays: 90,
  maxGroupMemberRequests: 10,
  activities: {
    initialLookbackHours: 24,
    overlapMinutes: 10,
    lagMinutes: 2,
    pageSize: 5000,
    includeTypes: [],
    excludeTypes: [],
  },
};

function apis(
  overrides = {},
  families: (keyof AnthropicApis)[] = ['compliance', 'admin', 'analytics'],
): AnthropicApis {
  const http = new HttpClient({
    apiKey: MOCK_KEY,
    fetchImpl: fakeAnthropic(overrides).fetch,
    sleep: async () => {},
  });
  return {
    compliance: families.includes('compliance') ? new ComplianceApi(http) : null,
    admin: families.includes('admin') ? new AdminApi(http) : null,
    analytics: families.includes('analytics') ? new AnalyticsApi(http) : null,
  };
}

describe('createAnthropicCollectors', () => {
  it('collects every Enterprise dataset from the documented responses', async () => {
    const gathered = await gatherDatasets(createAnthropicCollectors(apis(), settings), context);
    const statuses = Object.fromEntries(
      Object.entries(gathered.coverage).map(([k, v]) => [k, v.status]),
    );
    expect(Object.values(statuses).every((s) => s === 'ok')).toBe(true);
    expect(Object.keys(statuses).sort()).toEqual([
      'activities',
      'adoption',
      'cost',
      'credentials',
      'groups',
      'invites',
      'memberActivity',
      'members',
      'organizations',
      'settings',
      'spendLimits',
      'usage',
    ]);
    expect(gathered.coverage.cost?.asOf).toBe('2026-09-30T06:00:00Z');
    expect(gathered.coverage.groups?.source).toBe('GET /v1/organizations/rbac_groups');
  });

  it('marks datasets unavailable when their key is missing, naming the variable to set', async () => {
    const gathered = await gatherDatasets(
      createAnthropicCollectors(apis({}, ['compliance']), settings),
      context,
    );
    expect(gathered.coverage.usage).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('ANTHROPIC_ANALYTICS_API_KEY'),
    });
    expect(gathered.coverage.organizations?.status).toBe('ok');
  });

  it('treats 403 as unavailable (with the scope message) and 5xx as an error', async () => {
    const forbidden = () => ({
      status: 403,
      body: {
        error: {
          type: 'permission_error',
          message: "Missing required scopes. Got: ['read:analytics']",
        },
      },
    });
    const broken = () => ({
      status: 500,
      headers: { 'x-should-retry': 'false' },
      body: { error: { type: 'api_error', message: 'boom' } },
    });
    const gathered = await gatherDatasets(
      createAnthropicCollectors(
        apis({
          '/v1/organizations/spend_limits/effective': forbidden,
          '/v1/organizations/invites': broken,
        }),
        settings,
      ),
      context,
    );
    expect(gathered.coverage.spendLimits).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('Missing required scopes'),
    });
    expect(gathered.coverage.invites).toMatchObject({
      status: 'error',
      reason: expect.stringContaining('500 api_error'),
    });
  });

  it('falls back to the Compliance groups endpoint when rbac groups are not readable', async () => {
    const forbidden = () => ({
      status: 403,
      body: { error: { type: 'permission_error', message: 'needs read:rbac_groups' } },
    });
    const gathered = await gatherDatasets(
      createAnthropicCollectors(apis({ '/v1/organizations/rbac_groups': forbidden }), settings),
      context,
    );
    expect(gathered.coverage.groups).toMatchObject({
      status: 'ok',
      source: 'GET /v1/compliance/groups',
    });
    expect(gathered.data.groups?.[0]?.memberCount).toBeNull();
  });

  it('advances the activity window cursor and de-duplicates across runs', async () => {
    const collector = createAnthropicCollectors(apis(), settings).find(
      (c) => c.dataset === 'activities',
    )!;
    const first = await collector.collect({ ...context, cursor: undefined });
    expect(first.items).toHaveLength(2);
    const second = await collector.collect({
      ...context,
      now: new Date('2026-09-30T12:30:00Z'),
      cursor: first.cursor,
    });
    expect(second.items).toHaveLength(0);
    expect(second.window?.from).toBe('2026-09-30T11:48:00.000Z');
  });

  it('omits disabled datasets', () => {
    const collectors = createAnthropicCollectors(apis(), {
      ...settings,
      disabled: ['spendLimits', 'usage'],
    });
    expect(collectors.map((c) => c.dataset)).not.toContain('spendLimits');
    expect(collectors.map((c) => c.dataset)).not.toContain('usage');
  });
});

describe('firstAvailable', () => {
  const unavailable = (source: string): DatasetCollector<'members'> => ({
    dataset: 'members',
    source,
    collect: async () => {
      throw new DataUnavailableError(`${source} missing scope`);
    },
  });

  it('explains every attempt when no source is available and does not mask real errors', async () => {
    const chain = firstAvailable('members', [unavailable('a'), unavailable('b')]);
    await expect(chain.collect({ ...context, cursor: undefined })).rejects.toThrow(
      'a: a missing scope; b: b missing scope',
    );
    const failing = firstAvailable('members', [
      {
        dataset: 'members',
        source: 'x',
        collect: async () => {
          throw new Error('boom');
        },
      },
      unavailable('b'),
    ]);
    await expect(failing.collect({ ...context, cursor: undefined })).rejects.toThrow('boom');
  });
});
