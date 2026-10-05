# Walkthrough: B2-3 F-005 Activity search and timeline

Closes #63. Refs #37.

## What changed

- **Page** (`packages/dashboard/src/pages/Activity.tsx`, route `#/activity`, nav entry "Activity"): the month selector is built from the detail manifest (newest first) and only the selected `detail/activity-<yyyy-mm>.json` is fetched (the month view is keyed by month, so switching refetches and resets filters and page). Search, activity type, actor kind and an inclusive UTC date range inside the month; paged timeline (50 rows, Previous / Next, "Page n of m"); actor kind as icon + label + color; identifiers, e-mail addresses and IPs printed as published with a `maskPii` note; a notice with the total and kept rows for a capped (`truncated`) month. States: loading, not published, not collected (manifest reason), error, listed-but-missing month, empty month, no match.
- **Helpers** (`lib/activity-view.ts`, pure): `activityMonths`, `activityUnavailable`, `filterActivity`, `uniqueTypes` / `uniqueActorKinds`, `pageCount` / `pageSlice`, actor kind labels and badge keys, month labels and bounds.
- **Shared controls** (`components/DetailControls.tsx`): added `DateField`; the page reuses `SearchField`, `SelectField`, `Notice`, `detailNotice`, `CELL`, `HEAD`. **Badges**: `actor-*` entries.
- **Demo data** (`collector/src/adapters/demo/demo-activity-history.ts`, `demo-source.ts`): deterministic routine activity for July (62 rows) and August (130 rows) 2026 including month-boundary rows; September stays at 79 rows (2 pages). Benign types only, so compliance results are unchanged. The activities window widens to 91 days, so the `dashboard.json` activity aggregate (`total` 79 to 271, `topTypes`, `window`) and the weekly report counts change; `data/sample/` regenerated (new `detail/activity-2026-07.json` and `activity-2026-08.json`, manifest entries).
- **Docs**: `docs/DASHBOARD-FEATURES.md` F-005, `docs/BLUEPRINT.md` section 9.2.
- No contract change.

## Verification Results

| Stage  | Command                                                         | Result        |
| :----- | :-------------------------------------------------------------- | :------------ |
| Gate   | `pnpm fork:verify && typecheck && test && secret-scan && build` | Pass (exit 0) |
| Lint   | `pnpm lint`                                                     | Pass (exit 0) |
| Format | `pnpm format:check`                                             | Pass (exit 0) |
| Audit  | `pnpm audit:deps`                                               | Pass (exit 0) |
| Sample | `pnpm demo` then `git diff` of committed `data/sample/`         | Clean         |

Tests added: helper unit (months, unavailable, every filter incl. date boundaries, paging and clamping, labels); component (first page and lazy month fetch, paging, month switching with page reset, filters and no match, actor kind badge, truncated notice present and absent, `maskPii` on and off, empty month, missing and failing month file, unavailable with reason, not published, no activity files, loading and error, synthetic sample across three months); App deep link `#/activity`.

## Caveats

- The date filter works on UTC days of the selected month only; there is no cross-month search (only one month is loaded by design).
- Filter state lives in component state; URL query deep links and the count-by-day chart from the plan sketch are not included (the router has no query support). Follow-up candidates.
- The sample has no truncated month (the cap is 2000); that case is covered by component tests with synthetic data.
- Layout (390 px, light / dark) follows the existing token and wrapping patterns and was not checked in a real browser here; B5 (#40) covers E2E / a11y.
