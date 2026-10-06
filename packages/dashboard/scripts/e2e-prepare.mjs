// Builds the SPA once with the production base path and assembles one data profile per
// Playwright project under .e2e/profiles/<name>/ (a copy of the build with its own data/).
//   node scripts/e2e-prepare.mjs
// Prerequisites (root `pnpm test:e2e` runs them): `pnpm build:collector`, `pnpm fixture`,
// `pnpm demo --profile optional-sources`. This script never stages public/data and never reads
// the live data/dashboard.json.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dashboardViewSchema,
  detailActivitySchema,
  detailAlertsSchema,
  detailApiKeysSchema,
  detailArchiveSchema,
  detailMembersSchema,
  detailOrgGroupsSchema,
} from '@claude-audit/core/contracts';
import {
  assertNotLive,
  assertSynthetic,
  BASE_PATH,
  NO_KEY_REASON,
  OPTIONAL_DATASETS,
  PROFILES,
} from './e2e-profiles.mjs';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pkgRoot, '..', '..');
const outRoot = join(pkgRoot, '.e2e');
const appDir = join(outRoot, 'app');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf-8'));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function build() {
  rmSync(appDir, { recursive: true, force: true });
  const vite = join(pkgRoot, 'node_modules', '.bin', 'vite');
  execFileSync(vite, ['build', '--outDir', appDir, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: pkgRoot,
    stdio: 'inherit',
    env: { ...process.env, VITE_BASE_PATH: BASE_PATH },
  });
  // The build copies whatever public/data holds (possibly data staged for local dev): drop it.
  rmSync(join(appDir, 'data'), { recursive: true, force: true });
}

/** Rows removed per detail file; each result is validated against the published contract. */
const EMPTY_FILES = {
  'members.json': [detailMembersSchema, { members: [], invites: [] }],
  'api-keys.json': [detailApiKeysSchema, { keys: [] }],
  'alerts.json': [
    detailAlertsSchema,
    { alerts: [], totals: { alerts: 0, acknowledged: 0, unacknowledged: 0 } },
  ],
  'org-groups.json': [detailOrgGroupsSchema, { deviations: [], groups: [], organizations: [] }],
  'archive.json': [
    detailArchiveSchema,
    {
      years: [],
      ignoredEntries: 0,
      totals: { snapshots: 0, bytes: 0, years: 0, oldest: null, newest: null },
    },
  ],
};

function emptyDetail(dir) {
  for (const [name, [schema, patch]] of Object.entries(EMPTY_FILES)) {
    const file = join(dir, name);
    if (existsSync(file)) writeJson(file, schema.parse({ ...readJson(file), ...patch }));
  }
  for (const name of readdirSync(dir).filter((n) => /^activity-\d{4}-\d{2}\.json$/.test(n))) {
    const file = join(dir, name);
    writeJson(
      file,
      detailActivitySchema.parse({ ...readJson(file), items: [], total: 0, truncated: false }),
    );
  }
}

function staleDetail(dir) {
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = join(entry.parentPath, entry.name);
    const value = readJson(file);
    if (value && typeof value === 'object' && 'schemaVersion' in value) {
      writeJson(file, { ...value, schemaVersion: 999 });
    }
  }
}

/** What the collector publishes when the optional sources are on but the key is missing. */
function withoutConsoleKey(dashboard) {
  const coverage = dashboard.coverage.map((entry) =>
    OPTIONAL_DATASETS.includes(entry.dataset)
      ? { ...entry, status: 'unavailable', count: null, asOf: null, reason: NO_KEY_REASON }
      : entry,
  );
  const view = { ...dashboard, coverage };
  delete view.claudeCode; // the aggregate exists only when the dataset was collected (AN-4)
  return view;
}

function dashboardOf(profile, dashboard) {
  if (profile.variant === 'dashboard-schema') return { ...dashboard, schemaVersion: 999 };
  const view =
    profile.variant === 'optional-unavailable' ? withoutConsoleKey(dashboard) : dashboard;
  dashboardViewSchema.parse(view); // derived profiles stay valid against the published contract
  return view;
}

function assemble(profile) {
  const source = join(repoRoot, profile.source);
  const from = join(source, 'dashboard.json');
  if (!existsSync(from))
    throw new Error(`profile ${profile.name}: ${profile.source} not found (${profile.hint})`);
  const dashboard = readJson(from);
  assertSynthetic(dashboard, `profile ${profile.name}`);
  const target = join(outRoot, 'profiles', profile.name);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(appDir, target, { recursive: true });
  const data = join(target, 'data');
  mkdirSync(data, { recursive: true });
  writeJson(join(data, 'dashboard.json'), dashboardOf(profile, dashboard));
  if (profile.variant !== 'no-detail' && existsSync(join(source, 'detail'))) {
    cpSync(join(source, 'detail'), join(data, 'detail'), { recursive: true });
    if (profile.variant === 'empty') emptyDetail(join(data, 'detail'));
    if (profile.variant === 'detail-schema') staleDetail(join(data, 'detail'));
  }
  console.log(`E2E profile ${profile.name}: ${profile.description}`);
}

assertNotLive(process.env);
build();
for (const profile of PROFILES) assemble(profile);
