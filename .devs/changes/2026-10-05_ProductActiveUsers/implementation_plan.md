# AN-2: Active users by product

Issue #93 (parent tracking #91, after AN-1 #92). The Enterprise Analytics summaries endpoint
(`GET /v1/organizations/analytics/summaries`) returns, per day, the daily / weekly / monthly active
users per product: `cowork_*` (required) and the optional, nullable `chat_*`, `claude_code_*`,
`claude_design_*`, `office_agent_*` and `science_*` counts. The collector maps only the
organization-wide DAU / WAU / MAU. This change maps the per-product counts from the same call (no
extra request) and shows them on the Overview.

## User Review Required

> [!IMPORTANT]
> All new fields are **optional**: `AdoptionDay.byProduct` (so stored snapshots on `data/audit`
> still load) and `DashboardView.adoption.byProduct` / `productWeekly` (so an older
> `dashboard.json` still parses). `schemaVersion` stays `2` (additive, non-breaking).

> [!WARNING]
> Six products exceed the four validated categorical color slots, so the UI does not draw a
> six-line chart. It shows a table (product, DAU, WAU, MAU) with a one-hue WAU sparkline per row
> and a "View as table" twin of the WAU trend. A product whose counts are missing or `null` is
> simply absent; collection never fails because of these fields. No compliance rule changes.

## Proposed Changes

### Core (`@claude-audit/core`)

#### [MODIFY] `packages/core/src/domain/model/entities.ts`

- `ACTIVE_USER_PRODUCTS` catalog (`chat`, `claude_code`, `cowork`, `claude_design`,
  `office_agent`, `science`, with display labels), `ActiveUserProduct`, `ProductActiveUsers`
  `{ product, dau, wau, mau }`; `AdoptionDay.byProduct?: ProductActiveUsers[]`.

#### [MODIFY] `packages/core/src/contracts/dashboard-view.ts`

- `adoption.byProduct?: { product, label, dau, wau, mau }[]` (latest day, WAU descending) and
  `adoption.productWeekly?: { date, wau: Record<product, number> }[]` (WAU trend).

#### [MODIFY] `packages/core/src/application/presenters/dashboard-view.ts`

- Emit both fields only when at least one day carries a product breakdown (small helpers within
  the ESLint limits).

#### [NEW] `packages/core/src/application/__tests__/dashboard-view-products.test.ts`

- Latest-day breakdown and ordering, WAU trend, omission without data, old-format view parses.

### Collector (`@claude-audit/collector`)

#### [MODIFY] `packages/collector/src/adapters/anthropic/analytics-api.ts`

- `summarySchema` gains every per-product field as `nullish`; a pure mapper keeps a product only
  when its DAU, WAU and MAU are all numbers.

#### [MODIFY] `packages/collector/src/__tests__/fake-anthropic.ts` and `gateways.test.ts`

- Official example with all products; cases for omitted fields and `null` values; the tenant-shape
  fixture (cowork only) yields cowork only.

#### [MODIFY] `packages/collector/src/adapters/demo/demo-source.ts`

- Realistic per-product counts (Chat > Claude Code > Cowork > Design / Office / Science).

### Dashboard (`@claude-audit/dashboard`)

#### [MODIFY] `packages/dashboard/src/components/sections.tsx` (+ a small `ProductActiveUsers` component)

- Adoption card: "By product" table with DAU / WAU / MAU and a WAU sparkline (slot 1 only, named
  for assistive technology), plus a "View as table" WAU trend. Nothing extra for older views.

#### [NEW] `packages/dashboard/src/components/__tests__/AdoptionSection.test.tsx`

- Renders the product rows; falls back for an old-format view.

#### [MODIFY] `packages/dashboard/e2e/sample/overview.spec.ts`

- Assert the product breakdown on the sample.

### Data and docs

- `pnpm demo` regenerates `data/sample/` (golden test).
- `docs/API-MAPPING.md` §4, `docs/BLUEPRINT.md` contract description, `CHANGELOG.md`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- `pnpm test:e2e` (Playwright E2E and axe)

### Manual Verification

- Build the dashboard on the demo sample, Playwright screenshot of the Overview adoption card
  (light and dark) to confirm the product table and sparklines render.
