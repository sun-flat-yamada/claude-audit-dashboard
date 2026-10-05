# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Time-point summary, diff core and compare data files for the snapshot comparison (F-015 PR 2, #106, refs #42): `@claude-audit/core/contracts` gains the strict `TimePointSummary` / `CompareIndex` schemas (own `schemaVersion`; statuses and counts only), the pure `diffTimePoints(base, target)` (rule changes `regressed` / `improved` / `unchanged` / `added` / `removed` / `assessed` / `unassessed` over the full 5 x 5 status table, dataset coverage changes, KPI deltas, score delta with the assessed-count change) and Markdown / CSV / JSON export formatters (deterministic columns and file names; the CSV escaping `escapeCsvCell` moved from the dashboard to the contracts and is shared). `@claude-audit/core` gains `buildTimePointSummary` / `buildCompareIndex` / `buildDashboardKpis`. `pnpm check` writes `summaries/<snapshot id>.json` next to each compliance report (outlives archiving); `pnpm build:detail` backfills missing summaries, writes `detail/compare/index.json` and the newest 90 `detail/compare/<snapshot id>.json` (manifest kind `compare`, same `PAGES_DETAIL_DATA` gate, stale point files removed), and `checkDetailBundle` / `fork:verify` validate them (schema, index <-> file consistency, `example.*` only, no evidence text). `data/summaries/` is gitignored and a forbidden tracked path
- Multi-time-point synthetic data for the snapshot comparison (F-015 PR 1, #101, refs #42): `pnpm demo` also collects and judges the synthetic tenant at two earlier fixed-clock time points (28 and 14 days before the latest) and writes `history/<snapshot id>/dashboard.json` and `compliance-report.json` next to the sample; the latest point and every existing sample file are unchanged. The points contain `pass -> fail`, `fail -> pass`, `warning -> pass`, `pass -> skipped` and `error -> pass` transitions, rule add / remove, dataset coverage `ok` / `unavailable` / `error` changes and member / MAU / cost increases and decreases (in the `optional-sources` profile the optional datasets are enabled at the latest point). `fork:verify` validates `history/`. The F-015 design (per-time-point summary files under the `PAGES_DETAIL_DATA` gate, pure diff in `@claude-audit/core`, restore path, PR split) is recorded in `.devs/changes/2026-10-05_F015MultiTimePointSampleData/implementation_plan.md`
- Playwright E2E and axe accessibility suite for the dashboard (B5, #40): `pnpm test:e2e` builds the SPA with the Pages base path and runs journeys of every screen (Phase A, B1 fixture tenant, B2 F-003 / F-005 to F-014, B3 archive size, B4 optional datasets) on eight synthetic data profiles, WCAG 2.1 AA axe scans of every route in light and dark, keyboard-only checks and a guard against live data; new `E2E and accessibility` CI job (not part of `pnpm test`)
- Daily token breakdown and cache hit rate (AN-1, #92): `DashboardView.usage.daily` adds the optional `uncachedInputTokens` / `cacheReadInputTokens` / `cacheCreationInputTokens` (summing to `inputTokens`) and `usage` the optional `cacheHitRate` (cache reads ÷ all input, `null` without input); the Overview token chart shows the four token types and the hit rate. `schemaVersion` stays 2 and older `dashboard.json` files still parse (the chart falls back to input / output). The demo tenant varies its daily cache-read share
- Active users by product (AN-2, #93): the collector maps the per-product `<product>_{daily,weekly,monthly}_active_user_count` of the Analytics summaries (Chat, Claude Code, Cowork, Claude Design, Claude in Office, Claude Science) leniently from the same call into `AdoptionDay.byProduct` (an omitted or `null` product is skipped, never an error); `DashboardView.adoption` adds the optional `byProduct` (latest day) and `productWeekly` (weekly active trend), and the Overview Active users card shows a By product table with weekly sparklines. `schemaVersion` stays 2 and older `dashboard.json` files still parse. The demo tenant generates per-product counts
- Product engagement (AN-3, #94): the collector maps the metric blocks of the Analytics users roll-up (chat, Claude Code core metrics and tool actions, Cowork, Claude Design, the Office apps, Claude Science, web searches) leniently from the same call into the optional `MemberActivity.engagement` (a missing block or `null` counter is absent, never an error; `active` / `lastActiveOn` are unchanged); `DashboardView` adds the optional `engagement` aggregate with no per-person values (members active per product, summed counters, Claude Code lines, commits, pull requests, sessions and the suggestion accept rate per tool), and the Overview shows a Product engagement card. The field is optional within `schemaVersion` 3, so a `dashboard.json` written before it still parses. The demo tenant generates persona-based engagement
- Optional adapters (B4, key-free part of #39): the linked Claude Console organization Admin API (workspaces, API key inventory, Usage and Cost reports) and the Claude Code Analytics API, as five new datasets (`consoleWorkspaces`, `consoleApiKeys`, `consoleUsage`, `consoleCost`, `claudeCodeActivity`) registered only when `sources.console.enabled` / `sources.claudeCode.enabled` is set (both default `false`, so coverage, OP-002 and the score of existing tenants are unchanged). New secret `ANTHROPIC_CONSOLE_ADMIN_API_KEY` (never a fallback of the Enterprise key). Enabled without a key or with 401 / 403 / 404 the datasets are `unavailable`, schema drift is `error`, and the other datasets keep collecting. Per-person Claude Code rows are never published (aggregate-only)
- `pnpm demo --profile optional-sources` and `pnpm fixture --optional-sources` (gitignored output) with both sources on; official-shape fixtures for both APIs; `secret-scan` / `fork:verify` cover the new variable, the fixtures and the generated profile
- Long-term operation tooling (B3, key-free part of #38): `pnpm size` measures the `data/audit` history (object counts, reachable size, growth per 30 days, blobs per dataset, archive inventory shared with the dashboard's F-013 aggregation) and judges it against the new `capacity.*` limits with a pure function; the collect workflow runs it non-fatally before the save and alerts through the existing channels
- `pnpm restore <id|year> [--out <dir>]` restores `archive/<year>/<id>.json.gz` to `snapshots/<id>/` byte-identically; `pnpm build:data --snapshot <id>` and `pnpm build:detail --snapshot <id>` rebuild from a stored snapshot
- `collect-audit.yml` manual inputs `retention_days` and `dry_run`, validated through the environment by `.github/scripts/validate-dispatch-inputs.sh`
- Test support that synthesizes 400+ days of 6-hourly history and commits it into a temporary git repository (dedup, archive-does-not-shrink and threshold tests); capacity guideline and the yearly orphan-branch rotation procedure in `docs/CHANGE-PLAN.md` section 9.4 and `docs/DEPLOYMENT.md` (figures are synthetic-based, to be re-validated with real data)

### Changed

- `pnpm demo` now collects and judges the three synthetic time points in one store (oldest first, like a real pipeline), so `data/sample/dashboard.json` `compliance.history` carries three points and the Overview score trend is drawn from the sample (it needs two or more); the other root sample files are unchanged. `data/sample/history/*` is regenerated (the files committed with #101 predated the product active-user fields) and `data/sample/detail/` gains `compare/*` and the `compare` manifest entry
- Breaking: `DashboardView` is v3. The optional model x group spend (F-010, `sources.usageMatrix.enabled`) now lives in `dashboard.json` as `modelMatrix` (`null` while off, `unavailable` / `error` with a reason, or the matrix) and the Overview shows a model spend card; the staged `detail/usage-matrix.json` and the manifest kind `usage-matrix` are retired and `DETAIL_SCHEMA_VERSION` is 2. Regenerate published data with `pnpm build:data` / `pnpm build:detail` (or `pnpm demo`); an outdated file shows the regeneration hint (#102)
- Dashboard accessibility (found by the axe scans): muted text meets 4.5:1 in both themes, wide tables that scroll inside their own box are keyboard-focusable named regions, the organization / group pages keep a level-1 heading while loading or failing, and an outdated detail file now says how to regenerate it instead of printing the validator output
- `change-workflow` agent, skill and rule replaced by `change-dev`: implementation plan with user approval gate, plan / task / walkthrough artifacts in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` committed with each change, `.devs/` otherwise gitignored

## [0.2.0] - 2026-10-01

Claude Enterprise redesign. See [docs/CHANGE-PLAN.md](docs/CHANGE-PLAN.md) for the findings, decisions and migration notes.

### Added

- Collection from the Claude Enterprise APIs with one read-only Enterprise key: Compliance API (Activity Feed, linked organizations, effective settings, API key inventory), Admin API user management (members, invites, RBAC groups), Enterprise Analytics API (user activity, DAU/WAU/MAU, usage and cost by product / model / group) and Spend Limits API
- Activity Feed window polling with ID de-duplication; retry contract (429 `retry-after`, 5xx/529 back-off, `x-should-retry`); four pagination styles
- Dataset coverage (`ok` / `unavailable` / `error`) with reasons; rules declare required datasets and are `skipped` instead of passing when data is missing
- 30 compliance rules: AC-001–AC-004, AK-001–AK-003, UA-001–UA-004, DG-001, OP-001–OP-002, configuration baselines CF-001–CF-009 and activity watches AM-001–AM-007; custom baselines and watches in `config/custom-rules.json`; per-rule parameters and `disabledRules`
- Score shown with its coverage (`95/100 (2 of 30 rules assessed)`) in the dashboard, alerts and reports
- Analyzers (model concentration, cache efficiency, group concentration, seat utilization)
- Compliance, weekly and monthly reports rendered as Markdown, HTML, CSV and JSON; console / Slack / Discord / e-mail notifications with status, severity and cooldown policy
- Dashboard v2 on the published `DashboardView` contract: score and KPIs, filterable results, cost / token / adoption trends with table views, spend breakdowns, notable events, data coverage, light and dark themes
- `pnpm demo`: deterministic synthetic tenant that regenerates `data/sample/` (golden test)
- `.github/actions/setup` composite action and `.github/scripts/data-branch.sh` for the `data/audit` branch
- `fork:verify` validates the sample against the contract and rejects non-example e-mail addresses
- Documentation: change plan, architecture, API mapping; blueprint v0.3.0

### Changed

- **Breaking:** packages restructured into `@claude-audit/core` (domain, use cases, contracts), `@claude-audit/collector` (adapters, CLI) and `@claude-audit/dashboard`; `@claude-audit/shared` removed
- **Breaking:** secrets — `ANTHROPIC_ENTERPRISE_API_KEY` replaces the Console Admin key; `ANTHROPIC_COMPLIANCE_API_KEY` / `ANTHROPIC_ANALYTICS_API_KEY` / `ANTHROPIC_ADMIN_API_KEY` are optional overrides
- **Breaking:** configuration (`config/default.json`) uses the new camelCase schema; `compliance.enabled_rules` replaced by `compliance.disabledRules`; custom rules use `settingBaselines` / `activityWatches`
- **Breaking:** scripts — `collect`, `check:compliance`, `build:data`, `pipeline`, `notify`, `archive`, `report:compliance|weekly|monthly`, `demo` replace `collect:audit` / `collect:usage`
- Pages publish the synthetic sample unless `PAGES_DATA_SOURCE=live`
- Workflows: shared setup action, `audit-data` concurrency group, secrets passed only to the steps that use them, CI runs fork:verify and `pnpm audit --audit-level=high`
- ESLint enforces Clean Architecture boundaries and function size limits
- All Dependabot updates applied (Vite 8, Vitest 5, ESLint 10, zod 4, Recharts 3, nodemailer 10.0.13, GitHub Actions majors); Node.js >= 22.13

### Removed

- Workspace-based rules and views (Claude Enterprise has linked organizations and RBAC groups, not Console workspaces)
- Unused dashboard dependencies (`react-router-dom`, `lucide-react`, `clsx`, `tailwind-merge`, `date-fns`)

### Fixed

- Activity Feed paging direction (`after_id` returns older events) and missing de-duplication
- `DATA_DIR` resolved relative to the package instead of the invocation directory
- Sample data could be committed to the `data/audit` branch on the first run
- `report:monthly --month` accepted invalid months such as `2026-13`

## [0.1.0] - 2026-09-29

### Added

- Project blueprint and specification (Spec-Driven Development)
- Monorepo structure with pnpm workspaces (shared, collector, dashboard)
- Shared TypeScript type definitions for all domain models
- 10 built-in compliance audit rules
- GitHub Actions workflows (CI, Deploy Pages, Collect Audit, Weekly Report)
- Dependabot configuration for automated dependency updates
- Issue templates and PR template
- Sample data for development
- Configuration schema and defaults
- Plugin architecture, dashboard feature, deployment and billing/model-analysis specifications
- AI agent guidelines (`AGENTS.md`, `GEMINI.md`, `.agents/`) and community health files
- Secret scanner, fork-safety verifier and sibling worktree helper scripts
- ESLint flat config, `.gitattributes`, and minimal collector / dashboard entry points so the
  monorepo builds end to end

### Changed

- Scheduled workflows (audit collection, weekly and monthly reports) are opt-in via the
  `ENABLE_SCHEDULED_JOBS` repository variable
- Workspace scripts use full package names (`@claude-audit/*`) in `pnpm --filter`

### Fixed

- Missing root dev dependencies (TypeScript, Prettier, ESLint, rimraf) and a `husky` prepare
  script that failed on install
- `deploy-pages.yml` `workflow_run` branch filter, which never matched
- Secret scanners flagging the documented mock placeholders
- Documentation paths (`.agents/skills/`, `config/default.json`, `scripts/*.ts`)
