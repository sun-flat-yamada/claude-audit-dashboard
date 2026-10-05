# Walkthrough: Sync change-dev skill, agent and workflow docs (#78)

## Summary

The change-dev documentation in this repository was behind the upstream source (`sun-flat-yamada/github-copilot-dashboard`), whose scripts had already been imported. The missing upstream wording has been ported into the four owned documents while keeping every local adaptation: pnpm scripts without `--`, `docs/BLUEPRINT.md` instead of the SDD specification set, the `data/audit` data branch, compliance-rule sync, the CI-only `pnpm lint && pnpm format:check`, the multi-tool artifact table and Claude Code plan mode. `CHG_DEV_AUTO_PILOT` stays **disabled** by default here (`CHG_DEV_AUTO_PILOT=false` in `.env.example`), and the documents now say so explicitly.

## Changes Made

### `.agents/skills/change-dev/SKILL.md`

- Hosted-session NOTE now points at the branch rename; the plan gate is described as blocking only when Auto-Pilot is off.
- Phase 2: full plan review gate per mode (`pnpm change-dev:mode`), the enforced Plan First explanation, and the rule that the last `task.md` items are the PR **and** the merge.
- Phase 3: Claude Code cloud-session NOTE (skip the worktree) plus the unconditional "rename the assigned branch before the first push" block with `pnpm change-dev:branch rename --issue 42`, the helper's refusal conditions and the owner-approved exception reference.
- Phase 6: `pnpm change-dev:plan-check` before the PR, the mode-to-PR-state table, the cloud-session route through the built-in GitHub tool with `draft` from the table, and the PR body contents.
- Phase 7: NOTE that Auto-Pilot runs it right after Phase 6.
- Auto-Pilot: Activation table, What-the-mode-decides table, Behavior steps 1-7 (ready, wait for CI, self-heal, same-account approval / 422, rebase merge at the checked head SHA, cleanup with the `delete_branch_on_merge` recommendation, next task from the latest base) and the Guardrails list. Upstream PR numbers are stated generically.
- Claude Code Cloud Sessions: precedence paragraph (conflicts reported as `既定指示との競合`) and the cloud facts table, adapted (`.env.example` is `false` here; auto-merge phrased as "may be disabled").
- References: `fork-sync.agent.md`; `quality-rules-gate.md`, `language-rules-output.md`, `naming-rules-general.md` added to the rule list.
- `task.md` structure template: Phase 7 now names `pnpm change-dev:finish`.

### `.agents/change-dev.agent.md`

- Plan gate keyed on `CHG_DEV_AUTO_PILOT`, `task.md` last items, cloud sessions skip the worktree, branch deletion / `delete_branch_on_merge` recommendation, cloud CI event instead of polling, unconditional cloud rename, precedence bullet with the `既定指示との競合` section, references updated (`fork-sync.agent.md` and the new rules).

### `.agents/rules/development-workflow.md`

- YAML frontmatter added (single-quoted, `alwaysApply: true`).
- Isolated hosted sessions: unconditional rename before the first push.
- Step 2: `task.md` last items, enforced Plan First, plan review per mode (off by default here), cloud-session note, precedence bullet.
- Step 3: branch-name helper. Step 6: plan-check, draft per mode, cloud GitHub tool. Step 7: Auto-Pilot sequence, guardrails and the `delete_branch_on_merge` recommendation.

### `.agents/rules/instructions-rules-precedence.md`

- Conflicts are reported in a section titled `既定指示との競合` with Japanese column headers, referencing `language-rules-output.md`; `updated:` bumped to 2026-10-05.

## Verification Results

| Stage                    | Command                          | Result                     |
| :----------------------- | :------------------------------- | :------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`               | ✅ Clean (exit 0)          |
| TypeScript Check         | `pnpm typecheck`                 | ✅ Pass (exit 0)           |
| Unit & Integration Tests | `pnpm test`                      | ✅ 592 passed (57 files)   |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | ✅ 0 leaks (exit 0)        |
| Production Build         | `pnpm build`                     | ✅ Built                   |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | ✅ Clean                   |
| Plan First               | `pnpm change-dev:plan-check`     | ✅ Pass (docs-only branch) |
| Branch Name              | `pnpm change-dev:branch check`   | ✅ Pass                    |
