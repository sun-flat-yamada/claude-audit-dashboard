import { join } from 'node:path';
import type { CollectorState } from '@claude-audit/core';
import { addDays, initialState } from '@claude-audit/core';
import { loadCaptureEntries } from '../anthropic/raw-capture.js';
import { replayFetch, type ReplayFetch } from '../anthropic/replay-fetch.js';

/**
 * Fixture tenant: the sanitized, tenant-shaped API responses under
 * `adapters/anthropic/__tests__/fixtures/tenant/`, served by a fake `fetch`. Sits next to the
 * demo source: the demo builds datasets directly, this one drives the real HTTP clients,
 * gateways and collectors, so B2 (screens), B5 (E2E) and Phase C (regression) get a dashboard
 * produced by the same code path as a live run.
 */
export const FIXTURE_NOW = new Date('2026-09-30T12:00:00.000Z');

/** Relative to the repository root. */
export const TENANT_FIXTURE_DIR =
  'packages/collector/src/adapters/anthropic/__tests__/fixtures/tenant';

/** Not a credential: the replay fetch ignores it, the HTTP client only needs a non-empty value. */
export const FIXTURE_ENV: NodeJS.ProcessEnv = {
  ANTHROPIC_ENTERPRISE_API_KEY: 'fixture-key-not-used',
};

export async function createFixtureFetch(dir: string): Promise<ReplayFetch> {
  return replayFetch(await loadCaptureEntries(dir));
}

export const defaultFixtureDir = (repositoryRoot: string): string =>
  join(repositoryRoot, TENANT_FIXTURE_DIR);

/** Starting state: key usage has been observed for 120 days, so AK-001 can be evaluated. */
export const fixtureState = (now: Date): CollectorState => ({
  ...initialState(),
  projections: {
    credentialUsage: { observedSince: addDays(now, -120).toISOString(), lastSeen: {} },
  },
});
