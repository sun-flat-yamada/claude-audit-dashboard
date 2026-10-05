# AN-3: Product engagement

Issue #94 (parent tracking #91, after AN-2 #93). The Enterprise Analytics users endpoint
(`GET /v1/organizations/analytics/users`) is already called in range roll-up mode
(`starting_date` = today - `sources.memberActivity.lookbackDays`, default 90). Each row carries
`chat_metrics`, `claude_code_metrics` (`core_metrics`, `tool_actions`), `cowork_metrics`,
`design_metrics`, `office_metrics` (excel / outlook / powerpoint / word), `science_metrics` and
`web_search_count`, but the collector maps only `last_activity_date`. This change maps the metric
blocks from the same call (no extra request), aggregates them without per-person data and shows
them on the Overview, mirroring the official Claude Code analytics ("lines of code accepted",
"suggestion accept rate" over Edit / MultiEdit / Write / NotebookEdit) and the claude.ai usage
analytics (conversations, projects, artifacts, Cowork sessions).

## User Review Required

> [!IMPORTANT]
> All new fields are **optional**: `MemberActivity.engagement` (stored snapshots on `data/audit`
> still load) and `DashboardView.engagement` (an older `dashboard.json` still parses).
> `schemaVersion` stays `2`. The aggregate holds no per-person data: per product the number of
> members with any activity and summed counters, and for Claude Code the lines, commits, pull
> requests, sessions and per-tool accepted / rejected counts with the accept rate
> (accepted / (accepted + rejected), `null` when 0). The detail files and the per-person
> publishing policy do not change.

> [!WARNING]
> Every metric block is parsed leniently: a missing block or a `null` counter is "absent", never
> a collection failure. `lastActiveOn` / `active` (input of AC-001) are computed exactly as
> before; the existing AC-001 and adapter tests stay unchanged. Distinct counts are approximate
> (HLL) in range mode and are summed across members, so the UI labels them as sums. No compliance
> rule changes.

## Proposed Changes

### Core (`@claude-audit/core`)

#### [MODIFY] `packages/core/src/domain/model/entities.ts`

- `MemberEngagement` (domain words): `chat`, `claudeCode` (sessions, commits, pull requests,
  lines added / removed, artifacts, per-tool `{ accepted, rejected }` for edit / multiEdit /
  notebookEdit / write), `cowork`, `design`, `office` (summed across the Office apps), `science`,
  `webSearches`; `MemberActivity.engagement?`.

#### [MODIFY] `packages/core/src/contracts/dashboard-view.ts`

- Optional top-level `engagement`: `{ window, members, products[{ product, label, activeMembers,
messages, sessions, counters[{ key, label, value }] }], claudeCode{ linesAdded, linesRemoved,
commits, pullRequests, sessions, accepted, rejected, acceptRate, tools[...] } | null,
webSearches }`.

#### [NEW] `packages/core/src/application/presenters/dashboard-engagement.ts`

- Pure aggregation (small helpers within the ESLint limits); absent when no member row carries
  engagement or `memberActivity` was not collected.

#### [MODIFY] `packages/core/src/application/presenters/dashboard-view.ts`

- Attach `engagement` when available.

#### [NEW] `packages/core/src/application/__tests__/dashboard-view-engagement.test.ts`

- Sums, active-member counts, accept rate (incl. `null` at 0), omission, old-format view parses.

### Collector (`@claude-audit/collector`)

#### [NEW] `packages/collector/src/adapters/anthropic/user-engagement.ts`

- Lenient zod shapes for the metric blocks (`looseObject`, `nullish` everywhere) and a pure mapper
  to `MemberEngagement` (absent block -> absent product).

#### [MODIFY] `packages/collector/src/adapters/anthropic/analytics-api.ts`

- `userActivitySchema` gains the blocks; `listUserActivity` adds `engagement` when any block is
  present. `active` / `lastActiveOn` unchanged.

#### [MODIFY] tests in `packages/collector/src/adapters/anthropic/__tests__/`

- Official example row (all blocks), blocks missing, `null` distinct counts, malformed block.

#### [MODIFY] `packages/collector/src/adapters/demo/demo-source.ts`

- Realistic synthetic engagement per demo member; `pnpm demo` regenerates `data/sample/`.

### Dashboard (`@claude-audit/dashboard`)

#### [NEW] `packages/dashboard/src/components/ProductEngagement.tsx`, `src/lib/engagement-view.ts`

- "Product engagement (N days)" card: table-first (product, active members, messages, sessions,
  highlights), Claude Code facts and per-tool accept-rate bars (`--series-1` only) with a
  "View as table" twin. Nothing rendered for older views.

#### [MODIFY] `packages/dashboard/src/pages/Overview.tsx`

- Place the section after Active users.

#### [NEW] component / lib tests, [MODIFY] `e2e/sample/overview.spec.ts`

### Data and docs

- `pnpm demo` regenerates `data/sample/` (golden test).
- `docs/API-MAPPING.md` §4, `docs/BLUEPRINT.md` (contract + Overview description), `CHANGELOG.md`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- `pnpm test:e2e` (Playwright E2E and axe in light and dark)

### Manual Verification

- Build the dashboard on the demo sample and capture the new section with Playwright (light,
  dark, 390 px).
