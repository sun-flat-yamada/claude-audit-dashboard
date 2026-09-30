import type { ComplianceRulePlugin } from '@claude-audit/shared';
import { makeResult, num } from './helpers.js';

const meta = {
  spike: { id: 'UA-001', name: 'Usage Spike Detection', category: 'usage-anomaly', severity: 'high' },
  budget: { id: 'UA-002', name: 'Cost Budget Threshold', category: 'usage-anomaly', severity: 'critical' },
} as const;

export const usageSpike: ComplianceRulePlugin = {
  ...meta.spike,
  description: 'Detect unusual spikes in token usage compared to the 7-day average',
  /** `baselineTokens`: daily token totals of the previous 7 days, supplied by the runner. */
  defaultParams: { spikeMultiplier: 3.0, baselineTokens: [] },
  async check(snapshot, params) {
    const baseline = Array.isArray(params.baselineTokens)
      ? params.baselineTokens.filter((n): n is number => typeof n === 'number')
      : [];
    if (!snapshot.usage || baseline.length === 0) {
      return [makeResult(meta.spike, 'skipped', 'Not enough usage history')];
    }
    const multiplier = num(params, 'spikeMultiplier', 3);
    const avg = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    const current = snapshot.usage.total_input_tokens + snapshot.usage.total_output_tokens;
    if (avg > 0 && current > avg * multiplier) {
      return [
        makeResult(meta.spike, 'fail', `Token usage ${current} exceeds ${multiplier}x the 7-day average (${Math.round(avg)})`, {
          details: { current, average: avg, multiplier },
          remediation: 'Investigate the workspace or key driving the spike.',
        }),
      ];
    }
    return [makeResult(meta.spike, 'pass', 'Token usage within normal range')];
  },
};

export const costBudget: ComplianceRulePlugin = {
  ...meta.budget,
  description: 'Alert when monthly cost exceeds the configured budget threshold',
  defaultParams: { monthlyBudgetUsd: 10000 },
  async check(snapshot, params) {
    if (!snapshot.usage) return [makeResult(meta.budget, 'skipped', 'No usage data')];
    const budget = num(params, 'monthlyBudgetUsd', 10000);
    const cost = snapshot.usage.total_cost_usd;
    if (cost > budget) {
      return [
        makeResult(meta.budget, 'fail', `Cost $${cost.toFixed(2)} exceeds budget $${budget.toFixed(2)}`, {
          details: { cost, budget },
          remediation: 'Review usage by workspace and model, or raise the budget.',
        }),
      ];
    }
    return [makeResult(meta.budget, 'pass', `Cost $${cost.toFixed(2)} within budget`)];
  },
};

export const usageAnomalyRules = [usageSpike, costBudget];
