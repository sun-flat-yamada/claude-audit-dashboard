import {
  nowISO,
  type CheckStatus,
  type ComplianceCategory,
  type ComplianceCheckResult,
  type ComplianceEvidence,
  type ComplianceRulePlugin,
  type Severity,
} from '@claude-audit/shared';

type RuleMeta = Pick<ComplianceRulePlugin, 'id' | 'name' | 'category' | 'severity'>;

export function makeResult(
  rule: RuleMeta,
  status: CheckStatus,
  message: string,
  extra: {
    evidence?: ComplianceEvidence[];
    details?: Record<string, unknown>;
    remediation?: string;
  } = {},
): ComplianceCheckResult {
  return {
    rule_id: rule.id,
    rule_name: rule.name,
    status,
    severity: rule.severity as Severity,
    category: rule.category as ComplianceCategory,
    message,
    details: extra.details ?? {},
    evidence: extra.evidence ?? [],
    remediation: extra.remediation ?? null,
    checked_at: nowISO(),
  };
}

export function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

const DAY_MS = 86_400_000;

/** Whole days between an ISO timestamp and `now` (injectable for tests via params.now). */
export function ageDays(iso: string, params: Record<string, unknown>): number {
  const now = typeof params.now === 'string' ? Date.parse(params.now) : Date.now();
  return Math.floor((now - Date.parse(iso)) / DAY_MS);
}
