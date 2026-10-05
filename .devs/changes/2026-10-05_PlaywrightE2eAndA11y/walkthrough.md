# Walkthrough: B5-1 Playwright E2E and axe a11y suite

Closes #90, refs #40.

## Summary

`packages/dashboard` has a Playwright suite (`pnpm test:e2e`, not part of `pnpm test`) that builds the SPA once with the Pages base path, serves eight synthetic data profiles with `vite preview` and runs 376 tests: journeys for every screen of Phase A to B4, axe (`wcag2a`, `wcag2aa`) on every route in light and dark, keyboard-only checks and a guard against live data. The axe scans found real violations in the dashboard; they are fixed, nothing is suppressed.

## Changes Made

### Suite

- `playwright.config.ts`, `scripts/e2e-profiles.mjs`, `e2e-prepare.mjs`, `e2e-serve.mjs`: profiles `sample`, `fixtures`, `optional-sources`, `optional-unavailable`, `unavailable`, `empty`, `stale-detail`, `stale-dashboard`; derived ones are validated against the published contracts; `retries: 0`, `reducedMotion`, `en-US`, `UTC`; `vite preview` runs with `appType: 'mpa'` so a missing file answers 404 like GitHub Pages.
- `e2e/shared` (routes, axe, 390px, determinism), `e2e/sample` (Phase A, F-003 downloads, F-005 to F-014, B3 archive, keyboard, theme incl. denied `localStorage`, axe on interactive states), `e2e/fixtures` (B1), `e2e/optional-sources` (B4), `e2e/unavailable`, `e2e/empty`, `e2e/stale`.
- Guard: `DASHBOARD_DATA_SOURCE` other than `sample` / `fixtures` fails the runner; a profile source whose `source` is not `demo` is refused; `fork:verify` already rejects specs that name live data (it caught one of mine) and now also rejects a tracked `packages/dashboard/.e2e`.
- `package.json` scripts (`test:e2e` in the dashboard and at the root), `tsconfig.e2e.json` (part of `typecheck`), ESLint ignores / globals for the suite, `.gitignore`, `.prettierignore`, CI job `E2E and accessibility`.

### Dashboard fixes (found by the suite)

- Muted text failed WCAG 1.4.3 (3.5:1 light, 3.7:1 on dark warning rows): `--text-muted` is `#6b6a65` (light) and `#a8a69e` (dark).
- Tables scrolling inside their box were not keyboard reachable (`scrollable-region-focusable`): new `ScrollRegion` makes an overflowing box a named, focusable region (no tab stop when nothing overflows).
- Organization and group pages had no level-1 heading while loading or failing.
- An outdated detail file printed the validator's JSON; it now names the file, its `schemaVersion` and `pnpm build:detail` / `pnpm demo`.
- `prefers-reduced-motion` disables CSS transitions and animations.

## Verification Results

| Stage | Command | Result |
| :-- | :-- | :-- |
| Fork safety | `pnpm fork:verify` | Clean (exit 0) |
| Types | `pnpm typecheck` (incl. e2e) | Pass |
| Unit tests | `pnpm test` | core 179, collector 221, dashboard 342 pass |
| Secrets | `pnpm secret-scan` | Clean |
| Build, lint, format, audit | `pnpm build`, `pnpm lint`, `pnpm format:check`, `pnpm audit:deps` | Pass |
| E2E | `pnpm test:e2e` | 345 passed, 15 skipped by design, 1 failed on the first run (a race in my keyboard test, fixed) |
| Stability | `pnpm test:e2e --repeat-each=5` (retries 0) | 1805 passed, 75 skipped by design, 0 failed, 0 flaky (20 min on 2 workers) |

## Known limits

- The CI job has not run on GitHub yet. Branch protection registration is a repository admin step (`CONTRIBUTING.md`).
- The `optional-unavailable` profile derives the missing-key coverage from the optional-sources profile (the collector writes the same status and reason; OP-002 in that profile is not recomputed).
- B3 parity with `pnpm size` is checked as consistency of the inventory (per-year sums equal the totals shown); `pnpm size` itself needs a git history and is covered by the collector tests.
- Prerequisites #29 / #37 / #38 / #39 stay open (real-tenant work); #83 / #84 / #85 gaps are exercised through derived profiles.
