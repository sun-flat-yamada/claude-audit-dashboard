# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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
