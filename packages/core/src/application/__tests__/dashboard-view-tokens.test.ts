import { describe, expect, it } from 'vitest';
import { NOW, costRow, dayString, snapshot, usageRow } from '../../__tests__/fixtures.js';
import { dashboardViewSchema, type DashboardView } from '../../contracts/dashboard-view.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import { buildDashboardView } from '../presenters/dashboard-view.js';

const view = (snap: AuditSnapshot): DashboardView =>
  buildDashboardView({
    now: NOW,
    title: 'Audit',
    source: 'demo',
    maskPii: true,
    snapshot: snap,
    report: null,
    history: [],
    insights: [],
  });

describe('dashboard view token breakdown (AN-1)', () => {
  const snap = snapshot({
    usage: [
      usageRow(dayString(2), 1000, {
        cacheReadInputTokens: 6000,
        cacheCreationInputTokens: 500,
        outputTokens: 300,
      }),
      usageRow(dayString(1), 2000, { cacheReadInputTokens: 500, outputTokens: 100 }),
      usageRow(dayString(1), 9999, { dimension: 'model', key: 'claude-opus-5' }),
    ],
  });

  it('splits daily input into uncached, cache read and cache write that sum to inputTokens', () => {
    const daily = view(snap).usage?.daily ?? [];
    expect(daily).toHaveLength(2);
    expect(daily[0]).toMatchObject({
      inputTokens: 7500,
      uncachedInputTokens: 1000,
      cacheReadInputTokens: 6000,
      cacheCreationInputTokens: 500,
      outputTokens: 300,
    });
    for (const d of daily) {
      expect(
        (d.uncachedInputTokens ?? 0) +
          (d.cacheReadInputTokens ?? 0) +
          (d.cacheCreationInputTokens ?? 0),
      ).toBe(d.inputTokens);
    }
  });

  it('reports the period cache hit rate as cache reads over all input', () => {
    // (6000 + 500) / (7500 + 2500) = 65%
    expect(view(snap).usage?.cacheHitRate).toBe(65);
  });

  it('reports a null hit rate when no input tokens were recorded', () => {
    const costOnly = snapshot({ cost: [costRow(dayString(1), 10)], usage: [] });
    expect(view(costOnly).usage?.cacheHitRate).toBeNull();
    const zero = snapshot({ usage: [usageRow(dayString(1), 0, { outputTokens: 0 })] });
    expect(view(zero).usage?.cacheHitRate).toBeNull();
  });

  it('accepts a dashboard.json written before the breakdown existed', () => {
    const current = view(snap);
    if (!current.usage) throw new Error('usage expected');
    const legacyUsage = { ...current.usage };
    delete legacyUsage.cacheHitRate;
    const legacy = {
      ...current,
      usage: {
        ...legacyUsage,
        daily: legacyUsage.daily.map(({ date, cost, inputTokens, outputTokens }) => ({
          date,
          cost,
          inputTokens,
          outputTokens,
        })),
      },
    };
    const parsed = dashboardViewSchema.parse(JSON.parse(JSON.stringify(legacy)));
    expect(parsed.usage?.cacheHitRate).toBeUndefined();
    expect(parsed.usage?.daily[0]?.uncachedInputTokens).toBeUndefined();
    expect(dashboardViewSchema.parse(current)).toEqual(current);
  });
});
