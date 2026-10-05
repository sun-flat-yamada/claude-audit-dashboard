# Walkthrough: AN-2 Active users by product

## Summary

Issue #93 (parent #91). The collector now maps the per-product active-user counts that the
Enterprise Analytics summaries endpoint already returns (`chat_*`, `claude_code_*`, `cowork_*`,
`claude_design_*`, `office_agent_*`, `science_*` daily / weekly / monthly) from the same call, and
the Overview Active users card shows them as a "By product" table with a weekly-active sparkline
per product. Every new field is optional, so stored snapshots and older `dashboard.json` files
still load; `schemaVersion` stays 2. A product whose counts are omitted or `null` is skipped and
never fails the collection.

## Changes Made

### Core

- `packages/core/src/domain/model/entities.ts`: `ACTIVE_USER_PRODUCTS` catalog with display labels,
  `ProductActiveUsers`, optional `AdoptionDay.byProduct`.
- `packages/core/src/contracts/dashboard-view.ts`: optional `adoption.byProduct` (latest day) and
  `adoption.productWeekly` (weekly active per product and day).
- `packages/core/src/application/presenters/dashboard-view.ts`: `productAdoption` helper (latest
  day with a breakdown, WAU descending then catalog order; fields absent without data).
- `packages/core/src/application/__tests__/dashboard-view-products.test.ts`: ordering, trend,
  omission, old-format compatibility.

### Collector

- `packages/collector/src/adapters/anthropic/analytics-api.ts`: per-product fields added to
  `summarySchema` as `nullish`; `productActiveUsers` keeps a product only when DAU, WAU and MAU are
  all numbers.
- `packages/collector/src/__tests__/fake-anthropic.ts`, `gateways.test.ts`: official example with
  every product; omitted, `null` and incomplete products; the tenant-shape fixture (cowork only)
  yields cowork.
- `packages/collector/src/adapters/demo/demo-source.ts`: per-product demo counts (Chat > Claude
  Code (growing) > Cowork > Design / Office / Science); `data/sample/` regenerated with `pnpm demo`.

### Dashboard

- `packages/dashboard/src/components/ProductActiveUsers.tsx`, `src/lib/adoption-view.ts`: table
  (product, daily, weekly, monthly) with a one-hue (`--series-1`) sparkline per product on a shared
  scale, named for assistive technology, plus a "View as table" twin of the weekly trend. No new
  colors: six products exceed the validated categorical slots, so no multi-line chart.
- `packages/dashboard/src/components/sections.tsx`: `AdoptionSection` renders it below the chart.
- `packages/dashboard/src/components/__tests__/AdoptionSection.test.tsx`, `e2e/sample/overview.spec.ts`.

### Docs

- `docs/API-MAPPING.md` §4, `docs/BLUEPRINT.md` (dataset table, DashboardView description),
  `CHANGELOG.md`.

## Verification Results

| Stage                | Command             | Result                                     |
| :------------------- | :------------------ | :----------------------------------------- |
| Code-Data Decoupling | `pnpm fork:verify`  | ✅ Clean (exit 0)                          |
| TypeScript Check     | `pnpm typecheck`    | ✅ Pass (exit 0)                           |
| Unit Tests           | `pnpm test`         | ✅ core 187, collector 223, dashboard 348  |
| Secret Scan          | `pnpm secret-scan`  | ✅ Clean (exit 0)                          |
| Build                | `pnpm build`        | ✅ Pass (exit 0)                           |
| Lint                 | `pnpm lint`         | ✅ Pass (exit 0)                           |
| Format               | `pnpm format:check` | ✅ Pass (exit 0)                           |
| E2E and a11y         | `pnpm test:e2e`     | ✅ 362 passed, 15 skipped (by profile)     |

### Manual Verification

- Built the dashboard on the demo sample and captured the Overview Active users card with
  Playwright (light, dark and a 390 px viewport): the By product table lists the six products in
  WAU order with sparklines; on a phone the table scrolls inside its own focusable region.
