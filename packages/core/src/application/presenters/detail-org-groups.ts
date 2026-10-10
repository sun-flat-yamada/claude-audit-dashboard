import type { DetailOrgGroups } from '../../contracts/detail-view.js';
import { DETAIL_SCHEMA_VERSION } from '../../contracts/detail-view.js';
import type { CheckResult } from '../../domain/compliance/types.js';
import type { DatasetMap } from '../../domain/model/dataset.js';
import { sumBy } from '../../domain/util/collections.js';
import type { IdentityMasker } from '../../domain/util/mask.js';
import { round } from '../../domain/util/numbers.js';
import { monthKey } from '../../domain/util/time.js';

export interface DetailOrgGroupsInput {
  now: Date;
  data: DatasetMap;
  costCollected: boolean;
  results: readonly CheckResult[];
  mask: IdentityMasker;
}

function deviations(input: DetailOrgGroupsInput): DetailOrgGroups['deviations'] {
  const orgIds = new Set(input.data.organizations.map((o) => o.id));
  return input.results
    .filter((r) => r.ruleId.startsWith('CF-') && (r.status === 'fail' || r.status === 'warning'))
    .flatMap((r) => {
      const orgs = [...new Set(r.evidence.map((e) => e.id).filter((id) => orgIds.has(id)))];
      const row = {
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        severity: r.severity,
        status: r.status,
        message: input.mask.text(r.message),
      };
      return (orgs.length > 0 ? orgs : [null]).map((organizationId) => ({
        ...row,
        organizationId,
      }));
    });
}

function groupCost(input: DetailOrgGroupsInput, groupId: string): number | null {
  if (!input.costCollected) return null;
  const month = monthKey(input.now);
  const rows = input.data.cost.filter(
    (r) => r.dimension === 'group' && r.key === groupId && r.date.startsWith(month),
  );
  return round(sumBy(rows, (r) => r.amount));
}

/** Organizations, RBAC groups (member count, spend) and configuration deviations. */
export function buildDetailOrgGroups(input: DetailOrgGroupsInput): DetailOrgGroups {
  const { data } = input;
  const scoped = data.members.some((m) => m.organizationId !== null);
  return {
    schemaVersion: DETAIL_SCHEMA_VERSION,
    generatedAt: input.now.toISOString(),
    currency: data.cost[0]?.currency ?? 'USD',
    organizations: data.organizations.map((o) => ({
      id: o.id,
      name: o.name,
      memberCount: scoped ? data.members.filter((m) => m.organizationId === o.id).length : null,
    })),
    groups: data.groups.map((g) => ({
      id: g.id,
      name: g.name,
      source: g.source,
      memberCount: g.memberCount,
      monthToDateCost: groupCost(input, g.id),
      memberIds: g.memberIds ? g.memberIds.map((id) => input.mask.id('u', id)) : null,
    })),
    deviations: deviations(input),
  };
}
