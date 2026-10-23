import {
  LEDGER_MONTH,
  errorMessage,
  ledgerPushAlert,
  previousMonth,
  pushLedgerMonth,
  type LedgerPushResult,
  type LedgerSink,
} from '@claude-audit/core';
import type { Container } from './container.js';
import { notifyOnce } from './notify-once.js';

export interface PushArgs {
  /** Default: the previous month (UTC). */
  month?: string | undefined;
  /** Every sealed month instead of one. */
  all: boolean;
  notify: boolean;
}

/** Copies one sealed month with the configured sink (also the `SealedMonthSink` hook). */
export function pushMonth(
  c: Container,
  sink: LedgerSink,
  month: string,
): Promise<LedgerPushResult> {
  return pushLedgerMonth(month, { files: c.ledger(), sink, clock: c.clock });
}

function reportPush(c: Container, result: LedgerPushResult): void {
  for (const file of result.files)
    if (file.status === 'uploaded')
      c.logger.info(
        `Push ${result.month} ${file.name}: copied to ${result.sink} and verified (${String(file.attempts)} attempt(s))`,
      );
  for (const path of result.extra)
    c.logger.warn(
      `Push ${result.month}: ${result.sink} also holds ${path}, which the ledger does not (kept)`,
    );
  const uploaded = result.files.filter((f) => f.status === 'uploaded').length;
  c.logger.info(
    `Push ${result.month} to ${result.sink}: ${String(uploaded)} file(s) copied, ${String(result.files.length - uploaded)} already there, all verified against MANIFEST.json`,
  );
}

async function monthsOf(c: Container, args: PushArgs): Promise<string[]> {
  if (!args.all) return [args.month ?? previousMonth(c.clock.now())];
  const repository = c.ledger();
  const months: string[] = [];
  for (const month of await repository.months())
    if ((await repository.manifest(month))?.sealed) months.push(month);
  return months;
}

/**
 * `ledger push` (#161 U7): copies sealed months to `ledger.sink` and verifies the copies. With
 * `none` (the default) it does nothing. A failure is reported (and notified with `--notify`) per
 * month and fails the command at the end; a re-run copies only what is missing.
 */
export async function ledgerPush(c: Container, args: PushArgs): Promise<LedgerPushResult[]> {
  if (c.config.ledger.sink === 'none') {
    c.logger.info('Push: ledger.sink is none, no month is copied');
    return [];
  }
  const months = await monthsOf(c, args);
  if (months.length === 0) c.logger.info('Push: no sealed month to copy');
  const results: LedgerPushResult[] = [];
  const failed: string[] = [];
  for (const month of months) {
    try {
      const sink = c.ledgerSink();
      if (!sink) break;
      const result = await pushMonth(c, sink, month);
      reportPush(c, result);
      results.push(result);
    } catch (error) {
      const reason = errorMessage(error);
      c.logger.error(`Push ${month} to ${c.config.ledger.sink} failed: ${reason}`);
      if (args.notify)
        await notifyOnce(
          c,
          ledgerPushAlert(month, c.config.ledger.sink, reason, c.env.dashboardUrl),
        );
      failed.push(month);
    }
  }
  if (failed.length > 0)
    throw new Error(`Ledger month(s) not copied to ${c.config.ledger.sink}: ${failed.join(', ')}`);
  return results;
}

const PUSH_FLAGS = new Set(['--month', '--all', '--notify']);

/** `push [--month <yyyy-mm> | --all] [--notify]` (after `push`). */
export function parsePushArgs(args: readonly string[]): PushArgs {
  const unknown = args.filter((a) => a.startsWith('--') && !PUSH_FLAGS.has(a));
  if (unknown.length > 0) throw new Error(`Unknown option(s): ${unknown.join(', ')}`);
  const at = args.indexOf('--month');
  const month = at >= 0 ? args[at + 1] : undefined;
  if (at >= 0 && (!month || month.startsWith('--'))) throw new Error('--month requires a value');
  if (month && !LEDGER_MONTH.test(month))
    throw new Error(`--month must be a month (yyyy-mm): ${month}`);
  const all = args.includes('--all');
  if (all && month) throw new Error('--month and --all cannot be combined');
  return { month, all, notify: args.includes('--notify') };
}
