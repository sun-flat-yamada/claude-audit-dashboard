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
  gatherDatasets,
  runAnalyzers,
  timestampId,
} from '@claude-audit/core';
import { dashboardViewSchema } from '@claude-audit/core/contracts';
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

/** Writes `dashboard.json` (DashboardView v2) from the latest stored data. */
export async function writeDashboard(c: Container): Promise<DashboardView> {
  const [snapshot, history] = await Promise.all([
    c.snapshots.latest(),
    c.reports.history(HISTORY_LIMIT),
  ]);
  const view = buildDashboardView({
    now: c.clock.now(),
    title: c.config.dashboard.title,
    source: c.source,
    maskPii: c.config.dashboard.maskPii,
    snapshot,
    report: history.at(-1) ?? null,
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
