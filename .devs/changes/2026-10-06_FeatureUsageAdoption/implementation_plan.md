# AN-6: Opt-in skill, connector, plugin and chat project adoption

Issue #97 (parent tracking #91, after AN-1 #92 to AN-5 #96). The Claude Enterprise Analytics
API reports per-entity adoption of skills, connectors, plugins and claude.ai chat projects
(`GET /v1/organizations/analytics/skills`, `/connectors`, `/plugins`, `/apps/chat/projects`,
`read:analytics`). This change collects them **opt-in** (`sources.featureUsage.enabled`, default
`false`) as range roll-ups, publishes an aggregate in `dashboard.json` and adds a `#/features`
page. Connectors also matter for governance: they show which external systems Claude reads from
and writes to.

## User Review Required

> [!IMPORTANT]
> Four new **optional** datasets of a new source flag `featureUsage` (same mechanism as the B4
> sources `console` / `claudeCode`): `skillUsage`, `connectorUsage`, `pluginUsage`,
> `chatProjectUsage`. They use the existing Analytics key (`ANTHROPIC_ENTERPRISE_API_KEY` or
> `ANTHROPIC_ANALYTICS_API_KEY`, `read:analytics`); no new secret. With the default config
> nothing is registered, so coverage, OP-002, the score and `data/sample/` are unchanged.
> When enabled, a missing key or HTTP 401 / 403 / 404 makes only that dataset `unavailable`
> (OP-002 reports it), schema drift makes it `error`; every other dataset keeps collecting.

> [!IMPORTANT]
> The new top-level `DashboardView.features` is **optional**; `schemaVersion` stays `3`, so a
> v3 `dashboard.json` written before it still parses. It is present whenever any of the four
> datasets was collected (`status: ok`), and each section (`skills`, `connectors`, `plugins`,
> `projects`) is `null` when its own dataset was not collected. Names of skills, connectors,
> plugins and chat projects are organization configuration and are published (top 20 per kind
> by distinct users, plus totals). User ids, e-mail addresses and project creators are never
> stored or published: the adapter drops `created_by` while parsing. Project names can be
> descriptive; the blueprint and setup guide say so and how to turn the source off.

> [!WARNING]
> The `optional-sources` demo / fixture profiles (gitignored) gain the four datasets, so their
> dataset count goes from 18 to 22 and tests that count optional datasets are updated. Tests that
> iterate the B4 datasets by position are scoped to the B4 sources. The default profile and
> `data/sample/` stay byte-identical. No compliance rule changes (OP-002 already covers any
> registered dataset).

## Proposed Changes

### Core (`@claude-audit/core`)

#### [MODIFY] `packages/core/src/domain/model/optional-entities.ts`

- `SkillUsage`, `ConnectorUsage`, `PluginUsage`, `ChatProjectUsage` (our own field names; per
  product session / conversation counts nullable; no user fields).

#### [MODIFY] `packages/core/src/domain/model/optional-datasets.ts`

- Register the four datasets under source `featureUsage`.

#### [MODIFY] `packages/core/src/contracts/dashboard-view.ts`

- Optional `features`: `{ window, skills, connectors, plugins, projects }`, each section
  `{ total, items[] } | null`; connectors carry `calls { read, write, unclassified } | null`.
  Exported type `DashboardFeatures`.

#### [NEW] `packages/core/src/application/presenters/dashboard-features.ts`

- Pure aggregation: rank by distinct users (then usage, then name), keep the top 20, totals of
  the read / write / unclassified connector calls (null when the API gave no split).

#### [MODIFY] `packages/core/src/application/presenters/dashboard-view.ts`

- Attach `features` when any of the four datasets was collected.

#### [NEW] tests: `domain/__tests__/optional-datasets.test.ts` (extended),
`application/__tests__/dashboard-view-features.test.ts`

### Collector (`@claude-audit/collector`)

#### [NEW] `packages/collector/src/adapters/anthropic/feature-usage-api.ts`

- Range roll-up per endpoint: `starting_date` = today − `lookbackDays` (clamped to
  2026-01-01), `limit=1000`, `page` / `next_page` paging, lenient `looseObject` parsing with
  nullish optionals; `created_by` is never read.

#### [MODIFY] `adapters/anthropic/optional-collectors.ts`, `infrastructure/config.ts`, `main/container.ts`

- `sources.featureUsage { enabled: false, lookbackDays: 30 (1..366) }`; collectors use the
  Analytics gateway; missing key → `unavailable` naming the variables.

#### [MODIFY] `adapters/storage/repositories.ts` (stable sort keys), `adapters/demo/demo-optional.ts`
(synthetic skills, connectors, plugins, projects), `adapters/fixture/optional-fixture.ts` +
fixtures `__tests__/fixtures/feature-usage/` (official shape, two pages, nulls), `main/fixture.ts`,
`src/__tests__/synthetic-history.ts`

#### [NEW / MODIFY] tests

- `adapters/anthropic/__tests__/feature-usage-api.test.ts`: fake fetch, paging, nulls,
  `created_by` dropped, 403 → unavailable, drift → error.
- `main/__tests__/optional-sources.test.ts`: (a) default unchanged incl. no analytics feature
  request; (b) enabled + ok; (c) enabled + 401/403/404 → unavailable, the rest continues;
  (d) schema drift → error.
- `main/__tests__/optional-profiles.test.ts` and other profile counts.

### Dashboard (`@claude-audit/dashboard`)

#### [NEW] `src/pages/Features.tsx`, `src/lib/features-view.ts`

- Stat tiles (skills, connectors, plugins, chat projects in use; connector write share),
  ranked bars by distinct users with "View as table" twins, connector read / write /
  unclassified stacked bars, empty state explaining `sources.featureUsage.enabled`, coverage
  notice when enabled but not collected.

#### [MODIFY] `src/routes.tsx` (`/features`, nav label "Skills & connectors"; nav overflow is #112)

#### [NEW] `src/pages/__tests__/Features.test.tsx`

#### [MODIFY / NEW] E2E: `e2e/support/routes.ts`, `e2e/sample/features.spec.ts`,
`e2e/optional-sources/features.spec.ts`, `e2e/sample/keyboard.spec.ts`,
`e2e/stale/schema-mismatch.spec.ts`, `scripts/e2e-prepare.mjs`, `scripts/e2e-profiles.mjs`

### Docs and scripts

- `docs/API-MAPPING.md` (new section), `docs/BLUEPRINT.md` (datasets, config, contract,
  screens, §5.4), `docs/SETUP.md`, `config/default.json`, `CHANGELOG.md`,
  `.agents/rules/storage-and-data-routing.md`, `scripts/fork-verify.ts` and
  `scripts/secret-scan.ts` (new fixture directory).

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- `pnpm test:e2e`

### Manual Verification

- Playwright screenshots of the populated page (light, dark, 390 px) and the empty state.
