# B4-1 Optional adapters: Console Admin API and Claude Code Analytics API

Closes #87. Refs #39 (B4), tracking #46. Plan source: `docs/CHANGE-PLAN.md` section 3.3 and section 7 B4, `docs/ARCHITECTURE.md` sections 7-8.3, `docs/PLUGIN-ARCHITECTURE.md`. Pattern precedent: B2-8 (`.devs/changes/2026-10-05_DashboardUsageMatrix/`, opt-in source, `unavailable` / `error` handling). Prerequisites #29 / #37 / #38 stay open only for human real-tenant work; their implementations are merged (B1 #47, B2 #50..#76, B3 #86). No real API is called and no key exists in this environment.

## Scope and PR split

One Work-Unit Issue (#87) and one PR carry both adapters, as separate atomic commits: (1) shared groundwork (config flags, env var, optional-dataset registry, opt-in registration, tests (a)-(d) scaffolding, docs of the mechanism), (2) Console Admin adapter, (3) Claude Code Analytics adapter, (4) profiles / fixtures / regression tests / docs. Splitting into two PRs was considered and rejected: the groundwork has no observable behavior without an adapter, and the second adapter only adds files plus one registration line.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                 | Why                                                                                                                                                                                                  |
| :-- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Five new snapshot datasets: `consoleWorkspaces`, `consoleApiKeys`, `consoleUsage`, `consoleCost` (flag `sources.console.enabled`) and `claudeCodeActivity` (flag `sources.claudeCode.enabled`). Both flags default `false`.                                                                                                                                                                                                              | Issue #39: registered only when enabled, absent from coverage otherwise, so the 13 existing datasets, OP-002 and the score are identical by default.                                                |
| D2  | The datasets are added to `DatasetMap` (registration). `DATASET_NAMES` keeps meaning "the built-in datasets" (13 names); `OPTIONAL_DATASET_NAMES` lists the new ones and `isDatasetName` accepts both. The optional part lives in a new file (`domain/model/optional-datasets.ts`, entities in `optional-entities.ts`).                                                                                                                   | Existing consumers of `DATASET_NAMES` (core fixtures, restore test, config view) keep their behavior; only the type-complete `emptyData` and the interface gain the new keys.                       |
| D3  | New env var `ANTHROPIC_CONSOLE_ADMIN_API_KEY`. It never falls back to `ANTHROPIC_ENTERPRISE_API_KEY` (a Console Admin key and an Enterprise key are different credentials) and is not `ANTHROPIC_ADMIN_API_KEY` (the Enterprise admin override).                                                                                                                                                                                       | Issue #39 key section.                                                                                                                                                                              |
| D4  | Enabled and no key / HTTP 401, 403, 404 => `unavailable` (reason names the variable or the status). Enabled and a response that does not match the tolerant schema => `error` (`SchemaDriftError`). 429 / 5xx are retried by the HTTP client, then `error`. Other datasets keep collecting (orchestrator isolation, unchanged).                                                                                                            | Same classification as the Enterprise adapters (`via` / `classify`).                                                                                                                                 |
| D5  | PII: Claude Code Analytics rows are per user (e-mail) or per API key name. **Aggregate-only publication**: no per-person row is written to `dashboard.json` or to any `detail/*.json`. The raw rows live only in the snapshot files on the orphan branch `data/audit`. The datasets show in Data coverage (record counts, status, reason) and in `#/config` (enabled datasets). A per-person Claude Code view is a follow-up, not B4. | No `DashboardView` v3 and no new detail contract keeps the default sample byte-identical and avoids new publication risk; the issue allows the aggregate-only choice.                              |
| D6  | Demo: the default profile is unchanged (byte-identical `data/sample/`). A new profile `optional-sources` (`pnpm demo -- --profile optional-sources`, default output `data/sample-optional-sources/`, gitignored and regenerated, like `data/fixture/`) enables both datasets with synthetic values (example.com only) and passes the same contract / e-mail checks (`fork:verify` validates it when present).                              | Committing a second sample tree would put a second golden into `main`; determinism and content are tested instead.                                                                                 |
| D7  | Fixture tenant: `pnpm fixture -- --optional-sources` replays the existing B1 tenant plus the new official-shape fixtures with both flags on and a synthetic Console key; the default `pnpm fixture` run and `fixtures/tenant/` are untouched.                                                                                                                                                                                          | Issue #39 test data item 4.                                                                                                                                                                         |

## User Review Required

> [!IMPORTANT]
> D3: operators must create a Console Admin key (`sk-ant-admin...`) in the Claude Console organization linked to the Enterprise tenant and store it as `ANTHROPIC_CONSOLE_ADMIN_API_KEY`. Verification against a real tenant is a human task (see Out of scope).

> [!WARNING]
> `claudeCodeActivity` stores e-mail addresses in snapshots on `data/audit` (never on `main`, never published). Operators who enable it accept the same handling as `members` / `memberActivity`.

## Proposed Changes

### packages/core (pure; registration only)

- `[NEW] domain/model/optional-entities.ts`: `ConsoleWorkspace`, `ConsoleApiKey`, `ConsoleUsageRow`, `ConsoleCostRow`, `ClaudeCodeActivity` (own words, no API field names).
- `[NEW] domain/model/optional-datasets.ts`: `OptionalDatasetMap`, `emptyOptionalData`, `OPTIONAL_DATASET_NAMES`, `OPTIONAL_SOURCES` (dataset -> flag `console` | `claudeCode`), `isOptionalDatasetName`.
- `[MODIFY] domain/model/dataset.ts` (registration): `DatasetMap extends OptionalDatasetMap`, `emptyData` spreads `emptyOptionalData()`, `DATASET_NAMES` stays the built-ins, `isDatasetName` also accepts the optional names. `index.ts` exports.
- `[MODIFY] application/presenters/config-view.ts` + `ConfigViewInput`: optional `enabledOptionalDatasets` appended to the dataset list. Needed because the presenter enumerates `DATASET_NAMES`; recorded below as an extension-point finding.

### packages/collector

- `[NEW] adapters/anthropic/console-admin-api.ts`: gateway for `GET /v1/organizations/workspaces`, `/api_keys` (ID cursor), `/usage_report/messages`, `/cost_report` (page token, daily buckets, `group_by[]`), tolerant `looseObject` schemas, mapping to the domain rows (cents -> major units).
- `[NEW] adapters/anthropic/claude-code-api.ts`: gateway for `GET /v1/organizations/usage_report/claude_code` (one request series per day, `page` / `next_page`), tolerant schema, mapping.
- `[NEW] adapters/anthropic/optional-collectors.ts`: `createOptionalCollectors(api, settings)` builds only the collectors of enabled flags (minus `sources.disabled`); a missing key throws `DataUnavailableError` naming `ANTHROPIC_CONSOLE_ADMIN_API_KEY`; reuses `classify` (exported from `collectors.ts`).
- `[MODIFY] infrastructure/env.ts` (`keys.console`, no fallback), `infrastructure/config.ts` (`sources.console`, `sources.claudeCode`), `main/container.ts` (registration: wire the optional gateway and append the optional collectors), `main/config-view.ts` (pass enabled optional datasets), `adapters/storage/repositories.ts` (sort keys for the new datasets so unchanged data stays byte-identical).
- `[NEW] adapters/demo/demo-optional.ts`, `[MODIFY] main/demo.ts` / `commands.ts`: `--profile optional-sources`; `main/fixture.ts` / `commands.ts`: `--optional-sources`.
- `[NEW] adapters/anthropic/__tests__/fixtures/console/*.json`, `fixtures/claude-code/*.json`: official-reference-shaped captures (paging included) in the replay format.
- Tests: gateways (query shape, paging, mapping, drift), collectors (a)-(d), 401 / 403 / 404 / 429 / 5xx with a fake fetch, env (no fallback), capture header test, demo golden and profile, fixture tenant with optional sources, B3 (synthetic long history with the new datasets, archive -> restore, size).

### packages/dashboard

- No page changes: Data coverage renders `coverage` generically and `#/config` renders `sources.datasets`. Component tests pin both with the new datasets.

### Scripts / config / docs

- `scripts/secret-scan.ts` (assignment pattern for the new variable; required scan directories for the new fixtures), `scripts/fork-verify.ts` (new fixture directories, optional profile check, tracked-path guard), `.gitignore`, `.env.example`, `config/default.json`.
- Docs: `docs/BLUEPRINT.md` (sections 5.1 / 12.2 and the dataset / mapping tables), `docs/API-MAPPING.md` (sections 6 and a new Console section), `docs/SETUP.md` (enable steps), `docs/DASHBOARD-FEATURES.md` (coverage note), `docs/ARCHITECTURE.md` (extension recipe note), `AGENTS.md` rule 2, `CHANGELOG.md`, workflows (`collect-audit.yml` passes the new secret).

## Extension-point findings (existing code touched beyond pure registration)

Recorded here and in the walkthrough; the follow-up Issue #88 asks to fix them at the extension point.

1. `config-view.ts` presenter enumerates `DATASET_NAMES` instead of the registry (needs `enabledOptionalDatasets`).
2. `env.ts` / `container.ts` know every key family by name; a new family needs an edit there (no key-family registry).
3. `SORT_KEYS` in `repositories.ts` is a hand-kept per-dataset table (default `id` sort is wrong for rows without `id`).
4. `synthetic-history.ts` `CHANGE_PERIOD` is `Record<DatasetName, number>` (test support).
5. `classify` (unavailable / error mapping) was private to `collectors.ts` and is now exported; `createContainer` gained a `configPatch` option so profiles can enable the flags without a temporary config directory.

## Verification Plan

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`; `pnpm lint && pnpm format:check && pnpm audit:deps`.
- `pnpm demo` twice: `git diff --exit-code data/sample` clean. `pnpm demo -- --profile optional-sources` then `pnpm fork:verify`.
- Targeted: `pnpm --filter @claude-audit/collector test -- optional`.

## Out of scope

Real-tenant verification of the Console Admin key and responses (human; capture with `--capture-raw`, sanitize into the fixtures), a per-person Claude Code view, `DashboardView` v3, B5 E2E, F-015.
