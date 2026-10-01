import { z } from 'zod';
import { missingRequirements, withDefaults } from '../model/dataset.js';
import type { AuditSnapshot } from '../model/snapshot.js';
import { errorMessage } from '../util/mask.js';
import type { Rule, RuleInput } from './define-rule.js';
import { summarize } from './scoring.js';
import {
  COMPLIANCE_REPORT_SCHEMA_VERSION,
  type CheckResult,
  type ComplianceReport,
  type Outcome,
} from './types.js';

export interface EvaluateOptions {
  now: Date;
  /** Per-rule parameter overrides keyed by rule id; validated by each rule's schema. */
  params?: Readonly<Record<string, unknown>> | undefined;
  /** Rule ids to leave out of the report. */
  disabled?: readonly string[] | undefined;
}

const toResult = (rule: Rule, outcome: Outcome | CheckErrorOutcome): CheckResult => ({
  ruleId: rule.meta.id,
  ruleName: rule.meta.name,
  category: rule.meta.category,
  severity: rule.meta.severity,
  status: outcome.status,
  message: outcome.message,
  evidence: 'evidence' in outcome ? (outcome.evidence ?? []) : [],
  details: 'details' in outcome ? (outcome.details ?? {}) : {},
  remediation:
    outcome.status === 'fail' || outcome.status === 'warning' ? rule.meta.remediation : null,
});

interface CheckErrorOutcome {
  status: 'error';
  message: string;
}

type BaseInput = Omit<RuleInput<unknown>, 'params'>;

/** Runs one rule in isolation: requirements, parameter validation, then evaluation. */
function runRule(rule: Rule, base: BaseInput, rawParams: unknown): CheckResult {
  const missing = missingRequirements(rule.requires, base.coverage);
  if (missing) return toResult(rule, { status: 'skipped', message: missing });
  const parsed = rule.params.safeParse(rawParams ?? {});
  if (!parsed.success) {
    return toResult(rule, {
      status: 'error',
      message: `Invalid params: ${z.prettifyError(parsed.error)}`,
    });
  }
  try {
    return toResult(rule, rule.evaluate({ ...base, params: parsed.data }));
  } catch (error) {
    return toResult(rule, { status: 'error', message: `Rule failed: ${errorMessage(error)}` });
  }
}

export function evaluateCompliance(
  rules: readonly Rule[],
  snapshot: AuditSnapshot,
  options: EvaluateOptions,
): ComplianceReport {
  const base: BaseInput = {
    data: withDefaults(snapshot.data),
    coverage: snapshot.coverage,
    snapshot: { id: snapshot.id, collectedAt: snapshot.collectedAt },
    now: options.now,
  };
  const results = rules
    .filter((rule) => !options.disabled?.includes(rule.meta.id))
    .map((rule) => runRule(rule, base, options.params?.[rule.meta.id]));
  return {
    schemaVersion: COMPLIANCE_REPORT_SCHEMA_VERSION,
    id: `compliance-${snapshot.id}`,
    snapshotId: snapshot.id,
    generatedAt: options.now.toISOString(),
    summary: summarize(results),
    results,
  };
}
