# Implementation Plan - F-012 Drill-down Gaps (#84)

## Context & Problem
Issue #84 addresses gaps identified in F-012 drill-down views (`#/orgs/<id>` and `#/groups/<id>`):
1. **Group members**: The current contract only includes `memberCount: number | null` on `groups`, without the list of members belonging to each group.
2. **Organization spend**: Enterprise Analytics API only provides dimensions for `total`, `product`, `model`, and `rbac_group_id`. Organization-level cost breakdown is not provided by the API (no data source).
3. **Configuration deviations on groups**: RBAC groups do not have effective configurations, which are defined at the linked organization level. This needs explicit documentation and UI explanation rather than silent omission.

## Proposed Changes

### 1. Core & Contracts
- **`packages/core/src/domain/model/entities.ts`**:
  - Add `memberIds?: string[] | null` to `Group` domain entity.
- **`packages/core/src/contracts/detail-view.ts`**:
  - Bump `DETAIL_SCHEMA_VERSION` to 3.
  - Update `detailOrgGroupsSchema`: add `memberIds: z.array(z.string())` to `groups` array items.
- **`packages/core/src/application/presenters/detail-org-groups.ts`**:
  - Map `group.memberIds` to detail output, applying `input.mask.id` when `maskPii` is enabled.

### 2. Collector
- **`packages/collector/src/adapters/anthropic/admin-api.ts`**:
  - Update `countMembers` to return `string[]` (member user IDs) instead of just count.
  - Assign `memberIds` and `memberCount` in `listGroups`.
- **`packages/collector/src/adapters/demo/demo-source.ts`**:
  - Populate `memberIds` for synthetic groups from demo members.

### 3. Dashboard UI
- **`packages/dashboard/src/lib/drilldown-view.ts`**:
  - Add helper `membersOfGroup(members: readonly Member[], group: DetailOrgGroup): Member[]`.
- **`packages/dashboard/src/pages/GroupDetail.tsx`**:
  - Implement `GroupMembers` component fetching `detail/members.json` and displaying matching members via `MemberRows`.
  - Update explanations for group deviations (defined at org level).
- **`packages/dashboard/src/pages/OrganizationDetail.tsx`**:
  - Clarify that organization spend breakdown is not supported by the Enterprise Analytics API (no data source).

### 4. Verification & Golden Updates
- Run `pnpm demo` to regenerate sample data with `DETAIL_SCHEMA_VERSION = 3`.
- Update `scripts/fork-verify.ts` and test expectations.
- Run full quality gate: `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build && pnpm lint && pnpm format:check`.
