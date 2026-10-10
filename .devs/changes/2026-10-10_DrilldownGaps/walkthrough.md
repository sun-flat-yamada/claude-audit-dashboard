# Walkthrough: Drill-Down Gaps for Groups and Organizations (#84)

## Summary
Resolves Issue #84 (Phase B2-14, F-012 drill-down gaps):
1. **Group Member List**:
   - Extended `Group` entity in `@claude-audit/core` with `memberIds: string[] | null`.
   - Maintained `DETAIL_SCHEMA_VERSION = 2` in `detail-view.ts` for backward-compatibility across all detail endpoints and updated `detailOrgGroupsSchema` with `memberIds: z.array(z.string()).nullish()`.
   - Updated `buildDetailOrgGroups` to mask member IDs using `input.mask.id('u', id)` when `maskPii` is enabled, preserving stable joinability with `detail/members.json`.
   - Updated collector's `AdminApi.listGroups` to collect group member IDs via `PATHS.groupMembers(groupId)`.
   - Updated demo source with synthetic member IDs for demo groups and regenerated sample data via `pnpm demo`.
   - Implemented `GroupMembers` in `GroupDetail.tsx` displaying the group's members table (name, email, role, active status) with `maskPii` notification, empty states, and fallback for uncollected member lists.
2. **Per-Organization Spend Data Source Rationale**:
   - Investigated Enterprise Analytics API (`GET /analytics/cost_report`): `group_by[]` supports only `total`, `product`, `model`, and `rbac_group_id`. No `organization_id` grouping or per-user spend exists to compute organization spend.
   - Documented the investigation and rationale in `docs/API-MAPPING.md` §4, `docs/DASHBOARD-FEATURES.md` (F-012), and `docs/BLUEPRINT.md` §9.
   - Added clear explanation in `OrganizationDetail.tsx` stating why organization spend is unavailable.
3. **Group Configuration Deviations Scope Boundary**:
   - Documented in `GroupDetail.tsx`, `docs/DASHBOARD-FEATURES.md`, and `docs/BLUEPRINT.md` that configuration deviations apply to organizations only because RBAC groups carry no effective settings.
4. **Cross-Platform & Golden Consistency**:
   - Resolved path separator discrepancies in test helpers ensuring seamless validation on Windows and Linux CI environments.

---

## Verification Results

### 1. Automated Tests
- `@claude-audit/core`: 26 test files, 316 tests passed.
- `@claude-audit/collector`: 32 test files, 315 tests passed.
- `@claude-audit/dashboard`: 41 test files, 460 tests passed.
  - `Organizations.test.tsx`: 27 tests passed including group member rendering, `maskPii` on/off handling, and organization spend absence notices.

### 2. Quality Gate
- `pnpm fork:verify`: ✅ PASS (Fork-safe, valid detail schema v2, example.com only)
- `pnpm typecheck`: ✅ PASS (clean across all 3 workspace packages)
- `pnpm secret-scan`: ✅ PASS (0 secrets detected)
- `pnpm build`: ✅ PASS (production bundles compiled cleanly)
- `pnpm lint`: ✅ PASS (ESLint clean)
- `pnpm format:check`: ✅ PASS (Prettier clean)
