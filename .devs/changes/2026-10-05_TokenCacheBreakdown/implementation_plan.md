# AN-1: Daily token cache breakdown and cache hit rate

Issue #92 (parent tracking #91). `DashboardView.usage.daily` only carries the summed input and the
output tokens, so cache effectiveness is visible only through the `cache-efficiency` insight when it
falls below its threshold. The collector already holds `cacheReadInputTokens` /
`cacheCreationInputTokens` per usage row; this change publishes them and shows them on the Overview.

## User Review Required

> [!IMPORTANT]
> The new fields are **optional** in the zod contract, so a `dashboard.json` written before this
> change still parses. `schemaVersion` stays `2` (additive, non-breaking change).

> [!WARNING]
> The token chart grows from two to four series. The palette validates three slots all-pairs; the
> fourth slot (yellow) passes the adjacent-pair checks used for lines, and the chart keeps its legend
> and table view as secondary encoding. No compliance rule changes.

## Proposed Changes

### Core (`@claude-audit/core`)

#### [MODIFY] `packages/core/src/contracts/dashboard-view.ts`

- `usage.daily[]`: optional `uncachedInputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`
  (existing `inputTokens` kept; it equals their sum).
- `usage`: optional `cacheHitRate: number | null` — cache reads ÷ all input tokens over the period,
  percent with one decimal (same definition as the `cache-efficiency` analyzer), `null` when there
  is no input.

#### [MODIFY] `packages/core/src/application/presenters/dashboard-view.ts`

- `dailySeries` emits the three components per day; `usage` computes `cacheHitRate`.
- Keep functions within the ESLint limits (small helpers).

#### [MODIFY] `packages/core/src/application/__tests__/alerts-reports.test.ts` (or a new presenter test)

- Breakdown sums to `inputTokens`; `cacheHitRate` matches; `null` with zero input; an old-format
  view (no new fields) passes `dashboardViewSchema`.

### Dashboard (`@claude-audit/dashboard`)

#### [MODIFY] `packages/dashboard/src/components/sections.tsx`

- `TokenSection`: series by type (uncached input / cache read / cache write / output) when the
  breakdown is present, else the previous input / output series; subtitle shows the cache hit rate.

#### [MODIFY] `packages/dashboard/src/lib/view.ts`

- Pure helper choosing the token series and formatting the hit rate (unit tested).

#### [MODIFY] `packages/dashboard/src/index.css`

- Add the categorical slot `--series-4` (light `#eda100`, dark `#c98500`).

#### [NEW] `packages/dashboard/src/components/__tests__/TokenSection.test.tsx`

- Renders the four series and the hit rate; falls back for an old-format view.

### Data and docs

- `pnpm demo` regenerates `data/sample/` (golden test).
- `docs/BLUEPRINT.md` contract description, `CHANGELOG.md`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`

### Manual Verification

- `pnpm build:dashboard` on the demo sample, preview, Playwright screenshot of the Overview token
  card (light and dark) to confirm the four series and the hit rate render.
