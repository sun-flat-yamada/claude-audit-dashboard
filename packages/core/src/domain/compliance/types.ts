export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = [
  'access-control',
  'api-key-management',
  'usage-anomaly',
  'data-governance',
  'configuration',
  'activity-monitoring',
  'operational',
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * - `pass` / `fail`: evaluated
 * - `warning`: needs review, does not lower the score (e.g. activity watches, forecasts)
 * - `skipped`: required data missing or not applicable — never silently a pass
 * - `error`: the rule threw or its parameters were invalid
 */
export type CheckStatus = 'pass' | 'fail' | 'warning' | 'skipped' | 'error';

export interface RuleMeta {
  id: string;
  name: string;
  category: Category;
  severity: Severity;
  description: string;
  remediation: string;
}

export interface Evidence {
  kind: string;
  id: string;
  label: string;
  data?: Record<string, unknown> | undefined;
}

export interface Outcome {
  status: Exclude<CheckStatus, 'error'>;
  message: string;
  evidence?: Evidence[] | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface CheckResult {
  ruleId: string;
  ruleName: string;
  category: Category;
  severity: Severity;
  status: CheckStatus;
  message: string;
  evidence: Evidence[];
  details: Record<string, unknown>;
  remediation: string | null;
}

export interface ComplianceSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
  errors: number;
  score: number;
  failedBySeverity: Record<Severity, number>;
  byCategory: Record<Category, { total: number; failed: number }>;
}

export const COMPLIANCE_REPORT_SCHEMA_VERSION = 2;

export interface ComplianceReport {
  schemaVersion: typeof COMPLIANCE_REPORT_SCHEMA_VERSION;
  id: string;
  snapshotId: string;
  generatedAt: string;
  summary: ComplianceSummary;
  results: CheckResult[];
}

type Extra = Pick<Outcome, 'evidence' | 'details'>;

export const pass = (message: string, extra: Extra = {}): Outcome => ({
  status: 'pass',
  message,
  ...extra,
});
export const fail = (message: string, extra: Extra = {}): Outcome => ({
  status: 'fail',
  message,
  ...extra,
});
export const warn = (message: string, extra: Extra = {}): Outcome => ({
  status: 'warning',
  message,
  ...extra,
});
export const skip = (message: string): Outcome => ({ status: 'skipped', message });

/** Pass when `items` is empty, otherwise fail with one evidence entry per item. */
export function failIfAny<T>(
  items: readonly T[],
  messages: { pass: string; fail: (count: number) => string },
  evidence: (item: T) => Evidence,
): Outcome {
  if (items.length === 0) return pass(messages.pass);
  return fail(messages.fail(items.length), { evidence: items.map(evidence) });
}
