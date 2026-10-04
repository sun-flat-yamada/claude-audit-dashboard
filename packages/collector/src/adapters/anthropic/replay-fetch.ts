import { queryOf, type RawCaptureEntry } from './raw-capture.js';

/**
 * Parameters that choose between several responses of one endpoint (paging cursors and the
 * grouping dimension). Everything else (time windows, limits) is ignored, so a recorded
 * tenant answers regardless of the clock a test or the fixture source uses.
 */
const SELECTORS = ['after_id', 'page', 'group_by[]', 'statuses[]'] as const;

const sameSelectors = (recorded: Record<string, string[]>, requested: Record<string, string[]>) =>
  SELECTORS.every((name) => (recorded[name] ?? []).join(',') === (requested[name] ?? []).join(','));

const ACTIVITIES = '/v1/compliance/activities';

/**
 * The Activity Feed applies the `created_at.gte` / `created_at.lt` window server-side; a replay
 * must too, otherwise a second collection run would see the whole recording again.
 */
function windowed(body: unknown, url: URL): unknown {
  const gte = url.searchParams.get('created_at.gte');
  const lt = url.searchParams.get('created_at.lt');
  const data = (body as { data?: unknown } | null)?.data;
  if (url.pathname !== ACTIVITIES || !Array.isArray(data) || (!gte && !lt)) return body;
  const inWindow = (row: { created_at?: string }): boolean => {
    const at = Date.parse(row.created_at ?? '');
    return (!gte || at >= Date.parse(gte)) && (!lt || at < Date.parse(lt));
  };
  return {
    ...(body as object),
    data: data.filter((row) => inWindow(row as { created_at?: string })),
  };
}

export interface ReplayFetch {
  fetch: typeof fetch;
  /** Every URL requested, in order. */
  calls: URL[];
}

/** A `fetch` that answers GET requests from captured exchanges; unknown requests get a 404. */
export function replayFetch(entries: readonly RawCaptureEntry[]): ReplayFetch {
  const calls: URL[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    const query = queryOf(url);
    const hit = entries.find(
      (e) => e.request.path === url.pathname && sameSelectors(e.request.query, query),
    );
    const status = hit?.response.status ?? 404;
    const recorded = hit ? windowed(hit.response.body, url) : undefined;
    const body = recorded ?? {
      type: 'error',
      error: { type: 'not_found_error', message: 'Not found' },
    };
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'request-id': 'req_replay' },
    });
  }) as typeof fetch;
  return { fetch: impl, calls };
}
