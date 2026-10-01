import type { Rule } from '../../domain/compliance/define-rule.js';
import { evaluateCompliance, type EvaluateOptions } from '../../domain/compliance/engine.js';
import type { ComplianceReport } from '../../domain/compliance/types.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import type { Clock, ComplianceReportRepository, SnapshotRepository } from '../ports.js';

export interface CheckComplianceDeps {
  snapshots: SnapshotRepository;
  reports: ComplianceReportRepository;
  rules: readonly Rule[];
  clock: Clock;
  params?: EvaluateOptions['params'];
  disabled?: EvaluateOptions['disabled'];
}

/** Evaluates the newest snapshot and stores the compliance report. */
export async function checkLatestSnapshot(
  deps: CheckComplianceDeps,
): Promise<{ snapshot: AuditSnapshot; report: ComplianceReport }> {
  const snapshot = await deps.snapshots.latest();
  if (!snapshot) throw new Error('No snapshot found: run `collect` first');
  const report = evaluateCompliance(deps.rules, snapshot, {
    now: deps.clock.now(),
    params: deps.params,
    disabled: deps.disabled,
  });
  await deps.reports.save(report);
  return { snapshot, report };
}
