# Grouped navigation without hidden overflow (AN-7)

Since AN-4 to AN-6 the top navigation holds 14 links and scrolls sideways even at 1280px, so the
last items (Alerts, Organizations) are hidden behind a horizontal scroll. Issue #112 (parent #91).

## User Review Required

> [!IMPORTANT]
> The navigation moves from a single top row to a grouped side navigation from 1024px (`lg`) and a
> disclosure menu below 1024px (phones and tablets). Groups: (no label) Overview, Compliance /
> Usage: Models, Claude Code, Console API, Skills & connectors, Monthly report / Directory:
> Members, API keys, Organizations / Operations: Activity, Alerts, Configuration, Archive. This
> changes the keyboard Tab order of the nav (grouped order), which the E2E spec encodes.

> [!WARNING]
> The main content becomes narrower at 1024px to 1279px (side nav of about 13rem). Every page is
> already responsive down to 390px, and the E2E suite checks no horizontal page scroll; no visual
> snapshot tests exist.

## Proposed Changes

### Dashboard

#### [MODIFY] `packages/dashboard/src/routes.tsx`

- `RouteDef` gains an optional `group` (`NavGroupId`); `NAV_GROUPS` lists the group ids and labels
  in display order. Appending a page stays one entry in `ROUTES` (with its `group`).

#### [MODIFY] `packages/dashboard/src/components/NavBar.tsx`

- Pure `groupNavItems(items, groups)` (stable: route order inside a group, ungrouped items first).
- Each group renders as a `<ul aria-labelledby>` with a visible label (not a heading); links stay
  real `<a href="#/...">` with `aria-current="page"`.
- Below `lg`: a `Menu` button (`aria-expanded`, `aria-controls`) shows / hides the grouped list;
  Escape closes it and returns focus to the button; following a link closes it.
- From `lg`: the list is always shown in a sticky side column; the button is hidden.
- The theme toggle stays right after the links in DOM order.

#### [MODIFY] `packages/dashboard/src/App.tsx`

- Shell layout: side nav + main in a row from `lg`, stacked below.

### Tests

- Unit: `groupNavItems` and the menu button behavior (Vitest + Testing Library).
- E2E: nav order spec in grouped order; new spec: at 1280px and 1024px every nav link is within the
  viewport (no clipped item, no horizontal nav scroll); at 390px the menu opens / closes with the
  keyboard (Enter, Escape returns focus) and every destination is reachable; navigation spec opens
  the menu where needed.

### Docs

- `docs/BLUEPRINT.md` §9 (navigation description), `CHANGELOG.md`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- `pnpm test:e2e` (axe light / dark, keyboard, 390px)

### Manual Verification

- Playwright screenshots on the demo data at 1280px, 1024px, 390px (menu closed and open), light
  and dark; not committed.
