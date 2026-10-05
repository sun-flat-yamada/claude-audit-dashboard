# B2-3 F-005 Activity search and timeline (#/activity)

Closes #63. Refs #37 (tracking). Plan source: `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` section B2-3 (owner accepted D1-D8; D1: activity detail paged by UTC month, up to 2000 rows per month file with `total` / `truncated`). Prerequisites B2-0 (#49), B2-2 (#57, PR #58) and the patterns B2-4 (#59, PR #60) and B2-5 (#61, PR #62) are merged.

## User Review Required

> [!IMPORTANT]
> No contract change. `detail/index.json` lists one `activity` entry per month (`month`, `status`, `reason`, `count`); the month selector is driven by it and only the selected `detail/activity-<yyyy-mm>.json` is fetched. Rows are already masked by the collector per `maskPii`; the page prints identifiers as published and never unmasks.

> [!WARNING]
> (1) The plan sketch mentioned deep-linkable filter state in the hash query and a count-by-day chart; this unit keeps filter state in component state (the router has no query support yet) and shows no chart, to stay within one PR. Both are listed as follow-ups in the walkthrough. (2) The date-range filter works on UTC calendar days inside the selected month, the same basis as the month files.
> (3) The demo synthetic tenant gains July and August 2026 routine activity (benign types only, so no compliance result changes) and the activities collection window widens to 91 days; therefore the `dashboard.json` activity aggregate (`total`, `topTypes`, `window`) and the weekly report counts change. `data/sample/` and the golden test are regenerated.

## Proposed Changes

### packages/dashboard

#### [NEW] `src/lib/activity-view.ts`

- Pure helpers: `activityMonths(manifest)` (newest first, with status / reason / count), `filterActivity` (text over type / actor id / e-mail / IP / organization, activity type, actor kind, from / to day within the month), `uniqueTypes`, `uniqueActorKinds`, `pageCount` / `pageSlice` (page size 50, clamped), `actorKindLabel`.

#### [NEW] `src/pages/Activity.tsx`

- Loads the manifest, then the selected month file with `useDetailFile`. Month selector, search, type / actor kind selects, date range inputs, paged timeline table (time, type, actor with icon + label + color, masked ID / e-mail / IP, organization), pager (Previous / Next, "Page n of m"), truncated notice ("Showing the newest 2000 of N activities"). States: loading, not published, not collected (manifest reason, also per month), error, empty month, no match. Reuses `DetailControls.tsx` (`SelectField`, `SearchField`, `Notice`, `detailNotice`, `CELL`, `HEAD`, `FIELD`).

#### [MODIFY] `src/routes.tsx`, `src/components/Badges.tsx`

- Route `#/activity` ("Activity"); `actor-*` badge entries (icon + label + color).

### packages/collector

#### [MODIFY] `src/adapters/demo/demo-source.ts`

- Synthetic activity for 2026-07 and 2026-08 (example.com only; enough rows to page); the September rows and `dashboard.json` stay unchanged.

### Data

- Regenerate `data/sample/` with `pnpm demo` (new `detail/activity-2026-07.json`, `activity-2026-08.json`, manifest entries).

### Tests

- `src/lib/__tests__/activity-view.test.ts`, `src/pages/__tests__/Activity.test.tsx` (maskPii on / off, month switching with lazy fetch, paging, truncated notice, filters, all states, synthetic sample), `src/__tests__/app.test.tsx` deep link.

### Docs

- `docs/DASHBOARD-FEATURES.md` F-005, `docs/BLUEPRINT.md` section 9.2.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- `pnpm demo` leaves `git diff --exit-code data/sample` clean after the committed regeneration.

### Manual Verification

- `DASHBOARD_DATA_SOURCE=sample pnpm dev`, open `#/activity` at 390 px and in both themes.
