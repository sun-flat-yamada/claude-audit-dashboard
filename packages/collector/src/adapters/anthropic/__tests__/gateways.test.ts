import { describe, expect, it } from 'vitest';
import { FIXTURES, MOCK_KEY, ORG_A, fakeAnthropic } from '../../../__tests__/fake-anthropic.js';
import { AdminApi } from '../admin-api.js';
import { ANALYTICS_EPOCH, AnalyticsApi } from '../analytics-api.js';
import { ComplianceApi } from '../compliance-api.js';
import { HttpClient } from '../http-client.js';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const range = { start: new Date('2026-08-31T00:00:00.000Z'), end: NOW };

function gateways(overrides = {}) {
  const api = fakeAnthropic(overrides);
  const http = new HttpClient({ apiKey: MOCK_KEY, fetchImpl: api.fetch, sleep: async () => {} });
  return {
    api,
    compliance: new ComplianceApi(http),
    admin: new AdminApi(http),
    analytics: new AnalyticsApi(http),
  };
}

describe('ComplianceApi', () => {
  it('polls the activity window in ascending order with exclusions and maps actors', async () => {
    const { compliance, api } = gateways();
    const window = { from: new Date('2026-09-30T06:00:00Z'), to: new Date('2026-09-30T11:58:00Z') };
    const items = await compliance.listActivities(window, {
      pageSize: 5000,
      includeTypes: [],
      excludeTypes: ['claude_chat_viewed'],
    });
    const first = api.calls[0]!.searchParams;
    expect(Object.fromEntries(first)).toMatchObject({
      'created_at.gte': '2026-09-30T06:00:00.000Z',
      'created_at.lt': '2026-09-30T11:58:00.000Z',
      order: 'asc',
      limit: '5000',
      'exclude_activity_types[]': 'claude_chat_viewed',
    });
    expect(api.calls[1]!.searchParams.get('after_id')).toBe('activity_02');
    expect(items[0]).toMatchObject({
      organizationId: ORG_A,
      actor: {
        kind: 'user_actor',
        id: 'user_01TuVwXyZaBcDeFgH2JkLmN4',
        email: 'user@example.com',
        ip: '192.0.2.34',
      },
      attributes: {
        previous_role: 'user',
        current_role: 'owner',
        user_email: 'member@example.com',
      },
    });
    expect(items[1]?.actor).toMatchObject({
      kind: 'api_actor',
      id: 'apikey_01Hx7k2mP9nQ4rS6tU8vW0xY',
      email: null,
    });
  });

  it('uses the include filter instead of exclusions when configured', async () => {
    const { compliance, api } = gateways();
    await compliance.listActivities(
      { from: NOW, to: NOW },
      { pageSize: 10, includeTypes: ['org_sso_toggled'], excludeTypes: ['x'] },
    );
    expect(api.calls[0]!.searchParams.getAll('activity_types[]')).toEqual(['org_sso_toggled']);
    expect(api.calls[0]!.searchParams.has('exclude_activity_types[]')).toBe(false);
  });

  it('maps effective settings (implied names) and the key inventory, fetching each org once', async () => {
    const { compliance, api } = gateways();
    const [settings] = await compliance.listSettings();
    const credentials = await compliance.listCredentials();
    expect(settings?.values).toMatchObject({
      sso_provisioning_mode: { type: 'provisioning_mode', value: 'scim_advanced' },
      data_retention_periods: { type: 'data_retention' },
      account_session_duration_seconds: { value: null },
    });
    expect(credentials).toEqual([
      {
        id: 'apikey_01Hx7k2mP9nQ4rS6tU8vW0xY',
        name: 'Compliance Export Key',
        scopes: ['read:compliance_activities', 'read:compliance_org_data'],
        active: true,
        createdAt: '2026-03-14T09:30:00Z',
        expiresAt: null,
        createdBy: 'user_01Jz3a4bC5dE6fG7hI8jK9lM',
      },
    ]);
    expect(api.calls.filter((u) => u.pathname.endsWith('/settings'))).toHaveLength(1);
    expect(api.calls.filter((u) => u.pathname === '/v1/compliance/organizations')).toHaveLength(1);
  });

  it('reports schema drift instead of returning partial data', async () => {
    const broken = { ...FIXTURES['/v1/compliance/organizations'] };
    const { compliance } = gateways({
      '/v1/compliance/organizations': () => ({
        body: { data: [{ name: 'no uuid' }], has_more: false },
      }),
    });
    expect(broken).toBeDefined();
    await expect(compliance.listOrganizations()).rejects.toThrow(/schema drift/);
  });
});

describe('AdminApi (Enterprise user management and spend limits)', () => {
  it('maps members, pending invites and groups with member counts', async () => {
    const { admin, api } = gateways();
    expect(await admin.listMembers()).toContainEqual({
      id: 'user_01',
      email: 'owner@example.com',
      name: 'Owner',
      role: 'primary_owner',
      organizationId: null,
      joinedAt: '2025-01-01T00:00:00Z',
    });
    await admin.listInvites();
    expect(api.calls.at(-1)?.searchParams.getAll('statuses[]')).toEqual(['pending']);
    expect(await admin.listGroups(10)).toEqual([
      {
        id: 'rbac_group_01',
        name: 'Engineering',
        source: 'direct',
        roleIds: ['rbac_role_01'],
        memberCount: 1,
      },
    ]);
    expect((await admin.listGroups(0))[0]?.memberCount).toBeNull();
  });

  it('converts spend amounts from cents and keeps null as unlimited', async () => {
    const { admin } = gateways();
    const rows = await admin.listSpendLimits();
    expect(rows).toEqual([
      {
        userId: 'user_01',
        email: 'owner@example.com',
        period: 'monthly',
        limit: 500,
        spent: 314.025,
        source: 'seat_tier',
        currency: 'USD',
      },
      {
        userId: 'user_02',
        email: 'member@example.com',
        period: 'monthly',
        limit: null,
        spent: 0,
        source: 'organization',
        currency: 'USD',
      },
    ]);
  });
});

describe('AnalyticsApi', () => {
  it('derives activity from counters when last_activity_date is absent', async () => {
    const { analytics, api } = gateways();
    const result = await analytics.listUserActivity(new Date('2025-06-01T00:00:00Z'), NOW);
    expect(api.calls[0]?.searchParams.get('starting_date')).toBe(
      ANALYTICS_EPOCH.toISOString().slice(0, 10),
    );
    expect(result.items).toEqual([
      { userId: 'user_01', email: 'owner@example.com', active: true, lastActiveOn: '2026-09-28' },
      { userId: 'user_02', email: 'member@example.com', active: true, lastActiveOn: null },
    ]);
    expect(result.window?.from).toBe('2026-01-01T00:00:00.000Z');
  });

  it('requests one report per dimension and maps tokens, costs and the oldest watermark', async () => {
    const { analytics, api } = gateways();
    const usage = await analytics.usageReport(range, NOW);
    expect(api.calls.map((u) => u.searchParams.get('group_by[]'))).toEqual([
      null,
      'product',
      'model',
      'rbac_group_id',
    ]);
    expect(api.calls[0]?.searchParams.get('bucket_width')).toBe('1d');
    expect(usage.items.find((r) => r.dimension === 'model')).toEqual({
      date: '2026-09-29',
      dimension: 'model',
      key: 'claude-opus-5',
      uncachedInputTokens: 1000,
      cacheReadInputTokens: 200,
      cacheCreationInputTokens: 15,
      outputTokens: 300,
      webSearchRequests: 2,
      requests: 7,
    });
    const cost = await analytics.costReport(range, NOW);
    expect(cost.items.find((r) => r.dimension === 'group')).toMatchObject({
      key: 'rbac_group_01',
      amount: 412.8,
      listAmount: 500,
    });
    expect(cost.asOf).toBe('2026-09-30T06:00:00Z');
  });

  it('maps activity summaries', async () => {
    const { analytics, api } = gateways();
    const summaries = await analytics.listSummaries(range, NOW);
    expect(api.calls[0]?.searchParams.has('ending_date')).toBe(false);
    expect(summaries.items[0]).toEqual({
      date: '2026-09-29',
      dailyActiveUsers: 20,
      weeklyActiveUsers: 30,
      monthlyActiveUsers: 35,
      assignedSeats: 50,
      monthlyAdoptionRate: 70,
      pendingInvites: 1,
    });
  });
});
