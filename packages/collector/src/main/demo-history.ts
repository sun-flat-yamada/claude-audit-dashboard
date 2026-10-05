import { DEMO_TIME_POINTS, scenarioCollectors } from '../adapters/demo/demo-history.js';
import { createDemoCollectors, demoState } from '../adapters/demo/demo-source.js';
import { stableStringify } from '../adapters/storage/file-store.js';
import { fixedClock } from '../infrastructure/runtime.js';
import { createContainer } from './container.js';
import type { DemoOptions } from './demo.js';
import { check, collect, writeDashboard } from './workflows.js';

/** Relative path of an earlier time point's file in the sample: `history/<snapshot id>/<name>`. */
export const historyPath = (snapshotId: string, name: string): string =>
  `history/${snapshotId}/${name}`;

/**
 * Collects and judges the EARLIER time points of the synthetic tenant (every point but the
 * latest, which `writeDemoSample` produces itself) in the store `dataDir`, oldest first, the way
 * a real pipeline accumulates them: each point adds its snapshot, compliance report and time-point
 * summary (`summaries/<id>.json`), and its dashboard carries the cumulative score history up to
 * itself. The caller then judges the latest point in the same store, so the latest dashboard
 * and the compare files list every point. Returns `history/<snapshot id>/dashboard.json` and
 * `.../compliance-report.json` per point. Raw snapshots are not returned: they are large and
 * are regenerated on every run.
 */
export async function writeDemoHistory(
  dataDir: string,
  options: DemoOptions = {},
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const point of DEMO_TIME_POINTS.slice(0, -1)) {
    const c = await createContainer({
      env: options.env,
      cwd: options.cwd,
      logger: options.logger,
      dataDir,
      clock: fixedClock(point.now),
      collectors: scenarioCollectors(createDemoCollectors(), point.scenario),
      source: 'demo',
    });
    await c.state.save(demoState(point.now));
    await collect(c);
    const { report } = await check(c, {
      params: point.scenario.params,
      disabledRules: point.scenario.disabledRules,
    });
    const view = await writeDashboard(c);
    files[historyPath(report.snapshotId, 'dashboard.json')] = stableStringify(view);
    files[historyPath(report.snapshotId, 'compliance-report.json')] = stableStringify(report);
  }
  return files;
}
