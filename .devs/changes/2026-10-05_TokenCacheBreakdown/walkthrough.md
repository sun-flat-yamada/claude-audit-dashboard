# Walkthrough: AN-1 Daily token cache breakdown and cache hit rate

## Summary

Resolves #92 (parent #91). The published `DashboardView` now carries the daily input-token
breakdown (uncached / cache read / cache write) and the period cache hit rate, and the Overview
"Daily tokens" card charts tokens by type with the hit rate in its subtitle. All new fields are
optional, so a `dashboard.json` written before this change still validates (`schemaVersion` stays
2) and the card falls back to the previous input / output pair.

## Changes Made

### Core

- `packages/core/src/contracts/dashboard-view.ts`: optional `usage.daily[].uncachedInputTokens`,
  `cacheReadInputTokens`, `cacheCreationInputTokens` and optional `usage.cacheHitRate`
  (`number | null`).
- `packages/core/src/application/presenters/dashboard-view.ts`: `dailySeries` emits the breakdown;
  `cacheHitRate()` = cache reads ÷ all input tokens (percent, one decimal, the `cache-efficiency`
  analyzer's definition), `null` when there is no input.
- `packages/core/src/application/__tests__/dashboard-view-tokens.test.ts`: breakdown sums to
  `inputTokens`, hit rate value, `null` on zero input / cost-only usage, legacy view passes the
  schema.

### Dashboard

- `packages/dashboard/src/lib/view.ts`: `hasTokenBreakdown`, `tokenSeries`, `tokenSubtitle`.
- `packages/dashboard/src/components/sections.tsx`: `TokenSection` uses the helpers.
- `packages/dashboard/src/components/TimeSeriesChart.tsx`: row type allows optional fields.
- `packages/dashboard/src/index.css`: categorical slot `--series-4` (light `#eda100`, dark
  `#c98500`; the 4-slot palette passes the adjacent-pair checks in both modes). Series order is
  uncached input, cache read, output, cache write so the two lines that usually run close (cache
  read and output) get the orange / aqua pair rather than orange / yellow.
- `packages/dashboard/src/components/__tests__/TokenSection.test.tsx`: four series and hit rate,
  dash for `null`, fallback for an old view.

### Collector, sample and docs

- `packages/collector/src/adapters/demo/demo-source.ts`: the demo cache-read share varies per day
  (12-32 % of tokens) while the per-day input total keeps its previous rounding, so token totals,
  compliance results and reports are unchanged except the cache insight (25 % -> 29.7 % in the
  monthly report, 27.1 % on the dashboard).
- `data/sample/` regenerated with `pnpm demo`.
- `docs/BLUEPRINT.md` (DashboardView contract and the Overview table), `CHANGELOG.md`.

## Verification Results

| Stage                | Command              | Result                                       |
| :------------------- | :------------------- | :------------------------------------------- |
| Code-Data Decoupling | `pnpm fork:verify`   | ✅ Clean (exit 0)                            |
| TypeScript Check     | `pnpm typecheck`     | ✅ Pass (exit 0)                             |
| Unit Tests           | `pnpm test`          | ✅ core 183, collector 221, dashboard 341    |
| Secret Scan          | `pnpm secret-scan`   | ✅ No secrets detected                       |
| Build                | `pnpm build`         | ✅ Pass (exit 0)                             |
| Lint                 | `pnpm lint`          | ✅ Pass (exit 0)                             |
| Format               | `pnpm format:check`  | ✅ Pass (exit 0)                             |
| Plan first           | `change-dev:plan-check` | ✅ Plan committed before the first implementation commit |

### Manual Verification

- `pnpm build:dashboard` on the demo sample, `vite preview`, Playwright (Chromium) screenshots of
  the Overview in light and dark mode: the "Daily tokens" card shows the four series with a legend,
  the table view, and "Cache hit rate 27.1% (cache reads ÷ all input)". Screenshots are not
  committed.
