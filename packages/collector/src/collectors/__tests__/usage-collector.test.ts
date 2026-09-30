import { describe, expect, it } from 'vitest';
import type { Workspace } from '@claude-audit/shared';
import type { Bucket, CostResult, UsageResult } from '../../api/usage.js';
import { buildUsageReport, centsToUsd, collectUsage, monthToDate } from '../usage-collector.js';

const usage = (over: Partial<UsageResult>): UsageResult => ({
  workspace_id: 'wrkspc_1',
  model: 'model-a',
  uncached_input_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
  output_tokens: 0,
  ...over,
});
const cost = (over: Partial<CostResult>): CostResult => ({
  workspace_id: 'wrkspc_1',
  model: 'model-a',
  amount: '0',
  currency: 'USD',
  ...over,
});
const bucket = <R>(results: R[]): Bucket<R> => ({
  starting_at: '2026-09-01T00:00:00Z',
  ending_at: '2026-09-02T00:00:00Z',
  results,
});
const workspaces: Workspace[] = [
  { id: 'wrkspc_1', name: 'Eng', created_at: '', archived_at: null, member_count: 0 },
];
const period = { startingAt: '2026-09-01T00:00:00.000Z', endingAt: '2026-09-30T00:00:00.000Z' };

describe('usage helpers', () => {
  it('converts cents strings to USD', () => {
    expect(centsToUsd('123.45')).toBeCloseTo(1.2345);
    expect(centsToUsd('not-a-number')).toBe(0);
  });

  it('computes the UTC month-to-date window', () => {
    expect(monthToDate(new Date('2026-09-30T12:34:56Z'))).toEqual({
      startingAt: '2026-09-01T00:00:00.000Z',
      endingAt: '2026-09-30T12:34:56.000Z',
    });
  });
});

describe('buildUsageReport', () => {
  it('sums tokens (incl. cache) and cost per workspace and model; null workspace is the default', () => {
    const report = buildUsageReport(
      [
        bucket([
          usage({
            uncached_input_tokens: 100,
            cache_read_input_tokens: 50,
            output_tokens: 10,
            cache_creation: { ephemeral_1h_input_tokens: 5, ephemeral_5m_input_tokens: 15 },
          }),
          usage({
            workspace_id: null,
            model: 'model-b',
            uncached_input_tokens: 1,
            output_tokens: 2,
          }),
        ]),
        bucket([usage({ uncached_input_tokens: 10, output_tokens: 5 })]),
      ],
      [
        bucket([
          cost({ amount: '250' }),
          cost({ workspace_id: null, model: 'model-b', amount: '50' }),
          cost({ model: null, amount: '100' }), // e.g. web search: no model
          cost({ amount: '999', currency: 'EUR' }), // ignored
        ]),
      ],
      workspaces,
      period,
    );

    expect(report.total_input_tokens).toBe(100 + 50 + 5 + 15 + 1 + 10);
    expect(report.total_output_tokens).toBe(17);
    expect(report.total_cost_usd).toBeCloseTo(4); // (250 + 50 + 100) cents
    expect(report.by_workspace).toEqual([
      {
        workspace_id: 'wrkspc_1',
        workspace_name: 'Eng',
        input_tokens: 180,
        output_tokens: 15,
        cost_usd: 3.5,
      },
      {
        workspace_id: 'default',
        workspace_name: 'Default',
        input_tokens: 1,
        output_tokens: 2,
        cost_usd: 0.5,
      },
    ]);
    expect(report.by_model.find((m) => m.model === 'model-a')).toMatchObject({ cost_usd: 2.5 });
    expect(report.by_model.find((m) => m.model === 'model-b')).toMatchObject({ cost_usd: 0.5 });
    expect(report.period_start).toBe(period.startingAt);
  });

  it('is empty-safe', () => {
    expect(buildUsageReport([], [], [], period)).toMatchObject({
      total_cost_usd: 0,
      by_workspace: [],
      by_model: [],
    });
  });
});

describe('collectUsage', () => {
  it('queries both endpoints for the month-to-date window', async () => {
    const seen: string[] = [];
    const report = await collectUsage(
      {
        listUsage: async (q) => (seen.push(`u:${q.startingAt}`), []),
        listCost: async (q) => (seen.push(`c:${q.startingAt}`), []),
      },
      workspaces,
      new Date('2026-09-30T00:00:00Z'),
    );
    expect(seen.sort()).toEqual(['c:2026-09-01T00:00:00.000Z', 'u:2026-09-01T00:00:00.000Z']);
    expect(report.period_end).toBe('2026-09-30T00:00:00.000Z');
  });
});
