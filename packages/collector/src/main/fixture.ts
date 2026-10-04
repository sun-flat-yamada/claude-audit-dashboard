import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@claude-audit/core';
import {
  FIXTURE_ENV,
  FIXTURE_NOW,
  fixtureState,
  createFixtureFetch,
} from '../adapters/fixture/fixture-source.js';
import { stableStringify } from '../adapters/storage/file-store.js';
import { fixedClock } from '../infrastructure/runtime.js';
import { createContainer } from './container.js';
import { check, collect, writeDashboard } from './workflows.js';

export interface FixtureTenantOptions {
  fixtureDir: string;
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
    const replay = await createFixtureFetch(options.fixtureDir);
    const c = await createContainer({
      env: FIXTURE_ENV,
      cwd: options.cwd,
      logger: options.logger,
      dataDir: workDir,
      clock: fixedClock(FIXTURE_NOW),
      fetchImpl: replay.fetch,
      source: 'demo',
    });
    await c.state.save(fixtureState(FIXTURE_NOW));
    await collect(c);
    const { report } = await check(c);
    const view = await writeDashboard(c);
    return {
      'dashboard.json': stableStringify(view),
      'compliance-report.json': stableStringify(report),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function writeFixtureTenant(outDir: string, options: FixtureTenantOptions) {
  const files = await runFixtureTenant(options);
  await mkdir(outDir, { recursive: true });
  await Promise.all(
    Object.entries(files).map(([name, content]) => writeFile(join(outDir, name), content)),
  );
  return files;
}
