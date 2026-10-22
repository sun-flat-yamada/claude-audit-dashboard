# Implementation Plan - usage-matrix: split the cost_report range into windows of at most 31 days

Issue: to be filed upstream (draft prepared from the #29 V8 verification). Related: #29 (V8), #75 (B2-8), #85, parent #46.

## Context & Problem

The real-tenant check of #29 V8 (`sources.usageMatrix.enabled: true`) stored `modelMatrix` as `unavailable` (HTTP 400). A probe against the tenant (statuses, row counts and relative differences only) showed:

| Request | Result |
| --- | --- |
| `group_by[]=model&group_by[]=rbac_group_id`, 30 days | 200 (the pairwise grouping is accepted) |
| same, 90 days (`lookbackDays` default) | 400 `invalid_request_error: date range must span at most 31 days` |
| `rbac_group_ids[]=<g>&group_by[]=model` per group, 30 days | 200 for every group; per-model sums equal the group totals and the pairwise values |
| `group_by[]=model` sum vs ungrouped total | equal |

So the V8 assumption holds. The defect is that `AnalyticsApi.costMatrix()` requests the whole `lookbackDays` range at once, while the official reference limits the range (`starting_at` .. `ending_at`) to 31 days. The regular `cost` / `usage` datasets use 30 days and are not affected.

## User Review Required

> [!IMPORTANT]
> Approved approach: pairwise `group_by` per window of at most 31 days; a window whose pairwise response reaches the per-bucket group cap (100 rows in one bucket) is re-fetched per RBAC group (`rbac_group_ids[]=<g>&group_by[]=model`).

> [!WARNING]
> - In a re-fetched window the "no group" (unassigned) row cannot be requested (the `rbac_group_ids[]` filter never matches unassigned usage). The unassigned rows already present in the capped pairwise response are kept; anything cut by the cap stays missing and is noted in the docs.
> - The group list of a re-fetched window comes from `group_by[]=rbac_group_id` for that window, which is itself capped at 100 groups per bucket. Tenants with more than 100 RBAC groups with spend on one day are out of scope (documented).
> - Request count: 2 series x ceil(days / 31) windows (90 days = 6 requests), plus 1 + groups per capped window. The client's existing 429 / `retry-after` handling covers the 60 requests/minute limit.

## Proposed Changes

### Collector

#### [MODIFY] `packages/collector/src/adapters/anthropic/analytics-api.ts`

- Add a pure helper that splits a `DateRange` into consecutive windows of at most 31 days (`MAX_REPORT_RANGE_DAYS`).
- `buckets()` also reports whether any bucket reached the group cap (`GROUP_CAP = 100` rows) and accepts extra query parameters (`rbac_group_ids`).
- `costMatrix()` fetches the pairwise and per-model series window by window and concatenates the rows; the oldest `data_refreshed_at` wins (same rule as `collate`). A capped pairwise window is replaced by per-group requests (group list from the window's `group_by[]=rbac_group_id`, rows tagged with the requested group), keeping the unassigned rows of the capped response.

#### [MODIFY] `packages/collector/src/adapters/anthropic/__tests__/gateways.test.ts`

- Reproduction: a fake that rejects ranges over 31 days with 400; a 90-day `costMatrix()` succeeds with 3 windows x 2 series and every request spans at most 31 days (fails before the fix).
- Cap fallback: one window returns a bucket with 100 pairwise rows; that window switches to per-group requests and the merged rows are correct; other windows stay pairwise.

### Documentation

#### [MODIFY] `docs/CHANGE-PLAN.md` §10

- V8: confirmed (pairwise accepted); range limited to 31 days, handled by window splitting.

#### [MODIFY] `docs/API-MAPPING.md`

- The model x group request: windows of at most 31 days, cap fallback per group, unassigned-row caveat.

#### [MODIFY] `docs/BLUEPRINT.md` (F-010 paragraph)

- Replace "unconfirmed (assumed)" with the confirmed result and the window splitting.

#### [MODIFY] `CHANGELOG.md`

- Fixed entry.

No change to the configuration schema (`lookbackDays` 1-366, default 90), the `usage-matrix/input.json` schema, `DashboardView`, the 13 datasets, OP-002 or the score.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- Targeted: `pnpm --filter @claude-audit/collector test -- gateways usage-matrix`

### Manual Verification

- Real tenant (human, key holder): `sources.usageMatrix.enabled: true`, `pnpm pipeline` -> `Model x group matrix collected` and `modelMatrix.status = ok`.
