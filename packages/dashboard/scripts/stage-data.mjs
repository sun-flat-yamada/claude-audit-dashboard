// Stage dashboard data into public/data/ for local dev and builds.
//
// DASHBOARD_DATA_SOURCE selects where dashboard.json comes from:
//   (unset)   data/dashboard.json (built locally by `pnpm build:data`) if present, else data/sample/dashboard.json
//   sample    data/sample/dashboard.json (synthetic demo tenant; use this in tests and E2E)
//   fixtures  data/fixture/dashboard.json (written by `pnpm fixture`; gitignored; use this in tests and E2E)
//   live      data/dashboard.json; fails when absent (never use in tests or E2E)
// CI stages live data itself and sets STAGED_DATA=1 so this script leaves it untouched.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCES = ['sample', 'fixtures', 'live'];

const FILES = {
  sample: ['data', 'sample', 'dashboard.json'],
  fixtures: ['data', 'fixture', 'dashboard.json'],
  live: ['data', 'dashboard.json'],
};

const HINTS = {
  fixtures: 'run `pnpm fixture` first',
  live: 'run `pnpm build:data` first, or use DASHBOARD_DATA_SOURCE=sample',
};

/**
 * Pure source resolution. Returns the file to stage or throws with an actionable message.
 * `exists` is injectable so tests never depend on the files present on disk.
 */
export function resolveSource(requested, repoRoot, exists = existsSync) {
  const name = requested === undefined || requested === '' ? undefined : requested;
  if (name === undefined) {
    const live = join(repoRoot, ...FILES.live);
    return { name: 'default', file: exists(live) ? live : join(repoRoot, ...FILES.sample) };
  }
  if (!SOURCES.includes(name)) {
    throw new Error(
      `Unknown DASHBOARD_DATA_SOURCE "${name}" (expected one of: ${SOURCES.join(', ')})`,
    );
  }
  const file = join(repoRoot, ...FILES[name]);
  if (name !== 'sample' && !exists(file)) {
    throw new Error(
      `DASHBOARD_DATA_SOURCE=${name}: ${relative(repoRoot, file)} not found (${HINTS[name]})`,
    );
  }
  return { name, file };
}

export function stage({ env = process.env, pkgRoot, log = console.log } = {}) {
  const repoRoot = join(pkgRoot, '..', '..');
  const target = join(pkgRoot, 'public', 'data', 'dashboard.json');
  if (env.STAGED_DATA === '1' && existsSync(target)) {
    log('STAGED_DATA=1: keeping the pre-staged public/data/dashboard.json');
    return target;
  }
  const { name, file } = resolveSource(env.DASHBOARD_DATA_SOURCE, repoRoot);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(file, target);
  log(`Staged (${name}) ${relative(repoRoot, file)} -> public/data/dashboard.json`);
  return target;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    stage({ pkgRoot: join(dirname(fileURLToPath(import.meta.url)), '..') });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
