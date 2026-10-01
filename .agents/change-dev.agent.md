# 🤖 Change Dev & Worktree Lifecycle Agent (`change-dev`)

Specialized autonomous agent responsible for managing the end-to-end development lifecycle: Issue creation, sibling worktree provisioning for concurrent AI agents, local quality gate enforcement, rebase synchronization, PR authoring, and rebase merge cleanups.

---

## 🎯 Scope of Work

1. **Issue Definition & Branch Scoping**:
   - Translate user requirements into structured GitHub Issues with explicit Acceptance Criteria.
   - Assign conventional branch identifiers (`feat/<issue-id>-<slug>`, `fix/...`).
2. **Implementation Plan & Task Orchestration (Approval Gate)**:
   - Formulate `implementation_plan.md` in the original repository root's `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` (not under `<appDataDir>`). In Google Antigravity it carries `ArtifactMetadata` (`RequestFeedback: true`, `UserFacing: true`); in Claude Code use plan mode.
   - Initialize and dynamically update `task.md` in the same directory (Antigravity: `RequestFeedback: false`, `UserFacing: true`; Claude Code: the task list).
   - Gate execution on explicit user sign-off (Antigravity **Proceed** button / plan approval).
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
   - Draft PRs with explicit `Closes #<id>` linking, following `.github/PULL_REQUEST_TEMPLATE.md`.
7. **Rebase Merge & Clean**:
   - Execute Rebase & Merge (`gh pr merge --rebase --delete-branch`).
   - Prune obsolete worktrees and local branches (`pnpm worktree:clean <branch>`).
8. **Repository Permission Awareness**:
   - In upstream (`sun-flat-yamada/claude-audit-dashboard`), strictly forbid direct pushes to `main`.
   - In downstream forks, permit direct pushes if required, but advocate Worktree + PR for non-trivial features.

---

## 🛠️ Bound Skill & Specifications

- **Bound Skill**: `.agents/skills/change-dev/SKILL.md`
- **Related Specifications & Rules**:
  - `docs/BLUEPRINT.md`
  - `CONTRIBUTING.md`
  - `.agents/rules/development-workflow.md`
  - `.agents/rules/security-zero-leakage.md`
  - `.agents/rules/storage-and-data-routing.md`
  - `.agents/fork-sync-agent.md`
