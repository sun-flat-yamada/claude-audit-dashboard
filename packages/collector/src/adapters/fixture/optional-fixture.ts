import { join } from 'node:path';
import { loadCaptureEntries, type RawCaptureEntry } from '../anthropic/raw-capture.js';
import { replayFetch, type ReplayFetch } from '../anthropic/replay-fetch.js';

/**
 * Official-reference-shaped captures of the optional APIs sit next to the tenant fixtures
 * (`.../fixtures/tenant`, `.../fixtures/console`, `.../fixtures/claude-code`,
 * `.../fixtures/feature-usage`, `.../fixtures/member-daily`).
 */
export const CONSOLE_FIXTURE_DIR = 'console';
export const CLAUDE_CODE_FIXTURE_DIR = 'claude-code';
export const FEATURE_USAGE_FIXTURE_DIR = 'feature-usage';
export const MEMBER_DAILY_FIXTURE_DIR = 'member-daily';

const CONSOLE_PATH =
  /^\/v1\/organizations\/(workspaces|api_keys|usage_report\/messages|cost_report)$/;
const FEATURE_USAGE_PATH =
  /^\/v1\/organizations\/analytics\/(skills|connectors|plugins|apps\/chat\/projects)$/;

/** The directory that holds the optional fixtures, derived from the tenant fixture directory. */
export const optionalFixturesRoot = (tenantFixtureDir: string): string =>
  join(tenantFixtureDir, '..');

/** Not a credential: the replay fetch ignores it, the HTTP client only needs a non-empty value. */
export const FIXTURE_CONSOLE_KEY = 'fixture-console-key-not-used';

const CLAUDE_CODE_PATH = '/v1/organizations/usage_report/claude_code';
const MEMBER_DAILY_PATH = '/v1/organizations/analytics/users';

const EMPTY_PAGE = { data: [], has_more: false, next_page: null };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_replay' },
  });

/**
 * Per-day endpoints (Claude Code `starting_at`, Analytics users `date`) are asked once per day,
 * so a replay must answer by day and page as well; a day without a recording has no activity
 * (an empty 200 page).
 */
function perDayResponse(entries: readonly RawCaptureEntry[], url: URL, param: string): Response {
  const day = url.searchParams.get(param);
  const page = url.searchParams.get('page');
  const hit = entries.find(
    (e) => e.request.query[param]?.[0] === day && (e.request.query.page?.[0] ?? null) === page,
  );
  return hit ? json(hit.response.body, hit.response.status) : json(EMPTY_PAGE);
}

/** The per-day endpoint a request is for (path and day parameter), if any. */
const PER_DAY: readonly { path: string; param: string; dir: string }[] = [
  { path: CLAUDE_CODE_PATH, param: 'starting_at', dir: CLAUDE_CODE_FIXTURE_DIR },
  { path: MEMBER_DAILY_PATH, param: 'date', dir: MEMBER_DAILY_FIXTURE_DIR },
];

/** The daily users series shares its path with the range roll-up; only `date=` is per day. */
const isPerDay = (route: { path: string; param: string }, url: URL): boolean =>
  url.pathname === route.path && url.searchParams.has(route.param);

/**
 * Chains the optional-API fixtures in front of another replay (the B1 tenant): the Console and
 * feature usage endpoints replay as captured, the Claude Code endpoint and the daily users
 * series (`date=`) answer per day,
 * everything else goes to `base`.
 */
export async function withOptionalFixtures(
  base: ReplayFetch,
  fixturesRoot: string,
): Promise<ReplayFetch> {
  const consoleReplay = replayFetch(
    await loadCaptureEntries(join(fixturesRoot, CONSOLE_FIXTURE_DIR)),
  );
  const featureReplay = replayFetch(
    await loadCaptureEntries(join(fixturesRoot, FEATURE_USAGE_FIXTURE_DIR)),
  );
  const perDay = await Promise.all(
    PER_DAY.map(async (route) => ({
      ...route,
      entries: await loadCaptureEntries(join(fixturesRoot, route.dir)),
    })),
  );
  const calls = base.calls;
  const replayed = async (replay: ReplayFetch, input: string | URL | Request, url: URL) => {
    const response = await replay.fetch(input);
    calls.push(url);
    return response;
  };
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const day = perDay.find((route) => isPerDay(route, url));
    if (day) {
      calls.push(url);
      return perDayResponse(day.entries, url, day.param);
    }
    if (CONSOLE_PATH.test(url.pathname)) return replayed(consoleReplay, input, url);
    if (FEATURE_USAGE_PATH.test(url.pathname)) return replayed(featureReplay, input, url);
    return base.fetch(input);
  }) as typeof fetch;
  return { fetch: impl, calls };
}
