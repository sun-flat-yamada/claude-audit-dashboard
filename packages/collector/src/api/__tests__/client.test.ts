import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, HttpClient } from '../client.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function client(
  responses: Response[],
  sleep = vi.fn<(ms: number) => Promise<void>>(async () => {}),
) {
  const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
  return {
    http: new HttpClient({ apiKey: 'test-key', fetchImpl, sleep, retryBaseMs: 10 }),
    fetchImpl,
    sleep,
  };
}

describe('HttpClient', () => {
  it('sends auth and version headers', async () => {
    const { http, fetchImpl } = client([json({ ok: true })]);
    await http.get('/v1/x', { a: 1 });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(String(url)).toContain('/v1/x?a=1');
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe('test-key');
    expect((init!.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
  });

  it('honours Retry-After on 429', async () => {
    const { http, sleep } = client([json({}, 429, { 'retry-after': '2' }), json({ ok: 1 })]);
    await expect(http.get('/v1/x')).resolves.toEqual({ ok: 1 });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('retries 5xx with exponential backoff then throws structured error', async () => {
    const { http, sleep } = client([
      json({}, 500),
      json({}, 500),
      json({}, 500),
      json({ e: 1 }, 500),
    ]);
    await expect(http.get('/v1/x')).rejects.toBeInstanceOf(ApiRequestError);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20, 40]);
  });

  it('does not retry 4xx', async () => {
    const { http, fetchImpl } = client([json({}, 401)]);
    await expect(http.get('/v1/x')).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('auto-paginates via last_id', async () => {
    const { http, fetchImpl } = client([
      json({ data: [1, 2], has_more: true, first_id: '1', last_id: '2' }),
      json({ data: [3], has_more: false, first_id: '3', last_id: '3' }),
    ]);
    await expect(http.getAll<number>('/v1/x')).resolves.toEqual([1, 2, 3]);
    expect(String(vi.mocked(fetchImpl).mock.calls[1]![0])).toContain('after_id=2');
  });

  it('keeps a caller-supplied after_id on the first page and then follows last_id', async () => {
    const { http, fetchImpl } = client([
      json({ data: [1], has_more: true, first_id: '1', last_id: '9' }),
      json({ data: [2], has_more: false, first_id: '2', last_id: '2' }),
    ]);
    await http.getAll<number>('/v1/x', { after_id: 'start' });
    const urls = vi.mocked(fetchImpl).mock.calls.map((c) => new URL(String(c[0])).searchParams);
    expect(urls[0]!.get('after_id')).toBe('start');
    expect(urls[1]!.get('after_id')).toBe('9');
  });

  it('sends array params as repeated key[] and follows next_page for buckets', async () => {
    const { http, fetchImpl } = client([
      json({ data: ['a'], has_more: true, next_page: 'page_2' }),
      json({ data: ['b'], has_more: false, next_page: null }),
    ]);
    await expect(
      http.getAllBuckets<string>('/v1/x', { group_by: ['workspace_id', 'model'] }),
    ).resolves.toEqual(['a', 'b']);
    const urls = vi.mocked(fetchImpl).mock.calls.map((c) => new URL(String(c[0])).searchParams);
    expect(urls[0]!.getAll('group_by[]')).toEqual(['workspace_id', 'model']);
    expect(urls[0]!.has('page')).toBe(false);
    expect(urls[1]!.get('page')).toBe('page_2');
  });
});
