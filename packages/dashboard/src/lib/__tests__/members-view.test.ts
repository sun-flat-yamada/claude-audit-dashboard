import { describe, expect, it } from 'vitest';
import {
  countByStatus,
  filterMembers,
  memberStatus,
  roleLabel,
  sortMembers,
  uniqueRoles,
  type Member,
} from '../members-view';

const make = (id: string, over: Partial<Member> = {}): Member => ({
  id,
  email: `${id}***@example.com`,
  name: `Name ${id}`,
  role: 'user',
  organizationId: null,
  joinedAt: null,
  active: true,
  lastActiveOn: '2026-09-20',
  ...over,
});
const MEMBERS = [
  make('a', { role: 'owner', lastActiveOn: '2026-09-28' }),
  make('b', { active: false, lastActiveOn: null }),
  make('c', { active: null, lastActiveOn: null, role: 'primary_owner' }),
  make('d', { active: false, lastActiveOn: '2026-05-01' }),
];

describe('memberStatus', () => {
  it('maps the collector flag, keeping "not collected" apart from inactive', () => {
    expect(memberStatus({ active: true })).toBe('active');
    expect(memberStatus({ active: false })).toBe('inactive');
    expect(memberStatus({ active: null })).toBe('unknown');
  });
});

describe('roleLabel / uniqueRoles', () => {
  it('humanises role ids and lists each role once, sorted', () => {
    expect(roleLabel('primary_owner')).toBe('Primary owner');
    expect(uniqueRoles(MEMBERS)).toEqual(['owner', 'primary_owner', 'user']);
  });
});

describe('filterMembers', () => {
  const all = { query: '', role: 'all', status: 'all' } as const;
  it('returns everything for the empty filter', () => {
    expect(filterMembers(MEMBERS, all)).toHaveLength(4);
  });
  it('filters by status and by role', () => {
    expect(filterMembers(MEMBERS, { ...all, status: 'inactive' }).map((m) => m.id)).toEqual([
      'b',
      'd',
    ]);
    expect(filterMembers(MEMBERS, { ...all, role: 'owner' }).map((m) => m.id)).toEqual(['a']);
  });
  it('searches name, e-mail and role case-insensitively', () => {
    expect(filterMembers(MEMBERS, { ...all, query: ' NAME C ' }).map((m) => m.id)).toEqual(['c']);
    expect(filterMembers(MEMBERS, { ...all, query: 'name c' }).map((m) => m.id)).toEqual(['c']);
    expect(filterMembers(MEMBERS, { ...all, query: 'primary owner' }).map((m) => m.id)).toEqual([
      'c',
    ]);
    expect(filterMembers(MEMBERS, { ...all, query: 'D***@EXAMPLE' }).map((m) => m.id)).toEqual([
      'd',
    ]);
  });
  it('combines filters and can match nothing', () => {
    expect(filterMembers(MEMBERS, { ...all, status: 'active', role: 'user' })).toEqual([]);
  });
});

describe('countByStatus', () => {
  it('counts every status, including zero', () => {
    expect(countByStatus(MEMBERS)).toEqual({ active: 1, inactive: 2, unknown: 1 });
    expect(countByStatus([])).toEqual({ active: 0, inactive: 0, unknown: 0 });
  });
});

describe('sortMembers', () => {
  const ids = (key: Parameters<typeof sortMembers>[1], dir: 'asc' | 'desc') =>
    sortMembers(MEMBERS, key, dir).map((m) => m.id);
  it('puts inactive first by status and does not mutate the input', () => {
    const before = MEMBERS.map((m) => m.id);
    expect(ids('status', 'asc')).toEqual(['b', 'd', 'c', 'a']);
    expect(MEMBERS.map((m) => m.id)).toEqual(before);
  });
  it('sorts by last activity with undated members oldest', () => {
    expect(ids('lastActiveOn', 'asc')).toEqual(['b', 'c', 'd', 'a']);
    expect(ids('lastActiveOn', 'desc')).toEqual(['a', 'd', 'b', 'c']);
  });
  it('sorts by name and role', () => {
    expect(ids('name', 'desc')).toEqual(['d', 'c', 'b', 'a']);
    expect(ids('role', 'asc')).toEqual(['a', 'c', 'b', 'd']);
  });
});
