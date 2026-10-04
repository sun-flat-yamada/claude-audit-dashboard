# B2-5 F-007 API key inventory (#/keys)

Closes #61. Refs #37 (tracking). Plan source: `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` section B2-5 (owner accepted D1-D8). Prerequisites B2-0 (#49), B2-2 (#57, PR #58) and the Members pattern B2-4 (#59, PR #60) are merged.

## User Review Required

> [!IMPORTANT]
> No contract change. `detail/api-keys.json` already carries scopes, `createdAt`, `expiresAt`, `lastSeenAt` and the effective AK-001 / AK-003 thresholds (`unusedDays`, `maxAgeDays`) plus `usageObservedFrom`. Ages are computed against the file's `generatedAt` (not the browser clock), so the page is deterministic and consistent with the collector's evaluation time.

> [!WARNING]
> Two judgement calls, both documented in `docs/DASHBOARD-FEATURES.md`: (1) "rotate soon" is shown from 80% of `maxAgeDays` (a display hint, not a compliance rule); (2) the AK-002 flagged scopes are not in the detail file, so write / delete scopes (`write:*`, `delete:*`, the built-in default set) are flagged as "Write scope". A tenant that overrides `flaggedScopes` may differ from the AK-002 result.
> The sample already has fresh, unused (+ delete scope), over-age and deactivated keys; a "near rotation" key is covered by unit / component tests with synthetic data, so `data/sample/` is not changed.

## Proposed Changes

### packages/dashboard

#### [NEW] `src/lib/keys-view.ts`

- Pure helpers: `keyAgeDays`, `daysSince`, `keyFindings(key, context)` (rotate AK-003, rotate soon, unused AK-001 incl. "usage window too short" -> unknown, write scope, expired), `keyRecommendation` (primary: inactive, rotate, unused, privileged, rotate_soon, unknown, ok), `filterKeys` (search name / id / scope, status), `sortKeys`, `countByRecommendation`, `scopeLabel`.

#### [NEW] `src/pages/ApiKeys.tsx`

- Loads `detail/api-keys.json` and the manifest with `useDetailFile` (reusing the Members helpers `SelectField`-style controls where possible). Table: key name + masked ID, scopes, age (days), expires, last used, recommendation (icon + label + color) with the reason text. States: loading, not published, not collected (manifest reason), error, empty, no match. Never renders any key material (the contract has none).

#### [MODIFY] `src/routes.tsx`, `src/components/Badges.tsx`

- Route `#/keys` ("API keys"); `key-*` badge entries (icon + label + color).

### Tests

- `src/lib/__tests__/keys-view.test.ts`: age and threshold boundaries (exactly at / one day over), null last use with a short / long observation window, write scope, expired, inactive, filter, sort, counts.
- `src/pages/__tests__/ApiKeys.test.tsx`: normal, each recommendation, filters, sort, `maskPii` on / off, empty, unavailable, missing, error, loading, synthetic sample.
- `src/__tests__/app.test.tsx`: deep link `#/keys`.

### Docs

- `docs/DASHBOARD-FEATURES.md` F-007 row and section; `docs/BLUEPRINT.md` section 9.2.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- `pnpm demo` leaves `git diff --exit-code data/sample` clean.

### Manual Verification

- `DASHBOARD_DATA_SOURCE=sample pnpm dev`, open `#/keys` at 390 px and in both themes.
