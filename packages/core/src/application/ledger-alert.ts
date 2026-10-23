import type { LedgerSealResult } from './use-cases/ledger-seal.js';
import type { LedgerVerifyResult, PendingRevision } from './use-cases/ledger-verify.js';
import type { AlertMessage } from './ports.js';

/** At most this many findings are listed in one alert (the rest is counted). */
export const MAX_ALERT_LINES = 20;

const capped = (lines: readonly string[]): string[] =>
  lines.length > MAX_ALERT_LINES
    ? [...lines.slice(0, MAX_ALERT_LINES), `… and ${String(lines.length - MAX_ALERT_LINES)} more`]
    : [...lines];

/**
 * The alert for a verification that has failed on `notifyAfterDays` consecutive UTC days; null
 * before that or while passing. Months, datasets, dates and counts only (#160 U6).
 */
export function ledgerVerifyAlert(
  result: LedgerVerifyResult,
  notifyAfterDays: number,
  link?: string,
): AlertMessage | null {
  if (result.record.status === 'pass' || result.failingDays < notifyAfterDays) return null;
  return {
    key: 'ledger-verify:fail',
    title: `Ledger verification failing for ${String(result.failingDays)} day(s): ${String(result.record.findings.length)} finding(s)`,
    severity: 'high',
    lines: [
      ...capped(result.record.findings.map((f) => `[${f.check.toUpperCase()}] ${f.message}`)),
      'Fill missing days with pnpm ledger backfill; a hash mismatch needs the data/audit history (docs/DEPLOYMENT.md).',
    ],
    link,
  };
}

/** The alert for a seal that did not seal, or for a sealed month that differed; null otherwise. */
export function ledgerSealAlert(result: LedgerSealResult, link?: string): AlertMessage | null {
  const failures = result.sinkFailures.map((f) => `Sink ${f.id} failed: ${f.reason}`);
  if (result.outcome === 'not-sealed')
    return {
      key: `ledger-seal:${result.month}:not-sealed`,
      title: `Ledger ${result.month} not sealed: ${String(result.reasons.length)} dataset(s) differ or cannot be re-fetched`,
      severity: 'high',
      lines: [
        ...capped(result.reasons),
        `Reconcile with pnpm ledger backfill --from ${result.month} --to ${result.month} --force, then seal again.`,
      ],
      link,
    };
  if (result.outcome === 'revised')
    return {
      key: `ledger-seal:${result.month}:revised`,
      title: `Sealed ledger ${result.month} differs from the API: recorded in revisions/`,
      severity: 'medium',
      lines: [...capped(result.reasons), ...failures],
      link,
    };
  if (failures.length === 0) return null;
  return {
    key: `ledger-seal:${result.month}:sink`,
    title: `Ledger ${result.month} sealed, ${String(failures.length)} sink(s) failed`,
    severity: 'medium',
    lines: failures,
    link,
  };
}

/** The alert for sealed months that received revision entries since the last notification. */
export function ledgerRevisionAlert(
  revisions: readonly PendingRevision[],
  link?: string,
): AlertMessage | null {
  if (revisions.length === 0) return null;
  return {
    key: `ledger-revision:${revisions.map((r) => `${r.month}=${String(r.count)}`).join(',')}`,
    title: `Sealed ledger month(s) changed afterwards: ${revisions.map((r) => r.month).join(', ')}`,
    severity: 'medium',
    lines: [
      ...revisions.map(
        (r) =>
          `${r.month}: ${String(r.count - r.notified)} new revision entr(ies) (${String(r.count)} in total), kept in revisions/`,
      ),
      'The sealed files are unchanged; review the revisions (docs/DEPLOYMENT.md).',
    ],
    link,
  };
}
