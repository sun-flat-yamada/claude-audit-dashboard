# Walkthrough: AN-6 Skill, connector, plugin and chat project adoption (#97)

## Summary

A new opt-in source `sources.featureUsage.enabled` (default `false`, `lookbackDays` 30)
collects range roll-ups of the Enterprise Analytics API `skills`, `connectors`, `plugins` and
`apps/chat/projects` endpoints with the existing Analytics key into four optional datasets
(`skillUsage`, `connectorUsage`, `pluginUsage`, `chatProjectUsage`). `DashboardView` gains the
optional `features` aggregate (`schemaVersion` stays `3`) and the new `#/features` page (nav
"Skills & connectors"). With the default configuration nothing is requested or registered:
coverage, OP-002, the score and `data/sample/` are unchanged (`pnpm demo` leaves no diff).

## Changes

| Area        | Files                                                                                                                                                                                                                                                       |
| :---------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core model  | `packages/core/src/domain/model/optional-entities.ts` (`SkillUsage`, `ConnectorUsage`, `PluginUsage`, `ChatProjectUsage`), `optional-datasets.ts` (source `featureUsage`)                                                                                  |
| Contract    | `packages/core/src/contracts/dashboard-view.ts` (`features`, `DashboardFeatures`, `FEATURE_TOP_LIMIT`)                                                                                                                                                      |
| Presenter   | `packages/core/src/application/presenters/dashboard-features.ts` (new), `dashboard-view.ts`                                                                                                                                                                 |
| Adapter     | `packages/collector/src/adapters/anthropic/feature-usage-api.ts` (new), `optional-collectors.ts`, `main/container.ts`, `infrastructure/config.ts`, `adapters/storage/repositories.ts`                                                                       |
| Fixtures    | `adapters/anthropic/__tests__/fixtures/feature-usage/` (official shape, two skill pages, nulls, a project creator that must be dropped), `adapters/fixture/optional-fixture.ts`, `main/fixture.ts`                                                          |
| Demo        | `adapters/demo/demo-feature-usage.ts` (new), `demo-optional.ts`, `src/__tests__/synthetic-history.ts`                                                                                                                                                       |
| Page        | `packages/dashboard/src/pages/Features.tsx`, `src/lib/features-view.ts`, `src/routes.tsx`, `src/components/ShareBars.tsx` (opt-in label wrap)                                                                                                              |
| Tests       | core `dashboard-view-features.test.ts`, `optional-datasets.test.ts`; collector `feature-usage-api.test.ts`, `optional-collectors.test.ts`, `optional-sources.test.ts` (AN-6 (a)-(d)), `optional-profiles.test.ts`, `optional-history.test.ts`, `infrastructure.test.ts`; dashboard `Features.test.tsx` |
| E2E         | `e2e/sample/features.spec.ts`, `e2e/optional-sources/features.spec.ts`, `e2e/optional-sources/coverage.spec.ts`, `e2e/support/routes.ts`, `e2e/sample/keyboard.spec.ts`, `e2e/stale/schema-mismatch.spec.ts`, `scripts/e2e-prepare.mjs`, `scripts/e2e-profiles.mjs` |
| Scripts     | `scripts/fork-verify.ts`, `scripts/secret-scan.ts` (new fixture directory)                                                                                                                                                                                  |
| Docs/config | `docs/API-MAPPING.md` (§6.3), `docs/BLUEPRINT.md`, `docs/SETUP.md`, `config/default.json`, `CHANGELOG.md`, `.agents/rules/storage-and-data-routing.md`                                                                                                     |

## Decisions

- Four datasets instead of one, so a single denied endpoint (e.g. chat projects) is reported on
  its own and the other sections still publish.
- The Analytics key is reused (no new secret); a missing key names `ANTHROPIC_ENTERPRISE_API_KEY`
  / `ANTHROPIC_ANALYTICS_API_KEY` and `read:analytics`, not the Console key.
- No `group_by[]` and no `ending_date` (the API defaults to today); `starting_date` is clamped to
  2026-01-01. `created_by` is not in the schema, so the creator never reaches the snapshot.
- `features` lists the top 20 per kind by distinct users (then usage, then key) plus totals;
  names are published, people are only counted. Project names can be sensitive: the blueprint
  and setup guide say so and how to drop `chatProjectUsage` or the whole source.
- Plugin ids look like `name@marketplace`; the profile tests now treat only dotted domains as
  e-mail addresses, the same definition as `fork:verify`.
- The `optional-unavailable` E2E profile marks the feature datasets unavailable with an HTTP 403
  (`read:analytics`) reason, distinct from the missing Console key.

## Quality gate

| Check                             | Result                                         |
| :-------------------------------- | :--------------------------------------------- |
| `pnpm fork:verify`                | pass                                           |
| `pnpm typecheck`                  | pass                                           |
| `pnpm test`                       | pass (core 311, collector 307, dashboard 375)  |
| `pnpm secret-scan`                | clean                                          |
| `pnpm build`                      | pass                                           |
| `pnpm lint` / `pnpm format:check` | pass                                           |
| `pnpm test:e2e`                   | 439 passed, 21 skipped                         |

## Screenshot check

The populated page (optional-sources) in light, dark and at 390 px and the empty state on the
default sample were captured with Playwright and reviewed. At 390 px long chat project names
were truncated next to their counts; bar labels on this page now wrap (`ShareBars` `wrap`), and
the page has no page-level horizontal scroll. Screenshots are not committed. The primary
navigation already overflowed at 1280 px before this change (tracked in #112); this change only
adds the item.
