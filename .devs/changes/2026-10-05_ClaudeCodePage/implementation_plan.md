# AN-4: Claude Code page

Issue #95 (parent tracking #91, after AN-1 #92, AN-2 #93 and AN-3 #94). The optional dataset
`claudeCodeActivity` (Claude Code Analytics API, `sources.claudeCode.enabled`, B4 #87) is collected
but shown nowhere except as a Data coverage row. This change publishes an aggregate of it (no
per-person values) and adds a `#/claude-code` page, mirroring the official Console Claude Code
dashboard (lines accepted, suggestion accept rate, daily users and sessions, spend) and the
Grafana Claude Code OTel dashboards (cost by model, sessions by terminal, cache hit ratio).

## User Review Required

> [!IMPORTANT]
> The new top-level `DashboardView.claudeCode` is **optional**; `schemaVersion` stays `3`, so a v3
> `dashboard.json` written before it still parses. It is present only when `claudeCodeActivity`
> was collected (`status: ok`), even with zero rows (the page then says no activity was reported).
> It holds daily totals, window totals, sessions by terminal and tokens / estimated cost by model.
> Actor e-mail addresses and API key names never leave the snapshot: only distinct counts of
> actors are published. Field names follow the #94 convention (`addedLines`, `removedLines`,
> `accepted`, `rejected`) so the existing aggregate-only test in `optional-profiles.test.ts`
> (which rejects `linesAdded` / `toolAccepted` in published files) keeps working unchanged.

> [!WARNING]
> The default `pnpm demo` profile has no `claudeCodeActivity`, so `data/sample/` stays
> byte-identical (the field is omitted). Only the gitignored optional-sources profile changes.
> The demo generator gains more variation (terminals, models, a second API key actor, an
> inactive day per person). The fixture tenant's Claude Code rows are unchanged. No compliance
> rule changes. The BLUEPRINT per-person policy text is kept; one sentence notes the aggregate.

## Proposed Changes

### Core (`@claude-audit/core`)

#### [MODIFY] `packages/core/src/contracts/dashboard-view.ts`

- Optional `claudeCode`: `{ window, currency, users, apiKeys, daily[{ date, actors, sessions,
addedLines, removedLines, commits, pullRequests, accepted, rejected }], totals{ sessions,
addedLines, removedLines, commits, pullRequests, accepted, rejected, acceptRate },
byTerminal[{ terminal, sessions, percent }], byModel[{ model, inputTokens, outputTokens,
cacheReadTokens, cacheCreationTokens, estimatedCost }], estimatedCost, cacheReadShare }`;
  exported type `DashboardClaudeCode`.

#### [NEW] `packages/core/src/application/presenters/dashboard-claude-code.ts`

- Pure aggregation: distinct actors per day, `users` / `apiKeys` as distinct actors per kind over
  the window, accept rate accepted / (accepted + rejected) (`null` at 0), terminal share,
  per-model sums (cost `null` when no row had an estimate), cache read share
  cacheRead / (input + cacheRead + cacheCreation) (`null` without input).

#### [MODIFY] `packages/core/src/application/presenters/dashboard-view.ts`

- Attach `claudeCode` when the dataset was collected.

#### [NEW] `packages/core/src/application/__tests__/dashboard-view-claude-code.test.ts`

- Distinct actors, accept rate incl. `null`, empty rows, omission when not collected, an older v3
  view parses, and no e-mail / key name in the serialized view.

### Collector (`@claude-audit/collector`)

#### [MODIFY] `packages/collector/src/adapters/demo/demo-optional.ts`

- More believable variation for the optional-sources profile.

#### [MODIFY] `packages/collector/src/main/__tests__/optional-profiles.test.ts`

- Additive assertions: the optional-sources view has `claudeCode`, the default one does not, no
  actor appears in it (existing assertions untouched).

### Dashboard (`@claude-audit/dashboard`)

#### [NEW] `src/pages/ClaudeCode.tsx`, `src/lib/claude-code-view.ts`

- Stat tiles (active users, sessions, lines added / removed, commits, PRs, accept rate,
  estimated cost), daily users and sessions (`TimeSeriesChart`), daily lines, sessions by
  terminal (`ShareBars`), tokens and cost by model (table), cache read share. Empty state with the
  enabling steps (`sources.claudeCode.enabled`, `ANTHROPIC_CONSOLE_ADMIN_API_KEY`); a notice with
  the coverage reason when enabled but unavailable.

#### [MODIFY] `src/routes.tsx`, `src/components/ProductEngagement.tsx` (link only if trivial)

#### [NEW] `src/pages/__tests__/ClaudeCode.test.tsx`

#### [MODIFY / NEW] E2E: `e2e/support/routes.ts` (static route), `e2e/optional-sources/claude-code.spec.ts`, `e2e/sample` empty state

### Docs

- `docs/BLUEPRINT.md` (contract, screen list, §5.4 note), `CHANGELOG.md`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- `pnpm test:e2e`

### Manual Verification

- Playwright screenshots of the populated page (light, dark, 390 px) and the empty state.
