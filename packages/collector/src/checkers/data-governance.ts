import type { ComplianceRulePlugin } from '@claude-audit/shared';
import { makeResult } from './helpers.js';

const meta = {
  id: 'DG-001',
  name: 'Empty Workspaces',
  category: 'data-governance',
  severity: 'low',
} as const;

export const emptyWorkspaces: ComplianceRulePlugin = {
  ...meta,
  description: 'Detect workspaces with no members that may need cleanup',
  defaultParams: {},
  async check(snapshot) {
    const empty = snapshot.workspaces.filter((w) => !w.archived_at && w.member_count === 0);
    if (empty.length === 0) return [makeResult(meta, 'pass', 'No empty workspaces')];
    return [
      makeResult(meta, 'fail', `${empty.length} workspace(s) have no members`, {
        evidence: empty.map((w) => ({
          type: 'workspace' as const,
          id: w.id,
          description: w.name,
          data: {},
        })),
        remediation: 'Archive workspaces that are no longer used.',
      }),
    ];
  },
};

export const dataGovernanceRules = [emptyWorkspaces];
