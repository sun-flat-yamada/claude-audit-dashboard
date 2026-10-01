import { z } from 'zod';
import type { Member, MemberActivity } from '../../model/entities.js';
import { ADMIN_ROLES, PRIMARY_OWNER_ROLE } from '../../model/vocabulary.js';
import { groupBy } from '../../util/collections.js';
import { percent } from '../../util/numbers.js';
import { addDays, daysBetween, toIsoDate } from '../../util/time.js';
import { defineRule } from '../define-rule.js';
import { failIfAny, skip, type Evidence } from '../types.js';

const memberEvidence = (m: Member): Evidence => ({
  kind: 'member',
  id: m.id,
  label: m.email,
  data: { role: m.role },
});

/** Members listed without an organization come from a single-organization source. */
const orgKey = (m: Member): string => m.organizationId ?? 'organization';

/** User ids and lower-cased emails with activity on or after `cutoffDay`. */
function recentlyActive(rows: readonly MemberActivity[], cutoffDay: string): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const recent = row.lastActiveOn ? row.lastActiveOn >= cutoffDay : row.active;
    if (!recent) continue;
    keys.add(row.userId);
    if (row.email) keys.add(row.email.toLowerCase());
  }
  return keys;
}

export const inactiveMembers = defineRule({
  meta: {
    id: 'AC-001',
    name: 'Inactive Members',
    category: 'access-control',
    severity: 'medium',
    description:
      'Members without counted Claude activity (Enterprise Analytics) for longer than the threshold',
    remediation: 'Review these members and remove the ones who no longer need a seat.',
  },
  requires: ['members', 'memberActivity'],
  params: z.object({ inactiveDays: z.number().int().positive().default(90) }),
  evaluate({ data, coverage, params, now }) {
    const cutoff = addDays(now, -params.inactiveDays);
    const from = coverage.memberActivity?.window?.from;
    if (!from || new Date(from) > cutoff) {
      return skip(
        `Activity window starts ${from ?? 'unknown'}; ${params.inactiveDays} days needed`,
      );
    }
    const active = recentlyActive(data.memberActivity, toIsoDate(cutoff));
    const stale = data.members.filter(
      (m) =>
        !active.has(m.id) &&
        !active.has(m.email.toLowerCase()) &&
        (!m.joinedAt || new Date(m.joinedAt) <= cutoff),
    );
    return failIfAny(
      stale,
      {
        pass: 'Every member was active within the window',
        fail: (n) => `${n} member(s) without activity in the last ${params.inactiveDays} days`,
      },
      memberEvidence,
    );
  },
});

export const excessiveAdmins = defineRule({
  meta: {
    id: 'AC-002',
    name: 'Excessive Administrative Roles',
    category: 'access-control',
    severity: 'high',
    description: 'Share of members holding administrative built-in roles, per organization',
    remediation: 'Apply least privilege: keep day-to-day members on the user or managed role.',
  },
  requires: ['members'],
  params: z.object({
    maxAdminPercentage: z.number().min(0).max(100).default(20),
    adminRoles: z.array(z.string()).default([...ADMIN_ROLES]),
    minMembers: z.number().int().min(1).default(1),
  }),
  evaluate({ data, params }) {
    const orgs = [...groupBy(data.members, orgKey)]
      .map(([id, members]) => {
        const admins = members.filter((m) => params.adminRoles.includes(m.role)).length;
        return { id, admins, total: members.length, share: percent(admins, members.length) };
      })
      .filter((org) => org.total >= params.minMembers);
    if (orgs.length === 0) return skip('No organization has enough members to evaluate');
    return failIfAny(
      orgs.filter((org) => org.share > params.maxAdminPercentage),
      {
        pass: `Administrative share within ${params.maxAdminPercentage}% in ${orgs.length} organization(s)`,
        fail: (n) =>
          `${n} organization(s) exceed ${params.maxAdminPercentage}% administrative members`,
      },
      (org) => ({
        kind: 'organization',
        id: org.id,
        label: `${org.admins}/${org.total} administrative members (${org.share}%)`,
      }),
    );
  },
});

export const primaryOwner = defineRule({
  meta: {
    id: 'AC-003',
    name: 'Single Primary Owner',
    category: 'access-control',
    severity: 'critical',
    description: 'Each organization must have exactly one primary owner',
    remediation: 'Assign or transfer the primary owner role in claude.ai organization settings.',
  },
  requires: ['members'],
  params: z.object({ ownerRoles: z.array(z.string()).default([PRIMARY_OWNER_ROLE]) }),
  evaluate({ data, params }) {
    const orgs = [...groupBy(data.members, orgKey)].map(([id, members]) => ({
      id,
      owners: members.filter((m) => params.ownerRoles.includes(m.role)).length,
    }));
    if (orgs.length === 0) return skip('No members collected');
    return failIfAny(
      orgs.filter((org) => org.owners !== 1),
      {
        pass: `Exactly one primary owner in ${orgs.length} organization(s)`,
        fail: (n) => `${n} organization(s) without exactly one primary owner`,
      },
      (org) => ({ kind: 'organization', id: org.id, label: `${org.owners} primary owner(s)` }),
    );
  },
});

export const stalePendingInvites = defineRule({
  meta: {
    id: 'AC-004',
    name: 'Stale Pending Invites',
    category: 'access-control',
    severity: 'low',
    description: 'Invitations pending longer than the threshold (they hold seats and grant access)',
    remediation: 'Withdraw invitations that are no longer needed.',
  },
  requires: ['invites'],
  params: z.object({ maxPendingDays: z.number().int().positive().default(30) }),
  evaluate({ data, params, now }) {
    return failIfAny(
      data.invites.filter(
        (i) => i.status === 'pending' && daysBetween(i.invitedAt, now) > params.maxPendingDays,
      ),
      {
        pass: 'No stale pending invites',
        fail: (n) => `${n} invite(s) pending for more than ${params.maxPendingDays} days`,
      },
      (i) => ({
        kind: 'invite',
        id: i.id,
        label: `${i.email} (invited ${i.invitedAt.slice(0, 10)})`,
      }),
    );
  },
});

export const accessControlRules = [
  inactiveMembers,
  excessiveAdmins,
  primaryOwner,
  stalePendingInvites,
];
