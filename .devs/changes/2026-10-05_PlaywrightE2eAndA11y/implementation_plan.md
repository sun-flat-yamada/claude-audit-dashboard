# B5-1: Playwright E2E and axe a11y suite for the dashboard

Closes #90 (Work-Unit Issue B5-1), refs #40 (tracking, B5). Prerequisites #29 / #37 / #38 / #39 stay open (human real-tenant work); the owner decided to proceed. Merged inputs: B1 #47, B2 (#50 to #76), B3 #86, B4 #89. Single PR (infra, journeys, a11y fixes).

## User Review Required

> [!IMPORTANT]
> - `@playwright/test` and `@axe-core/playwright` are new devDependencies of `packages/dashboard` (lockfile change; `pnpm audit:deps` must stay clean).
> - The suite is not part of `pnpm test`. Root `pnpm test:e2e` prepares the data profiles (`pnpm build:collector`, `pnpm fixture`, `pnpm demo --profile optional-sources`) and runs the suite. It is meant to become a required CI check (branch protection is a human step, see CONTRIBUTING.md).

> [!WARNING]
> - The cloud session has Chromium preinstalled (`/opt/pw-browsers`); `playwright install` is never run there. The config uses `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` or the preinstalled build only when the Playwright-pinned build is absent. CI installs with `playwright install --with-deps chromium`.
> - axe findings are fixed in the dashboard. No rule is disabled without a written justification in the PR.
> - `retries: 0`; stability is shown with `--repeat-each=5`.

## Proposed Changes

### packages/dashboard (E2E infrastructure)

#### [NEW] `playwright.config.ts`, `e2e/support/*`

- One `vite build` with `VITE_BASE_PATH=/claude-audit-dashboard/`; per data profile a copy of `dist` with `data/` replaced, served by its own `vite preview` (same base path as Pages). Profiles: `sample`, `fixtures`, `optional-sources`, plus derived `unavailable` (no detail files) and `schema-mismatch`.
- Guard: fails when `DASHBOARD_DATA_SOURCE=live` or when a staged `dashboard.json` has `source` other than the demo / fixture tenants. The staging never leaves the source unset.
- Determinism: `reducedMotion: 'reduce'`, locale `en-US`, timezone `UTC`, offline context (external requests are aborted and fail the test), `retries: 0`.

#### [NEW] `e2e/*.spec.ts`

- Phase A screens, B1 fixture tenant on every route, B2 (F-003 downloads via `waitForEvent('download')`, F-005 .. F-014), B3 archive count / size, B4 Data coverage, empty / unavailable displays, keyboard-only journeys, axe (`wcag2a`, `wcag2aa`) on every route x light / dark.

#### [MODIFY] `src/**` (only where a real defect is found)

- Disable chart animation, honour `prefers-reduced-motion`, fix axe critical / serious findings (contrast, names, landmarks).

### Other

- `package.json` (dashboard and root): `test:e2e`; `.gitignore` / `scripts/fork-verify.ts`: generated E2E output dirs; `.github/workflows/ci.yml`: E2E job with browser cache keyed on the Playwright version and artifacts on failure; `CONTRIBUTING.md`, `docs/CONTRIBUTING.md`, `docs/BLUEPRINT.md` §18.2-18.3, `docs/DASHBOARD-FEATURES.md` Testing row, `CHANGELOG.md`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- `pnpm test:e2e` and `pnpm test:e2e -- --repeat-each=5`

### Manual Verification

- Inspect a failing-trace artifact path locally (`test-results/`) and the HTML report.
