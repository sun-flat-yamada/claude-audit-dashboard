# Walkthrough: F-015 PR3 compare UI, hash-router query support and diff export

## Summary

Implements the screen half of F-015 (#42) as Work-Unit #110: route `#/compare?base=<id>&target=<id>` with point selectors, rule / coverage / KPI differences computed in the browser by `diffTimePoints`, and Markdown / CSV / JSON export through the PR2 formatters. The hash router gains minimal query support. No archived-restore integration test (PR4) and no new E2E specs (PR5).

## Changes Made

### Router

- `lib/router.ts`: `parseHashQuery`, `formatHash(path, query?)`, `replaceQuery` (replaces the hash without a history entry and notifies subscribers), `useHashQuery`. `parseHash` is unchanged (path only), so existing routes and deep links keep working; unknown parameters are ignored by the page.

### Compare page

- `lib/compare-view.ts` (pure): selectable points, id check (ok / archived / unknown), default selection (target newest, base previous), change labels, filtering and search, unchanged-rule derivation, KPI formatting with signed deltas and units.
- `pages/Compare.tsx`: index and manifest via `useDetailFile`, selectors with swap, per-state notices, lazy loading of only the two chosen point files.
- `pages/ComparisonParts.tsx`: summary card, rule changes (filter chips with counts, search, ScrollRegion table), coverage changes, key figures, export bar.
- `components/Badges.tsx`: `change-*` badge entries (icon + label + colour). `routes.tsx`: `/compare` and the nav entry "Compare". `components/sections.tsx`: link from the score trend card to the comparison of the last two points.

### Tests

- New: `compare-view.test.ts`, `Compare.test.tsx` (every state, selection defaults and hash, swap, filter / search, coverage, KPI, currency, export parity with the core formatters on the sample's three points, deterministic file names). Extended: `router.test.ts` (query parse / serialize), `app.test.tsx` (deep link on the sample), `ComplianceTrend.test.tsx` (link).

### Existing E2E changed (and why)

- `e2e/support/routes.ts`: `STATIC_ROUTES` gains `/compare` (new nav entry). The navigation, screens, axe, mobile (390 px) and stale-data specs therefore also cover the new page in every profile.
- `e2e/sample/keyboard.spec.ts`: `NAV_LABELS` gains `Compare`; the Overview focus-order spec expects one more content stop (the trend-card link "Compare the last two time points") before the status filter.

### Docs

`docs/DASHBOARD-FEATURES.md` (F-015 UI available), `docs/BLUEPRINT.md` (§9 screen table, status note), `CHANGELOG.md`.

## Verification Results

| Stage                    | Command                                | Result                                              |
| :----------------------- | :------------------------------------- | :-------------------------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`                     | Clean (exit 0)                                      |
| TypeScript Check         | `pnpm typecheck`                       | Pass (exit 0)                                       |
| Unit & Integration Tests | `pnpm test`                            | core 294, collector 287, dashboard 421 pass         |
| Zero Secret / PII Scan   | `pnpm secret-scan`                     | 0 leaks (exit 0)                                    |
| Production Build         | `pnpm build`                           | Built                                               |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check`       | Clean                                               |
| Dependency audit         | `pnpm audit:deps`                      | No known vulnerabilities                            |
| E2E and axe              | `pnpm test:e2e` (full suite)           | 406 passed, 18 skipped (profile-specific), axe clean |
