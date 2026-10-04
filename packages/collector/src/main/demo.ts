import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@claude-audit/core';
import { DEMO_NOW, createDemoCollectors, demoState } from '../adapters/demo/demo-source.js';
import { toMarkdown } from '../adapters/renderers/markdown.js';
import { stableStringify } from '../adapters/storage/file-store.js';
import { fixedClock } from '../infrastructure/runtime.js';
import { createContainer } from './container.js';
import { writeDetail } from './detail.js';
import { writeFiles } from './write-files.js';
import { check, collect, generateReport, writeDashboard } from './workflows.js';

export interface DemoOptions {
  env?: NodeJS.ProcessEnv | undefined;
  cwd?: string | undefined;
  logger?: Logger | undefined;
}

/**
 * Runs collect → check → dashboard → weekly / monthly reports on the synthetic tenant with a
 * fixed clock, then writes the public sample files. Output is deterministic (golden-tested).
 */
export async function writeDemoSample(
  outDir: string,
  options: DemoOptions = {},
): Promise<Record<string, string>> {
  const workDir = await mkdtemp(join(tmpdir(), 'claude-audit-demo-'));
  try {
    const c = await createContainer({
      ...options,
      dataDir: workDir,
      clock: fixedClock(DEMO_NOW),
      collectors: createDemoCollectors(),
      source: 'demo',
    });
    await c.state.save(demoState(DEMO_NOW));
    await collect(c);
    const { report } = await check(c);
    const view = await writeDashboard(c);
    const weekly = await generateReport(c, 'weekly');
    const monthly = await generateReport(c, 'monthly');
    const detail = await writeDetail(c);
    const files: Record<string, string> = {
      'dashboard.json': stableStringify(view),
      'compliance-report.json': stableStringify(report),
      'weekly-report.md': toMarkdown(weekly.document),
      'monthly-report.md': toMarkdown(monthly.document),
      ...detail,
    };
    await writeFiles(outDir, files);
    return files;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
