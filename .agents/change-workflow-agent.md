# 🤖 Change Workflow & Worktree Lifecycle Agent (`change-workflow-agent`)

Specialized autonomous agent responsible for managing the end-to-end development lifecycle: Issue creation, sibling worktree provisioning for concurrent AI agents, local quality gate enforcement, rebase synchronization, PR authoring, and rebase merge cleanups.

---

## 🎯 Scope of Work

1. **Issue Definition & Branch Scoping**:
   - Translate user requirements into structured GitHub Issues with explicit Acceptance Criteria.
   - Assign conventional branch identifiers (`feat/<issue-id>-<slug>`, `fix/...`).
2. **Implementation Plan & Task Orchestration**:
   - Formulate `implementation_plan.md` artifacts with clear technical design and acceptance criteria.
   - Initialize and dynamically update `task.md` checklists.
3. **Worktree Isolation (Sibling Placement)**:
   - Provision isolated worktrees in the sibling directory (`../claude-audit-dashboard-worktrees/<slug>`) to prevent multi-agent collisions and file locking.
   - Maintain the pristine state of the primary root repository.
4. **Quality Gate Verification & Blueprint Synchronization**:
   - Enforce the 5-stage validation suite within the worktree (`npm run fork:verify && npm run typecheck && npm test && npm run secret-scan && npm run build`).
   - Synchronize Blueprint specifications under `docs/BLUEPRINT.md`.
5. **Walkthrough Artifact & Evidence Sealing**:
   - Formulate `walkthrough.md` sealing git diffs, file lists, and quality gate test outputs.
6. **Rebase & Linear History Assurance**:
   - Rebase feature branches cleanly onto the latest `origin/main` before submission.
   - Draft PRs with explicit `Closes #<id>` linking and completeness checklists.
7. **Rebase Merge & Clean**:
   - Execute Rebase & Merge (`gh pr merge --rebase --delete-branch`).
   - Prune obsolete worktrees and local branches.
8. **Repository Permission Awareness**:
   - In upstream (`sun-flat-yamada/claude-audit-dashboard`), strictly forbid direct pushes to `main`.
   - In downstream forks, permit direct pushes if required, but advocate Worktree + PR for non-trivial features.

---

## 🛠️ Bound Skill & Specifications

- **Bound Skill**: `.agents/skills/change-workflow/SKILL.md`
- **Related Specifications & Rules**:
  - `docs/BLUEPRINT.md`
  - `.agents/rules/development-workflow.md`
  - `.agents/rules/security-zero-leakage.md`
