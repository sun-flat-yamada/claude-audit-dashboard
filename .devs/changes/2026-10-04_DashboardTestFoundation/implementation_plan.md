# B2-0: Dashboard test foundation, data-source switch, hash routing

Closes #49 (Work-Unit Issue B2-0), refs #37 (tracking). Source: merged plan `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` (section B2-0). The owner accepted decisions D1-D8; this unit applies D4 (in-house hash router, edit BLUEPRINT 9.3) and D5 (default source order unchanged, new `fixtures` source reading the gitignored `data/fixture/`). No feature, no contract change, `data/sample/` unchanged.

## User Review Required

> [!NOTE]
> Plan approved by the owner (D1-D8 accepted). Branch stays on the session-assigned name as instructed by the caller (no rename).

> [!WARNING]
> - `data/fixture/` is a new gitignored directory; `fork:verify` forbids it on `main`.
> - `stage-data.mjs` default behaviour (live else sample) is unchanged. `live` is an explicit opt-in that fails when `data/dashboard.json` is absent.
> - New devDependencies (`@testing-library/*`, `jsdom`) change `pnpm-lock.yaml`; `pnpm audit:deps` must stay clean.

## Proposed Changes

### packages/dashboard

#### [NEW] `vitest.config.ts` (or test block in `vite.config.ts`), `src/test/setup.ts`

- jsdom environment for `*.test.tsx`; the existing node-side `lib` tests keep passing. Setup registers jest-dom matchers, `cleanup`, stubs for `matchMedia` and `localStorage`.

#### [MODIFY] `scripts/stage-data.mjs`

- Export `resolveSource(env, repoRoot, exists)` and `stage(...)` (pure, testable); CLI entry only runs when executed directly.
- `DASHBOARD_DATA_SOURCE`: unset = current behaviour; `sample` = `data/sample/dashboard.json`; `fixtures` = `data/fixture/dashboard.json` (error with hint `pnpm fixture` when absent); `live` = `data/dashboard.json` (error when absent); other values rejected. `STAGED_DATA=1` unchanged.

#### [NEW] `src/lib/router.ts`, `src/lib/detail-data.ts`, `src/components/NavBar.tsx`, `src/routes.tsx`, `src/pages/Overview.tsx`

- Hash router (~60 lines, no dependency): `parseHash`, `formatHash`, `useHashRoute`, `navigate`; works under any `VITE_BASE_PATH` because only `location.hash` is used. Unknown route renders "Page not found" with a link home.
- `NavBar`: `nav` landmark with accessible name, `aria-current="page"`, skip link to `#main`.
- `useDetailFile(path, schema, fetchImpl)`: loading / ready / missing (404) / error states, injectable `fetch`.
- `App.tsx` split: shell (header data load, nav, routes) + `pages/Overview.tsx` with the current content, output unchanged.

#### [NEW] tests: `src/lib/__tests__/router.test.ts`, `detail-data.test.tsx`, `src/__tests__/app.test.tsx`, `scripts/__tests__/stage-data.test.mjs` (run by vitest)

### Other

#### [MODIFY] `packages/collector/src/main/commands.ts`

- `fixture` command: `--out` optional, default `data/fixture`.

#### [MODIFY] `package.json` (root): `fixture` script alias; `.gitignore`: `data/fixture/`; `scripts/fork-verify.ts`: forbid tracked `data/fixture`, assert dashboard tests/E2E do not default to `live`.

#### [MODIFY] docs: `docs/BLUEPRINT.md` 9.3 (hash routing replaces "no router"; data-source switch), `CONTRIBUTING.md` (selector convention: role + accessible name, no `data-testid`; data sources), `docs/SETUP.md` (fixture default output).

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- Targeted: `pnpm --filter @claude-audit/dashboard test`

### Manual Verification

- `pnpm fixture` then `DASHBOARD_DATA_SOURCE=fixtures` staging; `VITE_BASE_PATH=/sub/ pnpm build` and preview with `#/compliance` deep link (not available as a screen yet: unknown-route page proves routing).
