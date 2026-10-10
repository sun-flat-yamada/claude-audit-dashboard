import type { DetailMembers, DetailOrgGroups } from '@claude-audit/core/contracts';

export type Organization = DetailOrgGroups['organizations'][number];
export type Group = DetailOrgGroups['groups'][number];
export type Deviation = DetailOrgGroups['deviations'][number];
export type Member = DetailMembers['members'][number];

export interface OrgSummary {
  organization: Organization;
  deviations: number;
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** Failing first, then by severity, then by rule id; deterministic. */
export function sortDeviations(deviations: readonly Deviation[]): Deviation[] {
  const rank = (d: Deviation): number => (d.status === 'fail' ? 0 : 1);
  return [...deviations].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

/** Deviations of one organization; `null` selects the unattributed bucket. */
export function deviationsFor(
  data: Pick<DetailOrgGroups, 'deviations'>,
  organizationId: string | null,
): Deviation[] {
  return sortDeviations(data.deviations.filter((d) => d.organizationId === organizationId));
}

export function orgSummaries(data: DetailOrgGroups): OrgSummary[] {
  return data.organizations.map((organization) => ({
    organization,
    deviations: data.deviations.filter((d) => d.organizationId === organization.id).length,
  }));
}

export function findOrganization(data: DetailOrgGroups, id: string): Organization | undefined {
  return data.organizations.find((o) => o.id === id);
}

export function findGroup(data: DetailOrgGroups, id: string): Group | undefined {
  return data.groups.find((g) => g.id === id);
}

/** True when at least one member carries an organization (otherwise a join would be empty). */
export function membersAreScoped(members: readonly Member[]): boolean {
  return members.some((m) => m.organizationId !== null);
}

export function membersOfOrganization(members: readonly Member[], id: string): Member[] {
  return members
    .filter((m) => m.organizationId === id)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function membersOfGroup(members: readonly Member[], group: Group): Member[] {
  const ids = new Set(group.memberIds);
  return members
    .filter((m) => ids.has(m.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * Share of the largest group's month-to-date spend, 0-100, or null without a cost figure.
 * Groups overlap, so shares are relative to the largest group and are never summed.
 */
export function spendShare(group: Group, groups: readonly Group[]): number | null {
  if (group.monthToDateCost === null) return null;
  const max = Math.max(0, ...groups.map((g) => g.monthToDateCost ?? 0));
  return max > 0 ? Math.round((group.monthToDateCost / max) * 100) : 0;
}

/** Case-insensitive match on name, id and source. */
export function filterGroups(groups: readonly Group[], query: string): Group[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...groups];
  return groups.filter((g) => [g.name, g.id, g.source].some((v) => v.toLowerCase().includes(q)));
}

export function filterOrganizations(summaries: readonly OrgSummary[], query: string): OrgSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...summaries];
  return summaries.filter(({ organization: o }) =>
    [o.name, o.id].some((v) => v.toLowerCase().includes(q)),
  );
}
