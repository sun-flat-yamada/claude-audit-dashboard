import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices } from '@playwright/test';
import { assertNotLive, BASE_PATH, originOf, PROFILES } from './scripts/e2e-profiles.mjs';

// The guard runs for the runner and every worker: E2E never uses live data.
assertNotLive(process.env);

/** Specs per project: `e2e/shared` runs on several profiles, the other folders on one. */
const SHARED: Record<string, string[]> = {
  sample: ['shared', 'sample'],
  fixtures: ['shared', 'fixtures'],
  'optional-sources': ['optional-sources'],
  'optional-unavailable': ['optional-sources'],
  unavailable: ['shared', 'unavailable'],
  empty: ['shared', 'empty'],
  'stale-detail': ['stale'],
  'stale-dashboard': ['stale'],
};

/**
 * The Playwright-pinned Chromium when it is installed (`playwright install chromium`, CI);
 * otherwise a preinstalled build (cloud sessions: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, or the
 * /opt/pw-browsers/chromium link). Never installs anything.
 */
function chromiumPath(): string | undefined {
  if (existsSync(chromium.executablePath())) return undefined;
  return [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, '/opt/pw-browsers/chromium'].find(
    (candidate): candidate is string => Boolean(candidate) && existsSync(candidate as string),
  );
}

const executablePath = chromiumPath();
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: './e2e',
  outputDir: './.e2e/test-results',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // No retries: a flaky test is a bug of the test or the app (docs/BLUEPRINT.md 18.3).
  retries: 0,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['html', { outputFolder: './.e2e/report', open: 'never' }],
  ],
  use: {
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    colorScheme: 'light',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: PROFILES.map((profile) => ({
    name: profile.name,
    testMatch: (SHARED[profile.name] ?? []).map((dir) => `**/e2e/${dir}/*.spec.ts`),
    use: {
      ...devices['Desktop Chrome'],
      baseURL: `${originOf(profile.name)}${BASE_PATH}`,
      viewport: { width: 1280, height: 900 },
      launchOptions,
    },
  })),
  webServer: {
    command: 'node scripts/e2e-serve.mjs',
    url: `${originOf(PROFILES[0]?.name ?? 'sample')}${BASE_PATH}`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
  },
});
