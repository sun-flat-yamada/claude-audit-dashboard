import { describe, expect, it } from 'vitest';
import { replayFetch } from '../replay-fetch.js';

const COST = '/v1/organizations/analytics/cost_report';
const bucket = (day: string) => ({ starting_at: `${day}T00:00:00Z`, results: [{ amount: '1' }] });
const recording = {
  request: { method: 'GET', path: COST, query: { 'group_by[]': ['model'] } },
  response: {
    status: 200,
    body: { data: ['2026-09-26', '2026-09-29'].map(bucket), next_page: null },
  },
};
const days = async (query: string): Promise<string[]> => {
  const replay = replayFetch([recording]);
  const res = await replay.fetch(`https://api.anthropic.com${COST}?group_by[]=model&${query}`);
  const body = (await res.json()) as { data: { starting_at: string }[] };
  return body.data.map((b) => b.starting_at.slice(0, 10));
};

describe('replayFetch bucketed reports', () => {
  it('returns only the recorded buckets inside the requested range', async () => {
    expect(
      await days('starting_at=2026-08-02T00:00:00.000Z&ending_at=2026-09-02T00:00:00.000Z'),
    ).toEqual([]);
    expect(
      await days('starting_at=2026-09-02T00:00:00.000Z&ending_at=2026-09-30T12:00:00.000Z'),
    ).toEqual(['2026-09-26', '2026-09-29']);
    expect(
      await days('starting_at=2026-09-27T00:00:00.000Z&ending_at=2026-09-29T00:00:00.000Z'),
    ).toEqual([]);
  });

  it('keeps every bucket when the request names no range', async () => {
    expect(await days('limit=31')).toEqual(['2026-09-26', '2026-09-29']);
  });
});
