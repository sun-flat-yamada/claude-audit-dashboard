# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
