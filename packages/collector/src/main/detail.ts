import {
  DEFAULT_DETAIL_THRESHOLDS,
  archivedSnapshotIds,
  buildDetailView,
  type ArchiveEntry,
  type ConfigViewInput,
  type DetailThresholds,
  errorMessage,
  type TimePointSummary,
} from '@claude-audit/core';
import {
  DETAIL_MANIFEST_PATH,
  detailActivitySchema,
  detailAlertsSchema,
  detailArchiveSchema,
  detailConfigSchema,
  detailApiKeysSchema,
  detailManifestSchema,
  detailMembersSchema,
  detailOrgGroupsSchema,
  COMPARE_DIR,
  DETAIL_DIR,
  COMPARE_INDEX_PATH,
  compareIndexSchema,
  timePointSummarySchema,
} from '@claude-audit/core/contracts';
import type { z } from 'zod';
import { listArchiveEntries } from '../adapters/storage/archive-inventory.js';
import { stableStringify } from '../adapters/storage/file-store.js';
import { readAlertsInput } from './alerts.js';
import { configViewInput } from './config-view.js';
import type { Container } from './container.js';
import { backfillSummaries, readSummaries, saveSummary, summaryFor } from './summaries.js';
import { resolveTarget } from './workflows.js';

const positiveInt = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;

/** Effective AC-001 / AK-001 / AK-003 thresholds (configured params over rule defaults). */
export function detailThresholds(
  params: Readonly<Record<string, Record<string, unknown>>>,
): DetailThresholds {
  const d = DEFAULT_DETAIL_THRESHOLDS;
  return {
    inactiveDays: positiveInt(params['AC-001']?.inactiveDays, d.inactiveDays),
    unusedDays: positiveInt(params['AK-001']?.unusedDays, d.unusedDays),
    maxAgeDays: positiveInt(params['AK-003']?.maxAgeDays, d.maxAgeDays),
  };
}

const schemaFor = (path: string): z.ZodType => {
  if (path.endsWith('/members.json')) return detailMembersSchema;
  if (path.endsWith('/api-keys.json')) return detailApiKeysSchema;
  if (path.endsWith('/org-groups.json')) return detailOrgGroupsSchema;
  if (path.endsWith('/config.json')) return detailConfigSchema;
  if (path.endsWith('/archive.json')) return detailArchiveSchema;
  if (path.endsWith('/alerts.json')) return detailAlertsSchema;
  if (path === COMPARE_INDEX_PATH) return compareIndexSchema;
  if (path.startsWith(`${COMPARE_DIR}/`)) return timePointSummarySchema;
  return detailActivitySchema;
};

/**
 * The stored time-point summaries for the compare files: first the missing ones of stored
 * snapshots are written (existing data, or a snapshot just restored); with `snapshotId` that
 * point's summary is written when absent, so a restored archived point becomes comparable.
 */
async function loadSummaries(
  c: Container,
  target: Awaited<ReturnType<typeof resolveTarget>>,
  snapshotId: string | undefined,
): Promise<TimePointSummary[] | null> {
  try {
    await backfillSummaries(c);
    const { snapshot, report } = target;
    const stored = await readSummaries(c);
    if (
      snapshotId !== undefined &&
      snapshot &&
      report &&
      !stored.some((s) => s.id === snapshotId)
    ) {
      await saveSummary(c, summaryFor(snapshot, report, c.config.compliance.disabledRules));
      return await readSummaries(c);
    }
    return stored;
  } catch (error) {
    c.logger.warn(`Time-point summaries could not be read: ${errorMessage(error)}`);
    return null;
  }
}

const STALE_ACTIVITY = /^activity-\d{4}-\d{2}\.json$/;

/**
 * Removes the files of `detail/` that the new bundle no longer lists: per-point files of
 * `detail/compare/` and the monthly activity files of another snapshot (a build of a restored
 * snapshot, then of the latest, must not leave unlisted files behind).
 */
async function removeStaleDetailFiles(c: Container, keep: ReadonlySet<string>): Promise<void> {
  const stale = (dir: string, wanted: (name: string) => boolean) =>
    c.store
      .list(dir)
      .then((entries) =>
        entries.filter((e) => !e.directory && wanted(e.name) && !keep.has(`${dir}/${e.name}`)),
      )
      .then((entries) => entries.map((e) => `${dir}/${e.name}`));
  const paths = [
    ...(await stale(COMPARE_DIR, (name) => name.endsWith('.json'))),
    ...(await stale(DETAIL_DIR, (name) => STALE_ACTIVITY.test(name))),
  ];
  for (const path of paths) await c.store.remove(path);
}

/**
 * Writes `detail/*.json` (manifest + entity files, incl. the effective configuration, the
 * archive inventory and the alert history) from the latest stored data. Every file is validated against its contract
 * at this single write site. `archive` replaces the listing of the data directory (the demo
 * supplies a synthetic one). `snapshotId` builds from that stored snapshot instead of the latest. The compare files (F-015) list the
 * newest 90 stored summaries; missing summaries of stored snapshots are backfilled first.
 * Returns path -> content.
 */
export async function writeDetail(
  c: Container,
  config: Omit<ConfigViewInput, 'now'> = configViewInput(c),
  archive?: readonly ArchiveEntry[],
  snapshotId?: string,
): Promise<Record<string, string>> {
  const entries = archive ?? (await listArchiveEntries(c.store).catch(() => null));
  const alerts = await readAlertsInput(c).catch(() => null);
  const target = await resolveTarget(c, snapshotId);
  const { snapshot, report } = target;
  const summaries = await loadSummaries(c, target, snapshotId);
  // A supplied listing (the demo's synthetic archive) only feeds the inventory: its ids have no
  // history behind them and must not appear as comparable points.
  const archivedIds = archive ? [] : archivedSnapshotIds(entries ?? []);
  const bundle = buildDetailView({
    now: c.clock.now(),
    source: c.source,
    maskPii: c.config.dashboard.maskPii,
    snapshot,
    report,
    thresholds: detailThresholds(c.config.compliance.params),
    config,
    archive: { snapshotDays: c.config.retention.snapshotDays, entries },
    alerts,
    summaries,
    archivedIds,
  });
  const out: Record<string, string> = {
    [DETAIL_MANIFEST_PATH]: stableStringify(detailManifestSchema.parse(bundle.manifest)),
  };
  for (const file of bundle.files)
    out[file.path] = stableStringify(schemaFor(file.path).parse(file.content));
  await Promise.all(Object.entries(out).map(([path, content]) => c.artifacts.write(path, content)));
  await removeStaleDetailFiles(c, new Set(Object.keys(out)));
  return out;
}
