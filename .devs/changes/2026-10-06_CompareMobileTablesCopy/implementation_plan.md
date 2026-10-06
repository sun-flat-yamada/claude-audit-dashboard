# Compare page mobile tables and copy fixes (F-015 follow-up)

Four defects of the F-015 compare page (#110, PR #113) reached `main` because PR #113 was merged
before they were fixed. Issue #117.

## User Review Required

> [!NOTE]
> Auto-Pilot is on: the plan is committed and reported, not held for approval. The changes are
> limited to the dashboard compare page; no contract, collector or compliance rule changes.

## Proposed Changes

### Dashboard

#### [MODIFY] `packages/dashboard/src/pages/ComparisonParts.tsx`

- Rule and coverage tables: `min-w-[36rem]` on the `<table>` so the existing `ScrollRegion`
  scrolls sideways instead of crushing the columns at 390px.
- `whitespace-nowrap` on the severity, base, target and change cells, the coverage item counts
  and the key figure number cells (the shared `CELL` with `[overflow-wrap:anywhere]` stays as it
  is for the other detail screens).
- Rule table column order: Rule, Change, Name, Severity, Base, Target (the change is the reason
  the row is shown, so it is visible without scrolling).
- Rule changes subtitle follows `CHANGE_CLASSES`: regressed, no longer assessed, added, removed,
  now assessed, improved; unchanged rules behind their own filter.

#### [MODIFY] `packages/dashboard/src/pages/Compare.tsx`

- Unknown-id alert: "Choose one below." becomes "Choose one above." (the selectors render above
  the alert). The archived hint keeps "see below" (`ArchivedGuide` renders after the alerts).

#### [MODIFY] `packages/dashboard/src/lib/compare-view.ts`

- `defaultSelection`: with only `base` in the query, the target is the newest selectable point
  other than the base (it could be the base itself before).

### Tests

- `compare-view.test.ts`: `{ base: <newest> }` selects the next newest point as target.
- `Compare.test.tsx`: updated copy / column order assertions where affected.
- New `e2e/sample/compare.spec.ts`: at 390px, the default and picked compare views have no
  page-level horizontal scroll and the rule table scrolls inside its region; the rule table
  header order.

### Docs

- `CHANGELOG.md` (Fixed); `docs/DASHBOARD-FEATURES.md` / `docs/BLUEPRINT.md` only if they
  describe the changed default selection or column order.

## Risks

- Column order change may break existing unit / E2E assertions; they are updated together.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`, then `pnpm test:e2e`

### Manual Verification

- Full-page screenshots of `#/compare` at 1280px and 390px (default and picked) and a 2x zoom of
  the rule table at 390px: no mid-word breaks, no page-level horizontal scroll, tables scroll in
  their region.
