import { backfillMonths } from '../../domain/ledger/backfill.js';
import { ledgerMonthOf } from '../../domain/ledger/entry.js';
import { revisionCount, type LedgerVerifyRecord } from '../../domain/ledger/health.js';
import type { LedgerManifest } from '../../domain/ledger/manifest.js';
import {
  dayGapFinding,
  digestFindings,
  entryDays,
  failingDays,
  staleFinding,
  type LedgerFinding,
} from '../../domain/ledger/verify.js';
import { addDays, startOfUtcDay, toIsoDate } from '../../domain/util/time.js';
import type { Clock, LedgerRepository, LedgerStatusStore } from '../ports.js';

export interface LedgerVerifySettings {
  /** Daily datasets expected to have rows for every day (`ledger.verify.dailyDatasets`). */
  dailyDatasets: readonly string[];
  /** Days a day needs before its rows are published (the last `lagDays` days are not checked). */
  lagDays: number;
  /** Maximum hours since the latest recorded collection. */
  maxStaleHours: number;
}

export interface LedgerVerifyDeps {
  repository: LedgerRepository;
  status: LedgerStatusStore;
  clock: Clock;
  settings: LedgerVerifySettings;
}

/** A month with more revision entries than were notified so far. */
export interface PendingRevision {
  month: string;
  count: number;
  notified: number;
}

export interface LedgerVerifyResult {
  record: LedgerVerifyRecord;
  /** Consecutive UTC days the verification has failed (0 while passing). */
  failingDays: number;
  months: { total: number; sealed: number };
  revisions: PendingRevision[];
}

interface Month {
  month: string;
  manifest: LedgerManifest | null;
}

async function digestCheck(repository: LedgerRepository, months: readonly Month[]) {
  const findings: LedgerFinding[] = [];
  for (const { month, manifest } of months) {
    if (!manifest?.sealed) continue;
    const files = await repository.digests(month);
    findings.push(...digestFindings(manifest, files, await repository.revisionDigests(month)));
  }
  return findings;
}

/** First UTC day any month recorded for `dataset` (from the manifest windows). */
const firstDayOf = (dataset: string, months: readonly Month[]): string | null =>
  months
    .map((m) => m.manifest?.datasets[dataset]?.window?.from.slice(0, 10) ?? null)
    .filter((day): day is string => day !== null)
    .sort()[0] ?? null;

/** Missing days of one daily dataset in the unsealed months from its first day to `until`. */
async function gapCheck(
  repository: LedgerRepository,
  dataset: string,
  months: readonly Month[],
  until: string,
): Promise<LedgerFinding[]> {
  const firstDay = firstDayOf(dataset, months);
  const lastMonth = ledgerMonthOf(toIsoDate(addDays(new Date(`${until}T00:00:00.000Z`), -1)));
  const firstMonth = firstDay ? ledgerMonthOf(firstDay) : null;
  if (!firstDay || !firstMonth || !lastMonth || firstMonth > lastMonth) return [];
  const sealed = new Set(months.filter((m) => m.manifest?.sealed).map((m) => m.month));
  const findings: LedgerFinding[] = [];
  for (const month of backfillMonths(firstMonth, lastMonth)) {
    if (sealed.has(month)) continue;
    const present = entryDays(dataset, await repository.read(month, dataset));
    const finding = dayGapFinding({ month, dataset, present, firstDay, until });
    if (finding) findings.push(finding);
  }
  return findings;
}

const latestRecord = (months: readonly Month[]): string | null =>
  months
    .map((m) => m.manifest?.lastRecordedAt ?? null)
    .filter((t): t is string => t !== null)
    .sort()
    .at(-1) ?? null;

async function findingsOf(deps: LedgerVerifyDeps, months: readonly Month[], now: Date) {
  const { repository, settings } = deps;
  const until = toIsoDate(addDays(startOfUtcDay(now), -settings.lagDays));
  const findings = await digestCheck(repository, months);
  for (const dataset of settings.dailyDatasets)
    findings.push(...(await gapCheck(repository, dataset, months, until)));
  const lastRecordedAt = latestRecord(months);
  const stale = staleFinding(lastRecordedAt, now, settings.maxStaleHours);
  if (stale) findings.push(stale);
  return { findings, lastRecordedAt };
}

/**
 * `ledger verify` (#160 U6): missing days of the daily datasets in unsealed months, the age of
 * the latest recorded collection, and the hashes of every sealed month's files. Stores the result
 * in `STATUS.json`, keeping the start of a run of failures (`failingSince`).
 */
export async function verifyLedger(deps: LedgerVerifyDeps): Promise<LedgerVerifyResult> {
  const now = deps.clock.now();
  const months: Month[] = [];
  for (const month of await deps.repository.months())
    months.push({ month, manifest: await deps.repository.manifest(month) });
  const { findings, lastRecordedAt } = await findingsOf(deps, months, now);
  const status = await deps.status.load();
  const failed = findings.length > 0;
  const previous = status.verify;
  const failingSince = failed
    ? previous?.status === 'fail' && previous.failingSince
      ? previous.failingSince
      : now.toISOString()
    : null;
  const record: LedgerVerifyRecord = {
    checkedAt: now.toISOString(),
    status: failed ? 'fail' : 'pass',
    failingSince,
    findings,
    lastRecordedAt,
  };
  await deps.status.save({ ...status, verify: record });
  const revisions = months
    .map((m) => ({
      month: m.month,
      count: revisionCount(m.manifest),
      notified: status.notifiedRevisions[m.month] ?? 0,
    }))
    .filter((r) => r.count > r.notified);
  return {
    record,
    failingDays: failingSince ? failingDays(failingSince, now) : 0,
    months: { total: months.length, sealed: months.filter((m) => m.manifest?.sealed).length },
    revisions,
  };
}

/** Records that the given revisions were notified, so the next verify does not repeat them. */
export async function markRevisionsNotified(
  store: LedgerStatusStore,
  revisions: readonly PendingRevision[],
): Promise<void> {
  if (revisions.length === 0) return;
  const status = await store.load();
  for (const { month, count } of revisions) status.notifiedRevisions[month] = count;
  await store.save(status);
}
