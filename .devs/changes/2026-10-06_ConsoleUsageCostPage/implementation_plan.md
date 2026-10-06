# AN-5: Console API usage and cost page

Issue #96 (parent tracking #91, after AN-1 #92 to AN-4 #95). The optional Console Admin API
datasets `consoleWorkspaces`, `consoleApiKeys`, `consoleUsage` and `consoleCost`
(`sources.console.enabled`, B4 #87) are collected but shown nowhere except as Data coverage
rows. This change publishes an aggregate of them and adds a `#/console` page, mirroring the
Claude Console Usage and Cost pages (daily spend, breakdowns by model, workspace and cost type,
token types) and the Grafana cost-by-model and cache-hit panels.

## User Review Required

> [!IMPORTANT]
> The new top-level `DashboardView.console` is **optional**; `schemaVersion` stays `3`, so a v3
> `dashboard.json` written before it still parses. It is present whenever `consoleUsage` or
> `consoleCost` was collected (`status: ok`), even with zero rows, and absent otherwise. The
> workspace and key counts are `null` when their own dataset was not collected. API key names,
> key ids and creator ids never leave the snapshot: keys are only counted by status.
> Workspace names are published (organisation configuration, not personal data), as the
> Console shows them; a `null` workspace id is the "Default workspace".

> [!WARNING]
> The default `pnpm demo` profile has no console datasets, so `data/sample/` stays
> byte-identical (the field is omitted). Only the gitignored optional-sources profile changes:
> its console usage and cost gain a default-workspace share, a third model, `web_search` and
> `code_execution` cost rows and more day-to-day variation. Row counts of other tests that use
> their own stubs are unaffected. No compliance rule changes.

## Proposed Changes

### Core (`@claude-audit/core`)

#### [MODIFY] `packages/core/src/contracts/dashboard-view.ts`

- Optional `console`: `{ window, currency, totalCost, daily[{ date, cost, uncachedInputTokens,
cacheReadInputTokens, cacheCreationInputTokens, outputTokens }], byModel: share[],
byWorkspace: share[], byCostType: share[], tokens{ uncachedInput, cacheRead, cacheWrite,
output }, cacheReadShare, webSearchRequests, workspaces{ active, archived } | null,
apiKeys[{ status, count }] | null }`; exported type `DashboardConsole`.

#### [NEW] `packages/core/src/application/presenters/dashboard-console.ts`

- Pure aggregation. Currency: the most frequent currency of the cost rows (`USD` without rows);
  rows in another currency are left out of the sums. Workspace labels from `consoleWorkspaces`
  (`null` id = `Default workspace`, unknown id = the id). Cache read share = cache read ÷ all
  input (uncached + read + write), `null` at 0 (same definition as `usage.cacheHitRate`, #92).

#### [MODIFY] `packages/core/src/application/presenters/dashboard-view.ts`

- Attach `console` when `consoleUsage` or `consoleCost` was collected.

#### [NEW] `packages/core/src/application/__tests__/dashboard-view-console.test.ts`

- Currency choice, workspace name resolution, cost type shares, token totals and cache share,
  no data / not collected, an older v3 view parses, no key name / id / creator in the output.

### Collector (`@claude-audit/collector`)

#### [MODIFY] `packages/collector/src/adapters/demo/demo-optional.ts`

- More believable console usage and cost (default workspace, three models, three cost types,
  weekday dip).

#### [MODIFY] `packages/collector/src/main/__tests__/optional-profiles.test.ts`

- Additive: the optional-sources view has `console`, the default one does not, no key name.

### Dashboard (`@claude-audit/dashboard`)

#### [NEW] `src/pages/Console.tsx`, `src/lib/console-view.ts`

- Stat tiles (period cost, cache read share, active workspaces, active keys, web search
  requests), daily cost chart, daily tokens by type, ShareBars + table twin for model /
  workspace / cost type, token-type table. Empty state with the enabling steps
  (`sources.console.enabled`, `ANTHROPIC_CONSOLE_ADMIN_API_KEY`); a notice with the coverage
  reason when enabled but unavailable.

#### [MODIFY] `src/routes.tsx` (`/console`, nav label "Console API")

#### [NEW] `src/pages/__tests__/Console.test.tsx`

#### [MODIFY / NEW] E2E: `e2e/support/routes.ts`, `e2e/optional-sources/console.spec.ts`, `e2e/sample/console.spec.ts`, `scripts/e2e-prepare.mjs`, keyboard / stale specs as needed

### Docs

- `docs/BLUEPRINT.md` (contract, screen list, §5.4 note, E2E scope), `docs/SETUP.md`,
  `CHANGELOG.md`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- `pnpm test:e2e`

### Manual Verification

- Playwright screenshots of the populated page (light, dark, 390 px) and the empty state.
