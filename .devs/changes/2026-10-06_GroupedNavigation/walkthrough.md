# Walkthrough: AN-7 Grouped navigation without hidden overflow

## Summary

The primary navigation held 14 links in one row and scrolled sideways even at 1280px, hiding
Alerts and Organizations. It is now grouped (ungrouped Overview and Compliance, then Usage,
Directory and Operations). From 1024px it is a sticky side column in which every link is visible;
below 1024px a `Menu` disclosure button (`aria-expanded` / `aria-controls`) shows the same grouped
links, Escape closes it and returns focus to the button, and choosing a link closes it. Links stay
`<a href="#/...">`, so deep links, the `aria-current` highlight (incl. `navPath` sub-routes) and
the Tab order (now in group order) keep working. No new colors.

## Changes Made

### Dashboard

- `packages/dashboard/src/routes.tsx`: `NAV_GROUPS` (display order) and an optional `group` per
  route; `ROUTES` reordered into navigation order. Adding a page is still one `ROUTES` entry.
- `packages/dashboard/src/components/NavBar.tsx`: pure `groupNavItems()`, grouped lists named by
  a visible label (`aria-labelledby`, not headings), side column from `lg`, `Menu` disclosure
  button below `lg`, Escape handling; the theme toggle stays after the links in DOM order.
- `packages/dashboard/src/App.tsx`: side-by-side shell from `lg`.
- `packages/dashboard/src/components/__tests__/NavBar.test.tsx`: grouping and menu behavior.

### E2E

- `e2e/support/routes.ts`, `e2e/sample/keyboard.spec.ts`: route list and Tab order in group order.
- `e2e/sample/nav-layout.spec.ts` (new): at 1280x900 and 1024x768 every nav link lies inside the
  viewport with no scrolling list and the groups are named; at 390px the menu opens with Enter,
  Tab enters the links, Escape closes and refocuses the button, every destination opens from the
  menu, and axe finds no serious / critical issue with the menu open in light and dark.

### Docs

- `docs/BLUEPRINT.md` §9 navigation description, `CHANGELOG.md`.

## Verification Results

| Stage                | Command              | Result                                         |
| :------------------- | :------------------- | :--------------------------------------------- |
| Code-Data Decoupling | `pnpm fork:verify`   | Clean (exit 0)                                 |
| TypeScript Check     | `pnpm typecheck`     | Pass (exit 0)                                  |
| Unit Tests           | `pnpm test`          | Pass: core 311, collector 307, dashboard 379   |
| Secret Scan          | `pnpm secret-scan`   | Clean (exit 0)                                 |
| Build                | `pnpm build`         | Pass (exit 0)                                  |
| Lint / Format        | `pnpm lint`, `pnpm format:check` | Pass (exit 0)                      |
| E2E and axe          | `pnpm test:e2e`      | 445 passed, 21 skipped (profile-specific)      |

## Manual Verification

Playwright screenshots on the demo data (not committed): 1280px light (Overview) and dark
(Members), 1024x768 (Claude Code), 390px with the menu closed, open and open in dark. All 14 links
are visible at 1280px and 1024px, no page scrolls horizontally, and the open menu at 390px lists
every destination in its groups.
