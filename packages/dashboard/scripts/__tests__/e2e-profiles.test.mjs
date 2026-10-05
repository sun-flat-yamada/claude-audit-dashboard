import { describe, expect, it } from 'vitest';
import {
  assertNotLive,
  assertSynthetic,
  BASE_PATH,
  originOf,
  PROFILES,
  portOf,
} from '../e2e-profiles.mjs';

describe('E2E data profiles', () => {
  it('refuses the live data source, whatever the spelling of the request', () => {
    expect(() => assertNotLive({ DASHBOARD_DATA_SOURCE: 'live' })).toThrow(/never live data/);
    expect(() => assertNotLive({ DASHBOARD_DATA_SOURCE: 'anything-else' })).toThrow();
    expect(() => assertNotLive({})).not.toThrow();
    expect(() => assertNotLive({ DASHBOARD_DATA_SOURCE: 'sample' })).not.toThrow();
    expect(() => assertNotLive({ DASHBOARD_DATA_SOURCE: 'fixtures' })).not.toThrow();
  });

  it('only accepts dashboards labelled as the demo tenant', () => {
    expect(() => assertSynthetic({ source: 'demo' }, 'x')).not.toThrow();
    expect(() => assertSynthetic({ source: 'live' }, 'x')).toThrow(/no live data/);
    expect(() => assertSynthetic(null, 'x')).toThrow();
  });

  it('reads synthetic repository directories only and never the live data/dashboard.json', () => {
    for (const profile of PROFILES) {
      expect(['data/sample', 'data/fixture', 'data/sample-optional-sources']).toContain(
        profile.source,
      );
    }
  });

  it('gives every profile a unique name and port and serves under the Pages base path', () => {
    expect(new Set(PROFILES.map((p) => p.name)).size).toBe(PROFILES.length);
    expect(new Set(PROFILES.map((p) => portOf(p.name))).size).toBe(PROFILES.length);
    expect(BASE_PATH).toBe('/claude-audit-dashboard/');
    expect(originOf('sample')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(() => portOf('nope')).toThrow(/Unknown E2E profile/);
  });
});
