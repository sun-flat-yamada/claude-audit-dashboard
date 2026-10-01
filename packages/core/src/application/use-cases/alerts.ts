import { formatScore, severityRank } from '../../domain/compliance/scoring.js';
import type {
  CheckResult,
  CheckStatus,
  ComplianceReport,
  Severity,
} from '../../domain/compliance/types.js';
import { errorMessage } from '../../domain/util/mask.js';
import type { ReportDocument } from '../documents.js';
import type { AlertMessage, Logger, Notifier } from '../ports.js';

export interface AlertPolicy {
  statuses: readonly CheckStatus[];
  minSeverity: Severity;
  cooldownMinutes: number;
  link?: string | undefined;
}

const bySeverity = (a: CheckResult, b: CheckResult): number =>
  severityRank(b.severity) - severityRank(a.severity) || a.ruleId.localeCompare(b.ruleId);

const withinCooldown = (sentAt: string | undefined, now: Date, minutes: number): boolean =>
  sentAt !== undefined && now.getTime() - Date.parse(sentAt) < minutes * 60_000;

/** One digest for the findings the policy selects; null when nothing new is worth sending. */
export function planComplianceAlert(
  report: ComplianceReport,
  policy: AlertPolicy,
  lastSent: Readonly<Record<string, string>>,
  now: Date,
): AlertMessage | null {
  const findings = report.results
    .filter(
      (r) =>
        policy.statuses.includes(r.status) &&
        severityRank(r.severity) >= severityRank(policy.minSeverity),
    )
    .sort(bySeverity);
  const [top] = findings;
  if (!top) return null;
  const key = `compliance:${findings.map((r) => `${r.ruleId}=${r.status}`).join(',')}`;
  if (withinCooldown(lastSent[key], now, policy.cooldownMinutes)) return null;
  return {
    key,
    title: `Claude Enterprise audit: ${findings.length} finding(s), score ${formatScore(report.summary)}`,
    severity: top.severity,
    lines: findings.map(
      (r) => `[${r.severity.toUpperCase()}] ${r.ruleId} ${r.ruleName} (${r.status}): ${r.message}`,
    ),
    link: policy.link,
  };
}

/** Wraps a generated report so notifiers can deliver it. */
export const documentAlert = (document: ReportDocument, link?: string): AlertMessage => ({
  key: `document:${document.id}`,
  title: document.title,
  severity: 'info',
  lines: document.sections.flatMap((s) =>
    s.type === 'kpis' ? s.items.map((i) => `${i.label}: ${i.value}`) : [],
  ),
  link,
  document,
});

/** Keeps only entries still inside the cooldown so state does not grow forever. */
export const pruneLastSent = (
  lastSent: Readonly<Record<string, string>>,
  now: Date,
  cooldownMinutes: number,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(lastSent).filter(([, at]) => withinCooldown(at, now, cooldownMinutes)),
  );

/** Sends to every notifier; one failing channel does not block the others. */
export async function dispatchAlert(
  alert: AlertMessage,
  notifiers: readonly Notifier[],
  logger: Logger,
): Promise<{ delivered: string[]; failed: string[] }> {
  const results = await Promise.allSettled(notifiers.map((n) => n.send(alert)));
  const delivered: string[] = [];
  const failed: string[] = [];
  results.forEach((result, i) => {
    const id = notifiers[i]?.id ?? 'unknown';
    if (result.status === 'fulfilled') delivered.push(id);
    else {
      failed.push(id);
      logger.error(`Notifier ${id} failed: ${errorMessage(result.reason)}`);
    }
  });
  return { delivered, failed };
}
