import type { ComplianceRulePlugin } from '@claude-audit/shared';
import { makeResult, num } from './helpers.js';

const meta = {
  id: 'OP-001',
  name: 'Collection Freshness',
  category: 'operational',
  severity: 'high',
} as const;

export const collectionFreshness: ComplianceRulePlugin = {
  ...meta,
  description: 'Warn if audit data has not been collected in the last 24 hours',
  defaultParams: { maxStaleHours: 24 },
  async check(snapshot, params) {
    const maxHours = num(params, 'maxStaleHours', 24);
    const now = typeof params.now === 'string' ? Date.parse(params.now) : Date.now();
    const staleHours = (now - Date.parse(snapshot.collected_at)) / 3_600_000;
    if (staleHours > maxHours) {
      return [
        makeResult(
          meta,
          'fail',
          `Last collection ${staleHours.toFixed(1)}h ago (max ${maxHours}h)`,
          {
            remediation: 'Check the collect-audit workflow for failures.',
          },
        ),
      ];
    }
    return [makeResult(meta, 'pass', 'Audit data is fresh')];
  },
};

export const operationalRules = [collectionFreshness];
