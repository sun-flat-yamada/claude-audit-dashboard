import { DataUnavailableError } from '@claude-audit/core';
import { describe, expect, it } from 'vitest';
import { MOCK_KEY, backfillTenant } from '../../../__tests__/backfill-tenant.js';
import { AnalyticsApi, endingDate } from '../analytics-api.js';
import { createBackfillSources, type BackfillApis } from '../backfill-sources.js';
import { ComplianceApi } from '../compliance-api.js';
import { FeatureUsageApi } from '../feature-usage-api.js';
import { HttpClient } from '../http-client.js';
import { MemberDailyActivityApi, publishedDaysIn } from '../member-daily-api.js';

const NOW = new Date('2026-10-23T15:00:00.000Z');
const SEPTEMBER = {
  start: new Date('2026-09-01T00:00:00.000Z'),
  end: new Date('2026-10-01T00:00:00.000Z'),
};
const OCTOBER = { start: new Date('2026-10-01T00:00:00.000Z'), end: NOW };

function sources(apis: Partial<BackfillApis> | null = null) {
  const tenant = backfillTenant(NOW);
  const http = new HttpClient({ apiKey: MOCK_KEY, fetchImpl: tenant.fetch, sleep: async () => {} });
  const all: BackfillApis = apis
    ? { analytics: null, featureUsage: null, memberActivityDaily: null, compliance: null, ...apis }
    : {
        analytics: new AnalyticsApi(http),
        featureUsage: new FeatureUsageApi(http),
        memberActivityDaily: new MemberDailyActivityApi(http),
        compliance: new ComplianceApi(http),
      };
  const registry = createBackfillSources(all, {
    activities: { pageSize: 5000, includeTypes: [], excludeTypes: [], lagMinutes: 2 },
  });
  return { registry, tenant };
}

describe('backfill request periods', () => {
  it('sends ending_date only for a period that ends before today', () => {
    expect(endingDate(SEPTEMBER.end, NOW)).toBe('2026-10-01');
    expect(endingDate(NOW, NOW)).toBeUndefined();
    expect(endingDate(new Date('2026-10-23T00:00:00.000Z'), NOW)).toBeUndefined();
  });

  it('lists the published days of a period, never before 2026-01-01', () => {
    const days = (range: { start: Date; end: Date }) =>
      publishedDaysIn(range, NOW).map((d) => d.toISOString().slice(0, 10));
    expect(days(SEPTEMBER)).toHaveLength(30);
    expect(days(OCTOBER).at(-1)).toBe('2026-10-22');
    expect(
      days({ start: new Date('2025-12-30T00:00:00Z'), end: new Date('2026-01-03T00:00:00Z') }),
    ).toEqual(['2026-01-01', '2026-01-02']);
  });

  it('asks each Analytics roll-up for exactly the month', async () => {
    const { registry, tenant } = sources();
    for (const dataset of ['adoption', 'memberActivity', 'skillUsage', 'chatProjectUsage'])
      await registry.require(dataset).fetch(SEPTEMBER, NOW);
    for (const call of tenant.calls) {
      expect(call.url.searchParams.get('starting_date'), call.url.pathname).toBe('2026-09-01');
      expect(call.url.searchParams.get('ending_date'), call.url.pathname).toBe('2026-10-01');
    }
    const rollup = await registry.require('memberActivity').fetch(SEPTEMBER, NOW);
    expect(rollup.window).toEqual({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    });
  });

  it('omits ending_date for the current month and skips a period that starts today', async () => {
    const { registry, tenant } = sources();
    await registry.require('pluginUsage').fetch(OCTOBER, NOW);
    expect(tenant.calls[0]?.url.searchParams.has('ending_date')).toBe(false);
    const today = { start: new Date('2026-10-23T00:00:00.000Z'), end: NOW };
    tenant.calls.length = 0;
    expect((await registry.require('adoption').fetch(today, NOW)).items).toEqual([]);
    expect(tenant.calls).toEqual([]);
  });

  it('windows the Activity Feed by created_at and ends it before the lag', async () => {
    const { registry, tenant } = sources();
    const result = await registry.require('activities').fetch(OCTOBER, NOW);
    const url = tenant.calls[0]?.url;
    expect(url?.searchParams.get('created_at.gte')).toBe('2026-10-01T00:00:00.000Z');
    expect(url?.searchParams.get('created_at.lt')).toBe('2026-10-23T14:58:00.000Z');
    expect(result.items).toHaveLength(23);
  });

  it('reports a missing key as unavailable', async () => {
    const { registry } = sources({});
    await expect(registry.require('usage').fetch(SEPTEMBER, NOW)).rejects.toBeInstanceOf(
      DataUnavailableError,
    );
    expect(registry.keys().sort()).toEqual(
      [
        'activities',
        'adoption',
        'chatProjectUsage',
        'connectorUsage',
        'cost',
        'memberActivity',
        'memberActivityDaily',
        'pluginUsage',
        'skillUsage',
        'usage',
      ].sort(),
    );
  });
});
