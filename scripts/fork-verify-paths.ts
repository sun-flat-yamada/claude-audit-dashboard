/**
 * Paths that hold live (or generated) audit data and must never be tracked on a code branch.
 * Shared by `scripts/fork-verify.ts` and its tests.
 */
export const FORBIDDEN_PATHS: readonly string[] = [
  'data/snapshots',
  'data/reports',
  'data/dashboard.json',
  'data/state.json',
  'data/archive',
  'data/raw',
  'data/fixture',
  'data/detail',
  'data/alerts',
  'data/usage-matrix',
  'data/summaries',
  // Monthly ledger (long-term retention, #154): lives only on data/audit
  'data/ledger',
  // Generated profiles of `pnpm demo --profile optional-sources` / `pnpm fixture --optional-sources`
  'data/sample-optional-sources',
  'data/fixture-optional-sources',
  // Generated profiles of `pnpm demo --profile empty` / `pnpm demo --profile unavailable`
  'data/sample-empty',
  'data/sample-unavailable',
  // Playwright E2E output: the built SPA with a copy of the data of every profile
  'packages/dashboard/.e2e',
];

/** Tracked files that sit under a forbidden path (`.gitkeep` placeholders excepted). */
export function findTrackedLiveData(
  trackedFiles: readonly string[],
  forbidden: readonly string[] = FORBIDDEN_PATHS,
): string[] {
  return trackedFiles.filter(
    (f) => !f.endsWith('.gitkeep') && forbidden.some((rel) => f === rel || f.startsWith(`${rel}/`)),
  );
}
