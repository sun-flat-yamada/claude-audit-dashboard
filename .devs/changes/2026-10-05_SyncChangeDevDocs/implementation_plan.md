# Sync change-dev Skill, Agent and Workflow Docs with Upstream

Issue #78. The change-dev scripts already match the upstream source (`sun-flat-yamada/github-copilot-dashboard`), but the documentation lags behind: the cloud-session branch rename is still conditional, the Auto-Pilot section is a summary, the PR state per mode is not a table, and the precedence rule reports conflicts under an English heading. This change ports the missing upstream wording while keeping this repository's adaptations (pnpm commands without `--`, `docs/BLUEPRINT.md` instead of SDD specs, the `data/audit` data branch, compliance rules, `pnpm lint && pnpm format:check`, the multi-tool artifact table, Claude Code plan mode).

## User Review Required

> [!IMPORTANT]
> `CHG_DEV_AUTO_PILOT` stays **disabled** by default in this repository (`CHG_DEV_AUTO_PILOT=false` in `.env.example`). The docs describe the upstream behavior for both modes but state the local default as off.

> [!WARNING]
> Documentation only; no script or configuration changes. References to `fork-sync.agent.md`, `quality-rules-gate.md`, `language-rules-output.md` and `naming-rules-general.md` point to files created by a concurrent change; they resolve once that change merges.

## Proposed Changes

### Agent documentation (`.agents/`)

#### [MODIFY] `.agents/skills/change-dev/SKILL.md`

- Phase 2: plan review gate per mode (`pnpm change-dev:mode`), Plan First explanation, last `task.md` items include the merge via `change-dev:finish`.
- Phase 3: Claude Code cloud session NOTE (skip the worktree) and the unconditional "rename the assigned branch before the first push" block (`pnpm change-dev:branch rename --issue 42`).
- Phase 6: `pnpm change-dev:plan-check` before the PR, mode-to-PR-state table, cloud sessions use the built-in GitHub tool with `draft` from the table.
- Auto-Pilot: Activation table, What-the-mode-decides table, Behavior steps 1-7, Guardrails list (no upstream PR numbers).
- Claude Code Cloud Sessions: precedence paragraph and cloud facts table (generic wording about auto-merge; `.env.example` is `false` here).
- References: `fork-sync.agent.md`; add `quality-rules-gate.md`, `language-rules-output.md`, `naming-rules-general.md`.

#### [MODIFY] `.agents/change-dev.agent.md`

- Unconditional cloud rename, precedence bullet, reference to `fork-sync.agent.md` and the new rules.

#### [MODIFY] `.agents/rules/development-workflow.md`

- YAML frontmatter (`alwaysApply: true`), unconditional cloud rename, precedence bullet, `task.md` last items, Step 6 PR state, Step 7 Auto-Pilot details and the `delete_branch_on_merge` recommendation.

#### [MODIFY] `.agents/rules/instructions-rules-precedence.md`

- Report conflicts in a section titled `既定指示との競合` with Japanese column headers (`language-rules-output.md`); bump `updated:`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- `pnpm change-dev:plan-check && pnpm change-dev:branch check`

### Manual Verification

- Diff each owned file against the upstream source and confirm only intended adaptations remain.
