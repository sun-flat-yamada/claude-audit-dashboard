import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@claude-audit/core';
import {
  FIXTURE_CONSOLE_KEY,
  optionalFixturesRoot,
  withOptionalFixtures,
} from '../adapters/fixture/optional-fixture.js';
import {
  FIXTURE_ENV,
  FIXTURE_NOW,
  fixtureState,
  createFixtureFetch,
} from '../adapters/fixture/fixture-source.js';
import { stableStringify } from '../adapters/storage/file-store.js';
import type { AppConfig } from '../infrastructure/config.js';
import { fixedClock } from '../infrastructure/runtime.js';
import { createContainer } from './container.js';
import { writeDetail } from './detail.js';
import { collectUsageMatrix } from './usage-matrix.js';
import { writeMonthlyView } from './monthly-report.js';
import { writeFiles } from './write-files.js';
import { check, collect, generateReport, writeDashboard } from './workflows.js';

/** The fixture profile configuration: usageMatrix enabled by default; optional sources on when requested. */
const patchFixtureConfig = (config: AppConfig, optional: boolean): AppConfig => ({
  ...config,
  sources: {
    ...config.sources,
    usageMatrix: { enabled: true, lookbackDays: 90 },
    ...(optional
      ? {
          console: { enabled: true, lookbackDays: 30 },
          claudeCode: { enabled: true, lookbackDays: 1 },
          featureUsage: { enabled: true, lookbackDays: 30 },
        }
      : {}),
  },
});

export interface FixtureTenantOptions {
  fixtureDir: string;
  /**
   * Also enable the optional sources (Console Admin, Claude Code Analytics, feature usage) with
   * a synthetic Console key and replay their official-shape fixtures next to the tenant.
   */
  optionalSources?: boolean | undefined;
  cwd?: string | undefined;
  logger?: Logger | undefined;
}

/**
 * Runs the real collect → check → dashboard pipeline against the fixture tenant with a fixed
 * clock and returns the generated files (`dashboard.json`, `compliance-report.json`).
 * Deterministic: the same fixtures always produce the same bytes. Labelled `demo`, the only
 * non-live value of the published dashboard contract.
 */
export async function runFixtureTenant(
  options: FixtureTenantOptions,
): Promise<Record<string, string>> {
  const workDir = await mkdtemp(join(tmpdir(), 'claude-audit-fixture-'));
  try {
    const tenant = await createFixtureFetch(options.fixtureDir);
    const optional = options.optionalSources === true;
    const replay = optional
      ? await withOptionalFixtures(tenant, optionalFixturesRoot(options.fixtureDir))
      : tenant;
    const c = await createContainer({
      env: optional
        ? { ...FIXTURE_ENV, ANTHROPIC_CONSOLE_ADMIN_API_KEY: FIXTURE_CONSOLE_KEY }
        : FIXTURE_ENV,
      configPatch: (cfg) => patchFixtureConfig(cfg, optional),
      cwd: options.cwd,
      logger: options.logger,
      dataDir: workDir,
      clock: fixedClock(FIXTURE_NOW),
      fetchImpl: replay.fetch,
      source: 'demo',
    });
    await c.state.save(fixtureState(FIXTURE_NOW));
    await collect(c);
    await collectUsageMatrix(c);
    const { report } = await check(c);
    const view = await writeDashboard(c);
    const detail = await writeDetail(c);
    const monthlyMonths = ['2026-07', '2026-08'];
    const monthlyFiles: Record<string, string> = {};
    for (const month of monthlyMonths) {
      const { document } = await generateReport(c, 'monthly', month);
      Object.assign(monthlyFiles, await writeMonthlyView(c, document));
    }
    return {
      'dashboard.json': stableStringify(view),
      'compliance-report.json': stableStringify(report),
      ...detail,
      ...monthlyFiles,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function writeFixtureTenant(outDir: string, options: FixtureTenantOptions) {
  const files = await runFixtureTenant(options);
  await writeFiles(outDir, files);
  return files;
}
