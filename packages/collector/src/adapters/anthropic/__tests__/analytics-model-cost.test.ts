import { breakdownGaps, usageTokens } from '@claude-audit/core';
import { describe, expect, it } from 'vitest';
import { MOCK_KEY } from '../../../__tests__/fake-anthropic.js';
import { AnalyticsApi } from '../analytics-api.js';
import { HttpClient } from '../http-client.js';

/**
 * Sanitized, synthetic daily buckets: the ungrouped total and the `group_by[]=model` rows of the
 * same day (two models plus usage without a model). Amounts are cents as decimal strings.
 */
const MODEL_ROWS = [
  { model: 'claude-model-a', amount: '30000.000000', output: 900 },
  { model: 'claude-model-b', amount: '11250.500000', output: 250 },
  { model: null, amount: '29.500000', output: 0 },
];

function bucket(day: string, groupBy: string[]) {
  const byModel = groupBy.includes('model');
  const rows = byModel ? MODEL_ROWS : [];
  const sum = (pick: (r: (typeof MODEL_ROWS)[number]) => number) =>
    MODEL_ROWS.reduce((s, r) => s + pick(r), 0);
  const result = (amount: number, output: number, model: string | null) => ({
    amount: amount.toFixed(6),
    currency: 'USD',
    uncached_input_tokens: 100,
    cache_read_input_tokens: 0,
    output_tokens: output,
    model,
  });
  return {
    starting_at: `${day}T00:00:00Z`,
    ending_at: `${day}T00:00:00Z`,
    results: byModel
      ? rows.map((r) => result(Number(r.amount), r.output, r.model))
      : [
          {
            ...result(
              sum((r) => Number(r.amount)),
              sum((r) => r.output),
              null,
            ),
            uncached_input_tokens: 100 * MODEL_ROWS.length,
          },
        ],
  };
}

function analytics() {
  const calls: URL[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    const groupBy = url.searchParams.getAll('group_by[]');
    const days = ['2026-09-28', '2026-09-29'].filter(
      (d) => Date.parse(`${d}T00:00:00Z`) >= Date.parse(url.searchParams.get('starting_at') ?? ''),
    );
    return new Response(
      JSON.stringify({
        data:
          groupBy.length > 1 || groupBy[0] === 'product' || groupBy[0] === 'rbac_group_id'
            ? []
            : days.map((d) => bucket(d, groupBy)),
        data_refreshed_at: '2026-09-30T06:00:00Z',
        has_more: false,
        next_page: null,
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  const http = new HttpClient({ apiKey: MOCK_KEY, fetchImpl, sleep: async () => {} });
  return { api: new AnalyticsApi(http), calls };
}

const NOW = new Date('2026-09-30T12:00:00.000Z');
const range = { start: new Date('2026-08-31T00:00:00.000Z'), end: NOW };

describe('model-only cost and usage (group_by[]=model alone)', () => {
  it('asks for the model series without a second dimension', async () => {
    const { api, calls } = analytics();
    await api.costReport(range, NOW);
    const groupings = calls.map((u) => u.searchParams.getAll('group_by[]').join(','));
    expect(groupings).toContain('model');
    expect(groupings.every((g) => !g.includes(','))).toBe(true);
  });

  it('the model rows of each day add up to the total row (cost and tokens)', async () => {
    const { api } = analytics();
    const cost = await api.costReport(range, NOW);
    const models = cost.items.filter((r) => r.dimension === 'model');
    expect(models.map((r) => [r.date, r.key])).toEqual([
      ['2026-09-28', 'claude-model-a'],
      ['2026-09-28', 'claude-model-b'],
      ['2026-09-28', null],
      ['2026-09-29', 'claude-model-a'],
      ['2026-09-29', 'claude-model-b'],
      ['2026-09-29', null],
    ]);
    expect(cost.items.find((r) => r.dimension === 'total')?.amount).toBe(412.8);
    expect(breakdownGaps(cost.items, 'model', (r) => r.amount, 0.005)).toEqual([]);
    const usage = await api.usageReport(range, NOW);
    expect(breakdownGaps(usage.items, 'model', usageTokens)).toEqual([]);
  });

  it('splits a range longer than 31 days into windows per dimension (HTTP 400 otherwise)', async () => {
    const { api, calls } = analytics();
    const long = { start: new Date('2026-07-01T00:00:00.000Z'), end: NOW };
    await api.costReport(long, NOW);
    const model = calls.filter((u) => u.searchParams.getAll('group_by[]').join() === 'model');
    expect(
      model.map((u) => [u.searchParams.get('starting_at'), u.searchParams.get('ending_at')]),
    ).toEqual([
      ['2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'],
      ['2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'],
      ['2026-09-01T00:00:00.000Z', '2026-09-30T12:00:00.000Z'],
    ]);
    for (const url of calls) {
      const span =
        Date.parse(url.searchParams.get('ending_at') ?? '') -
        Date.parse(url.searchParams.get('starting_at') ?? '');
      expect(span).toBeLessThanOrEqual(31 * 86_400_000);
    }
    expect(calls).toHaveLength(12);
  });
});
