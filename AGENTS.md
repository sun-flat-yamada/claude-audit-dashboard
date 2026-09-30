# AI Agents Instruction & Security Guidelines (AGENTS.md)

This repository enforces strict security, zero-leakage, and compliance standards for all autonomous AI agents operating on **claude-audit-dashboard**.

## Core Rules

1. **Never Commit Secrets**: Any Anthropic API keys (`sk-ant-admin...`, `sk-ant-api...`), GitHub tokens (`ghp_`, `github_pat_`), Slack/Discord webhooks, SMTP passwords, private keys, or certificates must NEVER be written into source files or commit history.
2. **Zero PII**: Do not hardcode or commit real employee names, corporate emails, user IDs, or organizational structures into Git. All sensitive configurations must be supplied dynamically via environment variables / GitHub Actions Secrets (`ANTHROPIC_ADMIN_API_KEY`, `ANTHROPIC_COMPLIANCE_API_KEY`, `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`, etc.).
3. **Run Secret Scan**: Always execute `npm run secret-scan` (or `pnpm secret-scan`) before proposing changes, committing, or opening PRs.
4. **Data Isolation & Fork Safety**: Never commit live audit snapshot files or internal compliance check reports into the `main` code branch. Maintain fork-isolation using `data/sample/` for public mocks and an isolated orphan branch or Actions artifact/Pages storage for production data. Verify with `npm run fork:verify`.
5. **Quality Gate**: Ensure `npm run fork:verify && npm run typecheck && npm test && npm run secret-scan && npm run build` pass cleanly with exit code 0 before concluding tasks.
6. **Change Workflow & Worktree Isolation**: For multi-agent development, avoid editing directly on the root workspace; provision a sibling worktree (`../claude-audit-dashboard-worktrees/<branch>`). Follow the `Issue -> Sibling Worktree -> Quality Gate -> PR -> Rebase Merge` lifecycle. Direct push to upstream `main` is strictly forbidden. See `.agents/rules/development-workflow.md`.
7. **Data Routing & Staging Convention**: Understand persistent audit snapshots (`data/snapshots/` and `data/reports/`) vs. SPA web distribution (`packages/dashboard/public/data/`). In CI packaging, ensure mock or snapshot metadata is properly staged and accessible via relative paths without 404s. See `.agents/rules/storage-and-data-routing.md`.
8. **Compliance Rules & Blueprint Dual-Sync**: Whenever compliance rules (e.g., AC-001〜AC-003, AK-001〜AK-003, UA-001〜UA-002, DG-001, OP-001) or thresholds are added or updated, specification documentation (`docs/BLUEPRINT.md`) must be kept 100% in sync with codebase definitions (`packages/shared/src/types/`, `packages/collector/src/checkers/`). See `.agents/rules/compliance-rules-management.md`.
