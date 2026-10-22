# Walkthrough: usage-matrix cost_report date windows (V8)

## Summary

The optional model x group matrix (F-010) was always `unavailable` (HTTP 400) on a real tenant because `AnalyticsApi.costMatrix()` requested the whole `lookbackDays` range (default 90) at once, while the Enterprise Analytics `cost_report` accepts at most 31 days per request. A real-tenant probe (#29 V8; statuses, row counts and relative differences only) confirmed that the pairwise `group_by[]=model&group_by[]=rbac_group_id` request is accepted and that per-group `rbac_group_ids[]` requests give the same values. The collection now splits the range into windows of at most 31 days and falls back to per-group requests only for a window that reaches the 100-row group cap.

## Changes Made

### Collector

- `packages/collector/src/adapters/anthropic/analytics-api.ts`: `splitRange()` (consecutive windows of at most `MAX_REPORT_RANGE_DAYS` = 31), `oldestMark()` (shared with `collate`), `buckets()` takes a `BucketRequest` (`groupBy`, optional `rbac_group_ids`) and reports `capped` (a bucket with `GROUP_ROW_CAP` = 100 rows); `costMatrix()` fetches the pairwise and per-model series window by window; `matrixPairs()` re-fetches a capped window per RBAC group and keeps the unassigned rows of the capped response.
- `packages/collector/src/adapters/anthropic/replay-fetch.ts`: the replay applies the requested `starting_at` .. `ending_at` range to the recorded buckets of `cost_report` / `usage_report`, so the windows of one range do not each receive the whole recording (not in the plan; found while verifying the fixture tenant, whose matrix would otherwise have been counted three times).
- Tests: `gateways.test.ts` (90-day range against a fake that rejects more than 31 days; cap fallback), `replay-fetch.test.ts` (new), `usage-matrix.test.ts` (the pipeline test expected one pairwise request, i.e. the defect; it now expects three windows of at most 31 days; not in the plan).

### Documentation

- `docs/CHANGE-PLAN.md` section 10: new row V8 (confirmed, 31-day windows, cap fallback).
- `docs/API-MAPPING.md`, `docs/BLUEPRINT.md` (F-010): the confirmed pairwise grouping, the 31-day windows, the cap fallback and its unassigned-row caveat, the replay range.
- `CHANGELOG.md`: Fixed entry.

No change to the configuration schema, `usage-matrix/input.json`, `DashboardView`, the 13 datasets, OP-002, the score or `data/sample/`.

## Verification Results

The change was prepared in an isolated session without network access to the npm registry, so the Windows-installed `node_modules` could only be used partially (no Linux native binaries for Vitest / esbuild / ESLint plugins). What ran there:

| Stage | Command (sandbox equivalent) | Result |
| :-- | :-- | :-- |
| Code-Data Decoupling | `scripts/fork-verify.ts` (Node type stripping) | ✅ PASSED |
| Zero Secret / PII Scan | `scripts/secret-scan.ts` (Node type stripping) | ✅ CLEAN |
| TypeScript Check (collector) | `tsc --noEmit` with a loose `vitest` type stub | ✅ 0 errors from the change (29 stub-only errors, identical before and after) |
| Production Build (core, collector) | `tsc -p tsconfig.build.json` | ✅ exit 0 |
| Unit & Integration Tests (collector, 34 files) | Node type stripping + a minimal Vitest-compatible shim | ✅ 0 tests fail only after the change; 4 tests fail before and pass after (the new / updated ones); 43 shim-related failures are identical before and after |
| Reproduction | new window and cap tests on the old `analytics-api.ts` | ✅ fail before, pass after |
| Fixture tenant output | `fixture` and `fixture --optional-sources` before / after | ✅ byte-identical (`modelMatrix` `ok`) |
| Format | `prettier --check` on the changed files, `docs`, `CHANGELOG.md` (without the Tailwind plugin, which only affects class strings) | ✅ Clean |

### Local Quality Gate

Run after the rebase onto `upstream/main` (`f594efd`), in the sibling worktree, on Windows with Node v24.13.0 and pnpm 9.15.4 (Corepack, `pnpm install --frozen-lockfile`):

| Stage | Command | Result |
| :-- | :-- | :-- |
| Code-Data Decoupling | `pnpm fork:verify` | ✅ PASSED |
| TypeScript Check | `pnpm typecheck` | ✅ exit 0 |
| Unit & Integration Tests | `pnpm test` | ✅ 1,175 passed (core 316, dashboard 464, collector 323, scripts 72), 0 failed |
| Zero Secret / PII Scan | `pnpm secret-scan` | ✅ CLEAN |
| Production Build | `pnpm build` | ✅ exit 0 (the dashboard chunk-size notice is unrelated: no dashboard file changed) |
| Lint | `pnpm lint` | ✅ 0 problems |
| Format | `pnpm format:check` | ✅ All matched files use Prettier code style |
| Dependency Audit (CI) | `pnpm audit:deps` | ✅ No known vulnerabilities found |

### Manual Verification (human, key holder)

- `sources.usageMatrix.enabled: true` and `pnpm pipeline` on the real tenant -> `Model x group matrix collected`, `modelMatrix.status = ok`.
