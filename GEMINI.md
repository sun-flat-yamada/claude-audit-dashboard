# Project Guardrails & Instructions for AI Agents (Antigravity / Gemini)

Welcome to `claude-audit-dashboard`.
All AI coding assistants (Antigravity, Gemini, Claude Code, Cursor, Copilot Workspace) working in this repository must strictly adhere to these core directives:

---

## 🔒 1. Strict Security & Zero-Leakage Policy

- **NO Hardcoded Secrets**: Under no circumstances should real Anthropic Admin API keys (`sk-ant-admin...`), Compliance Access keys (`sk-ant-api...`), GitHub tokens, Slack/Discord webhooks, or SMTP credentials be added to any file or output in chat logs.
- **NO PII Leakage**: Real employee identities, emails, or internal organization charts must not be committed to Git. User mapping or credentials are dynamically injected via GitHub Secrets/Variables.
- **Pre-Commit Verification**: Run `npm run secret-scan` before proposing any changes. Any scan failure must be remediated immediately.

---

## 🌿 2. Fork-Safe Storage Architecture

- **Data Isolation**: Never commit actual enterprise audit snapshot data or private organization reports to `main`. Public demo and tests must rely exclusively on synthetic data in `data/sample/`.
- **Zero Conflicts**: Upstream `main` must remain 100% clean code so downstream enterprise forks can run `Sync Fork` without merge conflicts.

---

## 📐 3. Specification-Driven Development (SDD) & Blueprint Alignment

- All architectural decisions and features must align with specifications in `docs/BLUEPRINT.md` and `docs/SETUP.md`.
- When compliance rules, data schemas, or collection schedules are modified, update the documentation in tandem.

---

## 🧪 4. Quality Standard

- Every pull request and major change should pass:
  - `npm run fork:verify`
  - `npm run typecheck`
  - `npm test`
  - `npm run secret-scan`
  - `npm run build`

---

## 🔄 5. Multi-Agent Worktree & Change Workflow

- **Multi-Agent Isolation**: Never edit directly on the root workspace when multiple agents operate concurrently. Always provision an isolated sibling worktree (`../claude-audit-dashboard-worktrees/<branch>`) to prevent concurrency race conditions.
- **Strict Lifecycle**: `Issue -> Sibling Worktree -> Local Quality Gate -> PR -> Rebase Merge -> Clean`.
- **Permission Boundary**: Direct commits/pushes to `main` are strictly forbidden on upstream (`sun-flat-yamada`). On downstream forks, direct commits are permitted when operationally necessary.
- **Reference**: See `.agents/rules/development-workflow.md`.

---

## 🛡️ 6. Compliance Rule & Audit Synchronization Policy

- **Rule Synchronization**: When compliance rules (Access Control, API Keys, Usage Anomaly, Data Governance, Operations) are added or modified, update both shared type definitions (`packages/shared/src/types/compliance.ts`), engine implementations (`packages/collector/src/checkers/`), and documentation (`docs/BLUEPRINT.md`).
- **Reference**: See `.agents/rules/compliance-rules-management.md`.
