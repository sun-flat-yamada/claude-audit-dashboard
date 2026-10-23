import { describe, expect, it } from 'vitest';
import { MOCK_KEY } from '../../../__tests__/fake-anthropic.js';
import { HttpClient } from '../http-client.js';
import {
  MEMBER_DAILY_PATH,
  MemberDailyActivityApi,
  dailyActivityDays,
  latestPublishedDay,
} from '../member-daily-api.js';

/** Synthetic users rows in the official single-day shape (example.com only). */
const row = (id: string, messages: number, date: string | null) => ({
  user: { type: 'user', id, email_address: `${id}@example.com` },
  ...(date ? { last_activity_date: date } : {}),
  chat_metrics: { message_count: messages, distinct_conversation_count: messages > 0 ? 1 : 0 },
  web_search_count: 0,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const error = (status: number, type: string, message: string) =>
  json({ type: 'error', error: { type, message } }, status);

type Route = (url: URL, call: number) => Response;

function api(route: Route) {
  const calls: URL[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    return route(url, calls.length);
  }) as typeof fetch;
  const http = new HttpClient({ apiKey: MOCK_KEY, fetchImpl, sleep: async () => {} });
  return { daily: new MemberDailyActivityApi(http), calls };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('daily availability', () => {
  it('publishes a day from 13:30 UTC on the next day', () => {
    expect(iso(latestPublishedDay(new Date('2026-09-30T13:29:59Z')))).toBe('2026-09-28');
    expect(iso(latestPublishedDay(new Date('2026-09-30T13:30:00Z')))).toBe('2026-09-29');
  });

  it('lists the last published days oldest first, never before 2026-01-01', () => {
    expect(dailyActivityDays(3, new Date('2026-09-30T14:00:00Z')).map(iso)).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
    ]);
    expect(dailyActivityDays(5, new Date('2026-01-03T15:00:00Z')).map(iso)).toEqual([
      '2026-01-01',
      '2026-01-02',
    ]);
    expect(dailyActivityDays(3, new Date('2026-01-01T15:00:00Z'))).toEqual([]);
  });
});

describe('MemberDailyActivityApi', () => {
  const NOW = new Date('2026-09-30T14:00:00Z');

  it('requests one date=<day> series per day and follows next_page within each day', async () => {
    const { daily, calls } = api((url) => {
      const date = url.searchParams.get('date') ?? '';
      if (date === '2026-09-29' && !url.searchParams.has('page'))
        return json({ data: [row('user_a', 3, date)], next_page: 'page_2' });
      if (date === '2026-09-29') return json({ data: [row('user_b', 0, null)], next_page: null });
      return json({ data: [row('user_a', 1, date)], next_page: null });
    });
    const result = await daily.listDailyActivity(2, NOW);
    expect(calls.map((u) => u.pathname)).toEqual(Array(3).fill(MEMBER_DAILY_PATH));
    expect(calls.map((u) => [u.searchParams.get('date'), u.searchParams.get('page')])).toEqual([
      ['2026-09-28', null],
      ['2026-09-29', null],
      ['2026-09-29', 'page_2'],
    ]);
    for (const url of calls) {
      expect(url.searchParams.get('limit')).toBe('1000');
      expect(url.searchParams.has('starting_date')).toBe(false);
    }
    expect(result.items).toEqual([
      {
        date: '2026-09-28',
        userId: 'user_a',
        email: 'user_a@example.com',
        active: true,
        lastActiveOn: '2026-09-28',
        engagement: expect.objectContaining({ chat: expect.objectContaining({ messages: 1 }) }),
      },
      expect.objectContaining({ date: '2026-09-29', userId: 'user_a', active: true }),
      expect.objectContaining({
        date: '2026-09-29',
        userId: 'user_b',
        active: false,
        lastActiveOn: null,
      }),
    ]);
    expect(result.window).toEqual({
      from: '2026-09-28T00:00:00.000Z',
      to: '2026-09-30T00:00:00.000Z',
    });
  });

  it('restarts a day from its first page when the cursor expires (410)', async () => {
    let expired = false;
    const { daily, calls } = api((url) => {
      const page = url.searchParams.get('page');
      if (page === 'page_2' && !expired) {
        expired = true;
        return error(410, 'gone_error', 'Cursor expired after a data refresh');
      }
      if (page === 'page_2')
        return json({ data: [row('user_b', 2, '2026-09-29')], next_page: null });
      return json({ data: [row('user_a', 1, '2026-09-29')], next_page: 'page_2' });
    });
    const result = await daily.listDailyActivity(1, NOW);
    expect(calls.map((u) => u.searchParams.get('page'))).toEqual([null, 'page_2', null, 'page_2']);
    // The restarted walk replaces the partial one: no duplicate rows.
    expect(result.items.map((r) => r.userId)).toEqual(['user_a', 'user_b']);
  });

  it('drops the newest day while it is not published yet (HTTP 400) and keeps the others', async () => {
    const { daily } = api((url) =>
      url.searchParams.get('date') === '2026-09-29'
        ? error(400, 'invalid_request_error', 'date is too recent; latest available is 2026-09-28')
        : json({ data: [row('user_a', 1, url.searchParams.get('date'))], next_page: null }),
    );
    const result = await daily.listDailyActivity(2, NOW);
    expect(result.items.map((r) => r.date)).toEqual(['2026-09-28']);
    expect(result.window?.to).toBe('2026-09-29T00:00:00.000Z');
  });

  it('fails on an error for an older day, so the run records an error instead of a gap', async () => {
    const { daily } = api((url) =>
      url.searchParams.get('date') === '2026-09-28'
        ? error(400, 'invalid_request_error', 'bad request')
        : json({ data: [], next_page: null }),
    );
    await expect(daily.listDailyActivity(2, NOW)).rejects.toThrow(/400 invalid_request_error/);
  });

  it('skips grouped rows without a user', async () => {
    const { daily } = api(() =>
      json({ data: [{ rbac_group_id: 'rbac_group_a', distinct_user_count: 4 }], next_page: null }),
    );
    expect((await daily.listDailyActivity(1, NOW)).items).toEqual([]);
  });
});

describe('HttpClient pacing', () => {
  it('spaces request starts by minIntervalMs, also for concurrent callers', async () => {
    let clock = 10_000;
    const waits: number[] = [];
    const http = new HttpClient({
      apiKey: MOCK_KEY,
      fetchImpl: (async () => json({ data: [] })) as typeof fetch,
      minIntervalMs: 1500,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await http.getJson('/a');
    await Promise.all([http.getJson('/b'), http.getJson('/c')]);
    expect(waits).toEqual([1500, 3000]);
    clock += 10_000;
    await http.getJson('/d');
    expect(waits).toEqual([1500, 3000]);
  });

  it('does not pace without minIntervalMs', async () => {
    const waits: number[] = [];
    const http = new HttpClient({
      apiKey: MOCK_KEY,
      fetchImpl: (async () => json({})) as typeof fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await Promise.all([http.getJson('/a'), http.getJson('/b')]);
    expect(waits).toEqual([]);
  });
});
