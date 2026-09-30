/**
 * Compliance check types and audit rule definitions
 */

/** Severity levels for compliance findings */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Status of a compliance check */
export type CheckStatus = 'pass' | 'fail' | 'warning' | 'error' | 'skipped';

/** A single compliance rule definition */
export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  category: ComplianceCategory;
  severity: Severity;
  enabled: boolean;
  /** Function ID referencing the checker implementation */
  checker: string;
  /** Configurable thresholds and parameters */
  params: Record<string, unknown>;
}

/** Categories of compliance checks */
export type ComplianceCategory =
  | 'access-control'
  | 'api-key-management'
  | 'usage-anomaly'
  | 'data-governance'
  | 'configuration'
  | 'operational';

/** Result of running a single compliance check */
export interface ComplianceCheckResult {
  rule_id: string;
  rule_name: string;
  status: CheckStatus;
  severity: Severity;
  category: ComplianceCategory;
  message: string;
  details: Record<string, unknown>;
  evidence: ComplianceEvidence[];
  remediation: string | null;
  checked_at: string;
}

/** Evidence supporting a compliance finding */
export interface ComplianceEvidence {
  type: 'activity' | 'member' | 'api_key' | 'workspace' | 'usage' | 'config';
  id: string;
  description: string;
  data: Record<string, unknown>;
}

/** Full compliance report */
export interface ComplianceReport {
  report_id: string;
  generated_at: string;
  organization_id: string;
  summary: ComplianceSummary;
  results: ComplianceCheckResult[];
  snapshot_id: string;
  metadata: {
    rules_evaluated: number;
    duration_ms: number;
    collector_version: string;
  };
}

/** Summary statistics for a compliance report */
export interface ComplianceSummary {
  total_checks: number;
  passed: number;
  failed: number;
  warnings: number;
  errors: number;
  skipped: number;
  by_severity: Record<Severity, number>;
  by_category: Record<ComplianceCategory, number>;
  compliance_score: number; // 0-100
}
