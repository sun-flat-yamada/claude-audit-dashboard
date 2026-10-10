# Implementation Plan: E2E Test Data Completion (#85)

Tracking Issue: #37 (Phase B2). Work-Unit Issue: #85.
Prepare complete test data across all profiles for browser-level E2E tests (#40, B5) without requiring any real tenant or credentials.

## User Review Required

> [!IMPORTANT]
> **Sample Tenant Score and Rule Outcome Changes**:
> Adding organization assignments to members in the synthetic sample enables testing organization member lists in F-012. As documented in Issue #85, evaluating AC-002 (excessive administrative roles) and AC-003 (single primary owner) per-organization instead of unscoped may alter compliance rule results and compliance scores.
> - Engineering will have 18 members with 5 admin roles (27.7%), exceeding the 20% limit, causing AC-002 to fail with an actionable warning/finding.
> - Each organization (Engineering, Legal, Sales) will have designated primary owners/owners, and unscoped members will have none.
> - An unlinked organization setting is added to `settings()` to generate an unattributed deviation (`organizationId: null`) for F-012.
> - An active, recently used API key of age ~150 days is added to test F-007's "Rotate soon" recommendation without violating AK-001/AK-002/AK-003.
> All resulting changes in `data/sample/` will be recorded and golden tests updated accordingly.

> [!NOTE]
> **Model x Group in Fixture Tenant**:
> While `detail/usage-matrix.json` was retired in PR #102 in favor of `DashboardView` v3's `modelMatrix` in `dashboard.json`, the fixture tenant will now include a tenant-shaped cost report fixture for `group_by[]=model&group_by[]=rbac_group_id` (`0028_organizations-analytics-cost-report.json`) and run `collectUsageMatrix` when `sources.usageMatrix.enabled: true`, ensuring `#/models` renders properly.

---

## Proposed Changes

### 1. `packages/collector` — Synthetic Sample Completion (AC-3)

#### [MODIFY] `packages/collector/src/adapters/demo/demo-source.ts`
- **Organization-Scoped Members**:
  - Assign members 0..17 to Engineering (`5f0c7a1e-1111-4a1a-9a11-000000000001`).
  - Assign members 18..23 to Legal (`5f0c7a1e-2222-4a1a-9a11-000000000002`). Member 18 given `primary_owner` role for Legal.
  - Assign members 24..32 to Sales (`5f0c7a1e-3333-4a1a-9a11-000000000003`). Member 24 given `primary_owner` role for Sales.
  - Leave members 33..39 with `organizationId: null` (unscoped personal / sandbox members).
- **Unattributed Deviation**:
  - Add a 4th setting record in `settings()` for an unlinked organization (`5f0c7a1e-9999-4a1a-9a11-000000000099`, "Example Corp Sandbox") deviating on `sso_claude_ai_enforced: false` (CF-001). Because this ID does not match any linked organization in `ORGS`, `buildDetailOrgGroups` attributes it to `organizationId: null` ("Unattributed deviations").
- **Rotate-Soon API Key**:
  - Add `apikey_demo_reporting` (name: 'Scheduled reporting', scopes: `['read:compliance_activities']`, age: 150 days ago, active: true).
  - Add `apikey_demo_reporting` to `credentialUsage` with recent activity (`ago(now, 5)`).
  - Evaluates to recommendation `Rotate soon` (80% threshold: 144 days) in F-007 while passing AK-001/AK-002/AK-003.

---

### 2. `packages/collector` — Fixture Tenant Monthly Report & Model x Group Matrix (AC-2)

#### [NEW] `packages/collector/src/adapters/anthropic/__tests__/fixtures/tenant/0028_organizations-analytics-cost-report.json`
- Tenant-shaped cost report fixture for `group_by[]: ["model", "rbac_group_id"]` splitting spend across tenant models (`claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`) and tenant groups (`rbac_group_69VbrMnSPaA9SkIZwJmdb02z`, `rbac_group_88JiOsLFMXBRbqmos5v9mNLX`, `rbac_group_50MYzTmTkiRONgS8EqSNeP6R`).

#### [MODIFY] `packages/collector/src/main/fixture.ts`
- Add option / support for generating monthly report view (`detail/monthly/index.json` and `detail/monthly/monthly-2026-08.json` / `2026-09.json`) using `writeMonthlyView` and `generateReport(c, 'monthly', month)`.
- Enable `sources.usageMatrix.enabled: true` and execute `collectUsageMatrix(c)` prior to `writeDashboard(c)`, so `dashboard.json` contains `modelMatrix` from the fixture tenant replay.

---

### 3. `packages/collector` & `packages/dashboard` — Empty & Unavailable Profiles (AC-1)

#### [MODIFY] `packages/collector/src/main/demo.ts`
- Extend `DemoProfile`: `'default' | 'optional-sources' | 'empty' | 'unavailable'`.
- In `writeDemoSample`:
  - `empty`: generates `dashboard.json` and detail files containing empty arrays (`[]`) for members, keys, alerts, groups, deviations, compare points, and activity.
  - `unavailable`: generates `dashboard.json` with all/selected dataset coverage set to `status: 'unavailable'` and writes NO detail files (emulating unpublished/uncollected states).

#### [MODIFY] `packages/collector/src/main/commands.ts`
- Update `demoCommand` usage and fallback path logic:
  - `data/sample-empty` for `empty`
  - `data/sample-unavailable` for `unavailable`

#### [MODIFY] `packages/dashboard/scripts/stage-data.mjs` & `packages/dashboard/scripts/e2e-profiles.mjs`
- Add `'empty'` and `'unavailable'` to `SOURCES` and `FILES` mapping in `stage-data.mjs`.
- Update `assertNotLive` in `e2e-profiles.mjs` to allow `empty` and `unavailable`.

---

### 4. Verification & Documentation (AC-4, AC-5, AC-6, AC-7)

- Regenerate sample data: `pnpm demo`.
- Regenerate fixture data: `pnpm fixture`.
- Regenerate optional-sources demo: `pnpm demo --profile optional-sources`.
- Generate empty and unavailable demo profiles: `pnpm demo --profile empty` and `pnpm demo --profile unavailable`.
- Update golden tests in `@claude-audit/collector` and `@claude-audit/dashboard`.
- Sync `docs/BLUEPRINT.md` §9 / §18.3, `docs/DASHBOARD-FEATURES.md`, and `CONTRIBUTING.md`.
- Run full quality checks: `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build && pnpm lint && pnpm format:check`.

---

## Verification Plan

### Automated Tests
- `packages/collector/src/main/__tests__/demo.test.ts`: verify all 4 profiles (`default`, `optional-sources`, `empty`, `unavailable`).
- `packages/collector/src/main/__tests__/fixture-tenant.test.ts`: verify fixture tenant generates `monthly` reports and `modelMatrix`.
- `packages/dashboard/scripts/__tests__/stage-data.test.ts`: test staging with `empty` and `unavailable` sources.
- Golden tests in collector and dashboard.
- Full suite: `pnpm test`.
