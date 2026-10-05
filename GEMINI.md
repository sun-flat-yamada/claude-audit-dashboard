---
title: 'Gemini / Antigravity Configuration for claude-audit-dashboard'
description: 'Guardrails and directives for Gemini CLI and Antigravity.'
category: 'meta'
type: 'configuration'
status: 'active'
date: 2026-10-05
updated: 2026-10-05
lang: 'en'
tags:
  - 'ai'
  - 'agent'
  - 'configuration'
---

# Project Guardrails & Instructions for AI Agents (Antigravity / Gemini)

Welcome to `claude-audit-dashboard`.
All AI coding assistants (Antigravity, Gemini, Claude Code, Cursor, Copilot Workspace) working in this repository must strictly adhere to these core directives:

---

## 🔒 1. Strict Security & Zero-Leakage Policy

- **NO Hardcoded Secrets**: Under no circumstances should real Anthropic keys (Enterprise / Compliance keys `sk-ant-api...`, Admin keys `sk-ant-admin...`), GitHub tokens, Slack/Discord webhooks, or SMTP credentials be added to any file or output in chat logs.
- **NO PII Leakage**: Real employee identities, emails, or internal organization charts must not be committed to Git. User mapping or credentials are dynamically injected via GitHub Secrets/Variables.
- **Pre-Commit Verification**: Run `pnpm secret-scan` before proposing any changes. Any scan failure must be remediated immediately.

---

## 🌿 2. Fork-Safe Storage Architecture

- **Data Isolation**: Never commit actual enterprise audit snapshot data or private organization reports to `main`. Public demo and tests must rely exclusively on synthetic data in `data/sample/`, regenerated only with `pnpm demo`. Live data belongs on the orphan branch `data/audit`.
- **Zero Conflicts**: Upstream `main` must remain 100% clean code so downstream enterprise forks can run `Sync Fork` without merge conflicts.

---

## 📐 3. Specification-Driven Development (SDD) & Blueprint Alignment

- All architectural decisions and features must align with `docs/BLUEPRINT.md` (requirements), `docs/ARCHITECTURE.md` (layers and extension recipes) and `docs/API-MAPPING.md` (Claude Enterprise API usage).
- When compliance rules, data schemas, or collection schedules are modified, update the documentation in tandem.

---

## 🧪 4. Quality Standard

- Every pull request and major change should pass:
  - `pnpm fork:verify`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm secret-scan`
  - `pnpm build`
  - `pnpm lint` and `pnpm format:check` (also enforced by CI)

---

## 🔄 5. Multi-Agent Worktree & Change Workflow

- **Multi-Agent Isolation**: Never edit directly on the root workspace when multiple agents operate concurrently. Always provision an isolated sibling worktree (`../claude-audit-dashboard-worktrees/<branch>`) to prevent concurrency race conditions.
- **Strict Lifecycle** (`change-dev`): `Issue -> Implementation Plan (user approval) -> Sibling Worktree -> Local Quality Gate -> Walkthrough -> PR -> Rebase Merge -> Clean`. Write `implementation_plan.md`, `task.md` and `walkthrough.md` to `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` under the repository root (never `<appDataDir>`) and commit the finished copies with the change.
- **Permission Boundary**: Direct commits/pushes to `main` are strictly forbidden on upstream (`sun-flat-yamada`). On downstream forks, direct commits are permitted when operationally necessary.
- **Reference**: See `.agents/rules/development-workflow.md` and `.agents/skills/change-dev/SKILL.md`.

---

## 🛡️ 6. Compliance Rule & Audit Synchronization Policy

- **Rule Synchronization**: When compliance rules (access control, API keys, usage, governance, operations, configuration baselines, activity watches) are added or modified, update the implementation (`packages/core/src/domain/compliance/rules/` or `factories/defaults.ts`), its tests, and the rule tables in `docs/BLUEPRINT.md` §7.1, `README.md` and `README.ja.md` together. A test fails when the tables and the catalog differ.
- **Reference**: See `.agents/rules/compliance-rules-management.md`.

---

## 🏛️ 7. Clean Architecture Boundaries

- `@claude-audit/core` is pure TypeScript (no Node APIs, no I/O); `@claude-audit/collector` holds adapters and the CLI; the dashboard imports only `@claude-audit/core/contracts`.
- Extend by adding one implementation and registering it (`docs/PLUGIN-ARCHITECTURE.md`). Do not add `switch` statements over kinds.
- ESLint enforces the boundaries and size limits (complexity 10, max depth 3, max 5 parameters, max 60 lines per function).
