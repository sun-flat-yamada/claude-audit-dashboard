import { describe, expect, it, vi } from 'vitest';
import { ApiError, HttpClient, backoffMs, buildUrl } from '../http-client.js';
import { collectIdPages, collectTokenPages } from '../paginate.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function client(responses: (Response | Error)[]) {
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error('no response queued');
    return next;
  }) as unknown as typeof fetch;
  return { http: new HttpClient({ apiKey: 'test-key', fetchImpl, sleep }), fetchImpl, sleep };
}

describe('buildUrl', () => {
  it('serializes arrays as key[] and objects as dotted keys, skipping empty values', () => {
    const url = buildUrl('https://api.anthropic.com', '/v1/x', {
      activity_types: ['a', 'b'],
      created_at: { gte: '2026-09-01T00:00:00Z', lt: undefined },
      limit: 5,
      page: undefined,
      flag: null,
    });
    expect(url.search).toBe(
      '?activity_types%5B%5D=a&activity_types%5B%5D=b&created_at.gte=2026-09-01T00%3A00%3A00Z&limit=5',
    );
  });
});

describe('HttpClient retry contract', () => {
  it('sends the key and version headers', async () => {
    const { http, fetchImpl } = client([json({ ok: true })]);
    await http.getJson('/v1/x');
    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
    });
  });

  it('waits retry-after seconds on 429 and does not advance anything', async () => {
    const { http, sleep } = client([json({}, 429, { 'retry-after': '25' }), json({ ok: 1 })]);
    await expect(http.getJson('/v1/x')).resolves.toEqual({ ok: 1 });
    expect(sleep).toHaveBeenCalledWith(25_000);
  });

  it('backs off 1s, 2s, 4s… on 5xx and 529, then throws a structured error', async () => {
    const error = { type: 'error', error: { type: 'api_error', message: 'Internal' } };
    const { http, sleep } = client([
      json({}, 529),
      json({}, 502),
      json({}, 503),
      json({}, 504),
      json({}, 500),
      json(error, 500, { 'request-id': 'req_1' }),
    ]);
    const failure = await http.getJson('/v1/x').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toBe(
      'GET /v1/x → 500 api_error: Internal (request-id req_1)',
    );
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(backoffMs(10)).toBe(60_000);
  });

  it('does not retry a 500 marked x-should-retry: false, nor other 4xx', async () => {
    const noRetry = client([json({}, 500, { 'x-should-retry': 'false' })]);
    await expect(noRetry.http.getJson('/v1/x')).rejects.toMatchObject({ status: 500 });
    expect(noRetry.fetchImpl).toHaveBeenCalledTimes(1);
    const forbidden = client([
      json({ error: { type: 'permission_error', message: 'Missing required scopes' } }, 403),
    ]);
    await expect(forbidden.http.getJson('/v1/x')).rejects.toMatchObject({
      status: 403,
      errorType: 'permission_error',
    });
  });

  it('retries network errors and reports the last cause', async () => {
    const { http, sleep } = client([new TypeError('fetch failed'), json({ ok: 2 })]);
    await expect(http.getJson('/v1/x')).resolves.toEqual({ ok: 2 });
    expect(sleep).toHaveBeenCalledWith(1000);
    const down = client(Array.from({ length: 6 }, () => new TypeError('fetch failed')));
    await expect(down.http.getJson('/v1/x')).rejects.toThrow('GET /v1/x failed: fetch failed');
  });
});

describe('pagination', () => {
  it('follows ID cursors until has_more is false and guards against loops', async () => {
    const pages = [
      { data: [1], has_more: true, last_id: 'a' },
      { data: [2], has_more: false, last_id: 'b' },
    ];
    const seen: (string | undefined)[] = [];
    await expect(
      collectIdPages(async (after) => (seen.push(after), pages.shift()!)),
    ).resolves.toEqual([1, 2]);
    expect(seen).toEqual([undefined, 'a']);
    await expect(
      collectIdPages(async () => ({ data: [1], has_more: true, last_id: 'same' })),
    ).rejects.toThrow(/did not advance/);
  });

  it('follows page tokens with or without has_more', async () => {
    const pages = [
      { data: ['x'], next_page: 'p2' },
      { data: ['y'], next_page: null },
    ];
    await expect(collectTokenPages(async () => pages.shift()!)).resolves.toEqual(['x', 'y']);
    const flagged = [{ data: ['x'], has_more: false, next_page: 'ignored' }];
    await expect(collectTokenPages(async () => flagged.shift()!)).resolves.toEqual(['x']);
  });

  it('restarts once from the first page when a cursor expires (410)', async () => {
    let calls = 0;
    const result = await collectTokenPages(async (page) => {
      calls++;
      if (calls === 2) throw new ApiError(410, 'gone', 'expired', null);
      return page ? { data: ['b'], next_page: null } : { data: ['a'], next_page: 'p2' };
    });
    expect(result).toEqual(['a', 'b']);
    expect(calls).toBe(4);
  });
});
