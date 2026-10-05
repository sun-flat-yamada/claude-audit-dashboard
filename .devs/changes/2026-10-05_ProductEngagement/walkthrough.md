# Walkthrough: AN-3 Product engagement

## Summary

Issue #94 (parent #91). The collector now maps the metric blocks that the Enterprise Analytics
users roll-up (`GET /v1/organizations/analytics/users`, `starting_date` = today - 90 days) already
returns: `chat_metrics`, `claude_code_metrics` (`core_metrics`, `tool_actions`), `cowork_metrics`,
`design_metrics`, `office_metrics` (Excel / Outlook / PowerPoint / Word, summed), `science_metrics`
and `web_search_count`, from the same call, into the optional `MemberActivity.engagement`. The
dashboard publishes an aggregate with no per-person values (`DashboardView.engagement`) and the
Overview shows a "Product engagement (90 days)" card with a product table and a Claude Code panel
(lines added / removed, commits, pull requests, sessions, suggestion accept rate per tool). Every
new field is optional, so stored snapshots and older `dashboard.json` files still load. The plan
was written against `schemaVersion` 2; `main` moved to `DashboardView` v3 (#102, model x group
aggregate) during this change, so after the rebase `engagement` is an optional v3 field and a v3
`dashboard.json` written before it still parses. A missing block or `null` counter never fails the collection, and
`active` / `lastActiveOn` (input of AC-001) are computed exactly as before.

## Changes Made

### Core

- `packages/core/src/domain/model/entities.ts`: `MemberEngagement` in domain words (`chat`,
  `claudeCode` with `ToolDecisions` per `CODE_TOOLS`, `cowork`, `design`, `office`, `science`,
  `webSearches`); optional `MemberActivity.engagement`.
- `packages/core/src/contracts/dashboard-view.ts`: optional top-level `engagement` (`window`,
  `members`, `products[]`, `claudeCode` with per-tool `acceptRate`, `webSearches`).
- `packages/core/src/application/presenters/dashboard-engagement.ts` (new) and
  `dashboard-view.ts`: pure aggregation; absent without engagement rows or without collected
  `memberActivity`.
- `packages/core/src/application/__tests__/dashboard-view-engagement.test.ts` (new).

### Collector

- `packages/collector/src/adapters/anthropic/user-engagement.ts` (new): lenient zod shapes
  (`nullish().catch(null)` for every block and counter) and the mapper.
- `packages/collector/src/adapters/anthropic/analytics-api.ts`: `userActivitySchema` gains the
  blocks; `engagement` is attached only when a block is present.
- `packages/collector/src/adapters/anthropic/__tests__/user-engagement.test.ts` (new): official
  example shape with every block, blocks missing, `null` distinct counts, malformed blocks.
- `packages/collector/src/adapters/anthropic/__tests__/gateways.test.ts`: the existing activity
  assertion compares only `userId` / `email` / `active` / `lastActiveOn` (expected values
  unchanged) because the default fixture rows now also carry `engagement`.
- `packages/collector/src/adapters/demo/demo-engagement.ts` (new), `demo-source.ts`:
  persona-based synthetic engagement; the demo member-activity window starts at the start of the
  day 90 days ago like the real roll-up; `data/sample/` (including the F-015 `history/` views
  after the rebase) regenerated with `pnpm demo`.

### Dashboard

- `packages/dashboard/src/components/ProductEngagement.tsx`, `src/lib/engagement-view.ts` (new):
  table-first card; Claude Code facts; accept-rate bars per tool on a fixed 0-100% scale in
  `--series-1` with a "View as table" twin.
- `packages/dashboard/src/pages/Overview.tsx`: section placed after Active users.
- `packages/dashboard/src/components/__tests__/ProductEngagement.test.tsx` (new),
  `e2e/sample/overview.spec.ts` (new AN-3 assertion).

### Docs

- `docs/API-MAPPING.md` §4, `docs/BLUEPRINT.md` (dataset table, §9.1 contract, §9.2 sections),
  `CHANGELOG.md`. The detail files and the per-person publishing policy are unchanged.

## Verification Results

| Stage                | Command             | Result                                    |
| :------------------- | :------------------ | :---------------------------------------- |
| Code-Data Decoupling | `pnpm fork:verify`  | ✅ Clean (exit 0)                         |
| TypeScript Check     | `pnpm typecheck`    | ✅ Pass (exit 0)                          |
| Unit Tests           | `pnpm test`         | ✅ core 196, collector 261, dashboard 355 |
| Secret Scan          | `pnpm secret-scan`  | ✅ Clean (exit 0)                         |
| Build                | `pnpm build`        | ✅ Pass (exit 0)                          |
| Lint                 | `pnpm lint`         | ✅ Pass (exit 0)                          |
| Format               | `pnpm format:check` | ✅ Pass (exit 0)                          |
| E2E and a11y         | `pnpm test:e2e`     | ✅ 362 passed, 14 skipped (by profile)    |

Results after rebasing onto `origin/main` (DashboardView v3). AC-001 tests (`packages/core/src/domain/compliance/__tests__/access-control.test.ts`) are
unchanged and pass.

### Manual Verification

- Built the dashboard on the demo sample and captured the Product engagement card with Playwright
  (light, dark and a 390 px viewport): six products ordered by active members (Chat 34 / 36 ...
  Claude Science 3 / 36), Claude Code panel with an 88.8% suggestion accept rate and per-tool bars;
  on a phone the product table scrolls inside its own focusable region.
