# Implementation Plan: Activity Query Deep Links, Rule-Match Filter, and Count-by-Day Chart (#83)

Context & Issue link: [#83](https://github.com/sun-flat-yamada/claude-audit-dashboard/issues/83) — F-005 Activity query deep links, rule-match filter, count-by-day chart.

## User Review Required

> [!IMPORTANT]
> - Hash routing query format: `#/activity?month=YYYY-MM&q=...&type=...&actorKind=...&from=...&to=...&rule=...&page=N`. All keys are optional. Missing or invalid values gracefully fall back to defaults without breaking navigation.
> - Browser history: Uses `replaceQuery('/activity', nextQuery)` when changing filters, selectors, or page so history stack is not flooded. The browser's back/forward buttons restore filter states via `hashchange`.
> - Rule match filter: Matches activities against AM-001 through AM-007 activity watch rule definitions purely in `@claude-audit/dashboard`'s `activity-view.ts` based on activity event types, keeping contract schemaVersion stable without requiring changes to storage or backend collector schemas.
> - Count-by-day chart: Displays daily counts of filtered activities in the selected month with a togglable table view ("View as table") accessible at 390px mobile widths without horizontal scroll.

## Proposed Changes

### `packages/dashboard`

#### [MODIFY] `packages/dashboard/src/lib/activity-view.ts`

- Add `ActivityRuleMatch` definitions and matching helper function for AM-001..AM-007 (`matchActivityRules(item): string[]`).
- Extend `ActivityFilter` type to include `rule?: string` ('all' | 'any' | rule ID).
- Add `parseActivityQuery(query: HashQuery, availableMonths: readonly string[]): { month: string; filter: ActivityFilter; page: number }`.
- Add `formatActivityQuery(month: string, filter: ActivityFilter, page: number, defaultMonth: string): HashQuery`.
- Add daily activity count aggregation helper: `dailyActivityCounts(items: readonly ActivityItem[], month: string): readonly { date: string; count: number }[]`.
- Update `filterActivity` to filter by rule matching.

#### [MODIFY] `packages/dashboard/src/pages/Activity.tsx`

- Use `useHashQuery()` and `replaceQuery()` to synchronize filters, selected month, and current page with the URL hash query.
- Add Rule match select field to `Filters`.
- Render Rule badges on timeline rows when an event matches AM-xxx rules.
- Add count-by-day chart component (`DailyActivityChart`) with accessible "View as table" toggle.
- Ensure 390px mobile responsiveness with no horizontal overflow.

#### [MODIFY] `packages/dashboard/src/lib/__tests__/activity-view.test.ts`

- Test `matchActivityRules`, `filterActivity` with rule filtering, query parse/format helpers, and `dailyActivityCounts`.

#### [MODIFY] `packages/dashboard/src/pages/__tests__/Activity.test.tsx`

- Test deep link query parsing and restoration.
- Test rule filter selection and count-by-day chart toggling between chart and table view.

### Documentation

#### [MODIFY] `docs/DASHBOARD-FEATURES.md`

- Update F-005 to mark query deep linking, rule-match filtering, and count-by-day chart as completed.

#### [MODIFY] `docs/BLUEPRINT.md`

- Ensure §9 Activity timeline specifications align with the query synchronization and rule matching features.

## Verification Plan

### Automated Tests

- In worktree:
  - `pnpm --filter @claude-audit/dashboard test`
  - `pnpm fork:verify`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm secret-scan`
  - `pnpm build`
  - `pnpm lint && pnpm format:check`
- E2E tests:
  - `pnpm test:e2e`

### Manual Verification

- Verify `#/activity?type=...&q=...` opens with active filters restored.
- Verify browser back/forward buttons restore previous filter state.
- Verify count-by-day chart renders and toggles to table view.
