import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@claude-audit/core';
import { DEMO_NOW, createDemoCollectors, demoState } from '../adapters/demo/demo-source.js';
import { toMarkdown } from '../adapters/renderers/markdown.js';
import { stableStringify } from '../adapters/storage/file-store.js';
import { fixedClock } from '../infrastructure/runtime.js';
import { createContainer, type Container } from './container.js';
import { writeDetail } from './detail.js';
import { writeMonthlyView } from './monthly-report.js';
import { writeFiles } from './write-files.js';
import { check, collect, generateReport, writeDashboard } from './workflows.js';

export interface DemoOptions {
  env?: NodeJS.ProcessEnv | undefined;
  cwd?: string | undefined;
  logger?: Logger | undefined;
}

/** Months of the public monthly cost data: the report month (previous month) and two before it. */
const DEMO_MONTHS = ['2026-06', '2026-07', '2026-08'] as const;

async function writeDemoMonths(c: Container): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const month of DEMO_MONTHS) {
    const { document } = await generateReport(c, 'monthly', month);
    Object.assign(files, await writeMonthlyView(c, document));
  }
  return files;
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
    const monthlyView = await writeDemoMonths(c);
    const detail = await writeDetail(c);
    const files: Record<string, string> = {
      'dashboard.json': stableStringify(view),
      'compliance-report.json': stableStringify(report),
      'weekly-report.md': toMarkdown(weekly.document),
      'monthly-report.md': toMarkdown(monthly.document),
      ...detail,
      ...monthlyView,
    };
    await writeFiles(outDir, files);
    return files;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
