import type {
  AuditSnapshot,
  ComplianceReport,
  DashboardView,
  DateRange,
  ReportContext,
  ReportDefinition,
  ReportDocument,
} from '@claude-audit/core';
import {
  SNAPSHOT_SCHEMA_VERSION,
  buildDashboardView,
  checkLatestSnapshot,
  collectSnapshot,
  evaluateCompliance,
  gatherDatasets,
  runAnalyzers,
  timestampId,
} from '@claude-audit/core';
import { SNAPSHOT_ID, dashboardViewSchema } from '@claude-audit/core/contracts';
import { stableStringify } from '../adapters/storage/file-store.js';
import type { Container } from './container.js';

const HISTORY_LIMIT = 90;

export const collect = (c: Container): Promise<AuditSnapshot> =>
  collectSnapshot({
    collectors: c.collectors,
    projections: c.projections,
    snapshots: c.snapshots,
    state: c.state,
    clock: c.clock,
  });

export const check = (
  c: Container,
): Promise<{ snapshot: AuditSnapshot; report: ComplianceReport }> =>
  checkLatestSnapshot({
    snapshots: c.snapshots,
    reports: c.reports,
    rules: c.rules,
    clock: c.clock,
    params: c.config.compliance.params,
    disabled: c.config.compliance.disabledRules,
  });

export interface BuildTarget {
  snapshot: AuditSnapshot | null;
  /** The compliance report of that snapshot (stored, else evaluated in memory; never saved). */
  report: ComplianceReport | null;
  /** Score history up to and including `report`, oldest first. */
  history: ComplianceReport[];
}

/**
 * What the dashboard and detail builds read: the latest snapshot, or the stored snapshot
 * `snapshotId` (e.g. one restored from the archive with `pnpm restore`). For a chosen snapshot
 * without a stored report the rules are evaluated in memory as of its collection time.
 */
export async function resolveTarget(c: Container, snapshotId?: string): Promise<BuildTarget> {
  const reports = await c.reports.history(HISTORY_LIMIT);
  if (snapshotId === undefined) {
    const snapshot = await c.snapshots.latest();
    return { snapshot, report: reports.at(-1) ?? null, history: reports };
  }
  if (!SNAPSHOT_ID.test(snapshotId)) throw new Error(`Invalid snapshot id: ${snapshotId}`);
  const snapshot = await c.snapshots.load(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} is not stored: restore it first (pnpm restore)`);
  }
  const history = reports.filter((r) => r.snapshotId <= snapshotId);
  const stored = history.find((r) => r.snapshotId === snapshotId);
  const report =
    stored ??
    // Round trip through the stored form, so the result equals what `check` would have saved.
    (JSON.parse(
      stableStringify(
        evaluateCompliance(c.rules, snapshot, {
          now: new Date(snapshot.collectedAt),
          params: c.config.compliance.params,
          disabled: c.config.compliance.disabledRules,
        }),
      ),
    ) as ComplianceReport);
  return { snapshot, report, history: stored ? history : [...history, report] };
}

/** Writes `dashboard.json` (DashboardView v2) from the latest (or the chosen) stored data. */
export async function writeDashboard(c: Container, snapshotId?: string): Promise<DashboardView> {
  const { snapshot, report, history } = await resolveTarget(c, snapshotId);
  const view = buildDashboardView({
    now: c.clock.now(),
    title: c.config.dashboard.title,
    source: c.source,
    maskPii: c.config.dashboard.maskPii,
    snapshot,
    report,
    history,
    insights: snapshot ? runAnalyzers(c.analyzers, snapshot) : [],
  });
  // Enforce the published contract at the only place that writes it.
  await c.artifacts.write('dashboard.json', stableStringify(dashboardViewSchema.parse(view)));
  return view;
}

/** Live collection limited to the report's datasets and period; nothing is persisted. */
async function liveSnapshot(
  c: Container,
  definition: ReportDefinition,
  period: DateRange,
): Promise<AuditSnapshot> {
  const now = c.clock.now();
  const collectors = c.collectors.filter((col) => definition.liveDatasets.includes(col.dataset));
  const gathered = await gatherDatasets(collectors, { now, range: period });
  for (const [name, meta] of Object.entries(gathered.coverage)) {
    if (meta.status !== 'ok')
      c.logger.warn(`${definition.id} report: ${name} ${meta.status} (${meta.reason})`);
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: timestampId(now),
    collectedAt: now.toISOString(),
    coverage: gathered.coverage,
    data: gathered.data,
  };
}

async function reportContext(
  c: Container,
  definition: ReportDefinition,
  period: DateRange,
): Promise<ReportContext> {
  const live = definition.liveDatasets.length > 0;
  const [stored, snapshots, complianceHistory] = await Promise.all([
    live ? liveSnapshot(c, definition, period) : c.snapshots.latest(),
    live ? Promise.resolve([]) : c.snapshots.since(period.start),
    c.reports.history(HISTORY_LIMIT),
  ]);
  return {
    now: c.clock.now(),
    period,
    snapshot: stored,
    snapshots,
    compliance: complianceHistory.at(-1) ?? null,
    complianceHistory,
    insights: stored ? runAnalyzers(c.analyzers, stored) : [],
  };
}

/** Builds a report and writes it in every registered format under `reports/<kind>/`. */
export async function generateReport(
  c: Container,
  id: string,
  argument?: string,
): Promise<{ document: ReportDocument; paths: string[] }> {
  const definition = c.reportDefinitions.require(id);
  const period = definition.period(c.clock.now(), argument);
  const document = definition.build(await reportContext(c, definition, period));
  const files = c.renderers.flatMap((renderer) => renderer.render(document));
  const paths = files.map((file) => `reports/${definition.id}/${document.id}${file.suffix}`);
  await Promise.all(files.map((file, i) => c.artifacts.write(paths[i] ?? '', file.content)));
  return { document, paths };
}
