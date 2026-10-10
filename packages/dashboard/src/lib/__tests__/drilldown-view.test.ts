import { describe, expect, it } from 'vitest';
import type { DetailOrgGroups } from '@claude-audit/core/contracts';
import {
  deviationsFor,
  filterGroups,
  filterOrganizations,
  findGroup,
  findOrganization,
  membersAreScoped,
  membersOfGroup,
  membersOfOrganization,
  orgSummaries,
  sortDeviations,
  spendShare,
  type Deviation,
  type Group,
  type Member,
} from '../drilldown-view';

const dev = (over: Partial<Deviation>): Deviation => ({
  ruleId: 'CF-001',
  ruleName: 'Rule',
  severity: 'medium',
  status: 'fail',
  organizationId: 'o1',
  message: 'm',
  ...over,
});
const group = (over: Partial<Group>): Group => ({
  id: 'g',
  name: 'G',
  source: 'direct',
  memberCount: 1,
  monthToDateCost: 10,
  ...over,
});
const member = (id: string, organizationId: string | null, name = id): Member => ({
  id,
  email: 'a@example.com',
  name,
  role: 'user',
  organizationId,
  joinedAt: null,
  active: true,
  lastActiveOn: null,
});
const data: DetailOrgGroups = {
  schemaVersion: 2,
  generatedAt: '2026-09-29T12:00:00.000Z',
  currency: 'USD',
  organizations: [
    { id: 'o1', name: 'Alpha', memberCount: 2 },
    { id: 'o2', name: 'Beta', memberCount: null },
  ],
  groups: [
    group({ id: 'g1', name: 'Eng', monthToDateCost: 200 }),
    group({ id: 'g2', name: 'Ops' }),
  ],
  deviations: [
    dev({ ruleId: 'CF-003' }),
    dev({ ruleId: 'CF-001', severity: 'high' }),
    dev({ ruleId: 'CF-002', status: 'warning', severity: 'critical' }),
    dev({ ruleId: 'CF-009', organizationId: null }),
  ],
};

describe('deviations', () => {
  it('sorts failing first, then by severity, then rule id', () => {
    expect(sortDeviations(data.deviations.slice(0, 3)).map((d) => d.ruleId)).toEqual([
      'CF-001',
      'CF-003',
      'CF-002',
    ]);
  });

  it('selects an organization or the unattributed bucket by exact id', () => {
    expect(deviationsFor(data, 'o1')).toHaveLength(3);
    expect(deviationsFor(data, 'o2')).toEqual([]);
    expect(deviationsFor(data, null).map((d) => d.ruleId)).toEqual(['CF-009']);
    expect(deviationsFor(data, 'missing')).toEqual([]);
  });

  it('counts deviations per organization without counting unattributed ones', () => {
    expect(orgSummaries(data).map((s) => s.deviations)).toEqual([3, 0]);
  });
});

describe('lookup and filters', () => {
  it('finds entities and returns undefined for unknown ids', () => {
    expect(findOrganization(data, 'o2')?.name).toBe('Beta');
    expect(findOrganization(data, 'x')).toBeUndefined();
    expect(findGroup(data, 'g1')?.name).toBe('Eng');
    expect(findGroup(data, 'x')).toBeUndefined();
  });

  it('filters by name, id and source, case-insensitively', () => {
    expect(filterGroups(data.groups, ' ENG ').map((g) => g.id)).toEqual(['g1']);
    expect(filterGroups(data.groups, 'direct')).toHaveLength(2);
    expect(filterGroups(data.groups, '')).toHaveLength(2);
    expect(filterOrganizations(orgSummaries(data), 'beta')).toHaveLength(1);
    expect(filterOrganizations(orgSummaries(data), 'zzz')).toEqual([]);
    expect(filterOrganizations(orgSummaries(data), '')).toHaveLength(2);
  });
});

describe('members join', () => {
  const members = [member('u2', 'o1', 'Zed'), member('u1', 'o1', 'Amy'), member('u3', null)];

  it('joins by organization id only and sorts by name', () => {
    expect(membersOfOrganization(members, 'o1').map((m) => m.id)).toEqual(['u1', 'u2']);
    expect(membersOfOrganization(members, 'o9')).toEqual([]);
  });

  it('joins by group memberIds and sorts by name', () => {
    const g = group({ memberIds: ['u2', 'u1', 'missing'] });
    expect(membersOfGroup(members, g).map((m) => m.id)).toEqual(['u1', 'u2']);
    expect(membersOfGroup(members, group({ memberIds: [] }))).toEqual([]);
    expect(membersOfGroup(members, group({ memberIds: undefined }))).toEqual([]);
  });

  it('detects members that carry no organization at all', () => {
    expect(membersAreScoped(members)).toBe(true);
    expect(membersAreScoped([member('u', null)])).toBe(false);
    expect(membersAreScoped([])).toBe(false);
  });
});

describe('spendShare', () => {
  it('is relative to the largest group and null without cost', () => {
    expect(spendShare(data.groups[0] as Group, data.groups)).toBe(100);
    expect(spendShare(data.groups[1] as Group, data.groups)).toBe(5);
    expect(spendShare(group({ monthToDateCost: null }), data.groups)).toBeNull();
  });

  it('is 0 when every group has zero spend', () => {
    const zero = [group({ monthToDateCost: 0 })];
    expect(spendShare(zero[0] as Group, zero)).toBe(0);
  });
});
