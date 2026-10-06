import type { DashboardKpi } from '../../contracts/dashboard-view.js';
import {
  COMPARE_POINT_LIMIT,
  COMPARE_SCHEMA_VERSION,
  TIME_POINT_SUMMARY_SCHEMA_VERSION,
  type CompareIndex,
  type TimePointSummary,
} from '../../contracts/time-point-summary.js';
import { assessedCount } from '../../domain/compliance/scoring.js';
import type { ComplianceReport } from '../../domain/compliance/types.js';
import type { Coverage } from '../../domain/model/dataset.js';

export interface TimePointInput {
  /** Snapshot id and collection time of the judged snapshot. */
  snapshot: { id: string; collectedAt: string; coverage: Coverage };
  report: ComplianceReport;
  /** The KPI figures of that snapshot (`buildDashboardKpis`). */
  kpis: readonly DashboardKpi[];
  /** Rule ids switched off by configuration when the report was evaluated. */
  disabledRules: readonly string[];
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The summary of one judged snapshot: statuses and counts only (no evidence, no message, no
 * identity). Pure: the same input always gives the same summary.
 */
export function buildTimePointSummary(input: TimePointInput): TimePointSummary {
  const { snapshot, report } = input;
  return {
    schemaVersion: TIME_POINT_SUMMARY_SCHEMA_VERSION,
    id: snapshot.id,
    collectedAt: snapshot.collectedAt,
    score: report.summary.score,
    assessed: assessedCount(report.summary),
    total: report.results.length,
    rules: report.results.map((r) => ({
      id: r.ruleId,
      name: r.ruleName,
      category: r.category,
      severity: r.severity,
      status: r.status,
    })),
    disabledRules: [...new Set(input.disabledRules)].sort(byCode),
    datasets: Object.entries(snapshot.coverage)
      .map(([name, meta]) => ({ name, status: meta.status, count: meta.count ?? null }))
      .sort((a, b) => byCode(a.name, b.name)),
    kpis: input.kpis.map((k) => ({ id: k.id, label: k.label, unit: k.unit, value: k.value })),
  };
}

/**
 * The selectable points, newest first, at most `limit` (default 90). A stored summary makes a
 * point `summary` (also when its snapshot was archived: the summary outlives the snapshot).
 * `archivedIds` are the snapshot ids known from the archive inventory; those without a summary
 * are listed as `archived` (no per-point file, score unknown) so the UI can explain how to
 * restore them. Both kinds share the cap. Pure and deterministic: ids sort chronologically and
 * a repeated id is listed once, as `summary` when it has one.
 */
export function buildCompareIndex(
  summaries: readonly TimePointSummary[],
  now: Date,
  limit: number = COMPARE_POINT_LIMIT,
  archivedIds: readonly string[] = [],
): CompareIndex {
  const withSummary = new Set(summaries.map((s) => s.id));
  const points: CompareIndex['points'] = [
    ...summaries.map((s) => ({
      id: s.id,
      collectedAt: s.collectedAt,
      state: 'summary' as const,
      score: s.score,
      assessed: s.assessed,
    })),
    ...[...new Set(archivedIds)]
      .filter((id) => !withSummary.has(id))
      .map((id) => ({
        id,
        collectedAt: null,
        state: 'archived' as const,
        score: null,
        assessed: null,
      })),
  ];
  return {
    schemaVersion: COMPARE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    points: points.sort((a, b) => byCode(b.id, a.id)).slice(0, limit),
  };
}
