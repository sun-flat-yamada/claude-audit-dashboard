import {
  CATEGORIES,
  SEVERITIES,
  type Category,
  type CheckResult,
  type ComplianceSummary,
  type Severity,
} from './types.js';

export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 10,
  high: 5,
  medium: 3,
  low: 1,
  info: 0,
};

/** Higher is more severe. */
export const severityRank = (severity: Severity): number =>
  SEVERITIES.length - SEVERITIES.indexOf(severity);

/** Score = max(0, 100 − Σ weight of failed checks). Warnings and skips do not lower it. */
export const complianceScore = (results: readonly CheckResult[]): number =>
  Math.max(
    0,
    100 -
      results
        .filter((r) => r.status === 'fail')
        .reduce((sum, r) => sum + SEVERITY_WEIGHTS[r.severity], 0),
  );

type ScoreSummary = Pick<ComplianceSummary, 'score' | 'total' | 'skipped' | 'errors'>;

/** Rules that produced a verdict: not skipped for missing data and not errored. */
export const assessedCount = (summary: ScoreSummary): number =>
  summary.total - summary.skipped - summary.errors;

/**
 * `82/100`, or `95/100 (2 of 30 rules assessed)` when missing data or errors left rules
 * without a verdict. Every place that shows the score uses this, so a high score caused by
 * missing data never travels without its coverage.
 */
export function formatScore(summary: ScoreSummary): string {
  const assessed = assessedCount(summary);
  const score = `${summary.score}/100`;
  return assessed === summary.total
    ? score
    : `${score} (${assessed} of ${summary.total} rules assessed)`;
}

const countStatus = (results: readonly CheckResult[], status: CheckResult['status']): number =>
  results.filter((r) => r.status === status).length;

export function summarize(results: readonly CheckResult[]): ComplianceSummary {
  const failedBySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<
    Severity,
    number
  >;
  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, { total: 0, failed: 0 }]),
  ) as Record<Category, { total: number; failed: number }>;
  for (const r of results) {
    byCategory[r.category].total++;
    if (r.status !== 'fail') continue;
    byCategory[r.category].failed++;
    failedBySeverity[r.severity]++;
  }
  return {
    total: results.length,
    passed: countStatus(results, 'pass'),
    failed: countStatus(results, 'fail'),
    warnings: countStatus(results, 'warning'),
    skipped: countStatus(results, 'skipped'),
    errors: countStatus(results, 'error'),
    score: complianceScore(results),
    failedBySeverity,
    byCategory,
  };
}
