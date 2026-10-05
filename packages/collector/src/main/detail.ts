import {
  DEFAULT_DETAIL_THRESHOLDS,
  buildDetailView,
  type ArchiveEntry,
  type ConfigViewInput,
  type DetailThresholds,
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
} from '@claude-audit/core/contracts';
import type { z } from 'zod';
import { listArchiveEntries } from '../adapters/storage/archive-inventory.js';
import { stableStringify } from '../adapters/storage/file-store.js';
import { readAlertsInput } from './alerts.js';
import { configViewInput } from './config-view.js';
import type { Container } from './container.js';

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
  return detailActivitySchema;
};

/**
 * Writes `detail/*.json` (manifest + entity files, incl. the effective configuration, the
 * archive inventory and the alert history) from the latest stored data. Every file is validated against its contract
 * at this single write site. `archive` replaces the listing of the data directory (the demo
 * supplies a synthetic one). Returns path -> content.
 */
export async function writeDetail(
  c: Container,
  config: Omit<ConfigViewInput, 'now'> = configViewInput(c),
  archive?: readonly ArchiveEntry[],
): Promise<Record<string, string>> {
  const entries = archive ?? (await listArchiveEntries(c.store).catch(() => null));
  const alerts = await readAlertsInput(c).catch(() => null);
  const [snapshot, report] = await Promise.all([c.snapshots.latest(), c.reports.latest()]);
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
  });
  const out: Record<string, string> = {
    [DETAIL_MANIFEST_PATH]: stableStringify(detailManifestSchema.parse(bundle.manifest)),
  };
  for (const file of bundle.files)
    out[file.path] = stableStringify(schemaFor(file.path).parse(file.content));
  await Promise.all(Object.entries(out).map(([path, content]) => c.artifacts.write(path, content)));
  return out;
}
