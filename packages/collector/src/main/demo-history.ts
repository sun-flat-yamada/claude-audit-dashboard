import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLatestSnapshot } from '@claude-audit/core';
import { DEMO_TIME_POINTS, scenarioCollectors } from '../adapters/demo/demo-history.js';
import { createDemoCollectors, demoState } from '../adapters/demo/demo-source.js';
import { stableStringify } from '../adapters/storage/file-store.js';
import { fixedClock } from '../infrastructure/runtime.js';
import { createContainer } from './container.js';
import type { DemoOptions } from './demo.js';
import { collect, writeDashboard } from './workflows.js';

/** Relative path of an earlier time point's file in the sample: `history/<snapshot id>/<name>`. */
export const historyPath = (snapshotId: string, name: string): string =>
  `history/${snapshotId}/${name}`;

/**
 * Collects and judges the EARLIER time points of the synthetic tenant (every point but the
 * latest, which `writeDemoSample` produces itself) in one separate store, oldest first, so
 * each point's dashboard carries the cumulative score history up to itself. Returns
 * `history/<snapshot id>/dashboard.json` and `.../compliance-report.json` per point.
 * Raw snapshots are not returned: they are large and are regenerated on every run.
 */
export async function writeDemoHistory(options: DemoOptions = {}): Promise<Record<string, string>> {
  const workDir = await mkdtemp(join(tmpdir(), 'claude-audit-demo-history-'));
  const files: Record<string, string> = {};
  try {
    for (const point of DEMO_TIME_POINTS.slice(0, -1)) {
      const c = await createContainer({
        env: options.env,
        cwd: options.cwd,
        logger: options.logger,
        dataDir: workDir,
        clock: fixedClock(point.now),
        collectors: scenarioCollectors(createDemoCollectors(), point.scenario),
        source: 'demo',
      });
      await c.state.save(demoState(point.now));
      await collect(c);
      const { report } = await checkLatestSnapshot({
        snapshots: c.snapshots,
        reports: c.reports,
        rules: c.rules,
        clock: c.clock,
        params: { ...c.config.compliance.params, ...point.scenario.params },
        disabled: [...c.config.compliance.disabledRules, ...point.scenario.disabledRules],
      });
      const view = await writeDashboard(c);
      files[historyPath(report.snapshotId, 'dashboard.json')] = stableStringify(view);
      files[historyPath(report.snapshotId, 'compliance-report.json')] = stableStringify(report);
    }
    return files;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
