# Walkthrough: AN-5 Console API usage and cost page (#96)

## Summary

The optional Console Admin API datasets (`consoleUsage`, `consoleCost`, `consoleWorkspaces`,
`consoleApiKeys`) now feed an optional `DashboardView.console` aggregate and a new `#/console`
page. `schemaVersion` stays `3`; a v3 `dashboard.json` without the field still parses. The
default `data/sample/` is byte-identical (`pnpm demo` leaves no diff).

## Changes

| Area      | Files                                                                                                                                                                     |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract  | `packages/core/src/contracts/dashboard-view.ts` (`console`, `DashboardConsole`)                                                                                           |
| Presenter | `packages/core/src/application/presenters/dashboard-console.ts` (new), `dashboard-view.ts` (attach when usage or cost was collected)                                     |
| Tests     | `packages/core/src/application/__tests__/dashboard-view-console.test.ts`: currency choice, workspace name resolution, shares, tokens, no data, omission, no key name / id |
| Demo      | `packages/collector/src/adapters/demo/demo-optional.ts`: default workspace, three models priced from tokens, web search and code execution costs, weekend dip            |
| Profiles  | `packages/collector/src/main/__tests__/optional-profiles.test.ts`: `console` only in optional-sources, no key name / id / creator                                         |
| Page      | `packages/dashboard/src/pages/Console.tsx`, `src/lib/console-view.ts`, `src/routes.tsx` (`/console`, nav "Console API"), `src/lib/view.ts` (export `TOKEN_TYPES`)       |
| Tests     | `packages/dashboard/src/pages/__tests__/Console.test.tsx`                                                                                                                 |
| E2E       | `e2e/sample/console.spec.ts`, `e2e/optional-sources/console.spec.ts`, `e2e/support/routes.ts`, `e2e/sample/keyboard.spec.ts`, `e2e/stale/schema-mismatch.spec.ts`, `scripts/e2e-prepare.mjs` |
| Docs      | `docs/BLUEPRINT.md` (§5.4, contract, screen list, E2E scope), `docs/SETUP.md`, `CHANGELOG.md`                                                                            |

## Decisions

- The aggregate is attached when `consoleUsage` or `consoleCost` is `ok`; `workspaces` and
  `apiKeys` are `null` when their own dataset was not collected (the tiles show `—`).
- Amounts use the most frequent currency of the cost rows; rows in another currency are left
  out so sums never mix currencies.
- Cache read share = cache read ÷ (uncached + cache read + cache write), the same definition as
  `usage.cacheHitRate` (#92).
- The page notice groups the not-collected datasets by reason, so a missing key is named once.

## Quality gate

| Check                                   | Result                       |
| :-------------------------------------- | :--------------------------- |
| `pnpm fork:verify`                      | pass                         |
| `pnpm typecheck`                        | pass                         |
| `pnpm test`                             | pass (core 212, collector 263, dashboard 367) |
| `pnpm secret-scan`                      | clean                        |
| `pnpm build`                            | pass                         |
| `pnpm lint` / `pnpm format:check`       | pass                         |
| `pnpm test:e2e`                         | 414 passed, 19 skipped       |

## Screenshot check

Populated page (optional-sources) in light, dark and at 390 px, and the empty state on the
default sample were captured with Playwright and reviewed: no clipped labels, no page-level
horizontal scroll, the token table fits at 390 px. Screenshots are not committed. The primary
navigation already scrolled horizontally at 1280 px before this change; the extra item adds
one more entry to that scroll.
