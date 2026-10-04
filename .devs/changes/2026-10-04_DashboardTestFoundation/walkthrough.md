# Walkthrough: B2-0 test foundation, data-source switch, hash routing

## Summary

Adds the foundation every later B2 unit, B5 (#40) and F-015 (#42) build on: Testing Library + Vitest (jsdom) inside `pnpm test`, an explicit `DASHBOARD_DATA_SOURCE=sample|fixtures|live` staging switch (default behaviour unchanged, tests and E2E forbidden from `live`), hash routing with deep links and back/forward, and a documented role + accessible-name selector convention. No feature, no contract change, `data/sample/` unchanged. Closes #49, refs #37.

## Changes Made

### packages/dashboard

- `scripts/stage-data.mjs`: `resolveSource()` / `stage()` exported and unit-tested; `fixtures` reads `data/fixture/`, `live` fails when `data/dashboard.json` is absent, unknown values rejected, `STAGED_DATA=1` unchanged.
- `src/lib/router.ts`, `src/routes.tsx`, `src/components/NavBar.tsx`, `src/App.tsx`, `src/pages/Overview.tsx`: in-house hash router (D4), `nav` landmark "Primary" with `aria-current`, skip link, not-found page; Overview content unchanged.
- `src/lib/detail-data.ts`: `loadDetailFile` / `useDetailFile` (loading / missing / error / ready, injectable `fetch`).
- `vitest.config.ts`, `src/test/setup.ts`, devDependencies (`@testing-library/react`, `user-event`, `jest-dom`, `jsdom`).
- Tests: `router.test.ts`, `detail-data.test.tsx`, `app.test.tsx` (Overview from sample and from the `pnpm fixture` output, deep link, back/forward, skip link, load error), `scripts/__tests__/stage-data.test.mjs`.

### Repository

- `packages/collector/src/main/commands.ts`: `fixture --out` optional, default `data/fixture`; root `package.json`: `pnpm fixture` alias, `pnpm test` builds the collector and runs `pnpm fixture` first so the fixture-tenant regression test is never skipped in the gate.
- `.gitignore`: `data/fixture/`; `scripts/fork-verify.ts`: `data/fixture` forbidden on `main`, new check that dashboard tests / E2E never read live data.
- Docs: `docs/BLUEPRINT.md` 9.3 (hash routing, selector convention, data sources), `CONTRIBUTING.md` (dashboard test conventions), `docs/SETUP.md`.

## Verification Results

| Stage                    | Command                                                         | Result                           |
| :----------------------- | :-------------------------------------------------------------- | :------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`                                              | Clean (exit 0)                   |
| TypeScript Check         | `pnpm typecheck`                                                | Pass (exit 0)                    |
| Unit & Integration Tests | `pnpm test`                                                     | core 55, collector 98, dashboard 42 pass |
| Zero Secret / PII Scan   | `pnpm secret-scan`                                              | 0 leaks (exit 0)                 |
| Production Build         | `pnpm build`                                                    | Built                            |
| Lint / Format / Audit    | `pnpm lint && pnpm format:check && pnpm audit:deps`             | Clean                            |
