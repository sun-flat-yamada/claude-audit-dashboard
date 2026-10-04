/**
 * In-memory Anthropic API for tests. Response bodies follow the examples in the official
 * references (platform.claude.com/docs, 2026-09-30); identifiers and addresses are synthetic.
 */
export const ORG_A = '91012d09-e48b-438e-a489-1bebfd8fa6f9';

export const MOCK_KEY = 'sk-ant-api01-mock000000000000000000000000';

export type Handler = (url: URL) => {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
};

/** Applies the `created_at.gte` / `created_at.lt` window like the Activity Feed does. */
const inWindow = <T extends { created_at: string }>(url: URL, rows: T[]): T[] => {
  const gte = url.searchParams.get('created_at.gte');
  const lt = url.searchParams.get('created_at.lt');
  return rows.filter(
    (r) =>
      (!gte || Date.parse(r.created_at) >= Date.parse(gte)) &&
      (!lt || Date.parse(r.created_at) < Date.parse(lt)),
  );
};

export const FIXTURES: Record<string, Handler> = {
  '/v1/compliance/organizations': () => ({
    body: {
      data: [{ uuid: ORG_A, name: 'Acme Engineering', created_at: '2025-06-01T10:00:00Z' }],
      has_more: false,
      next_page: null,
    },
  }),
  [`/v1/compliance/organizations/${ORG_A}/settings`]: () => ({
    body: {
      type: 'effective_organization_settings',
      organization_id: ORG_A,
      settings: [
        { name: 'sso_claude_ai_enforced', type: 'boolean', value: true },
        { name: 'ip_allowlist_enabled', type: 'boolean', value: false },
        { type: 'provisioning_mode', value: 'scim_advanced' },
        {
          type: 'data_retention',
          value: { chat: { type: 'fixed', timescale: 'day', duration: 90 } },
        },
        { name: 'account_session_duration_seconds', type: 'integer', value: null },
      ],
      api_keys: [
        {
          type: 'compliance_api_key',
          id: 'apikey_01Hx7k2mP9nQ4rS6tU8vW0xY',
          name: 'Compliance Export Key',
          scopes: ['read:compliance_activities', 'read:compliance_org_data'],
          is_active: true,
          created_at: '2026-03-14T09:30:00Z',
          created_by_id: 'user_01Jz3a4bC5dE6fG7hI8jK9lM',
          expires_at: null,
        },
      ],
    },
  }),
  '/v1/compliance/activities': (url) => ({
    body: url.searchParams.get('after_id')
      ? { data: [], has_more: false, first_id: null, last_id: null }
      : {
          data: inWindow(url, [
            {
              id: 'activity_01XyDMpzjS89pFZXqSFUBDr6',
              created_at: '2026-09-30T08:09:10Z',
              organization_id: 'org_01Wv6QeBcDfGhJkLmNpQrSt8',
              organization_uuid: ORG_A,
              actor: {
                type: 'user_actor',
                email_address: 'user@example.com',
                user_id: 'user_01TuVwXyZaBcDeFgH2JkLmN4',
                ip_address: '192.0.2.34',
                user_agent: 'Mozilla/5.0',
              },
              type: 'claude_user_role_updated',
              user_id: 'user_02',
              user_email: 'member@example.com',
              previous_role: 'user',
              current_role: 'owner',
            },
            {
              id: 'activity_02',
              created_at: '2026-09-30T09:00:00Z',
              organization_id: null,
              organization_uuid: null,
              actor: {
                type: 'api_actor',
                api_key_id: 'apikey_01Hx7k2mP9nQ4rS6tU8vW0xY',
                ip_address: '203.0.113.5',
                user_agent: 'curl/8',
              },
              type: 'compliance_api_accessed',
            },
          ]),
          has_more: true,
          first_id: 'activity_01XyDMpzjS89pFZXqSFUBDr6',
          last_id: 'activity_02',
        },
  }),
  '/v1/compliance/groups': () => ({
    body: {
      data: [
        {
          id: 'rbac_group_012',
          name: 'Engineering Team',
          description: '',
          source_type: 'scim',
          roles: ['rbac_role_01'],
          created_at: null,
          updated_at: null,
        },
      ],
      has_more: false,
      next_page: null,
    },
  }),
  '/v1/organizations/users': () => ({
    body: {
      data: [
        {
          type: 'user',
          id: 'user_01',
          email: 'owner@example.com',
          name: 'Owner',
          role: 'primary_owner',
          added_at: '2025-01-01T00:00:00Z',
        },
        {
          type: 'user',
          id: 'user_02',
          email: 'member@example.com',
          name: 'Member',
          role: 'user',
          added_at: '2026-09-01T00:00:00Z',
        },
      ],
      has_more: false,
      first_id: 'user_01',
      last_id: 'user_02',
    },
  }),
  '/v1/organizations/invites': () => ({
    body: {
      data: [
        {
          type: 'invite',
          id: 'invite_01',
          email: 'new@example.com',
          role: 'user',
          status: 'pending',
          invited_at: '2026-06-01T00:00:00Z',
          expires_at: '2026-10-21T00:00:00Z',
          accepted_at: null,
          rbac_group_ids: [],
        },
      ],
      has_more: false,
      first_id: 'invite_01',
      last_id: 'invite_01',
    },
  }),
  '/v1/organizations/rbac_groups': () => ({
    body: {
      data: [
        {
          type: 'rbac_group',
          id: 'rbac_group_01',
          name: 'Engineering',
          source_type: 'direct',
          role_ids: ['rbac_role_01'],
          roles: ['rbac_role_01'],
          created_at: '2026-03-18T10:01:42Z',
          updated_at: '2026-05-02T08:55:09Z',
        },
      ],
      has_more: false,
      next_page: null,
    },
  }),
  '/v1/organizations/rbac_groups/rbac_group_01/members': () => ({
    body: {
      data: [
        {
          type: 'rbac_group_member',
          rbac_group_id: 'rbac_group_01',
          group_id: 'rbac_group_01',
          user_id: 'user_01',
          email: 'owner@example.com',
          created_at: '2026-04-07T12:30:00Z',
        },
      ],
      has_more: false,
      next_page: null,
    },
  }),
  '/v1/organizations/spend_limits/effective': () => ({
    body: {
      data: [
        {
          scope: { type: 'user', user_id: 'user_01' },
          actor: {
            type: 'user_actor',
            user_id: 'user_01',
            name: 'Owner',
            email_address: 'owner@example.com',
            deleted: false,
          },
          amount: '50000',
          currency: 'USD',
          period: 'monthly',
          source: { type: 'seat_tier', seat_tier: 'enterprise_standard' },
          spend_limit_id: 'spl_01',
          period_to_date_spend: '31402.5',
        },
        {
          scope: { type: 'user', user_id: 'user_02' },
          actor: {
            type: 'user_actor',
            user_id: 'user_02',
            name: 'Member',
            email_address: 'member@example.com',
            deleted: false,
          },
          amount: null,
          currency: 'USD',
          period: 'monthly',
          source: { type: 'organization' },
          spend_limit_id: 'spl_02',
          period_to_date_spend: '0',
        },
        {
          scope: { type: 'organization' },
          actor: { type: 'scoped_api_key_actor', scoped_api_key_id: 'key' },
          amount: '1',
          currency: 'USD',
          period: 'monthly',
          source: { type: 'organization' },
          spend_limit_id: 'spl_03',
          period_to_date_spend: '0',
        },
      ],
      next_page: null,
    },
  }),
  '/v1/organizations/analytics/users': () => ({
    body: {
      data: [
        {
          user: { type: 'user', id: 'user_01', email_address: 'owner@example.com' },
          last_activity_date: '2026-09-28',
          chat_metrics: { message_count: 4 },
          web_search_count: 0,
        },
        {
          user: { type: 'user', id: 'user_02', email_address: 'member@example.com' },
          chat_metrics: { message_count: 0 },
          claude_code_metrics: { core_metrics: { commit_count: 2 } },
          web_search_count: 0,
        },
      ],
      next_page: null,
    },
  }),
  '/v1/organizations/analytics/summaries': () => ({
    body: {
      data: [
        {
          starting_at: '2026-09-29T00:00:00Z',
          ending_at: '2026-09-30T00:00:00Z',
          daily_active_user_count: 20,
          weekly_active_user_count: 30,
          monthly_active_user_count: 35,
          assigned_seat_count: 50,
          monthly_adoption_rate: 70,
          daily_adoption_rate: 40,
          weekly_adoption_rate: 60,
          pending_invite_count: 1,
          cowork_daily_active_user_count: 0,
          cowork_weekly_active_user_count: 0,
          cowork_monthly_active_user_count: 0,
        },
      ],
      next_page: null,
    },
  }),
  '/v1/organizations/analytics/usage_report': (url) => ({
    body: {
      data: [
        {
          starting_at: '2026-09-29T00:00:00Z',
          ending_at: '2026-09-30T00:00:00Z',
          results: [
            {
              uncached_input_tokens: 1000,
              cache_read_input_tokens: 200,
              cache_creation: { ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 5 },
              output_tokens: 300,
              server_tool_use: { web_search_requests: 2 },
              requests: 7,
              model: url.searchParams.get('group_by[]') === 'model' ? 'claude-opus-5' : null,
              product: url.searchParams.get('group_by[]') === 'product' ? 'chat' : null,
              rbac_group_id:
                url.searchParams.get('group_by[]') === 'rbac_group_id' ? 'rbac_group_01' : null,
            },
          ],
        },
      ],
      data_refreshed_at: '2026-09-30T08:00:00Z',
      has_more: false,
      next_page: null,
      organization_id: 'org_013FP9SaFPBg7Kw7fetjn6cF',
    },
  }),
  '/v1/organizations/analytics/cost_report': (url) => ({
    body: {
      data: [
        {
          starting_at: '2026-09-29T00:00:00Z',
          ending_at: '2026-09-30T00:00:00Z',
          results: [
            {
              amount: '41280.000000',
              list_amount: '50000',
              currency: 'USD',
              model: url.searchParams.get('group_by[]') === 'model' ? 'claude-opus-5' : null,
              product: url.searchParams.get('group_by[]') === 'product' ? 'chat' : null,
              rbac_group_id:
                url.searchParams.get('group_by[]') === 'rbac_group_id' ? 'rbac_group_01' : null,
            },
          ],
        },
      ],
      data_refreshed_at: '2026-09-30T06:00:00Z',
      has_more: false,
      next_page: null,
      organization_id: 'org_013FP9SaFPBg7Kw7fetjn6cF',
    },
  }),
};

export interface FakeApi {
  fetch: typeof fetch;
  calls: URL[];
}

/** Routes by path; unknown paths answer 404 like the real API. `overrides` replace fixtures. */
export function fakeAnthropic(overrides: Record<string, Handler> = {}): FakeApi {
  const routes = { ...FIXTURES, ...overrides };
  const calls: URL[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    const handler = routes[url.pathname];
    const result = handler
      ? handler(url)
      : {
          status: 404,
          body: { type: 'error', error: { type: 'not_found_error', message: 'Not found' } },
        };
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: {
        'content-type': 'application/json',
        'request-id': 'req_test',
        ...(result.headers ?? {}),
      },
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}
