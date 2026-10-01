import { z } from 'zod';
import { totalTokens } from '../../model/metrics.js';
import { groupBy, sumBy, totalsBy } from '../../util/collections.js';
import { formatCount, mean, percent, round } from '../../util/numbers.js';
import {
  DAY_MS,
  daysInMonth,
  earlierOf,
  monthKey,
  monthRange,
  toIsoDate,
} from '../../util/time.js';
import { defineRule } from '../define-rule.js';
import { fail, failIfAny, pass, skip, warn } from '../types.js';

/** First `YYYY-MM-DD` whose buckets may still be incomplete (analytics `data_refreshed_at`). */
export const incompleteFrom = (asOf: string | undefined, now: Date): string =>
  toIsoDate(asOf ? earlierOf(new Date(asOf), now) : now);

export const usageSpike = defineRule({
  meta: {
    id: 'UA-001',
    name: 'Usage Spike Detection',
    category: 'usage-anomaly',
    severity: 'high',
    description: 'Latest complete day of token usage compared with the trailing daily average',
    remediation: 'Break the day down by product, model and group and confirm it is expected.',
  },
  requires: ['usage'],
  params: z.object({
    spikeMultiplier: z.number().positive().default(3),
    baselineDays: z.number().int().positive().default(7),
    minBaselineTokens: z.number().nonnegative().default(1000),
  }),
  evaluate({ data, coverage, params, now }) {
    const limit = incompleteFrom(coverage.usage?.asOf, now);
    const complete = data.usage.filter((r) => r.dimension === 'total' && r.date < limit);
    const days = [...totalsBy(complete, (r) => r.date, totalTokens)].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    if (days.length < params.baselineDays + 1) {
      return skip(`Need ${params.baselineDays + 1} complete days of usage, have ${days.length}`);
    }
    const [day, latest] = days[days.length - 1] as [string, number];
    const average = mean(days.slice(-params.baselineDays - 1, -1).map(([, tokens]) => tokens));
    const details = {
      day,
      latest,
      average: Math.round(average),
      multiplier: params.spikeMultiplier,
    };
    if (average < params.minBaselineTokens) {
      return pass('Baseline usage too low to detect spikes', { details });
    }
    if (latest <= average * params.spikeMultiplier) {
      return pass(`${day}: usage within ${params.spikeMultiplier}x the trailing average`, {
        details,
      });
    }
    return fail(
      `${day}: ${formatCount(latest)} tokens exceed ${params.spikeMultiplier}x the ${params.baselineDays}-day average (${formatCount(details.average)})`,
      { details },
    );
  },
});

export const costBudget = defineRule({
  meta: {
    id: 'UA-002',
    name: 'Cost Budget Threshold',
    category: 'usage-anomaly',
    severity: 'critical',
    description: 'Month-to-date cost against the monthly budget, with an end-of-month forecast',
    remediation: 'Review spend by product, model and group, set spend limits or adjust the budget.',
  },
  requires: ['cost'],
  params: z.object({
    monthlyBudget: z.number().positive().default(10000),
    currency: z.string().default('USD'),
  }),
  evaluate({ data, params, now }) {
    const month = monthKey(now);
    const rows = data.cost.filter(
      (r) => r.dimension === 'total' && r.currency === params.currency && r.date.startsWith(month),
    );
    const spent = round(sumBy(rows, (r) => r.amount));
    const elapsed = Math.max((now.getTime() - monthRange(month).start.getTime()) / DAY_MS, 1);
    const forecast = round((spent / elapsed) * daysInMonth(now));
    const details = {
      month,
      spent,
      forecast,
      budget: params.monthlyBudget,
      currency: params.currency,
    };
    const money = (value: number) => `${params.currency} ${value.toFixed(2)}`;
    if (spent > params.monthlyBudget) {
      return fail(
        `Month-to-date cost ${money(spent)} exceeds the budget ${money(params.monthlyBudget)}`,
        {
          details,
        },
      );
    }
    if (forecast > params.monthlyBudget) {
      return warn(`Forecast ${money(forecast)} exceeds the budget ${money(params.monthlyBudget)}`, {
        details,
      });
    }
    return pass(`Month-to-date cost ${money(spent)} within the budget`, { details });
  },
});

export const unlimitedSpend = defineRule({
  meta: {
    id: 'UA-003',
    name: 'Members Without Spend Limit',
    category: 'usage-anomaly',
    severity: 'medium',
    description: 'Members whose effective spend limit is unlimited in every period',
    remediation: 'Set an organization, seat-tier or group default spend limit in claude.ai.',
  },
  requires: ['spendLimits'],
  params: z.object({}),
  evaluate({ data }) {
    if (data.spendLimits.length === 0) {
      return skip('No spend limit rows (usage credits may be disabled)');
    }
    const unlimited = [...groupBy(data.spendLimits, (r) => r.userId)]
      .filter(([, rows]) => rows.every((r) => r.limit === null))
      .map(([userId, rows]) => ({ userId, email: rows[0]?.email ?? null }));
    return failIfAny(
      unlimited,
      { pass: 'Every member has a spend limit', fail: (n) => `${n} member(s) have no spend limit` },
      (u) => ({ kind: 'member', id: u.userId, label: u.email ?? u.userId }),
    );
  },
});

export const spendNearLimit = defineRule({
  meta: {
    id: 'UA-004',
    name: 'Spend Limit Nearly Exhausted',
    category: 'usage-anomaly',
    severity: 'low',
    description: 'Members whose period-to-date spend reached the threshold share of their limit',
    remediation:
      'Confirm the usage is expected before members are blocked; review increase requests.',
  },
  requires: ['spendLimits'],
  params: z.object({ thresholdPercent: z.number().min(1).max(100).default(90) }),
  evaluate({ data, params }) {
    const near = data.spendLimits.filter(
      (r) =>
        r.limit !== null && r.limit > 0 && percent(r.spent, r.limit) >= params.thresholdPercent,
    );
    if (near.length === 0) return pass(`No member at ${params.thresholdPercent}% of their limit`);
    return warn(`${near.length} member(s) at or above ${params.thresholdPercent}% of their limit`, {
      evidence: near.map((r) => ({
        kind: 'member',
        id: r.userId,
        label: `${r.email ?? r.userId}: ${percent(r.spent, r.limit ?? 0)}% of the ${r.period} limit`,
      })),
    });
  },
});

export const usageRules = [usageSpike, costBudget, unlimitedSpend, spendNearLimit];
