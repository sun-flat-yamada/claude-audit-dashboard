import type { DetailManifest } from '@claude-audit/core/contracts';
import { describe, expect, it } from 'vitest';
import {
  actorBadge,
  actorKindLabel,
  activityMonths,
  activityUnavailable,
  filterActivity,
  monthEnd,
  monthLabel,
  NO_ACTIVITY_FILTER,
  pageCount,
  pageSlice,
  uniqueActorKinds,
  uniqueTypes,
  type ActivityItem,
} from '../activity-view';

type ItemOverrides = Partial<Omit<ActivityItem, 'actor'>> & {
  actor?: Partial<ActivityItem['actor']>;
};
const item = (id: string, over: ItemOverrides = {}): ActivityItem => ({
  id,
  type: 'claude_chat_created',
  createdAt: '2026-09-10T08:00:00.000Z',
  organizationId: 'org-1',
  ...over,
  actor: { kind: 'user_actor', id: 'u_1', email: 'a***@example.com', ip: null, ...over.actor },
});

const entry = (over: Record<string, unknown>) => ({
  kind: 'activity',
  path: 'detail/activity-2026-09.json',
  schemaVersion: 1,
  status: 'ok',
  reason: null,
  count: 3,
  month: '2026-09',
  ...over,
});
const manifest = (files: unknown[]) => ({ files }) as unknown as DetailManifest;

describe('activityMonths', () => {
  it('lists ok activity months newest first and ignores other kinds and unavailable entries', () => {
    const m = manifest([
      entry({ month: '2026-07' }),
      entry({ month: '2026-09', count: 9 }),
      entry({ month: '2026-08' }),
      entry({ kind: 'members', month: null }),
      entry({ status: 'unavailable', month: null }),
    ]);
    expect(activityMonths(m).map((x) => x.month)).toEqual(['2026-09', '2026-08', '2026-07']);
    expect(activityMonths(m)[0]?.count).toBe(9);
  });

  it('reports an unavailable dataset with its reason', () => {
    expect(
      activityUnavailable(manifest([entry({ status: 'unavailable', month: null, reason: 'x' })])),
    ).toEqual({ reason: 'x' });
    expect(activityUnavailable(manifest([entry({})]))).toBeNull();
  });
});

describe('filterActivity', () => {
  const rows = [
    item('a', { createdAt: '2026-09-01T00:00:00.000Z' }),
    item('b', {
      type: 'sso_login_failed',
      actor: {
        kind: 'unauthenticated_user_actor',
        id: null,
        email: 'z***@example.com',
        ip: '198.51.100.x',
      },
    }),
    item('c', {
      createdAt: '2026-09-30T23:59:59.000Z',
      organizationId: 'org-2',
      actor: { kind: 'api_actor', email: null },
    }),
  ];
  const ids = (f: Partial<typeof NO_ACTIVITY_FILTER>) =>
    filterActivity(rows, { ...NO_ACTIVITY_FILTER, ...f }).map((r) => r.id);

  it('returns everything without filters', () => expect(ids({})).toEqual(['a', 'b', 'c']));
  it('filters by type and actor kind', () => {
    expect(ids({ type: 'sso_login_failed' })).toEqual(['b']);
    expect(ids({ actorKind: 'api_actor' })).toEqual(['c']);
  });
  it('searches type, actor id, e-mail, IP and organization case-insensitively', () => {
    expect(ids({ query: 'LOGIN_FAILED' })).toEqual(['b']);
    expect(ids({ query: 'z***@' })).toEqual(['b']);
    expect(ids({ query: '198.51' })).toEqual(['b']);
    expect(ids({ query: 'org-2' })).toEqual(['c']);
    expect(ids({ query: 'u_1' })).toEqual(['a', 'c']);
    expect(ids({ query: 'nothing' })).toEqual([]);
  });
  it('treats the date range as inclusive UTC days', () => {
    expect(ids({ from: '2026-09-02' })).toEqual(['b', 'c']);
    expect(ids({ to: '2026-09-01' })).toEqual(['a']);
    expect(ids({ from: '2026-09-30', to: '2026-09-30' })).toEqual(['c']);
    expect(ids({ from: '2026-09-11', to: '2026-09-29' })).toEqual([]);
  });
  it('lists distinct types and actor kinds', () => {
    expect(uniqueTypes(rows)).toEqual(['claude_chat_created', 'sso_login_failed']);
    expect(uniqueActorKinds(rows)).toEqual([
      'api_actor',
      'unauthenticated_user_actor',
      'user_actor',
    ]);
  });
});

describe('paging', () => {
  const rows = Array.from({ length: 120 }, (_, i) => i);
  it('counts pages with at least one', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(pageCount(120)).toBe(3);
  });
  it('slices and clamps the page', () => {
    expect(pageSlice(rows, 1)).toHaveLength(50);
    expect(pageSlice(rows, 3)).toEqual(rows.slice(100));
    expect(pageSlice(rows, 99)).toEqual(rows.slice(100));
    expect(pageSlice(rows, 0)[0]).toBe(0);
    expect(pageSlice([], 1)).toEqual([]);
  });
});

describe('labels', () => {
  it('names actor kinds and maps unknown kinds to a shared badge', () => {
    expect(actorKindLabel('api_actor')).toBe('API key');
    expect(actorKindLabel('new_thing_actor')).toBe('New thing');
    expect(actorKindLabel('')).toBe('Unknown');
    expect(actorBadge('user_actor')).toBe('actor-user_actor');
    expect(actorBadge('new_thing_actor')).toBe('actor-other');
  });
  it('formats months', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(monthEnd('2026-09')).toBe('2026-09-30');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
  });
});
