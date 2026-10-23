/**
 * Synthetic tenant for the ledger backfill (#159): every time-bounded endpoint answers for any
 * period and enforces the documented limits with HTTP 400 (`usage_report` / `cost_report`:
 * `starting_at` within the last 365 days and not before 2026-01-01, at most 31 days; Analytics
 * dates not before 2026-01-01, `ending_date` at most today, at most 366 days; `users?date=` not
 * after the newest published day). Identifiers and addresses are synthetic (`example.com`).
 */
import { MOCK_KEY } from './fake-anthropic.js';

export { MOCK_KEY };

const DAY = 86_400_000;
const EPOCH = Date.parse('2026-01-01T00:00:00Z');
/** The Compliance API was enabled on this day: no activity exists before it. */
export const COMPLIANCE_ENABLED = '2026-01-01';

export interface TenantCall {
  url: URL;
  /** Pacing clock (ms) when the request started. */
  at: number;
  family: 'analytics' | 'compliance';
}

export interface BackfillTenant {
  fetch: typeof fetch;
  calls: TenantCall[];
  /** Answer the next requests matching `match` with this status (once per entry). */
  failOnce(match: (url: URL) => boolean, status: number, headers?: Record<string, string>): void;
  /** Answer every request matching `match` with this status until `heal()`. */
  failAlways(match: (url: URL) => boolean, status: number): void;
  heal(): void;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`);
const startOfDay = (ms: number) => Math.floor(ms / DAY) * DAY;

class BadRequest extends Error {}

function check(condition: boolean, message: string): void {
  if (!condition) throw new BadRequest(message);
}

const MODELS = ['claude-model-a', 'claude-model-b'] as const;

/** Cost and tokens of one day: deterministic, and the two models add up to the total. */
const dayValue = (date: string) => (Number(date.slice(8, 10)) + Number(date.slice(5, 7))) * 100;

function reportRows(url: URL, date: string, kind: 'usage' | 'cost'): Record<string, unknown>[] {
  const groupBy = url.searchParams.getAll('group_by[]');
  const total = dayValue(date);
  const row = (share: number, extra: Record<string, unknown>) =>
    kind === 'cost'
      ? { amount: (total * share).toFixed(6), list_amount: null, currency: 'USD', ...extra }
      : { uncached_input_tokens: total * share, output_tokens: total * share, ...extra };
  if (groupBy.includes('model'))
    return [row(0.75, { model: MODELS[0] }), row(0.25, { model: MODELS[1] })];
  if (groupBy.includes('product')) return [row(1, { product: 'chat' })];
  if (groupBy.includes('rbac_group_id')) return [row(1, { rbac_group_id: 'rbac_group_fx_01' })];
  return [row(1, {})];
}

function bucketReport(url: URL, now: number, kind: 'usage' | 'cost') {
  const start = Date.parse(url.searchParams.get('starting_at') ?? '');
  const end =
    Date.parse(url.searchParams.get('ending_at') ?? '') || Math.min(now, start + 31 * DAY);
  check(start >= EPOCH, 'starting_at must be no earlier than 2026-01-01T00:00:00Z');
  check(start >= now - 365 * DAY, 'starting_at must be within the last 365 days');
  check(end - start <= 31 * DAY, 'The range may span at most 31 days');
  const data = [];
  for (let at = start; at < end; at += DAY)
    data.push({
      starting_at: new Date(at).toISOString(),
      ending_at: new Date(at + DAY).toISOString(),
      results: reportRows(url, day(at), kind),
    });
  return { data, has_more: false, next_page: null, data_refreshed_at: new Date(now).toISOString() };
}

/** `starting_date` / `ending_date` checks shared by the Analytics roll-up endpoints. */
function dateRange(url: URL, now: number): { start: number; end: number } {
  const start = midnight(url.searchParams.get('starting_date') ?? '');
  const ending = url.searchParams.get('ending_date');
  const end = ending ? midnight(ending) : startOfDay(now);
  check(start >= EPOCH, 'starting_date must be no earlier than 2026-01-01');
  check(end <= startOfDay(now), 'ending_date can be at most today');
  check(end - start <= 366 * DAY && end > start, 'The range may span at most 366 days');
  return { start, end };
}

function summaries(url: URL, now: number) {
  const { start, end } = dateRange(url, now);
  const data = [];
  for (let at = start; at < end; at += DAY)
    data.push({
      starting_at: day(at),
      ending_at: day(at + DAY),
      daily_active_user_count: 2,
      weekly_active_user_count: 2,
      monthly_active_user_count: 2,
      assigned_seat_count: 3,
      pending_invite_count: 0,
    });
  return { data, has_more: false, next_page: null };
}

const USERS = ['user_fx_backfill_01', 'user_fx_backfill_02'];

const userRow = (id: string, index: number, lastActivity: string) => ({
  user: { id, email_address: `backfill${String(index + 1)}@example.com` },
  last_activity_date: lastActivity,
  chat_metrics: { message_count: index + 1 },
});

/** Newest day whose per-user activity is published: yesterday after 13:30 UTC. */
const latestPublished = (now: number) =>
  startOfDay(now) - (now - startOfDay(now) >= 13.5 * 3_600_000 ? DAY : 2 * DAY);

function users(url: URL, now: number) {
  const date = url.searchParams.get('date');
  if (date) {
    check(midnight(date) >= EPOCH, 'date must be no earlier than 2026-01-01');
    check(
      midnight(date) <= latestPublished(now),
      `latest available day is ${day(latestPublished(now))}`,
    );
    return { data: USERS.map((id, i) => userRow(id, i, date)), next_page: null };
  }
  const { end } = dateRange(url, now);
  return { data: USERS.map((id, i) => userRow(id, i, day(end - DAY))), next_page: null };
}

function features(path: string, url: URL, now: number) {
  dateRange(url, now);
  const name = path.split('/').at(-1) ?? 'feature';
  const rows: Record<string, Record<string, unknown>> = {
    skills: { skill_name: 'fx-skill', distinct_user_count: 2, invocation_count: 4 },
    connectors: { connector_name: 'fx-connector', distinct_user_count: 1 },
    plugins: {
      plugin_name: 'fx-plugin',
      plugin_id: 'plugin_fx',
      distinct_user_count: 1,
      invocation_count: 2,
    },
    projects: {
      project_id: 'claude_proj_fx',
      project_name: 'Fixture project',
      distinct_user_count: 2,
      message_count: 9,
    },
  };
  return { data: [rows[name]], next_page: null };
}

/** One activity per day at 12:00 UTC since the Compliance API was enabled. */
function activities(url: URL, now: number) {
  const gte = Date.parse(url.searchParams.get('created_at.gte') ?? '');
  const lt = Date.parse(url.searchParams.get('created_at.lt') ?? '');
  const limit = Number(url.searchParams.get('limit') ?? '5000');
  const after = url.searchParams.get('after_id');
  const rows = [];
  // Newest first, like the feed.
  for (
    let at = startOfDay(Math.min(lt, now)) + DAY / 2;
    at >= midnight(COMPLIANCE_ENABLED);
    at -= DAY
  )
    if (at >= gte && at < lt && at <= now)
      rows.push({
        id: `activity_fx_${day(at).replaceAll('-', '')}`,
        type: 'claude_chat_created',
        created_at: new Date(at).toISOString(),
        organization_id: 'org_fx',
        organization_uuid: null,
        actor: { type: 'user_actor', user_id: USERS[0], email_address: 'backfill1@example.com' },
      });
  const from = after ? rows.findIndex((r) => r.id === after) + 1 : 0;
  const page = rows.slice(from, from + limit);
  return {
    data: page,
    has_more: from + limit < rows.length,
    first_id: page[0]?.id ?? null,
    last_id: page.at(-1)?.id ?? null,
  };
}

type Route = (url: URL, now: number) => unknown;

const ROUTES: Record<string, Route> = {
  '/v1/organizations/analytics/usage_report': (url, now) => bucketReport(url, now, 'usage'),
  '/v1/organizations/analytics/cost_report': (url, now) => bucketReport(url, now, 'cost'),
  '/v1/organizations/analytics/summaries': summaries,
  '/v1/organizations/analytics/users': users,
  '/v1/compliance/activities': activities,
  ...Object.fromEntries(
    ['skills', 'connectors', 'plugins', 'apps/chat/projects'].map((name) => {
      const path = `/v1/organizations/analytics/${name}`;
      return [path, (url: URL, now: number) => features(path, url, now)];
    }),
  ),
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_fx', ...headers },
  });

const errorBody = (type: string, message: string) => ({ type: 'error', error: { type, message } });

interface Failure {
  match: (url: URL) => boolean;
  status: number;
  headers?: Record<string, string>;
  once: boolean;
}

/**
 * `now` is the tenant's wall clock (the API limits); `pacing()` is the replaced clock of the
 * HTTP client, recorded per request so tests can check the waits between request starts.
 */
export function backfillTenant(now: Date, pacing: () => number = () => 0): BackfillTenant {
  const calls: TenantCall[] = [];
  let failures: Failure[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const family = url.pathname.startsWith('/v1/compliance') ? 'compliance' : 'analytics';
    calls.push({ url, at: pacing(), family });
    const failure = failures.find((f) => f.match(url));
    if (failure) {
      if (failure.once) failures = failures.filter((f) => f !== failure);
      return json(failure.status, errorBody('api_error', 'injected failure'), {
        'x-should-retry': 'false',
        ...failure.headers,
      });
    }
    const route = ROUTES[url.pathname];
    if (!route) return json(404, errorBody('not_found_error', 'Not found'));
    try {
      return json(200, route(url, now.getTime()));
    } catch (error) {
      if (error instanceof BadRequest)
        return json(400, errorBody('invalid_request_error', error.message));
      throw error;
    }
  }) as typeof fetch;
  return {
    fetch: fetchImpl,
    calls,
    failOnce: (match, status, headers) => {
      failures.push({ match, status, ...(headers ? { headers } : {}), once: true });
    },
    failAlways: (match, status) => {
      failures.push({ match, status, once: false });
    },
    heal: () => {
      failures = [];
    },
  };
}
