# Walkthrough: Complete Synthetic Test Data Profiles for E2E (#85)

## Summary
Resolves Issue #85 (Phase B2-15, E2E test data completion):
1. **Empty & Unavailable Demo Profiles**:
   - Added `'empty'` and `'unavailable'` demo profile variants to `packages/collector/src/main/demo.ts` (`pnpm demo --profile empty|unavailable`).
   - Implemented `createDemoEmptyCollectors` and `createDemoUnavailableCollectors` in `demo-source.ts`.
   - Updated `packages/dashboard/scripts/stage-data.mjs` and `e2e-profiles.mjs` to stage `empty` (`data/sample-empty/`) and `unavailable` (`data/sample-unavailable/`).
   - Added unit tests for profile generation, staging, and E2E validation in `optional-profiles.test.ts`, `stage-data.test.mjs`, and `e2e-profiles.test.mjs`.
2. **Missing Cases in Synthetic Sample**:
   - Added organization memberships across Engineering (18), Legal (6), Sales (9), and Unscoped (7) members.
   - Preserved balanced roles: 1 primary owner per organization (AC-003: pass) and <= 20% admins (AC-002: pass on latest snapshot, with valid multi-point historical transition from fail at T1/T2 to pass at T3 for F-015).
   - Added unattributed deviation (`organizationId: null`, Sandbox tenant) for CF-001 (SSO enforcement).
   - Added active key nearing rotation (`apikey_demo_reporting`, age: 150 days) triggering F-007 ("Rotate soon").
3. **Fixture Tenant Monthly Reports & Model Matrix**:
   - Added sanitized fixture `0028_organizations-analytics-cost-report.json` with `group_by[]: ["model", "rbac_group_id"]`.
   - Updated `packages/collector/src/main/fixture.ts` to collect `usageMatrix` and generate monthly reports (`2026-07`, `2026-08`) alongside `dashboard.json`.
   - Updated fixture tenant E2E tests in `packages/dashboard/e2e/fixtures/tenant.spec.ts` to assert that monthly reports and model spend are published and displayed.
4. **Documentation & Quality Verification**:
   - Updated `CONTRIBUTING.md`, `docs/BLUEPRINT.md` §9.3 & §18.3, and `docs/DASHBOARD-FEATURES.md` (F-009, F-010) reflecting the new profiles and fixture tenant data.

---

## Verification Results

### 1. Automated Tests
- `@claude-audit/core`: 26 test files, 316 tests passed.
- `@claude-audit/collector`: 32 test files, 317 tests passed (including time-point compare goldens & fixture-tenant).
- `@claude-audit/dashboard`: 41 test files, 464 tests passed.
- Node.js test runner (`scripts/__tests__`): 66 tests passed.

### 2. Quality Gate
- `pnpm fork:verify`: ✅ PASS
- `pnpm typecheck`: ✅ PASS
- `pnpm test`: ✅ PASS
- `pnpm secret-scan`: ✅ PASS
- `pnpm build`: ✅ PASS
- `pnpm lint`: ✅ PASS
- `pnpm format:check`: ✅ PASS
- `pnpm audit:deps`: ✅ PASS
