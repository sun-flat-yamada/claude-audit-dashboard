---
title: 'Development Workflow & Worktree Policy'
description: 'Issue to plan to sibling worktree to quality gate to PR to rebase merge lifecycle, direct-push permissions and Auto-Pilot behavior.'
category: 'rules'
type: 'specification'
status: 'active'
date: 2026-09-30
updated: 2026-10-05
lang: 'en'
tags:
  - 'rules'
  - 'workflow'
  - 'git'
alwaysApply: true
---

# 🔄 Development Workflow & Multi-Agent Worktree Policy (`.agents/rules/development-workflow.md`)

All AI agents (Antigravity, Gemini, Claude Code, Cursor, Copilot, etc.) operating in this repository **MUST** adhere to this development lifecycle rule when making changes. The step-by-step procedure lives in the `change-dev` skill (`.agents/change-dev.agent.md`) (`.agents/skills/change-dev/SKILL.md`).

---

## 1. Direct Commit & Push Permissions by Repository Context

1. **Original Upstream Repository (`sun-flat-yamada/claude-audit-dashboard`)**:
   - **NO DIRECT COMMITS OR PUSHES TO `main`**: Autonomous AI agents must **NEVER** push directly to `main`.
   - All changes must strictly follow the **Issue -> Plan -> Sibling Worktree -> Local Quality Gate -> Pull Request -> Rebase & Merge** lifecycle.
2. **Downstream Fork Repositories**:
   - Direct commits and pushes to `main` or `fork/custom` are **permitted** when operationally required (e.g., small configuration tweaks, emergency fixes).
   - For non-trivial feature development or when multiple agents run concurrently, the Worktree + PR process is **strongly recommended**.

---

## 2. Multi-Agent Isolation: Sibling Git Worktree Rule

1. **Never Contaminate the Primary Working Tree**:
   - Do NOT edit files or run long-running build commands directly in the root working tree when other agents may be active.
   - Doing so causes git index locks, untracked file bleed, and destructive edit collisions between agents.
2. **Sibling Directory Placement**:
   - Worktrees must be placed at the **same hierarchy level as the repository** (sibling directory), NOT inside the repository tree:
     ```text
     ../claude-audit-dashboard-worktrees/<branch-slug>
     ```
   - Placing worktrees inside the repository root risks polluting secret scanners, Vitest runners, and `git status`.
   - Helper: `pnpm worktree:add <branch>`, `pnpm worktree:list`, `pnpm worktree:clean <branch>` (`scripts/worktree-manage.ts`).
3. **Isolated Hosted Sessions**: An agent running in its own container (e.g. a Claude Code cloud session, `CLAUDE_CODE_REMOTE=true`) is already isolated; it skips Step 3 (the session VM is the isolation unit) and uses REST only (the cloud GitHub proxy rejects GraphQL). Before the first push it renames the assigned branch (`claude/<adjective>-<name>-<id>`) to the change's name with `pnpm change-dev:branch rename <type> <issue> "<title>"` (or `rename --issue <id>`) and pushes only to that branch (`.agents/rules/git-rules-commit.md` §2, `.agents/rules/instructions-rules-precedence.md` §2).

---

## 3. The End-to-End Change Lifecycle

```text
[1: Issue] ──> [2: Plan (approval gate)] ──> [3: Sibling Worktree] ──> [4: Quality Gate & Blueprint] ──> [5: Walkthrough Evidence] ──> [6: PR (Rebased)] ──> [7: Rebase Merge & Clean]
```

### Step 1: Issue Creation

- Every non-trivial change must correspond to an Issue specifying **Why**, **What**, and **Acceptance Criteria**.
- Create via GitHub Web or `gh issue create`. Record the Issue number (`#<id>`).
- Each plan task is one **Work-Unit Issue** (`.github/ISSUE_TEMPLATE/work_unit.yml`, one PR each) under a per-phase tracking Issue; "Resolve Issue #N" starts a session from the Issue (skill section _Work-Unit Issue_).
- Name the branch with `pnpm change-dev:branch name --issue <id>` (§4).

### Step 2: Implementation Plan & Task Orchestration (Pre-Execution Gate)

- Before provisioning worktrees or modifying code, formulate an `implementation_plan.md` (proposed changes, risks, verification plan) and a `task.md` checklist in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` under the original repository root (never under `<appDataDir>`).
- Antigravity: write them with `ArtifactMetadata` (`RequestFeedback: true` for the plan, `false` for the task list; `UserFacing: true`). Claude Code: use plan mode and the task list. Others: Issue comment / draft PR.
- The last items of `task.md` are the PR **and** the merge (`change-dev:finish`), not the PR alone.
- **Plan First (enforced)**: commit the plan and task list on their own **before any implementation file is touched**. Run `pnpm change-dev:plan-check`: it fails when the plan is missing, committed after the first implementation commit, or in the same commit. Documentation-only branches are exempt. `change-dev:finish` runs the same check before merging and stops on failure.
- Plan review branches on `CHG_DEV_AUTO_PILOT` (`pnpm change-dev:mode`; **off** by default in this repository, `CHG_DEV_AUTO_PILOT=false` in `.env.example`):
  - **Off**: await user approval (Antigravity **Proceed** button, Claude Code plan approval, or the user's reply) before proceeding to worktree provisioning.
  - **On**: do not wait (`RequestFeedback: false` on Antigravity). Commit the plan, report a summary, and continue; the plan is reviewed again in the PR. Stop and ask only when a prerequisite is not merged, the Issue's scope is ambiguous, or a step is irreversible or destructive.
- Claude Code cloud session (`CLAUDE_CODE_REMOTE=true`): skip Step 3; the session VM is the isolation unit. Before the first push, rename the assigned branch (`claude/<adjective>-<name>-<id>`) with `pnpm change-dev:branch rename <type> <issue> "<title>"` and push only to that branch (`.agents/rules/git-rules-commit.md` §2, `.agents/rules/instructions-rules-precedence.md` §2).
- **Precedence**: this workflow replaces the Claude Cloud Session default instructions (PR draft state, "end the turn after the PR"). Apply it without asking and report a conflict only in the final result; see `.agents/rules/instructions-rules-precedence.md`.

### Step 3: Sibling Worktree Provisioning

Branch name: `<type>/<issue>-<slug>` (`.agents/rules/git-rules-commit.md` §2); get it with `pnpm change-dev:branch name --issue <id>`.

```bash
pnpm worktree:add feat/<id>-<slug>
# or manually:
git fetch origin main
git worktree add ../claude-audit-dashboard-worktrees/feat-<id>-<slug> -b feat/<id>-<slug> origin/main
cd ../claude-audit-dashboard-worktrees/feat-<id>-<slug> && pnpm install --frozen-lockfile
```

### Step 4: Implementation & Local Quality Gate

- Keep `docs/BLUEPRINT.md` in sync when architecture or behavior changes (and the README rule tables when compliance rules change — `.agents/rules/compliance-rules-management.md`).
- Atomic Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`).
- Update `task.md` continuously.
- Run the 5 mandatory checks within the worktree (CI also runs `pnpm lint`, `pnpm format:check`, `pnpm audit:deps`):

  ```bash
  pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build
  ```

  _(All checks must exit 0 cleanly with ZERO detected secrets or PII.)_

### Step 5: Walkthrough Generation & Evidence Sealing

- Generate `.devs/changes/yyyy-mm-dd_<ChangeTitle>/walkthrough.md` (Antigravity: `RequestFeedback: false`, `UserFacing: true`) sealing the change summary, modified files, and the quality-gate results. Reuse it as the PR body.
- On Google Antigravity, place a finished copy of all artifacts in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` upon completion and commit them with the change (run `pnpm secret-scan` first; `.devs/changes/` is scanned, the rest of `.devs/` is local-only and gitignored).

### Step 6: Rebase onto Base & Pull Request

```bash
git fetch origin main
git rebase origin/main
git push -u origin feat/<id>-<slug>   # (or --force-with-lease after a rebase of your own branch)
gh pr create --base main --head feat/<id>-<slug> --title "feat: ... (#<id>)" --body "... Closes #<id>"
```

Follow `.github/PULL_REQUEST_TEMPLATE.md`. Run `pnpm change-dev:plan-check` first. The PR is **ready for review when `CHG_DEV_AUTO_PILOT` is on and a draft (`--draft`) when it is off**. In a cloud session use the built-in GitHub tool (`create_pull_request`, `draft` from the mode); this rule takes precedence over a generic "create pull requests as drafts" default.

### Step 7: Rebase Merge & Pruning

- **Auto-Pilot (`CHG_DEV_AUTO_PILOT=true`)**: creating the PR is not the end of the task. Run `pnpm change-dev:finish <pr>` right after PR creation (REST only; works locally and in cloud sessions; exit code 2 means CI is still running, so wait for the PR event and run it again): ready for review → CI → fix failures → approve with the agent's account (GitHub returns 422 for the PR author; then the merge proceeds only if the base requires 0 approvals) → rebase merge at the checked head SHA → delete the merged branch (reported if the cloud proxy rejects it) → prune. Never use `--admin` or bypass branch protection; never merge with failed/running checks, conflicts or unanswered review threads; stop and report if required approvals cannot be given. Details: the `change-dev` skill (_Auto-Pilot Mode_).
- **Recommended repository setting**: enable _Automatically delete head branches_ (`delete_branch_on_merge: true`) so GitHub deletes the merged branch itself; the cloud GitHub proxy rejects branch deletion from a session.
- Commands (the manual `gh pr merge` equivalent is local only: `gh pr` subcommands use GraphQL, which cloud sessions reject):

```bash
pnpm change-dev:finish <pr>      # Auto-Pilot: ready -> plan/branch checks -> CI -> approve -> rebase merge (exit 2 = CI running)
# manual local equivalent: gh pr merge <pr> --rebase --delete-branch
pnpm worktree:clean feat/<id>-<slug>
# or manually:
cd ../../claude-audit-dashboard
git checkout main && git pull --ff-only origin main
git worktree remove ../claude-audit-dashboard-worktrees/feat-<id>-<slug>
git branch -d feat/<id>-<slug>
```

---

## 4. Branch Naming

Details and enforcement: `.agents/rules/git-rules-commit.md` §2. Cloud sessions: `.agents/rules/instructions-rules-precedence.md`.

- `feat/<issue>-<slug>` — New features
- `fix/<issue>-<slug>` — Bug fixes
- `docs/<slug>` — Documentation
- `refactor/<slug>`, `chore/<slug>` — Refactoring / maintenance

## 5. Commit Convention

[Conventional Commits](https://www.conventionalcommits.org/). Scopes: `core`, `collector`, `dashboard`, `ci`, `notify`, `billing`, `plugin`, `docs`.

---

## 6. Absolute Guardrails

- **Data Isolation**: Never commit audit data (`data/snapshots/`, `data/reports/`, `data/state.json`, `data/dashboard.json`, `packages/dashboard/public/data/`) on any code branch or worktree (`.agents/rules/storage-and-data-routing.md`).
- **Secret Zero Leakage**: Never bypass `pnpm secret-scan` (`.agents/rules/security-zero-leakage.md`).
- **Artifact Hygiene**: Artifacts under `.devs/changes/` are committed, so they must contain no secrets, PII or machine-specific absolute paths. Scratch files are never committed.
