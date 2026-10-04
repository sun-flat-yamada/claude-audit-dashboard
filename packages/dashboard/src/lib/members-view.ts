import type { DetailMembers } from '@claude-audit/core/contracts';

export type Member = DetailMembers['members'][number];
export type MemberStatus = 'active' | 'inactive' | 'unknown';
export const MEMBER_STATUSES: readonly MemberStatus[] = ['active', 'inactive', 'unknown'];

export type StatusFilter = MemberStatus | 'all';
export type SortKey = 'name' | 'role' | 'lastActiveOn' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface MemberFilter {
  /** Case-insensitive match on name, e-mail and role. */
  query: string;
  /** Exact role, or `all`. */
  role: string;
  status: StatusFilter;
}

/**
 * AC-001 outcome as the collector recorded it (`active` is derived there from the effective
 * `inactiveDays` threshold). `null` means member activity was not collected, which must not be
 * shown as inactive.
 */
export function memberStatus(member: Pick<Member, 'active'>): MemberStatus {
  if (member.active === null) return 'unknown';
  return member.active ? 'active' : 'inactive';
}

/** `primary_owner` -> `Primary owner`. */
export function roleLabel(role: string): string {
  const text = role.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function uniqueRoles(members: readonly Member[]): string[] {
  return [...new Set(members.map((m) => m.role))].sort();
}

export function filterMembers(members: readonly Member[], filter: MemberFilter): Member[] {
  const query = filter.query.trim().toLowerCase();
  return members.filter((m) => {
    if (filter.role !== 'all' && m.role !== filter.role) return false;
    if (filter.status !== 'all' && memberStatus(m) !== filter.status) return false;
    if (!query) return true;
    return [m.name, m.email, m.role, roleLabel(m.role)].some((v) =>
      v.toLowerCase().includes(query),
    );
  });
}

export function countByStatus(members: readonly Member[]): Record<MemberStatus, number> {
  const counts: Record<MemberStatus, number> = { active: 0, inactive: 0, unknown: 0 };
  for (const m of members) counts[memberStatus(m)] += 1;
  return counts;
}

const STATUS_ORDER: Record<MemberStatus, number> = { inactive: 0, unknown: 1, active: 2 };

function compare(a: Member, b: Member, key: SortKey): number {
  switch (key) {
    case 'role':
      return a.role.localeCompare(b.role);
    case 'status':
      return STATUS_ORDER[memberStatus(a)] - STATUS_ORDER[memberStatus(b)];
    case 'lastActiveOn':
      // Members without a date sort as the oldest.
      return (a.lastActiveOn ?? '').localeCompare(b.lastActiveOn ?? '');
    default:
      return a.name.localeCompare(b.name);
  }
}

/** Stable sort; ties fall back to the (masked) id so the order is deterministic. */
export function sortMembers(
  members: readonly Member[],
  key: SortKey,
  direction: SortDirection,
): Member[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...members].sort((a, b) => sign * compare(a, b, key) || a.id.localeCompare(b.id));
}
