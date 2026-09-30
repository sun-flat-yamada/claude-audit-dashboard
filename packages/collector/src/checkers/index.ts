import {
  SEVERITY_WEIGHTS,
  nowISO,
  type AuditSnapshot,
  type ComplianceCategory,
  type ComplianceCheckResult,
  type ComplianceReport,
  type ComplianceRulePlugin,
  type Severity,
} from '@claude-audit/shared';
import { PluginRegistry } from '../plugins/registry.js';
import { accessControlRules } from './access-control.js';
import { apiKeyManagementRules } from './api-key-management.js';
import { dataGovernanceRules } from './data-governance.js';
import { operationalRules } from './operational.js';
import { usageAnomalyRules } from './usage-anomaly.js';
import { makeResult } from './helpers.js';

export function createBuiltinRegistry(): PluginRegistry<ComplianceRulePlugin> {
  const registry = new PluginRegistry<ComplianceRulePlugin>();
  for (const rule of [
    ...accessControlRules,
    ...apiKeyManagementRules,
    ...usageAnomalyRules,
    ...dataGovernanceRules,
    ...operationalRules,
  ]) {
    registry.register(rule);
  }
  return registry;
}

/** Score = max(0, 100 - Σ severity weight of failed checks). */
export function calculateScore(results: ComplianceCheckResult[]): number {
  const penalty = results
    .filter((r) => r.status === 'fail')
    .reduce((sum, r) => sum + SEVERITY_WEIGHTS[r.severity], 0);
  return Math.max(0, 100 - penalty);
}

export interface RunOptions {
  /** Per-rule parameter overrides, keyed by rule id. */
  params?: Record<string, Record<string, unknown>>;
  /** Rule ids to skip. */
  disabled?: string[];
}

export async function runComplianceChecks(
  snapshot: AuditSnapshot,
  registry: PluginRegistry<ComplianceRulePlugin> = createBuiltinRegistry(),
  options: RunOptions = {},
): Promise<ComplianceReport> {
  const started = Date.now();
  const results: ComplianceCheckResult[] = [];
  const rules = registry.list().filter((r) => !options.disabled?.includes(r.id));

  for (const rule of rules) {
    try {
      results.push(
        ...(await rule.check(snapshot, { ...rule.defaultParams, ...options.params?.[rule.id] })),
      );
    } catch (err) {
      results.push(makeResult(rule, 'error', `Rule failed: ${(err as Error).message}`));
    }
  }

  const count = (status: ComplianceCheckResult['status']) =>
    results.filter((r) => r.status === status).length;
  const by_severity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const by_category = {
    'access-control': 0,
    'api-key-management': 0,
    'usage-anomaly': 0,
    'data-governance': 0,
    configuration: 0,
    operational: 0,
  } satisfies Record<ComplianceCategory, number>;
  for (const r of results.filter((x) => x.status === 'fail')) {
    by_severity[r.severity]++;
    by_category[r.category]++;
  }

  return {
    report_id: `report-${snapshot.collection_id}`,
    generated_at: nowISO(),
    organization_id: snapshot.organization_id,
    summary: {
      total_checks: results.length,
      passed: count('pass'),
      failed: count('fail'),
      warnings: count('warning'),
      errors: count('error'),
      skipped: count('skipped'),
      by_severity,
      by_category,
      compliance_score: calculateScore(results),
    },
    results,
    snapshot_id: snapshot.collection_id,
    metadata: {
      rules_evaluated: rules.length,
      duration_ms: Date.now() - started,
      collector_version: snapshot.metadata.collector_version,
    },
  };
}
