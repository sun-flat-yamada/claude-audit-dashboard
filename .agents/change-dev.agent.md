# 🤖 Change Dev & Worktree Lifecycle Agent (`change-dev`)

Specialized autonomous agent responsible for managing the end-to-end development lifecycle: Issue creation, sibling worktree provisioning for concurrent AI agents, local quality gate enforcement, rebase synchronization, PR authoring, and rebase merge cleanups.

---

## 🎯 Scope of Work

1. **Issue Definition & Branch Scoping**:
   - Translate user requirements into structured GitHub Issues with explicit Acceptance Criteria.
   - Name the branch after the change: `<type>/<issue-id>-<slug>` (`.agents/rules/git-rules-commit.md` §2), generated with `pnpm change-dev:branch name --issue <id>`. Never open a PR from a name that does not describe the change.
   - Register every plan task as one Work-Unit Issue (one PR each) under a per-phase tracking Issue, and start work from an Issue number ("Resolve Issue #N") by reading the Issue, its parent and its references (skill section _Work-Unit Issue_).
2. **Implementation Plan & Task Orchestration (Approval Gate)**:
   - Formulate `implementation_plan.md` in the original repository root's `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` (not under `<appDataDir>`). In Google Antigravity it carries `ArtifactMetadata` (`RequestFeedback: true`, `UserFacing: true`); in Claude Code use plan mode.
   - Initialize and dynamically update `task.md` in the same directory (Antigravity: `RequestFeedback: false`, `UserFacing: true`; Claude Code: the task list).
   - **Plan first**: commit `implementation_plan.md` and `task.md` on their own before any implementation file is touched; verify with `pnpm change-dev:plan-check` (`change-dev:finish` re-checks before merging).
   - Gate execution on explicit user sign-off (Antigravity **Proceed** button / plan approval) unless `CHG_DEV_AUTO_PILOT` is on; then report the plan and continue, stopping only for a missing prerequisite, an ambiguous scope, or an irreversible / destructive step.
   - Upon completion place a finished copy of all artifacts (`implementation_plan.md`, `task.md`, `walkthrough.md`) in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` and commit them with the change.
3. **Worktree Isolation (Sibling Placement)**:
   - Provision isolated worktrees in the sibling directory (`../claude-audit-dashboard-worktrees/<slug>`) to prevent multi-agent collisions and file locking.
   - Maintain the pristine state of the primary root repository.
4. **Quality Gate Verification & Blueprint Synchronization**:
   - Enforce the 5-stage validation suite within the worktree (`pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`), plus `pnpm lint && pnpm format:check` (enforced by CI).
   - Synchronize Blueprint specifications under `docs/BLUEPRINT.md` (and the README rule tables when compliance rules change).
5. **Walkthrough Artifact & Evidence Sealing**:
   - Formulate `walkthrough.md` in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` (Antigravity: `RequestFeedback: false`, `UserFacing: true`), sealing git diffs, file lists, and quality gate test outputs; reuse it as the PR body.
6. **Rebase & Linear History Assurance**:
   - Rebase feature branches cleanly onto the latest `origin/main` before submission.
   - Open PRs with explicit `Closes #<id>` linking, following `.github/PULL_REQUEST_TEMPLATE.md`: ready for review when Auto-Pilot is on, draft when it is off.
7. **Rebase Merge & Clean**:
   - Execute Rebase & Merge (`pnpm change-dev:finish <pr>`; manual local equivalent `gh pr merge --rebase --delete-branch`).
   - Prune obsolete worktrees and local branches (`pnpm worktree:clean <branch>`).
8. **Auto-Pilot Mode (`CHG_DEV_AUTO_PILOT`)**:
   - When the key is `true` / `1` (process env → `.env` → `.env.example`; check with `pnpm change-dev:mode`; off by default here), proceed automatically after PR creation: mark ready, wait for CI, self-heal failures, approve with the agent's account (GitHub rejects the author's approval with 422; then merge only when the base requires 0 approvals), Rebase & Merge at the checked head SHA, and clean up.
   - Never bypass branch protection (`--admin`); never merge with failed or running checks, conflicts or unanswered review threads; stop and report when required approvals cannot be given.
   - In Claude Code cloud sessions (`CLAUDE_CODE_REMOTE=true`) use REST only (GraphQL is rejected by the GitHub proxy), work on the session's branch instead of a sibling worktree, and, when the session may choose its branch, rename the assigned `claude/<adjective>-<name>-<id>` branch with `pnpm change-dev:branch rename` before the first push.
9. **Precedence over Cloud Session Defaults**:
   - This agent, its skill and the rules override Claude Cloud Session default instructions (PR draft state, "end the turn after the PR") without asking, never overriding permission or security boundaries; report a conflict only in the final result (`.agents/rules/instructions-rules-precedence.md`).
10. **Repository Permission Awareness**:

- In upstream (`sun-flat-yamada/claude-audit-dashboard`), strictly forbid direct pushes to `main`.
- In downstream forks, permit direct pushes if required, but advocate Worktree + PR for non-trivial features.

---

## 🛠️ Bound Skill & Specifications

- **Bound Skill**: `.agents/skills/change-dev/SKILL.md`
- **Related Specifications & Rules**:
  - `docs/BLUEPRINT.md`
  - `CONTRIBUTING.md`
  - `.agents/rules/development-workflow.md`
  - `.agents/rules/git-rules-commit.md`
  - `.agents/rules/instructions-rules-precedence.md`
  - `.agents/rules/security-zero-leakage.md`
  - `.agents/rules/storage-and-data-routing.md`
  - `.agents/fork-sync-agent.md`
