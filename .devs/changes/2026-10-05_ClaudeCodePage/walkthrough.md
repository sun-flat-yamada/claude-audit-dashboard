# Walkthrough: AN-4 Claude Code page

## Summary

Issue #95. The optional `claudeCodeActivity` dataset (`sources.claudeCode.enabled`) is now
aggregated into the optional `DashboardView.claudeCode` (no per-person values: actors are only
counted) and shown on a new `#/claude-code` page. Without the dataset the page explains how to
enable it; when enabled but not collected it names the coverage reason. `schemaVersion` stays 3
and the default `data/sample/` is byte-identical (the default profile has no Claude Code data).

## Changes Made

### Core

- `packages/core/src/contracts/dashboard-view.ts`: optional `claudeCode` (`window`, `currency`,
  `users`, `apiKeys`, `daily`, `totals` with `acceptRate`, `byTerminal`, `byModel`,
  `estimatedCost`, `cacheReadShare`) and the `DashboardClaudeCode` type. Field names follow the
  #94 convention (`addedLines`, `accepted`, ...).
- `packages/core/src/application/presenters/dashboard-claude-code.ts` (new): pure aggregation.
- `packages/core/src/application/presenters/dashboard-view.ts`: attaches it when the dataset
  was collected (`ok`), also with zero rows.
- `packages/core/src/application/__tests__/dashboard-view-claude-code.test.ts` (new): distinct
  actors, accept rate incl. `null`, empty data, omission, older v3 view parses, no e-mail or key
  name in the published view (masking on or off).

### Collector

- `packages/collector/src/adapters/demo/demo-optional.ts`: six synthetic users on different
  terminals with a model mix and days off, two automation keys (optional-sources profile only).
- `packages/collector/src/main/__tests__/optional-profiles.test.ts`: additive test that only the
  optional-sources profile has the aggregate and that no actor appears in it. The existing
  aggregate-only assertions are unchanged.

### Dashboard

- `src/pages/ClaudeCode.tsx`, `src/lib/claude-code-view.ts` (new), `src/routes.tsx`: the page
  (stat tiles, daily users / sessions, daily lines, daily accept rate, sessions by terminal,
  model table, enabling guide).
- `src/components/ProductEngagement.tsx`, `src/pages/Overview.tsx`: link from the Claude Code
  engagement panel to the page when it has data.
- Tests: `src/pages/__tests__/ClaudeCode.test.tsx` (new), `ProductEngagement.test.tsx`.
- E2E: `e2e/sample/claude-code.spec.ts`, `e2e/optional-sources/claude-code.spec.ts` (new;
  populated page, Overview link, axe light / dark, 390 px, unavailable notice);
  `e2e/support/routes.ts` (static route, so the shared screen / axe / mobile specs cover the
  empty state), `e2e/sample/keyboard.spec.ts` (nav order), `e2e/stale/schema-mismatch.spec.ts`
  (the page reads `dashboard.json` only), `scripts/e2e-prepare.mjs` (the optional-unavailable
  profile drops the aggregate like the collector).

### Docs

- `docs/BLUEPRINT.md` (contract, §5.4 note, §9.2 screen, §18.3 scope), `docs/SETUP.md`
  (what the dashboard shows of Claude Code), `CHANGELOG.md`. The per-person policy is unchanged.

## Verification Results

| Stage                | Command                          | Result                                                   |
| :------------------- | :------------------------------- | :------------------------------------------------------- |
| Code-Data Decoupling | `pnpm fork:verify`               | ✅ Clean (exit 0)                                        |
| TypeScript Check     | `pnpm typecheck`                 | ✅ Pass (exit 0)                                         |
| Unit Tests           | `pnpm test`                      | ✅ core 203, collector 262, dashboard 361 passed         |
| Secret Scan          | `pnpm secret-scan`               | ✅ Clean (exit 0)                                        |
| Build                | `pnpm build`                     | ✅ Pass (exit 0)                                         |
| Lint / Format        | `pnpm lint && pnpm format:check` | ✅ Pass (exit 0)                                         |
| E2E and axe          | `pnpm test:e2e`                  | ✅ 389 passed, 17 skipped (by profile)                   |

One earlier full E2E run had a single failure in the unrelated `theme.spec.ts` first-paint check
(timing); it passed on its own and in the following full run.

## Manual Verification

Screenshots taken with Playwright (not committed): the populated page on the optional-sources
profile in light, dark and at 390 px (the model table scrolls inside its own box), and the empty
state on the default sample.
