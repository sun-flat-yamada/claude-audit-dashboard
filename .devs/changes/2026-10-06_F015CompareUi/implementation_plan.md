# F-015 PR3: compare UI, hash-router query support and diff export

Closes #110 (Work-Unit Issue, sub-issue of #42), Refs #42. Prerequisites merged: PR1 (#101 / #103) design and three-point sample data, PR2 (#106 / #108) summary schema, `diffTimePoints`, export formatters, `detail/compare/*`.

Design decisions D-1 to D-5 are in `.devs/changes/2026-10-05_F015MultiTimePointSampleData/implementation_plan.md`; this PR implements D-4 (routing and UX) on top of the PR2 core. It does not add the archived-snapshot integration test (PR4) or E2E specs (PR5).

## User Review Required

> [!IMPORTANT]
> - **Router**: the hash router gains query support (`#/compare?base=<id>&target=<id>`) as an additive API (`parseHashQuery`, `formatHash(path, query?)`, `useHashQuery`). `parseHash` still returns the path only, so every existing route, deep link and test is unchanged. Unknown params are ignored by the page; an id that is not a selectable point is shown as "unknown time point" (no crash, no silent fallback).
> - **Existing E2E** changes only where the new "Compare" nav entry legitimately changes expectations: `STATIC_ROUTES` in `e2e/support/routes.ts` gains `/compare`, which makes the navigation spec (link count) and the per-route screen / axe / mobile specs cover the new page in every data profile. Listed in the walkthrough.

> [!WARNING]
> - Compare data is a detail file: it is only present for the sample or under `PAGES_DETAIL_DATA`. Every other deployment shows the "not published" state, which is a normal state, not an error.

## Proposed Changes

### Dashboard router

#### [MODIFY] `packages/dashboard/src/lib/router.ts`

- `parseHashQuery(hash)`: URLSearchParams of the part after `?` inside the hash (empty when none; malformed escapes never throw). `formatHash(path, query?)`: serializes defined, non-empty entries in key order. `useHashQuery()` re-renders on `hashchange`; `setHashQuery(path, query)` navigates with `replace` semantics so selector changes do not flood the history.

### Dashboard compare page

#### [NEW] `packages/dashboard/src/lib/compare-view.ts`

- Pure helpers: default selection (target = newest, base = previous), resolving `base` / `target` ids against the index (`ok`, `unknown`, `archived`, `same`), rule-change filtering by class and search, class labels and order, KPI value / delta formatting by unit, export file names via `timePointDiffFileName`.

#### [NEW] `packages/dashboard/src/pages/Compare.tsx`, `ComparisonParts.tsx`

- Loads `detail/compare/index.json` with `useDetailFile` and the manifest for the "not collected" reason; the two point files are fetched lazily once the selection is valid. All states: loading, not published, not collected, error, fewer than two points, same point, unknown id, archived-without-summary (listed but disabled with the `restore <id>` then `build:detail --snapshot <id>` guidance).
- Results: score header, rule changes (filter chips with counts, search, regressed first, unchanged collapsed behind a filter), coverage changes, KPI deltas, Markdown / CSV / JSON export buttons through the existing `downloadText` helper.

#### [MODIFY] `packages/dashboard/src/routes.tsx`, `components/sections.tsx`, `components/Badges.tsx`

- `/compare` route and nav entry "Compare"; a link in the compliance trend card to compare the last two points (only when the trend has two or more points); badge entries for the change classes (icon + label + colour).

### Tests

- `lib/__tests__/router.test.ts` (query parse / serialize), `lib/__tests__/compare-view.test.ts`, `pages/__tests__/Compare.test.tsx` (every state, filter, search, swap, export parity with the core formatters on the sample's three points), App deep-link test, `ComplianceTrend.test.tsx` link.
- `e2e/support/routes.ts`: add `/compare`.

### Docs

- `docs/DASHBOARD-FEATURES.md` F-015 (UI available), `docs/BLUEPRINT.md` §9 route table, `CHANGELOG.md`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- `pnpm test:e2e` (full suite, axe clean, including the new route through `STATIC_ROUTES`)

### Manual Verification

- `pnpm dev`, open `#/compare` and the deep link with `?base=2026-09-01T12-00-00Z&target=2026-09-29T12-00-00Z`; check 390 px, light and dark.
