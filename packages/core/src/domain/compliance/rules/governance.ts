import { z } from 'zod';
import { defineRule } from '../define-rule.js';
import { failIfAny, skip } from '../types.js';

export const emptyGroups = defineRule({
  meta: {
    id: 'DG-001',
    name: 'Empty Groups',
    category: 'data-governance',
    severity: 'low',
    description: 'Directly created RBAC groups without members',
    remediation: 'Delete groups that are no longer used so role grants stay reviewable.',
  },
  requires: ['groups'],
  params: z.object({}),
  evaluate({ data }) {
    const counted = data.groups.filter((g) => g.memberCount !== null);
    if (data.groups.length > 0 && counted.length === 0) {
      return skip('Group member counts were not collected');
    }
    return failIfAny(
      counted.filter((g) => g.source === 'direct' && g.memberCount === 0),
      { pass: 'No empty groups', fail: (n) => `${n} group(s) have no members` },
      (g) => ({ kind: 'group', id: g.id, label: g.name }),
    );
  },
});

export const governanceRules = [emptyGroups];
