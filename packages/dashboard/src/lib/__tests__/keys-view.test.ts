import { describe, expect, it } from 'vitest';
import {
  countByRecommendation,
  daysBetween,
  filterKeys,
  hasWriteScope,
  keyAgeDays,
  keyFindings,
  keyRecommendation,
  scopeLabel,
  sortKeys,
  usesComplianceApi,
  type ApiKey,
  type KeyContext,
} from '../keys-view';

const NOW = '2026-09-29T12:00:00.000Z';
const ctx: KeyContext = {
  now: NOW,
  unusedDays: 30,
  maxAgeDays: 180,
  usageObservedFrom: '2026-06-01T12:00:00.000Z',
};
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();
const key = (id: string, over: Partial<ApiKey> = {}): ApiKey => ({
  id,
  name: `Key ${id}`,
  scopes: ['read:compliance_activities'],
  active: true,
  createdAt: daysAgo(10),
  expiresAt: null,
  createdBy: null,
  lastSeenAt: daysAgo(1),
  ...over,
});

describe('daysBetween / keyAgeDays', () => {
  it('floors whole days, never goes negative, and rejects bad dates', () => {
    expect(daysBetween(daysAgo(2.9), NOW)).toBe(2);
    expect(daysBetween(NOW, daysAgo(5))).toBe(0);
    expect(daysBetween('nope', NOW)).toBeNull();
    expect(keyAgeDays(key('a', { createdAt: daysAgo(400) }), ctx)).toBe(400);
  });
});

describe('keyRecommendation', () => {
  it('flags age exactly one day over the limit, not at the limit (AK-003)', () => {
    expect(keyRecommendation(key('a', { createdAt: daysAgo(180) }), ctx)).toBe('rotate_soon');
    expect(keyRecommendation(key('a', { createdAt: daysAgo(181) }), ctx)).toBe('rotate');
  });

  it('starts "rotate soon" at 80% of the limit', () => {
    expect(keyRecommendation(key('a', { createdAt: daysAgo(143) }), ctx)).toBe('ok');
    expect(keyRecommendation(key('a', { createdAt: daysAgo(144) }), ctx)).toBe('rotate_soon');
  });

  it('flags non-use past the limit, not at it (AK-001)', () => {
    expect(keyRecommendation(key('a', { lastSeenAt: daysAgo(30) }), ctx)).toBe('ok');
    expect(keyRecommendation(key('a', { lastSeenAt: daysAgo(31) }), ctx)).toBe('unused');
  });

  it('treats a never-seen key as unused only when the observation window is long enough', () => {
    const never = key('a', { lastSeenAt: null });
    expect(keyRecommendation(never, ctx)).toBe('unused');
    expect(keyRecommendation(never, { ...ctx, usageObservedFrom: daysAgo(29) })).toBe('unknown');
    expect(keyRecommendation(never, { ...ctx, usageObservedFrom: null })).toBe('unknown');
    expect(keyRecommendation(never, { ...ctx, usageObservedFrom: daysAgo(30) })).toBe('unused');
  });

  it('ignores usage for keys without Compliance API scopes', () => {
    const analytics = key('a', { scopes: ['read:analytics'], lastSeenAt: null });
    expect(keyRecommendation(analytics, ctx)).toBe('ok');
  });

  it('flags write and delete scopes (AK-002)', () => {
    expect(keyRecommendation(key('a', { scopes: ['read:members', 'write:members'] }), ctx)).toBe(
      'privileged',
    );
    expect(hasWriteScope(['delete:compliance_user_data'])).toBe(true);
    expect(hasWriteScope(['read:members'])).toBe(false);
    expect(usesComplianceApi(['read:org_audit'])).toBe(true);
    expect(usesComplianceApi(['read:analytics'])).toBe(false);
  });

  it('orders findings by urgency and exposes every reason', () => {
    const k = key('a', {
      createdAt: daysAgo(400),
      lastSeenAt: null,
      scopes: ['delete:compliance_user_data'],
    });
    expect(keyFindings(k, ctx).map((f) => f.kind)).toEqual(['rotate', 'unused', 'privileged']);
    expect(keyRecommendation(k, ctx)).toBe('rotate');
  });

  it('reports an expired key as rotate', () => {
    const k = key('a', { expiresAt: daysAgo(2) });
    expect(keyFindings(k, ctx)[0]?.kind).toBe('expired');
    expect(keyRecommendation(k, ctx)).toBe('rotate');
  });

  it('gives deactivated keys no findings, however old', () => {
    const k = key('a', { active: false, createdAt: daysAgo(900), scopes: ['write:members'] });
    expect(keyFindings(k, ctx)).toEqual([]);
    expect(keyRecommendation(k, ctx)).toBe('inactive');
  });

  it('is ok for a fresh, recently used key', () => {
    expect(keyRecommendation(key('a'), ctx)).toBe('ok');
  });
});

describe('filter, sort, counts', () => {
  const keys = [
    key('k_b', { name: 'Beta', createdAt: daysAgo(400) }),
    key('k_a', { name: 'Alpha', lastSeenAt: null, scopes: ['read:members'] }),
    key('k_c', { name: 'Gamma', active: false, createdAt: daysAgo(30) }),
  ];

  it('filters by recommendation and by name, id and scope text', () => {
    const all = { query: '', recommendation: 'all' as const };
    expect(filterKeys(keys, { ...all, recommendation: 'rotate' }, ctx).map((k) => k.id)).toEqual([
      'k_b',
    ]);
    expect(filterKeys(keys, { ...all, query: 'ALPHA' }, ctx)).toHaveLength(1);
    expect(filterKeys(keys, { ...all, query: 'k_c' }, ctx)).toHaveLength(1);
    expect(filterKeys(keys, { ...all, query: 'read:members' }, ctx)).toHaveLength(1);
    expect(filterKeys(keys, { ...all, query: 'zzz' }, ctx)).toHaveLength(0);
  });

  it('counts by recommendation', () => {
    expect(countByRecommendation(keys, ctx)).toMatchObject({ rotate: 1, ok: 1, inactive: 1 });
  });

  it('sorts by name, age, last use and recommendation, both directions', () => {
    const ids = (k: ApiKey[]) => k.map((x) => x.id);
    expect(ids(sortKeys(keys, 'name', 'asc', ctx))).toEqual(['k_a', 'k_b', 'k_c']);
    expect(ids(sortKeys(keys, 'age', 'desc', ctx))).toEqual(['k_b', 'k_c', 'k_a']);
    expect(ids(sortKeys(keys, 'lastSeen', 'asc', ctx))[0]).toBe('k_a');
    expect(ids(sortKeys(keys, 'recommendation', 'asc', ctx))).toEqual(['k_b', 'k_a', 'k_c']);
    expect(ids(sortKeys(keys, 'name', 'desc', ctx))).toEqual(['k_c', 'k_b', 'k_a']);
  });
});

describe('scopeLabel', () => {
  it('makes scope identifiers readable', () => {
    expect(scopeLabel('read:compliance_activities')).toBe('read: compliance activities');
  });
});
