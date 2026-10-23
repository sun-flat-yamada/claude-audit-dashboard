import {
  ledgerRevisionAlert,
  ledgerVerifyAlert,
  markRevisionsNotified,
  verifyLedger,
  type LedgerVerifyResult,
} from '@claude-audit/core';
import { FsLedgerRepository } from '../adapters/storage/ledger.js';
import { FsLedgerStatusStore } from '../adapters/storage/ledger-status.js';
import type { Container } from './container.js';
import { notifyOnce } from './notify-once.js';

export interface VerifyArgs {
  notify: boolean;
  json: boolean;
}

function reportVerify(c: Container, result: LedgerVerifyResult): void {
  const { record, months } = result;
  for (const finding of record.findings)
    c.logger.warn(`Verify [${finding.check.toUpperCase()}] ${finding.message}`);
  for (const r of result.revisions)
    c.logger.warn(
      `Verify: sealed ${r.month} has ${String(r.count)} revision entr(ies) (${String(r.count - r.notified)} new)`,
    );
  const failing =
    record.status === 'fail' ? `, failing for ${String(result.failingDays)} day(s)` : '';
  c.logger.info(
    `Ledger verify ${record.status}: ${String(months.total)} month(s), ${String(months.sealed)} sealed, ${String(record.findings.length)} finding(s)${failing}`,
  );
}

/**
 * `ledger verify` (#160 U6): stores the result in `ledger/STATUS.json` and, with `notify`, alerts
 * when it has failed on `ledger.verify.notifyAfterDays` consecutive days and when sealed months
 * received revisions. Findings are reported, never an exit code (the rule OP-003 shows them).
 */
export async function ledgerVerify(c: Container, args: VerifyArgs): Promise<LedgerVerifyResult> {
  const settings = c.config.ledger.verify;
  const status = new FsLedgerStatusStore(c.store);
  const result = await verifyLedger({
    repository: new FsLedgerRepository(c.store),
    status,
    clock: c.clock,
    settings,
  });
  if (args.json) c.logger.info(JSON.stringify(result, null, 2));
  else reportVerify(c, result);
  if (!args.notify) return result;
  const link = c.env.dashboardUrl;
  await notifyOnce(c, ledgerVerifyAlert(result, settings.notifyAfterDays, link));
  // Sent now or within the cooldown of the same key (same counts): notified either way.
  if (ledgerRevisionAlert(result.revisions, link)) {
    await notifyOnce(c, ledgerRevisionAlert(result.revisions, link));
    await markRevisionsNotified(status, result.revisions);
  }
  return result;
}

const VERIFY_FLAGS = new Set(['--notify', '--json']);

/** `verify [--notify] [--json]` (after `verify`). */
export function parseVerifyArgs(args: readonly string[]): VerifyArgs {
  const unknown = args.filter((a) => !VERIFY_FLAGS.has(a));
  if (unknown.length > 0) throw new Error(`Unknown option(s): ${unknown.join(', ')}`);
  return { notify: args.includes('--notify'), json: args.includes('--json') };
}
