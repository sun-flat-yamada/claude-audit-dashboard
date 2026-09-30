import type { ComplianceRulePlugin } from '@claude-audit/shared';
import { ageDays, makeResult, num } from './helpers.js';

const meta = {
  inactive: {
    id: 'AC-001',
    name: 'Inactive Members',
    category: 'access-control',
    severity: 'medium',
  },
  admins: {
    id: 'AC-002',
    name: 'Excessive Admin Roles',
    category: 'access-control',
    severity: 'high',
  },
  owner: {
    id: 'AC-003',
    name: 'Single Primary Owner',
    category: 'access-control',
    severity: 'critical',
  },
} as const;

export const inactiveMembers: ComplianceRulePlugin = {
  ...meta.inactive,
  description: 'Detect organization members who have not been active for over 90 days',
  defaultParams: { inactiveDays: 90 },
  async check(snapshot, params) {
    const days = num(params, 'inactiveDays', 90);
    const stale = snapshot.members.filter(
      (m) => ageDays(m.last_active_at ?? m.created_at, params) > days,
    );
    if (stale.length === 0) return [makeResult(meta.inactive, 'pass', 'No inactive members')];
    return [
      makeResult(
        meta.inactive,
        'fail',
        `${stale.length} member(s) inactive for over ${days} days`,
        {
          evidence: stale.map((m) => ({
            type: 'member' as const,
            id: m.id,
            description: `Last active ${m.last_active_at ?? 'never'}`,
            data: { role: m.role },
          })),
          remediation: 'Review and remove members who no longer need access.',
        },
      ),
    ];
  },
};

export const excessiveAdmins: ComplianceRulePlugin = {
  ...meta.admins,
  description: 'Warn when more than 20% of members have owner or admin roles',
  defaultParams: { maxAdminPercentage: 20 },
  async check(snapshot, params) {
    const max = num(params, 'maxAdminPercentage', 20);
    const total = snapshot.members.length;
    if (total === 0) return [makeResult(meta.admins, 'skipped', 'No members collected')];
    const admins = snapshot.members.filter((m) =>
      ['primary_owner', 'owner', 'admin'].includes(m.role),
    );
    const pct = (admins.length / total) * 100;
    if (pct <= max) {
      return [makeResult(meta.admins, 'pass', `Admin ratio ${pct.toFixed(1)}% within ${max}%`)];
    }
    return [
      makeResult(meta.admins, 'fail', `Admin ratio ${pct.toFixed(1)}% exceeds ${max}%`, {
        details: { admins: admins.length, total, percentage: pct },
        remediation: 'Apply least privilege: downgrade unnecessary admin roles.',
      }),
    ];
  },
};

export const primaryOwner: ComplianceRulePlugin = {
  ...meta.owner,
  description: 'Verify there is exactly one primary owner (no orphaned or duplicate)',
  defaultParams: {},
  async check(snapshot) {
    const owners = snapshot.members.filter((m) => m.role === 'primary_owner');
    if (owners.length === 1) return [makeResult(meta.owner, 'pass', 'Exactly one primary owner')];
    return [
      makeResult(meta.owner, 'fail', `Found ${owners.length} primary owners (expected 1)`, {
        evidence: owners.map((m) => ({
          type: 'member' as const,
          id: m.id,
          description: 'Primary owner',
          data: {},
        })),
        remediation: 'Ensure the organization has exactly one primary owner.',
      }),
    ];
  },
};

export const accessControlRules = [inactiveMembers, excessiveAdmins, primaryOwner];
