import {
  buildDashboardKpis,
  buildTimePointSummary,
  type AuditSnapshot,
  type ComplianceReport,
} from '@claude-audit/core';
import {
  COMPARE_POINT_LIMIT,
  SNAPSHOT_ID,
  SUMMARY_STORE_DIR,
  summaryStorePath,
  timePointSummarySchema,
  type TimePointSummary,
} from '@claude-audit/core/contracts';
import { stableStringify } from '../adapters/storage/file-store.js';
import type { Container } from './container.js';

/**
 * Summary of one judged snapshot (F-015). The KPI figures are computed as of the snapshot's
 * own collection time, so a summary rebuilt later from a restored snapshot equals the one the
 * pipeline wrote when the snapshot was judged.
 */
export function summaryFor(
  snapshot: AuditSnapshot,
  report: ComplianceReport,
  disabledRules: readonly string[],
): TimePointSummary {
  return buildTimePointSummary({
    snapshot,
    report,
    kpis: buildDashboardKpis({ now: new Date(snapshot.collectedAt), snapshot, report }),
    disabledRules,
  });
}

/**
 * Stores the summary as `summaries/<snapshot id>.json` on the data branch, validated against
 * the contract. The store outlives the snapshot: archiving moves the snapshot, not its summary.
 */
export async function saveSummary(c: Container, summary: TimePointSummary): Promise<void> {
  await c.store.write(
    summaryStorePath(summary.id),
    stableStringify(timePointSummarySchema.parse(summary)),
  );
}

/** Ids that have a stored summary file (not validated). */
async function storedIds(c: Container): Promise<string[]> {
  return (await c.store.list(SUMMARY_STORE_DIR))
    .filter((e) => !e.directory && e.name.endsWith('.json'))
    .map((e) => e.name.slice(0, -'.json'.length))
    .filter((id) => SNAPSHOT_ID.test(id));
}

/**
 * Every valid stored summary, newest first, at most `limit`. A file that does not parse or
 * does not match its name is skipped with a warning, never fatal: the other points stay usable.
 */
export async function readSummaries(
  c: Container,
  limit: number = COMPARE_POINT_LIMIT,
): Promise<TimePointSummary[]> {
  const ids = (await storedIds(c)).sort().reverse().slice(0, limit);
  const loaded = await Promise.all(
    ids.map(async (id) => {
      const raw = await c.store.readJson(summaryStorePath(id)).catch(() => null);
      const parsed = timePointSummarySchema.safeParse(raw);
      if (!parsed.success || parsed.data.id !== id) {
        c.logger.warn(`summaries/${id}.json is not a valid time-point summary: skipped`);
        return null;
      }
      return parsed.data;
    }),
  );
  return loaded.filter((s): s is TimePointSummary => s !== null);
}

/**
 * Writes the missing summaries of the newest `limit` stored reports whose snapshot is still in
 * the data directory (older runs, or a restored snapshot). Reports whose snapshot was archived
 * have no coverage to summarize and are left alone. The rule switches of the past are not
 * recorded in a report, so the current `compliance.disabledRules` are used. Returns the number
 * of summaries written. Existing summaries are never overwritten.
 */
export async function backfillSummaries(
  c: Container,
  limit: number = COMPARE_POINT_LIMIT,
): Promise<number> {
  const have = new Set(await storedIds(c));
  const missing = (await c.reports.history(limit)).filter((r) => !have.has(r.snapshotId));
  let written = 0;
  for (const report of missing) {
    const snapshot = await c.snapshots.load(report.snapshotId);
    if (!snapshot) continue;
    await saveSummary(c, summaryFor(snapshot, report, c.config.compliance.disabledRules));
    written += 1;
  }
  return written;
}
