# Walkthrough: B4-1 Optional Console Admin API and Claude Code Analytics adapters

Closes #87. Refs #39 (B4), tracking #46. Follow-up for the extension-point findings: #88.

## Summary

Two optional adapters were added without touching the rule engine, the orchestrator or any existing domain entity: the linked Console organization Admin API (workspaces, API key inventory, Usage and Cost reports) and the Claude Code Analytics API. Their five datasets (`consoleWorkspaces`, `consoleApiKeys`, `consoleUsage`, `consoleCost`, `claudeCodeActivity`) are registered only when `sources.console.enabled` / `sources.claudeCode.enabled` is true (both default `false`), exactly like `sources.disabled`. With the default configuration the 13 datasets, their coverage, OP-002 and the score are identical (golden: the committed `data/sample/` is byte-identical).

The key is the new `ANTHROPIC_CONSOLE_ADMIN_API_KEY` (no fallback to the Enterprise key; not `ANTHROPIC_ADMIN_API_KEY`). Enabled without a key or on 401 / 403 / 404 the datasets are `unavailable` (reason names the variable), schema drift is `error`, and the other datasets keep collecting.

Decisions (plan D1-D7): five opt-in datasets; `DATASET_NAMES` stays the 13 built-ins and `OPTIONAL_DATASET_NAMES` lists the new ones; aggregate-only publication (no per-person Claude Code row in `dashboard.json` or any detail file; the datasets show as Data coverage rows and in `#/config`); a gitignored `optional-sources` demo profile and `pnpm fixture --optional-sources`. One PR carries both adapters (separate atomic commits).

## Changes Made

### packages/core

- `domain/model/optional-entities.ts`, `optional-datasets.ts` (new): entities, `OptionalDatasetMap`, `OPTIONAL_SOURCES` (dataset to config flag), helpers.
- `domain/model/dataset.ts`: registration (`DatasetMap extends OptionalDatasetMap`, `emptyData`, `ALL_DATASET_NAMES`, `isDatasetName` accepts both).
- `application/presenters/config-view.ts`: optional `enabledOptionalDatasets` (extension-point finding 1).

### packages/collector

- `adapters/anthropic/console-admin-api.ts`, `claude-code-api.ts`, `optional-collectors.ts` (new): gateways, tolerant schemas, mapping, opt-in collectors.
- `infrastructure/env.ts`, `config.ts`, `main/container.ts`, `main/config-view.ts`, `adapters/storage/repositories.ts`: key, flags, registration, storage sort keys.
- `adapters/demo/demo-optional.ts`, `adapters/fixture/optional-fixture.ts`, `main/demo.ts`, `main/fixture.ts`, `main/commands.ts`: profiles (`pnpm demo --profile optional-sources`, `pnpm fixture --optional-sources`).
- Fixtures: `adapters/anthropic/__tests__/fixtures/console/` (7 files, two pages each for the paged endpoints) and `claude-code/` (3 files, per-day and paged).

### Scripts, config, docs

- `scripts/secret-scan.ts` (assignment pattern, required fixture directories), `scripts/fork-verify.ts` (new fixture directories, generated profile check, tracked-path guard), `.gitignore`, `.env.example`, `config/default.json`, `collect-audit.yml` (passes the secret).
- `docs/BLUEPRINT.md` 5.1 / 5.4 / 12.2 / appendix A, `docs/API-MAPPING.md` section 6, `docs/SETUP.md`, `docs/DASHBOARD-FEATURES.md`, `docs/ARCHITECTURE.md` 4.1 / 8.3, `AGENTS.md` rule 2, storage rule, audit-collector skill, `CHANGELOG.md`.

### Tests (issue #39 mapping)

| Requirement | Test |
| :-- | :-- |
| (a) default config: coverage / OP-002 / score identical | `main/__tests__/optional-sources.test.ts` (with and without a Console key, 13 datasets, "All 13 datasets collected"); `sample-and-docs.test.ts` and `optional-profiles.test.ts` (committed sample byte-identical) |
| (b) enabled + valid key => ok | `optional-sources.test.ts` (all five `ok`, "All 18 datasets collected", Console key only on Console endpoints) |
| (c) enabled + missing key / 401 / 403 / 404 => unavailable, rest continues | `optional-sources.test.ts`, `optional-collectors.test.ts` |
| (d) enabled + schema mismatch => error | `optional-sources.test.ts`, `optional-apis.test.ts` |
| Official-shape fixtures with paging, fake fetch 401 / 403 / 404 / 429 / 5xx / 410 | `adapters/anthropic/__tests__/optional-apis.test.ts` |
| `--capture-raw` header / key not stored | `raw-capture.test.ts` (Console Admin key) |
| Env: no fallback, flags default off | `infrastructure.test.ts` |
| Synthetic profile, fixture tenant extension | `optional-profiles.test.ts` |
| B2: Data coverage and `#/config` show the datasets | `CoverageSection.test.tsx`, `Config.test.tsx`, `config-view.test.ts` |
| B3: archive / restore / size include them | `optional-history.test.ts` |

## Verification Results

| Stage                    | Command                          | Result                                   |
| :----------------------- | :------------------------------- | :--------------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`               | Clean (exit 0)                           |
| TypeScript Check         | `pnpm typecheck`                 | Pass (exit 0)                            |
| Unit & Integration Tests | `pnpm test`                      | core 179, collector 221, dashboard 338, scripts 32 pass |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | 0 leaks (exit 0)                         |
| Production Build         | `pnpm build`                     | Built                                    |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | Clean                                    |
| Dependency audit (CI)    | `pnpm audit:deps`                | No known vulnerabilities                 |

`pnpm demo` leaves `data/sample/` unchanged (`git status` clean); `pnpm demo --profile optional-sources` passes the `fork:verify` profile checks.

## Extension-point findings (existing code touched beyond registration)

Recorded for #39 and filed as #88: (1) config-view presenter enumerates `DATASET_NAMES`; (2) `env.ts` / `container.ts` know key families by name; (3) `SORT_KEYS` in `repositories.ts`; (4) `synthetic-history.ts` `CHANGE_PERIOD` / `variant` (test support); (5) `classify` exported and the `configPatch` container option.

## Remaining for humans

- Create a real Console Admin key, set `ANTHROPIC_CONSOLE_ADMIN_API_KEY`, enable the flags in a fork and run `pnpm collect --capture-raw <dir>`; sanitize the captures into the fixtures (the fixtures here follow the official references and are not captured from a tenant). Unconfirmed assumptions: the `group_by[]` pair on the Console Usage / Cost reports, the `claude_code` per-day `starting_at` semantics and the cents unit of `estimated_cost.amount`.
- A fork run of `collect-audit` with the new secret.
- #29 / #37 / #38 stay open for their own real-tenant work.
