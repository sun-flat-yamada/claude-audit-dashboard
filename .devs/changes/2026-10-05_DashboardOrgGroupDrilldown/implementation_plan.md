# B2-10 F-012 Organization / group drill-down (#/orgs)

Closes #65. Refs #37 (tracking). Plan source: `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` section B2-10 (owner accepted D1-D8). Prerequisites B2-0 (#49), B2-2 (#57, PR #58) and the patterns B2-4, B2-5, B2-3 are merged.

## User Review Required

> [!IMPORTANT]
> No contract change. The plan names the routes `#/orgs/<id>` and `#/groups/<id>`; this unit adds the index `#/orgs` ("Organizations" in the nav) so the detail pages are reachable. `detail/org-groups.json` is the source; `detail/members.json` is joined for the organization member list (by `organizationId`).

> [!WARNING]
> Contract limits, reported rather than worked around: (1) the Group entity carries only `memberCount`, so the group page shows the count and states that no member list exists (no invented join); (2) configuration deviations (CF-xxx) are attributed to organizations only (evidence IDs matching an organization); rows with `organizationId: null` are shown in an "Unattributed" bucket; the group page therefore has no deviations of its own; (3) spend exists per RBAC group only, so the organization page has no spend figure. (4) The demo is left unchanged: giving synthetic members organization IDs would change AC-002/AC-003 (the demo has a single primary owner) and the compliance score, so in the sample `organizationId` stays null; the organization member list then shows a "members carry no organization" state, and the joined list is covered by component tests with synthetic data.

## Proposed Changes

### packages/dashboard

#### [NEW] `src/lib/drilldown-view.ts`

- Pure helpers: `orgSummaries` (deviation and member counts), `findOrganization` / `findGroup`, `deviationsFor`, `unattributedDeviations`, `membersOfOrganization`, `groupSpendShare` (share of the largest group, never a sum), severity ordering.

#### [NEW] `src/pages/Organizations.tsx`, `OrganizationDetail`, `GroupDetail`

- Index: organizations (members, deviations), RBAC groups (source, members, month-to-date spend), unattributed bucket. Organization page: deviations (severity + status with icon + label), members. Group page: source, member count, spend, overlap note. Unknown id: not-found state. States: loading, not published, not collected (manifest reason), error, empty, no match. Reuses `DetailControls.tsx`.

#### [MODIFY] `src/routes.tsx`, `src/App.tsx`

- Routes `/orgs`, `/orgs/:id`, `/groups/:id`; sub-routes keep "Organizations" current in the nav (`navPath`).

### Data

- No demo change; `data/sample/` is unchanged (the existing `org-groups.json` already has 3 organizations, 4 groups and 3 deviations).

### Tests

- `lib/__tests__/drilldown-view.test.ts`, `pages/__tests__/Organizations.test.tsx` (maskPii on / off, every state, unknown id, unattributed, synthetic sample), App deep links.

### Docs

- `docs/DASHBOARD-FEATURES.md` F-012, `docs/BLUEPRINT.md` section 9.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- `pnpm demo` leaves `git diff --exit-code data/sample` clean.

### Manual Verification

- `DASHBOARD_DATA_SOURCE=sample pnpm dev`, open `#/orgs`, `#/orgs/<id>`, `#/groups/<id>` at 390 px and in both themes.
