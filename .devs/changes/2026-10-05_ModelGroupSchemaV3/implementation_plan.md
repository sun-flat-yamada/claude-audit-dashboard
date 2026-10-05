# Model x group aggregate in DashboardView v3 (retire detail/usage-matrix.json)

Closes #102. Refs #37 (closed), #75 / PR #76 (B2-8, merged with D6 (b)). Owner decisions: D6 = (a), and the staged `detail/usage-matrix.json` of D6 (b) is **retired**: v3 replaces it (no parallel publication path).

## User Review Required

> [!IMPORTANT]
> Open points 2-4 of #102 are proposed below with a recommendation; approve or change them before implementation starts (`CHG_DEV_AUTO_PILOT` is off, so this plan waits for approval).

> [!WARNING]
> Breaking contract change: `DASHBOARD_VIEW_SCHEMA_VERSION` 2 -> 3, and the detail manifest loses the `usage-matrix` kind (`DETAIL_SCHEMA_VERSION` 1 -> 2, so an older manifest fails with the existing "re-run" message instead of a confusing enum error). Anything already published on Pages (or saved on `data/audit`) must be regenerated with `pnpm build:data` / the next collection run; the SPA shows the existing regeneration hint for a v2 file.

> [!WARNING]
> Publication consequence: the matrix moves from the detail publication condition (`PAGES_DETAIL_DATA=true`, Private Pages) to the `dashboard.json` rules. This is acceptable because it is aggregate-only and the same classes of data are already in `dashboard.json` (`usage.byGroup` has group names and per-group cost; `usage.byModel` has per-model cost). No per-person data is added. Record this in `docs/DEPLOYMENT.md`.

## Decisions (open points of #102)

| # | Point | Decision |
| :-- | :-- | :-- |
| 1 | Keep (b)? | **Retire (b)** (owner). Remove `detail/usage-matrix.json`, the manifest kind, `detailUsageMatrixSchema`, `DETAIL_USAGE_MATRIX_PATH`, the bundle checks, staging and docs for it. |
| 2 | Granularity in v3 | Same content as today's file, moved into the view: month x model x group cost cells (overlapping, never summed), ungrouped model mix per month, month totals, caps `MATRIX_MODEL_LIMIT = 12` / `MATRIX_GROUP_LIMIT = 30` with `omitted` counts, group names only (no ids that identify people). Top-level field `modelMatrix`. |
| 3 | Behavior when `sources.usageMatrix.enabled` is off | `modelMatrix: null` (not collected by choice). Enabled but failing: `{ status: 'unavailable' \| 'error', reason }`; success: `{ status: 'ok', ...matrix }`. The 13 snapshot datasets, coverage, OP-002 and the score stay identical; `dashboard.json` differs from v2 only by `schemaVersion: 3` and `modelMatrix: null`. |
| 4 | v2 data in a v3 SPA | Existing mismatch message in `lib/data.ts` (`schemaVersion 2; expected 3. Re-run pnpm build:data or pnpm demo`); covered by the stale-data E2E. The multi-`group_by` API behavior stays **assumed** (real-tenant confirmation remains #29). |

## Proposed Changes

### packages/core (pure)

- `contracts/dashboard-view.ts`: `DASHBOARD_VIEW_SCHEMA_VERSION = 3`; `modelMatrix` = nullable discriminated union (`ok` carries the former `detailUsageMatrixSchema` body; `unavailable` / `error` carry `reason`). Move `MATRIX_*` constants and the matrix zod pieces here; export type `DashboardModelMatrix`.
- Delete `contracts/usage-matrix.ts`; remove its exports from `contracts/index.ts` and `core/src/index.ts` where no longer needed. `contracts/detail-view.ts`: drop `usage-matrix` from `DETAIL_KINDS`, `DETAIL_SCHEMA_VERSION = 2`. `contracts/detail-bundle.ts`: drop the matrix schema, count and referential checks (move the referential checks, month listed / keys listed / no negative cost, to a `checkModelMatrix` used by `fork:verify` on `dashboard.json`).
- `presenters/usage-matrix-view.ts`: keep `aggregateMatrixRows` and `buildUsageMatrixView`, rename output to the view shape; `presenters/dashboard-view.ts` takes an optional `usageMatrix` input (the stored collection) and group names, and fills `modelMatrix`; `presenters/detail-view.ts`: remove the matrix part.

### packages/collector

- Keep the opt-in collection (`sources.usageMatrix.enabled`, default off), `AnalyticsApi.costMatrix()`, `collectUsageMatrix` and `usage-matrix/input.json`; the `usage-matrix` step now runs **before** `dashboard` in `pnpm pipeline` / `build:data`.
- `workflows.ts` `writeDashboard` reads the stored input (`readUsageMatrixInput`, tolerant: off -> null, unreadable -> `error` entry with a short reason) and passes it to `buildDashboardView`. `detail.ts`: stop writing/reading the matrix; remove the schema mapping for `/usage-matrix.json`.
- `demo.ts` / `adapters/demo/demo-source.ts`: the synthetic 3-month matrix goes into `dashboard.json` (profile `default` keeps it on as today, other profiles keep their current on/off); `data/sample/detail/usage-matrix.json` is deleted by regeneration. `pnpm demo`, golden test and `data/sample/` regenerated; `git diff --exit-code data/sample` clean afterwards.

### packages/dashboard

- `pages/Models.tsx` reads `view.modelMatrix` instead of fetching the detail file (props: the `DashboardView`); states: off (`null`) shows "not collected (enable `sources.usageMatrix`)", `unavailable` / `error` show the reason, empty and no-match as today. `lib/usage-matrix-view.ts`, `Heatmap`, `MixTrend` unchanged except the type source.
- `pages/Overview.tsx`: a compact "Model x group" card (latest-month ungrouped model mix, top 5, with the overlap note text and a link to `#/models`); hidden when `modelMatrix` is `null`. Table view for the card.
- `routes.tsx` passes the view to `Models`; no detail fetch for `#/models` any more.

### Tooling, docs, scripts

- `scripts/fork-verify.ts`: validate `modelMatrix` in `dashboard.json` (referential checks above, group names only); drop the matrix entry from the detail checks. `packages/dashboard/scripts/stage-data.mjs` and its test: no `usage-matrix.json` staging. `.github/workflows/deploy-pages.yml` unchanged except any matrix mention.
- Docs: `docs/BLUEPRINT.md` section 9 (v3 contract, publication consequence), `docs/DASHBOARD-FEATURES.md` F-010, `docs/API-MAPPING.md`, `docs/DEPLOYMENT.md`, `docs/SETUP.md`, `.agents/rules/storage-and-data-routing.md` (remove the `detail/usage-matrix.json` row, keep `usage-matrix/input.json`, note v3 `modelMatrix`), `CHANGELOG.md`.

## Verification Plan

- core: schema round trip for `ok` / `unavailable` / `error` / `null`; presenter fills `modelMatrix` from the stored input (caps, omitted counts, names, null keys); `buildDashboardView` without input yields `modelMatrix: null`; detail bundle no longer accepts the `usage-matrix` kind; v2 `dashboard.json` rejected.
- collector: `usage-matrix.test.ts` adapted (input -> dashboard); default config run leaves coverage, OP-002 and score identical to the pre-change run (byte-compare of everything except `schemaVersion` / `modelMatrix`); sample / fixture-tenant goldens regenerated; `pnpm usage-matrix` failure never stops the pipeline.
- dashboard: `Models` component tests for every state from the view; Overview card test (shown / hidden); stage-data test without the matrix file; app test for the v2 mismatch message.
- E2E (Playwright, #90): `#/models` from the sample, empty / unavailable profiles and the fixture tenant read the view; stale-data spec expects `expected 3`; axe scan of `#/models` and the Overview card in light and dark.
- Gate: `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`, then `pnpm lint && pnpm format:check && pnpm audit:deps`, then `pnpm test:e2e`.
