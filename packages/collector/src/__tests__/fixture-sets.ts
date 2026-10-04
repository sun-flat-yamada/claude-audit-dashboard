import { fileURLToPath } from 'node:url';
import { replayFetch } from '../adapters/anthropic/replay-fetch.js';
import { loadCaptureEntries } from '../adapters/anthropic/raw-capture.js';
import { fakeAnthropic, type FakeApi, type Handler } from './fake-anthropic.js';

/**
 * The API fixtures the adapter tests run against. `official` follows the examples in the
 * official references; `tenant` is the sanitized, tenant-shaped capture under
 * `adapters/anthropic/__tests__/fixtures/tenant/` (more records, several pages, unknown
 * actors, activity from keys that are in the key inventory). The numbers are what each set holds.
 */
export interface FixtureSet {
  name: string;
  members: number;
  activities: number;
  groups: number;
  invites: number;
  userSpendLimits: number;
  costAsOf: string;
  api(overrides?: Record<string, Handler>): FakeApi;
}

export const OFFICIAL_SET: FixtureSet = {
  name: 'official examples',
  members: 2,
  activities: 2,
  groups: 1,
  invites: 1,
  userSpendLimits: 2,
  costAsOf: '2026-09-30T06:00:00Z',
  api: (overrides) => fakeAnthropic(overrides),
};

export const TENANT_FIXTURE_URL = new URL(
  '../adapters/anthropic/__tests__/fixtures/tenant/',
  import.meta.url,
);

export async function tenantSet(): Promise<FixtureSet> {
  const replay = await loadCaptureEntries(fileURLToPath(TENANT_FIXTURE_URL));
  return {
    name: 'tenant shape',
    members: 14,
    activities: 14,
    groups: 3,
    invites: 2,
    userSpendLimits: 14,
    costAsOf: '2026-09-30T06:00:00Z',
    api(overrides = {}) {
      const base = replayFetch(replay);
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const handler = overrides[url.pathname];
        if (!handler) return base.fetch(input);
        base.calls.push(url);
        const result = handler(url);
        return new Response(JSON.stringify(result.body), {
          status: result.status ?? 200,
          headers: { 'content-type': 'application/json', ...(result.headers ?? {}) },
        });
      }) as typeof fetch;
      return { fetch: fetchImpl, calls: base.calls };
    },
  };
}

export const FIXTURE_SETS: FixtureSet[] = [OFFICIAL_SET, await tenantSet()];
