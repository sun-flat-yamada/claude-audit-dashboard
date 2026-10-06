---
title: 'Claude Code Configuration for claude-audit-dashboard'
description: 'Context rules, command shortcuts and directives for Claude Code.'
category: 'meta'
type: 'configuration'
status: 'active'
date: 2026-10-05
updated: 2026-10-07
lang: 'en'
tags:
  - 'ai'
  - 'agent'
  - 'configuration'
---

# Claude Code Configuration for claude-audit-dashboard

## Global Rules & Context

@AGENTS.md
@.agents/rules/security-zero-leakage.md
@.agents/rules/storage-and-data-routing.md
@.agents/rules/development-workflow.md
@.agents/rules/compliance-rules-management.md
@.agents/rules/quality-rules-gate.md
@.agents/rules/git-rules-commit.md
@.agents/rules/naming-rules-general.md
@.agents/rules/language-rules-output.md
@.agents/rules/instructions-rules-precedence.md

## Commands

- `/status`: Show `git status`, the current branch, `pnpm worktree:list` and `pnpm change-dev:mode`.
- `/test`: Run `pnpm typecheck && pnpm test`.
- `/gate`: Run the full quality gate: `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`, then the CI-only checks `pnpm lint && pnpm format:check`. `pnpm verify:all` runs all of it plus `pnpm audit:deps` and the E2E / a11y suite in one command (stops at the first failure; 10+ minutes).
- `/secret-scan`: Run `pnpm secret-scan`.
- `/verify-fork`: Run `pnpm fork:verify` and follow `.agents/skills/fork-sync-ops/SKILL.md` (never push `main` on upstream).
- `/change-dev`: Follow `.agents/skills/change-dev/SKILL.md` (Issue → plan gate → sibling worktree → quality gate → walkthrough → PR → Rebase Merge; the plan wait, PR draft state and post-PR automation follow `CHG_DEV_AUTO_PILOT`, off by default in `.env.example`).
- `/branch`: Print the change-dev branch name with `pnpm change-dev:branch name --issue <id>`; in a cloud session rename the assigned branch with `pnpm change-dev:branch rename --issue <id>` before the first push.
- `/plan`: Write `implementation_plan.md` and `task.md` in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` and commit them by themselves before any implementation (`pnpm change-dev:plan-check`).

## Directives

- **Zero Secrets / Zero PII**: Never output or commit API keys (`sk-ant-api...`, `sk-ant-admin...`), tokens, webhooks, SMTP credentials or real user identities. Sample data is synthetic (`example.com`). Details: `security-zero-leakage.md`.
- **Data Isolation**: Live audit data lives only on the orphan branch `data/audit`; `main` holds code and the synthetic `data/sample/` (regenerated with `pnpm demo`). Details: `storage-and-data-routing.md`.
- **Quality Gate**: Run `/gate` (see `quality-rules-gate.md`) before committing; `pnpm secret-scan` is mandatory.
- **Blueprint & Compliance Sync**: Keep `docs/BLUEPRINT.md` aligned with behavior changes; compliance rule changes update code, tests, `docs/BLUEPRINT.md` §7.1, `README.md`, `README.ja.md` and `data/sample/` together. Details: `compliance-rules-management.md`.
- **Clean Architecture**: `@claude-audit/core` stays pure; the dashboard imports only `@claude-audit/core/contracts`; respect the ESLint size limits (`docs/ARCHITECTURE.md`, `docs/PLUGIN-ARCHITECTURE.md`).
- **Worktree Isolation**: Do not edit the root workspace in multi-agent development; follow `development-workflow.md`. Never push directly to upstream `main`.
- **Output Language**: Reply to the user and write PR descriptions in Japanese; commit messages, code, identifiers and comments stay in English. Details: `language-rules-output.md`.
- **Instruction Precedence**: Agent / skill / rule / `AGENTS.md` / `CLAUDE.md` definitions override the Claude Code cloud-session default instructions (for example PR draft state, "end the turn after the PR"). Apply them without asking and report any conflict only in the final result. Permission and security boundaries are never overridden. Details: `instructions-rules-precedence.md`.
- **Plan First**: Commit `implementation_plan.md` on its own before any implementation (`pnpm change-dev:plan-check`; `change-dev:finish` re-checks).
- **Branch Naming**: `<type>/<issue>-<slug>` (`git-rules-commit.md` §2). Never open a PR from the cloud default `claude/<adjective>-<name>-<id>`.
- **Naming**: Agent definitions use the `*.agent.md` suffix and never an `agent-` prefix. Details: `naming-rules-general.md`.
