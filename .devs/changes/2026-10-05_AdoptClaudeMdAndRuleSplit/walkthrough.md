# Walkthrough: Adopt CLAUDE.md and split agent rules (#77)

## Summary

The repository now has a `CLAUDE.md` entrypoint that imports `AGENTS.md` and every rule under `.agents/rules/`, three new rule files extracted from the sibling repository's layout (quality gate, output language, naming), the shared YAML frontmatter convention on all rule and root instruction files, and agent personas renamed to the `*.agent.md` suffix. All facts are this repository's: pnpm scripts, the `data/audit` orphan branch, `docs/BLUEPRINT.md` instead of SDD specs, compliance-rule dual-sync, `.devs/changes/` artifacts and `CHG_DEV_AUTO_PILOT=false` by default.

## Changes Made

### Root instruction files

- `CLAUDE.md` (new): frontmatter, `@` imports of `AGENTS.md` + 9 rule files, Commands (`/status`, `/test`, `/gate`, `/secret-scan`, `/verify-fork`, `/change-dev`, `/branch`, `/plan`) using only scripts that exist in `package.json`, and Directives (zero secrets / PII, data isolation, quality gate, blueprint & compliance sync, clean architecture, worktree isolation, output language, instruction precedence, plan first, branch naming, naming).
- `AGENTS.md`: frontmatter; "each rule is a summary" lead; a `→ rule file` link on every Core Rule; new Rule 10 (Git & language conventions) and Rule 11 (Instruction precedence).
- `GEMINI.md`: frontmatter.

### Rules (`.agents/rules/`)

- `quality-rules-gate.md` (new): mandatory gate, CI-only `pnpm lint && pnpm format:check` / `pnpm audit:deps`, blueprint alignment.
- `language-rules-output.md` (new): Japanese replies and PR descriptions, English commits / code / comments.
- `naming-rules-general.md` (new): `*.agent.md` suffix, rule and skill naming with the legacy names kept, change-artifact directories, frontmatter convention (single-quoted values).
- `security-zero-leakage.md`, `storage-and-data-routing.md`, `compliance-rules-management.md`: frontmatter added (the security rule keeps its `name` / `trigger` keys).
- `git-rules-commit.md`: §3 now points to `language-rules-output.md`, §4 to `quality-rules-gate.md`.

### Agent definitions (`.agents/`)

- `git mv` renames: `audit-collector`, `compliance-checker`, `dashboard-ui`, `fork-sync`, `report-notification` → `<name>.agent.md`; heading identifiers updated. `development-workflow.md`, `instructions-rules-precedence.md`, `change-dev.agent.md` and `.agents/skills/change-dev/SKILL.md` were left to the work unit that owns them, so their two remaining `fork-sync-agent.md` references are untouched by design.

## Verification Results

| Stage                    | Command                          | Result                        |
| :----------------------- | :------------------------------- | :---------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`               | ✅ Clean (exit 0)             |
| TypeScript Check         | `pnpm typecheck`                 | ✅ Pass (exit 0)              |
| Unit & Integration Tests | `pnpm test`                      | ✅ 592 pass + 23 script tests |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | ✅ 0 leaks (exit 0)           |
| Production Build         | `pnpm build`                     | ✅ Built                      |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | ✅ Clean                      |
| Plan-First Gate          | `pnpm change-dev:plan-check`     | ✅ Plan committed first       |
| Branch Name              | `pnpm change-dev:branch check`   | ✅ Conforms                   |
