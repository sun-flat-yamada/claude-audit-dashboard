# Walkthrough: Compare page mobile tables and copy fixes (F-015 follow-up)

## Summary

Fixes the four defects of the F-015 compare page (#110, PR #113) that reached `main`
(Issue #117): unreadable tables at 390px, a rule-changes subtitle that did not match the real
order, an alert that pointed "below" to selectors rendered above it, and a base-only selection
that could pick the base itself as target.

## Changes Made

### Dashboard

- `packages/dashboard/src/pages/ComparisonParts.tsx`: local cell classes for the compare tables
  (`TEXT` wraps between words only with `break-words`, `NOWRAP` for badges and short values,
  `NUMBER` for figures); the shared `CELL` of the other detail screens is unchanged. The rule and
  coverage tables get `min-w-[36rem]` so their `ScrollRegion` scrolls on a phone; the rule table
  columns are Rule, Change, Name, Severity, Base, Target. The subtitle names the
  `CHANGE_CLASSES` order (regressed, no longer assessed, added, removed, now assessed, improved).
- `packages/dashboard/src/pages/Compare.tsx`: "Choose one above." (the archived hint keeps
  "see below": `ArchivedGuide` renders after the alerts).
- `packages/dashboard/src/lib/compare-view.ts`: `defaultSelection` picks the newest selectable
  point other than an explicit `base` as target.

### Tests

- `compare-view.test.ts`: base-only cases (`{ base: newest }` selects the next newest).
- `Compare.test.tsx`: column order, "Choose one above.", base-only selection on the page.
- `e2e/sample/compare.spec.ts` (new): at 390px, default and picked selections have no
  page-level horizontal scroll, no word of the three tables is laid out on two lines and the rule
  table scrolls inside its region; base-only hash selects the next newest target.

### Docs

- `CHANGELOG.md` (Fixed), `docs/DASHBOARD-FEATURES.md` and `docs/BLUEPRINT.md` (default
  selection with only a base, rule table columns, 390px behaviour). `pnpm demo`: `data/sample/`
  unchanged.

## Screenshots

Full-page `#/compare` at 1280px and 390px (default, and base 2026-09-01 / target 2026-09-29) and
a 2x zoom of the rule table at 390px, taken from the `sample` E2E profile build: no mid-word
breaks, no page-level horizontal scroll at 390px (checked in the browser), the coverage and key
figure tables scroll inside their region. Stored outside the repository (not committed).

## Verification Results

| Stage                    | Command                          | Result                       |
| :----------------------- | :------------------------------- | :--------------------------- |
| Plan first               | `pnpm change-dev:plan-check`     | ✅ Plan before implementation |
| Code-Data Decoupling     | `pnpm fork:verify`               | ✅ Clean (exit 0)             |
| TypeScript Check         | `pnpm typecheck`                 | ✅ Pass (exit 0)              |
| Unit & Integration Tests | `pnpm test`                      | ✅ 1073/1073 pass             |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | ✅ 0 leaks (exit 0)           |
| Production Build         | `pnpm build`                     | ✅ Built                      |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | ✅ Clean                      |
| E2E and accessibility    | `pnpm test:e2e`                  | ✅ 465 passed, 22 skipped     |
