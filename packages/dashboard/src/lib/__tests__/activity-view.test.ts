import type { DetailManifest } from '@claude-audit/core/contracts';
import { describe, expect, it } from 'vitest';
import {
  actorBadge,
  actorKindLabel,
  activityMonths,
  activityUnavailable,
  dailyActivityCounts,
  filterActivity,
  formatActivityQuery,
  matchActivityRules,
  monthEnd,
  monthLabel,
  NO_ACTIVITY_FILTER,
  pageCount,
  pageSlice,
  parseActivityQuery,
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
  schemaVersion: 2,
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

describe('rule matching', () => {
  it('matches AM-001 for role changes and AM-004 for api key lifecycle', () => {
    const roleItem = item('1', { type: 'primary_owner_transferred' });
    const keyItem = item('2', { type: 'api_key_created' });
    const chatItem = item('3', { type: 'claude_chat_created' });

    expect(matchActivityRules(roleItem)).toEqual(['AM-001']);
    expect(matchActivityRules(keyItem)).toEqual(['AM-004']);
    expect(matchActivityRules(chatItem)).toEqual([]);
  });

  it('filters activity by rule match (all, any, specific rule ID)', () => {
    const r1 = item('1', { type: 'primary_owner_transferred' });
    const r2 = item('2', { type: 'api_key_created' });
    const r3 = item('3', { type: 'claude_chat_created' });
    const list = [r1, r2, r3];

    expect(filterActivity(list, { ...NO_ACTIVITY_FILTER, rule: 'all' })).toHaveLength(3);
    expect(filterActivity(list, { ...NO_ACTIVITY_FILTER, rule: 'any' })).toEqual([r1, r2]);
    expect(filterActivity(list, { ...NO_ACTIVITY_FILTER, rule: 'AM-001' })).toEqual([r1]);
    expect(filterActivity(list, { ...NO_ACTIVITY_FILTER, rule: 'AM-004' })).toEqual([r2]);
    expect(filterActivity(list, { ...NO_ACTIVITY_FILTER, rule: 'AM-002' })).toEqual([]);
  });
});

describe('dailyActivityCounts', () => {
  it('aggregates events across days in the month and fills days with 0', () => {
    const list = [
      item('1', { createdAt: '2026-09-01T08:00:00.000Z' }),
      item('2', { createdAt: '2026-09-01T12:00:00.000Z' }),
      item('3', { createdAt: '2026-09-05T15:00:00.000Z' }),
    ];
    const counts = dailyActivityCounts(list, '2026-09');
    expect(counts).toHaveLength(30);
    expect(counts[0]).toEqual({ date: '2026-09-01', day: 1, count: 2 });
    expect(counts[1]).toEqual({ date: '2026-09-02', day: 2, count: 0 });
    expect(counts[4]).toEqual({ date: '2026-09-05', day: 5, count: 1 });
  });

  it('returns empty array when month is missing', () => {
    expect(dailyActivityCounts([], '')).toEqual([]);
  });
});

describe('parseActivityQuery and formatActivityQuery', () => {
  const months = ['2026-09', '2026-08'];

  it('parses empty query into default state', () => {
    const state = parseActivityQuery({}, months);
    expect(state.month).toBe('2026-09');
    expect(state.page).toBe(1);
    expect(state.filter).toEqual(NO_ACTIVITY_FILTER);
  });

  it('parses valid query parameters and ignores unknown keys', () => {
    const state = parseActivityQuery(
      {
        month: '2026-08',
        q: 'search-term',
        type: 'api_key_created',
        actorKind: 'user_actor',
        from: '2026-08-01',
        to: '2026-08-15',
        rule: 'AM-004',
        page: '3',
        unknown: 'ignore-me',
      },
      months,
    );
    expect(state.month).toBe('2026-08');
    expect(state.page).toBe(3);
    expect(state.filter.query).toBe('search-term');
    expect(state.filter.type).toBe('api_key_created');
    expect(state.filter.actorKind).toBe('user_actor');
    expect(state.filter.from).toBe('2026-08-01');
    expect(state.filter.to).toBe('2026-08-15');
    expect(state.filter.rule).toBe('AM-004');
  });

  it('falls back to default month if given unknown month', () => {
    const state = parseActivityQuery({ month: '2020-01' }, months);
    expect(state.month).toBe('2026-09');
  });

  it('falls back to page 1 on invalid page number', () => {
    expect(parseActivityQuery({ page: '-1' }, months).page).toBe(1);
    expect(parseActivityQuery({ page: 'abc' }, months).page).toBe(1);
  });

  it('formats state into query omitting defaults', () => {
    const formatted = formatActivityQuery(
      {
        month: '2026-09',
        page: 1,
        filter: NO_ACTIVITY_FILTER,
      },
      '2026-09',
    );
    expect(formatted).toEqual({});
  });

  it('formats non-default values into query', () => {
    const formatted = formatActivityQuery(
      {
        month: '2026-08',
        page: 2,
        filter: {
          query: 'test',
          type: 'api_key_created',
          actorKind: 'all',
          from: '',
          to: '',
          rule: 'AM-004',
        },
      },
      '2026-09',
    );
    expect(formatted).toEqual({
      month: '2026-08',
      page: '2',
      q: 'test',
      type: 'api_key_created',
      rule: 'AM-004',
    });
  });
});
