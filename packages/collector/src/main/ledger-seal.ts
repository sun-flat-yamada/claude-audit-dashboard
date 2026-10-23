import {
  LEDGER_MONTH,
  ledgerSealAlert,
  previousMonth,
  sealLedgerMonth,
  type LedgerSealResult,
  type SealDatasetCheck,
} from '@claude-audit/core';
import { sha256Hex } from '../adapters/storage/ledger.js';
import { FsLedgerStatusStore } from '../adapters/storage/ledger-status.js';
import type { Container } from './container.js';
import { backfillPlanOf, defaultBackfillDatasets } from './ledger-backfill.js';
import { notifyOnce } from './notify-once.js';

export interface SealArgs {
  /** Default: the previous month (UTC). */
  month?: string | undefined;
  notify: boolean;
}

const CHECK_TEXT: Readonly<Record<SealDatasetCheck['status'], string>> = {
  match: 'matches the API',
  differs: 'differs from the API',
  replaced: 'roll-up replaced by the calendar-month value',
  blocked: 'cannot be re-fetched',
  kept: 'kept as recorded (no API history)',
  skipped: 'not in the ledger, nothing returned',
};

function reportSeal(c: Container, result: LedgerSealResult): void {
  for (const check of result.checks) {
    const fetched = check.fetched === undefined ? '' : ` (${String(check.fetched)} row(s) fetched)`;
    const reason = check.reason ? `: ${check.reason}` : '';
    const line = `Seal ${result.month} ${check.dataset}: ${CHECK_TEXT[check.status]}${fetched}${reason}`;
    if (check.status === 'differs' || check.status === 'blocked') c.logger.warn(line);
    else c.logger.info(line);
  }
  for (const reason of result.reasons) c.logger.warn(`Seal ${result.month}: ${reason}`);
  for (const r of result.revisions)
    c.logger.warn(`Seal ${r.month}: ${String(r.count)} ${r.dataset} entr(ies) added to revisions/`);
  for (const f of result.sinkFailures)
    c.logger.warn(`Seal ${result.month}: sink ${f.id} failed: ${f.reason}`);
  c.logger.info(`Seal ${result.month}: ${result.outcome}`);
}

/**
 * `ledger seal`: re-fetches one month through the backfill sources and seals it when it matches
 * the ledger (#160 U6). Expects the stored snapshots to be recorded first (the caller runs
 * `ledger update`). Fails after reporting (and notifying) when the month stays unsealed.
 */
export async function ledgerSeal(c: Container, args: SealArgs): Promise<LedgerSealResult> {
  const now = c.clock.now();
  const month = args.month ?? previousMonth(now);
  if (!LEDGER_MONTH.test(month)) throw new Error(`--month must be a month (yyyy-mm): ${month}`);
  const datasets = defaultBackfillDatasets(c);
  const plan = backfillPlanOf(c, { from: month, to: month, datasets }, now);
  const result = await sealLedgerMonth(
    { month, datasets, plan },
    {
      source: (dataset) => c.backfill.get(dataset),
      repository: c.ledger(),
      hash: sha256Hex,
      clock: c.clock,
      status: new FsLedgerStatusStore(c.store),
      sinks: c.sealSinks,
    },
  );
  reportSeal(c, result);
  if (args.notify) await notifyOnce(c, ledgerSealAlert(result, c.env.dashboardUrl));
  if (result.outcome === 'not-sealed')
    throw new Error(
      `Ledger ${month} was not sealed (${String(result.reasons.length)} reason(s) above)`,
    );
  return result;
}

const SEAL_FLAGS = new Set(['--month', '--notify']);

/** `seal [--month <yyyy-mm>] [--notify]` (after `seal`). */
export function parseSealArgs(args: readonly string[]): SealArgs {
  const unknown = args.filter((a) => a.startsWith('--') && !SEAL_FLAGS.has(a));
  if (unknown.length > 0) throw new Error(`Unknown option(s): ${unknown.join(', ')}`);
  const at = args.indexOf('--month');
  const month = at >= 0 ? args[at + 1] : undefined;
  if (at >= 0 && (!month || month.startsWith('--'))) throw new Error('--month requires a value');
  return { month, notify: args.includes('--notify') };
}
