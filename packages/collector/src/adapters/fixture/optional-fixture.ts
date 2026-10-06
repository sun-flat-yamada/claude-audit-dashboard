import { join } from 'node:path';
import { loadCaptureEntries, type RawCaptureEntry } from '../anthropic/raw-capture.js';
import { replayFetch, type ReplayFetch } from '../anthropic/replay-fetch.js';

/**
 * Official-reference-shaped captures of the optional APIs sit next to the tenant fixtures
 * (`.../fixtures/tenant`, `.../fixtures/console`, `.../fixtures/claude-code`,
 * `.../fixtures/feature-usage`).
 */
export const CONSOLE_FIXTURE_DIR = 'console';
export const CLAUDE_CODE_FIXTURE_DIR = 'claude-code';
export const FEATURE_USAGE_FIXTURE_DIR = 'feature-usage';

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

const EMPTY_PAGE = { data: [], has_more: false, next_page: null };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_replay' },
  });

/**
 * The Claude Code endpoint is asked once per day, so a replay must answer by day (`starting_at`)
 * and page as well; a day without a recording has no activity (an empty 200 page).
 */
function claudeCodeResponse(entries: readonly RawCaptureEntry[], url: URL): Response {
  const day = url.searchParams.get('starting_at');
  const page = url.searchParams.get('page');
  const hit = entries.find(
    (e) => e.request.query.starting_at?.[0] === day && (e.request.query.page?.[0] ?? null) === page,
  );
  return hit ? json(hit.response.body, hit.response.status) : json(EMPTY_PAGE);
}

/**
 * Chains the optional-API fixtures in front of another replay (the B1 tenant): the Console and
 * feature usage endpoints replay as captured, the Claude Code endpoint answers per day,
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
  const claudeCode = await loadCaptureEntries(join(fixturesRoot, CLAUDE_CODE_FIXTURE_DIR));
  const calls = base.calls;
  const replayed = async (replay: ReplayFetch, input: string | URL | Request, url: URL) => {
    const response = await replay.fetch(input);
    calls.push(url);
    return response;
  };
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === CLAUDE_CODE_PATH) {
      calls.push(url);
      return claudeCodeResponse(claudeCode, url);
    }
    if (CONSOLE_PATH.test(url.pathname)) return replayed(consoleReplay, input, url);
    if (FEATURE_USAGE_PATH.test(url.pathname)) return replayed(featureReplay, input, url);
    return base.fetch(input);
  }) as typeof fetch;
  return { fetch: impl, calls };
}
