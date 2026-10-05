# B2-8 F-010 Model x group heatmap and model mix trend (#/models)

Closes #75. Refs #37 (tracking). Plan source: `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` section B2-8. Owner accepted D1-D8; D6: spike first, then a staged `usage-matrix` detail file with its own `schemaVersion` (no `DashboardView` v3); limit the heatmap to existing data if the API cannot provide pairwise data. Prerequisites B2-0 (#49) and B2-2 (#57) are merged; the patterns of B2-7 (monthly report) and B2-11 (archive inventory) are reused. This is the last B2 unit.

## Step A: spike result (pairwise `group_by[]`, model x rbac_group_id)

No real API was called (no keys in this environment). Sources: `docs/API-MAPPING.md`, `docs/api-spec-mismatch-findings.md`, `docs/CHANGE-PLAN.md`, `analytics-api.ts`, `http-client.ts`, the fixture tenant (`0021`-`0027`) and the fake API in the tests.

| Question | Finding | Status |
| :-- | :-- | :-- |
| Is `group_by` an array parameter? | Yes: `group_by[]=model&group_by[]=workspace_id` (`api-spec-mismatch-findings.md` section 4.1, taken from the Admin Usage / Cost API reference); `buildUrl` already sends one `group_by[]` per item. | Confirmed by repo docs (Admin Usage / Cost API reference) |
| Does the Enterprise Analytics `usage_report` / `cost_report` accept two values (`model` + `rbac_group_id`) in one request? | Not stated anywhere in the repo. The endpoint family mirrors the Admin Usage / Cost API (same `bucket_width`, `limit`, `page`, `group_by[]`), so it is plausible. API-MAPPING section 4 only records "top 100 groups per bucket" for a single dimension. | **Assumed (plausible, unconfirmed)** |
| Which pairs are allowed, how are `null` keys returned, is there a row cap per bucket with two dimensions? | No captured response exists: every fixture response is single-dimension. | Unknown |
| Are overlapping groups still overlapping in a pairwise result? | The single-dimension note applies (a member counts in every group, so group cells overlap; CHANGE-PLAN V7). | Assumed same semantics |

Outcome: **plausible, so implement it, opt-in and fail-soft.** Because it is not confirmed:

- Collection is off by default (`sources.usageMatrix.enabled = false`). With it off nothing changes: no new request, the snapshot still has the same 13 datasets, coverage / OP-002 / score are identical, and `pnpm pipeline` skips the step.
- It is **not** a 14th snapshot dataset (that would change `coverage`, the OP-002 message "All N datasets collected", and the score for every tenant). It is a separate, optional input file `usage-matrix/input.json` written by a new `usage-matrix` pipeline step and mapped into `detail/usage-matrix.json` by `writeDetail`. This is the "B4-style opt-in/enable rule" the owner asked for.
- If the API rejects the pairwise request (HTTP 400 / 401 / 403 / 404) the file records `unavailable` with the reason; any other failure records `error`; both are logged as a warning and never stop the pipeline. The page then shows "not collected (reason)".
- To confirm against a real tenant: run `pnpm collect -- --capture-raw <dir>` with `sources.usageMatrix.enabled` and sanitize the captured pair of responses into the fixture tenant (B1 tooling; a human task, listed as a caveat).

## User Review Required

> [!IMPORTANT]
> D2: `detail/usage-matrix.json` carries cost per RBAC group (confidential) and group names (organization structure, no per-person data). It is published exactly like the other detail files (sample always; live only with `PAGES_DATA_SOURCE=live` **and** `PAGES_DETAIL_DATA=true`, Private Pages only).

> [!WARNING]
> Group cells overlap (a member counts in every group they belong to; CHANGE-PLAN V7). The UI never sums group cells: no row / column totals, and the "model total" shown next to a model is the ungrouped value (`group_by[]=model` only). The overlap note is always shown with the heatmap.

## Proposed Changes

### packages/core (pure)

- `[NEW] contracts/usage-matrix.ts` (exported from `contracts/index.ts`): `USAGE_MATRIX_SCHEMA_VERSION = 1`, `DETAIL_USAGE_MATRIX_PATH = detail/usage-matrix.json`, `detailUsageMatrixSchema`: `currency`, `window`, `asOf`, `months` (ascending), `models` / `groups` (`key`, `name`, ungrouped `total` for models, `omitted` counts), `cells` (`month`, `model`, `group`, `cost`), `mix` (`month`, `model`, `cost`, ungrouped), `notes`.
- `[MODIFY] contracts/detail-view.ts`: `DETAIL_KINDS` gains `usage-matrix`. `contracts/detail-bundle.ts`: schema, count (= cells), referential checks (every cell / mix key is listed, months listed, no negative cost), `example.*` e-mails only.
- `[NEW] application/presenters/usage-matrix-view.ts`: `aggregateMatrixRows` (daily rows -> month cells, deterministic), `buildUsageMatrixView(input, groupNames, now)` (caps: 12 models x 30 groups by total cost, rest counted in `omitted`; names from the group directory, unknown id -> the id, null group -> "No group", null model -> "Unknown model"). `presenters/detail-view.ts`: optional `usageMatrix` input -> `usageMatrixPart` (unavailable entry with the reason, no file).

### packages/collector

- `[MODIFY] adapters/anthropic/analytics-api.ts`: `AnalyticsApi.costMatrix(range, now)` issues `cost_report` with `group_by[]=model&group_by[]=rbac_group_id` and, for the additive mix, `group_by[]=model`; tolerant zod read (`looseObject`, key fields nullish); the existing single-dimension requests are unchanged.
- `[MODIFY] infrastructure/config.ts`: `sources.usageMatrix { enabled (false), lookbackDays (90) }`; `main/container.ts` wires an optional matrix source only when enabled and an analytics key exists.
- `[NEW] main/usage-matrix.ts`: `collectUsageMatrix(c)` (fail-soft, writes `usage-matrix/input.json` with a `schemaVersion`), `readUsageMatrixInput(c)` (tolerant read). `main/commands.ts`: `usage-matrix` command, included in `pipeline` after `collect`. `main/detail.ts`: passes the input and the group names.
- `main/demo.ts`: synthetic 3-month matrix (2026-06..2026-08, the demo models x groups, a zero cell, a dominant model, overlapping groups) written to `data/sample/detail/usage-matrix.json`; the manifest gains one entry, every other sample file stays byte-identical.

### Staging / publication

`stage-data.mjs` / `deploy-pages.yml` already copy `detail/` whole, so the new file follows the B2-2 rule without a script change (a stage-data test pins it). `scripts/fork-verify.ts` validates it through `checkDetailBundle`; the tracked-path guard gains `data/usage-matrix`.

### packages/dashboard

- `[NEW] lib/usage-matrix-view.ts` (pure: `scaleRatio`, `heatCells` incl. zero / single value / equal values / no cell, `legendTicks`, `modelMix` shares with top-3 + Other, filters), `components/Heatmap.tsx` (single-hue sequential continuous scale from the `--seq-lo` / `--seq-hi` tokens, legend with min / mid / max, value text in every cell on a surface-colored chip so contrast never depends on the fill, hover / focus readout, `title` and `aria-label` with the value, scrolls inside its own container), `components/MixTrend.tsx` (100 % stacked bar per month, categorical slots 1-3 + Other, no animation), `pages/Models.tsx` (period selector, search, "View as table" toggles, overlap note), route `/models`, nav "Models". Reuses `DetailControls.tsx`, `Badges`, `Card`.
- States: loading, not published, not collected (reason), error, empty (no spend), no match.
- `index.css`: `--seq-lo` / `--seq-hi` tokens for light and dark (the validated blue ramp: light `#cde2fb` -> `#0d366b`, dark `#16304f` -> `#9ec5f4`).

### Tests

core (aggregation, caps, names, overlap-free totals, bundle negatives), collector (gateway query shape with two `group_by[]`, tolerant parse, 400 -> unavailable, error -> error without stopping, disabled -> no request and no file, coverage / OP-002 unchanged, pipeline, demo golden), dashboard (helpers, heatmap legend + table parity, every state, deep link, stage-data).

### Docs

`docs/DASHBOARD-FEATURES.md` F-010, `docs/BLUEPRINT.md` sections 4.2 / 9, `docs/API-MAPPING.md` (pairwise request, status "assumed"), `docs/DEPLOYMENT.md`, `docs/SETUP.md`, `.agents/rules/storage-and-data-routing.md`.

## Verification Plan

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`; `pnpm lint && pnpm format:check && pnpm audit:deps`.
- `pnpm demo` twice; `git diff --exit-code data/sample` clean after the first regeneration.
- Manual: `DASHBOARD_DATA_SOURCE=sample pnpm dev`, open `#/models` at 390 px in both themes.

## Out of scope

Tokens as a second measure (cost only), a `DashboardView` v3, any B3 / B4 / B5 work, verifying the pairwise response on a real tenant (human task via B1 capture).
