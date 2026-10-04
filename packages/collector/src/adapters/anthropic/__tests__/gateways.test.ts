import { describe, expect, it } from 'vitest';
import { FIXTURES, MOCK_KEY, ORG_A } from '../../../__tests__/fake-anthropic.js';
import { FIXTURE_SETS, OFFICIAL_SET, type FixtureSet } from '../../../__tests__/fixture-sets.js';
import { AdminApi } from '../admin-api.js';
import { ANALYTICS_EPOCH, AnalyticsApi } from '../analytics-api.js';
import { ComplianceApi } from '../compliance-api.js';
import { HttpClient } from '../http-client.js';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const range = { start: new Date('2026-08-31T00:00:00.000Z'), end: NOW };

function gateways(overrides = {}, set: FixtureSet = OFFICIAL_SET) {
  const api = set.api(overrides);
  const http = new HttpClient({ apiKey: MOCK_KEY, fetchImpl: api.fetch, sleep: async () => {} });
  return {
    api,
    compliance: new ComplianceApi(http),
    admin: new AdminApi(http),
    analytics: new AnalyticsApi(http),
  };
}

describe('ComplianceApi (official examples)', () => {
  it('polls the activity window with exclusions, sends no undocumented sort parameter, and maps actors', async () => {
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
      limit: '5000',
      'exclude_activity_types[]': 'claude_chat_viewed',
    });
    expect(first.has('order')).toBe(false);
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

describe('AdminApi (official examples)', () => {
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

describe('AnalyticsApi (official examples)', () => {
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

/** Shape contract that every fixture set (official examples and tenant shape) must satisfy. */
describe.each(FIXTURE_SETS)('gateways on the $name fixtures', (set) => {
  it('pages through the activity feed and maps every actor kind', async () => {
    const { compliance, api } = gateways({}, set);
    const items = await compliance.listActivities(
      { from: new Date('2026-09-24T12:00:00Z'), to: NOW },
      { pageSize: 5000, includeTypes: [], excludeTypes: [] },
    );
    const calls = api.calls.filter((u) => u.pathname === '/v1/compliance/activities');
    expect(items).toHaveLength(set.activities);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]?.searchParams.has('order')).toBe(false);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.every((i) => i.id && i.type && i.createdAt && i.actor.kind)).toBe(true);
    expect(items.some((i) => i.actor.kind === 'api_actor' && i.actor.id)).toBe(true);
  });

  it('keeps Activity api_key_id and the key inventory id in one ID space (V2 shape)', async () => {
    const { compliance } = gateways({}, set);
    const items = await compliance.listActivities(
      { from: new Date('2026-09-24T12:00:00Z'), to: NOW },
      { pageSize: 5000, includeTypes: [], excludeTypes: [] },
    );
    const credentials = await compliance.listCredentials();
    const keyIds = new Set(credentials.map((c) => c.id));
    const used = items.filter((i) => i.actor.kind === 'api_actor').map((i) => i.actor.id);
    expect(credentials.length).toBeGreaterThan(0);
    expect(used.some((id) => id !== null && keyIds.has(id))).toBe(true);
  });

  it('maps effective settings for every organization and fetches each one once', async () => {
    const { compliance, api } = gateways({}, set);
    const orgs = await compliance.listOrganizations();
    const settings = await compliance.listSettings();
    expect(settings).toHaveLength(orgs.length);
    for (const s of settings) {
      expect(s.values).toHaveProperty('sso_claude_ai_enforced');
      expect(s.values).toMatchObject({
        sso_provisioning_mode: { type: 'provisioning_mode' },
        data_retention_periods: { type: 'data_retention' },
      });
    }
    expect(api.calls.filter((u) => u.pathname.endsWith('/settings'))).toHaveLength(orgs.length);
  });

  it('maps members, pending invites and groups with member counts', async () => {
    const { admin, api } = gateways({}, set);
    const members = await admin.listMembers();
    expect(members).toHaveLength(set.members);
    expect(new Set(members.map((m) => m.id)).size).toBe(set.members);
    expect(members.every((m) => m.email.endsWith('@example.com') && m.role)).toBe(true);
    expect(await admin.listInvites()).toHaveLength(set.invites);
    expect(api.calls.at(-1)?.searchParams.getAll('statuses[]')).toEqual(['pending']);
    const groups = await admin.listGroups(10);
    expect(groups).toHaveLength(set.groups);
    expect(groups.every((g) => typeof g.memberCount === 'number')).toBe(true);
    expect((await admin.listGroups(0)).every((g) => g.memberCount === null)).toBe(true);
  });

  it('converts spend amounts from minor units and keeps null as unlimited', async () => {
    const { admin } = gateways({}, set);
    const rows = await admin.listSpendLimits();
    expect(rows).toHaveLength(set.userSpendLimits);
    expect(rows.every((r) => r.currency === 'USD' && r.spent >= 0)).toBe(true);
    expect(rows.some((r) => r.limit === null)).toBe(true);
    expect(rows.some((r) => r.limit !== null && r.limit > 0 && r.limit < 100_000)).toBe(true);
  });

  it('derives member activity, summaries, usage and cost', async () => {
    const { analytics, api } = gateways({}, set);
    const users = await analytics.listUserActivity(new Date('2025-06-01T00:00:00Z'), NOW);
    expect(users.items).toHaveLength(set.members);
    expect(users.items.every((u) => typeof u.active === 'boolean')).toBe(true);
    expect(users.items.some((u) => u.active)).toBe(true);
    const summaries = await analytics.listSummaries(range, NOW);
    expect(summaries.items.length).toBeGreaterThan(0);
    const usage = await analytics.usageReport(range, NOW);
    const dimensions = new Set(usage.items.map((r) => r.dimension));
    expect(dimensions).toEqual(new Set(['total', 'product', 'model', 'group']));
    const cost = await analytics.costReport(range, NOW);
    expect(cost.items.length).toBeGreaterThan(0);
    expect(cost.asOf).toBe(set.costAsOf);
    expect(
      api.calls
        .filter((u) => u.pathname.endsWith('usage_report'))
        .map((u) => u.searchParams.get('group_by[]')),
    ).toEqual([null, 'product', 'model', 'rbac_group_id']);
  });
});
