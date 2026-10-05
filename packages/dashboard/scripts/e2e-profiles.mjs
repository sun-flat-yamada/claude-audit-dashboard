// Data profiles of the E2E suite (docs/BLUEPRINT.md section 18.3).
// Every profile is a complete `data/` directory of the built SPA. Sources are always explicit
// repository paths of synthetic data (`data/sample`, `data/fixture`, `data/sample-optional-sources`);
// the live `data/dashboard.json` is never a source and `DASHBOARD_DATA_SOURCE=live` is refused.

/** Base path of GitHub Pages: the suite builds and serves with the same one. */
export const BASE_PATH = '/claude-audit-dashboard/';
export const FIRST_PORT = 4310;

/**
 * @typedef {object} Profile
 * @property {string} name Playwright project name
 * @property {string} source Directory (repository relative) holding dashboard.json and detail/
 * @property {string} hint Command that creates the source when it is missing
 * @property {'copy' | 'no-detail' | 'dashboard-schema' | 'detail-schema' | 'empty' | 'optional-unavailable'} variant
 * @property {string} description
 */

/** @type {Profile[]} */
export const PROFILES = [
  {
    name: 'sample',
    source: 'data/sample',
    hint: 'the committed sample is missing; run `pnpm demo`',
    variant: 'copy',
    description: 'public synthetic tenant (default profile, optional sources off)',
  },
  {
    name: 'fixtures',
    source: 'data/fixture',
    hint: 'run `pnpm fixture`',
    variant: 'copy',
    description: 'fixture tenant (pnpm fixture)',
  },
  {
    name: 'optional-sources',
    source: 'data/sample-optional-sources',
    hint: 'run `pnpm demo --profile optional-sources`',
    variant: 'copy',
    description: 'sample with the Console and Claude Code datasets on (B4)',
  },
  {
    name: 'optional-unavailable',
    source: 'data/sample-optional-sources',
    hint: 'run `pnpm demo --profile optional-sources`',
    variant: 'optional-unavailable',
    description:
      'optional sources enabled but no Console Admin key: the five datasets are unavailable',
  },
  {
    name: 'unavailable',
    source: 'data/sample',
    hint: 'run `pnpm demo`',
    variant: 'no-detail',
    description:
      'dashboard.json only: every detail file answers 404 (not collected / not published)',
  },
  {
    name: 'empty',
    source: 'data/sample',
    hint: 'run `pnpm demo`',
    variant: 'empty',
    description: 'detail files present but without rows',
  },
  {
    name: 'stale-detail',
    source: 'data/sample',
    hint: 'run `pnpm demo`',
    variant: 'detail-schema',
    description: 'detail files with an unsupported schemaVersion',
  },
  {
    name: 'stale-dashboard',
    source: 'data/sample',
    hint: 'run `pnpm demo`',
    variant: 'dashboard-schema',
    description: 'dashboard.json with an unsupported schemaVersion',
  },
];

export const portOf = (name) => {
  const index = PROFILES.findIndex((p) => p.name === name);
  if (index < 0) throw new Error(`Unknown E2E profile "${name}"`);
  return FIRST_PORT + index;
};

export const originOf = (name) => `http://127.0.0.1:${portOf(name)}`;

/**
 * The guard: E2E never reads live data. Throws when `live` is selected through the environment.
 * @param {NodeJS.ProcessEnv} env
 */
export function assertNotLive(env) {
  const selected = env.DASHBOARD_DATA_SOURCE;
  if (
    selected !== undefined &&
    selected !== '' &&
    selected !== 'sample' &&
    selected !== 'fixtures'
  ) {
    throw new Error(
      `E2E refuses DASHBOARD_DATA_SOURCE=${selected}: profiles read data/sample, data/fixture and data/sample-optional-sources only (never live data)`,
    );
  }
}

/**
 * The guard on content: a staged dashboard.json must come from the synthetic demo tenant.
 * @param {unknown} dashboard parsed dashboard.json
 * @param {string} where
 */
export function assertSynthetic(dashboard, where) {
  const source = /** @type {{ source?: unknown } | null} */ (dashboard)?.source;
  if (source !== 'demo') {
    throw new Error(
      `${where}: source is "${String(source)}", expected "demo" (no live data in E2E)`,
    );
  }
}

/** The datasets of the optional Console and Claude Code sources (B4). */
export const OPTIONAL_DATASETS = [
  'consoleWorkspaces',
  'consoleApiKeys',
  'consoleUsage',
  'consoleCost',
  'claudeCodeActivity',
];

/** The reason the collector records for a missing key (`optional-collectors.ts`). */
export const NO_KEY_REASON =
  'No Console Admin API key for the source (set ANTHROPIC_CONSOLE_ADMIN_API_KEY; the Enterprise keys do not work for this API)';
