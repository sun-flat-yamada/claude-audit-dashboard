---
name: change-dev
description: >
  End-to-end development lifecycle for multi-agent work using plan / task /
  walkthrough artifacts and sibling Git worktrees. Covers Issue scoping,
  implementation plan with a user approval gate, sibling worktree provisioning,
  Blueprint sync, the local quality gate, walkthrough evidence sealing, rebase,
  PR authoring, rebase merge, and workspace cleanup.
---

# 🔄 Change Dev & Multi-Agent Worktree Skill (`change-dev`)

Use this skill when proposing, planning, and making code, documentation, or architectural changes to the repository, particularly when several AI agents (Antigravity, Gemini, Claude Code, Cursor, Copilot, …) or parallel tasks operate at the same time.

---

## 🧭 Repository Permission Guard

Before executing changes, identify whether this workspace is:

1. **Upstream Original (`sun-flat-yamada/claude-audit-dashboard`)**:
   - 🚫 **Direct commit/push to `main` is strictly prohibited.**
   - Must use: `Issue -> Implementation Plan -> Sibling Worktree -> Quality Gate -> Walkthrough -> PR -> Rebase & Merge`.
2. **Downstream Fork**:
   - ⚠️ Direct commit/push to `main` / `fork/custom` is **permitted** when operationally needed (e.g. configuration tweaks).
   - For non-trivial feature development or multi-agent collaboration, use this Worktree + PR + Plan workflow.

> [!NOTE]
> Hosted agent sessions (e.g. Claude Code cloud sessions, `CLAUDE_CODE_REMOTE=true`) run in their own isolated container; the container already gives worktree-level isolation, so Phase 3 is satisfied by the session checkout, after the assigned branch is renamed to the change's name (Phase 3). All other phases still apply.

---

## 📐 Artifact Triad (Plan / Task / Walkthrough)

Architectural changes and task executions are governed through three artifacts. They are stored per change under the **original repository root**, never under `<appDataDir>`:

```text
<repo-root>/.devs/changes/yyyy-mm-dd_<ChangeTitle>/
├── implementation_plan.md
├── task.md
└── walkthrough.md
```

- `yyyy-mm-dd`: the date the change was started (local date). `<ChangeTitle>`: short PascalCase/kebab-case title (no spaces or path-unsafe characters).
- A finished copy of every artifact is placed in this directory upon completion and committed with the change so reviewers see the plan and the evidence in the PR.
- Scratch scripts and temporary data stay out of the repository (use the agent's scratch area) and are never committed.
- Artifacts must not contain secrets, PII or machine-specific absolute paths. `pnpm secret-scan` scans `.devs/changes/` (it only matches secret patterns), so check for PII and absolute paths by review. Everything else under `.devs/` is gitignored local scratch.

| Artifact                     | Role                                           | Generation Timing                             | Blocks for user approval |
| :--------------------------- | :--------------------------------------------- | :-------------------------------------------- | :----------------------- |
| **`implementation_plan.md`** | Pre-execution technical blueprint & contract   | Before any code changes / worktree edits      | ✅ Yes (Auto-Pilot off)  |
| **`task.md`**                | Real-time task progress tracking checklist     | Initialized with the plan; updated throughout | ❌ No                    |
| **`walkthrough.md`**         | Post-execution verification & evidence sealing | After the quality gate passes cleanly         | ❌ No                    |

### Where each tool keeps them

| Tool                      | Plan (approval gate)                                                                                                                                                         | Task tracking                                                                                              | Walkthrough                                                                  |
| :------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| **Google Antigravity**    | `.devs/changes/yyyy-mm-dd_<ChangeTitle>/implementation_plan.md` + `ArtifactMetadata` (`RequestFeedback: true`, `UserFacing: true`) — renders the **Proceed** button          | `task.md` in the same directory (`RequestFeedback: false`); finished copy kept there                       | `walkthrough.md` in the same directory (`RequestFeedback: false`)            |
| **Claude Code**           | Plan mode (`ExitPlanMode` approval), or the plan posted in chat and confirmed; the approved plan is saved as `.devs/changes/yyyy-mm-dd_<ChangeTitle>/implementation_plan.md` | Task list (`TaskCreate` / `TaskUpdate`); final `task.md` copy in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` | Final copy in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` + the PR description |
| **Other agents / humans** | Issue comment or draft PR description awaiting reviewer sign-off                                                                                                             | Checklist in the Issue / PR                                                                                | PR description "Verification" section                                        |

> [!IMPORTANT]
>
> - The plan gate is **blocking** when Auto-Pilot is off: do not provision worktrees or edit code until the user approves the plan. With Auto-Pilot on, report the plan and continue (Phase 2).
> - Antigravity only: `ArtifactMetadata` is mandatory when writing the artifact files in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` and **must never** be used when editing other repository files (`packages/`, `docs/`, `.agents/`, …). On Antigravity, a finished copy of every artifact must be placed in this directory even if its own artifact runtime keeps an internal working copy.
> - Artifacts must follow the zero-PII rule (`.agents/rules/security-zero-leakage.md`): no real names, emails, keys or absolute paths revealing a user's home directory.

### A. `implementation_plan.md` structure

```markdown
# <Title: Feature / Refactoring Plan>

<Brief context and intent of the change. Link the Issue (#<id>).>

## User Review Required

> [!IMPORTANT]
> <Critical architectural decisions, breaking changes, or confirmations needed.>

> [!WARNING]
> <Edge cases, dependency updates, migration risks, compliance-rule changes.>

## Proposed Changes

### <Package / Domain Area 1>

#### [NEW] `packages/<pkg>/src/<path>`

- Purpose and key functionality.

#### [MODIFY] `packages/<pkg>/src/<path>`

- Targeted changes and method additions.

#### [DELETE] `packages/<pkg>/src/<path>`

- Rationale for deletion.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- Targeted: `pnpm --filter @claude-audit/<pkg> test -- <test-file>`

### Manual Verification

- Step-by-step checks (e.g. `pnpm demo` + dashboard inspection).
```

### B. `task.md` structure

```markdown
# Task: <Feature Name>

- [x] Phase 1: Issue Definition & Scoping
- [x] Phase 2: Implementation Plan formulated & approved
- [/] Phase 3: Sibling Worktree Provisioning & Implementation
  - [x] Sibling worktree provisioned (`../claude-audit-dashboard-worktrees/feat-...`)
  - [/] Core logic implementation
  - [ ] Vitest test cases
- [ ] Phase 4: Blueprint Sync & Local Quality Gate
- [ ] Phase 5: Walkthrough Generation & Evidence Sealing
- [ ] Phase 6: Rebase onto Base & Create PR
- [ ] Phase 7: Rebase & Merge with `pnpm change-dev:finish` and Worktree Cleanup (auto when `CHG_DEV_AUTO_PILOT=true`)
```

### C. `walkthrough.md` structure

```markdown
# Walkthrough: <Feature Name>

## Summary

<Concise explanation of what was achieved and delivered.>

## Changes Made

### <Package / Domain Area>

- `packages/<pkg>/src/<file>.ts`: Description of modification.

## Verification Results

| Stage                    | Command                          | Result              |
| :----------------------- | :------------------------------- | :------------------ |
| Code-Data Decoupling     | `pnpm fork:verify`               | ✅ Clean (exit 0)   |
| TypeScript Check         | `pnpm typecheck`                 | ✅ Pass (exit 0)    |
| Unit & Integration Tests | `pnpm test`                      | ✅ <n>/<n> pass     |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | ✅ 0 leaks (exit 0) |
| Production Build         | `pnpm build`                     | ✅ Built            |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | ✅ Clean            |
```

---

## 🎫 Work-Unit Issue (one task = one Issue)

Every task that a plan defines (a `task.md` item, a plan table row such as `P1-2`) is registered as **one Issue**, sized for one Pull Request, so a fresh agent session can start from the Issue number alone.

1. **Register**: one Issue per task with `.github/ISSUE_TEMPLATE/work_unit.yml` (Why, What, Done condition, Acceptance Criteria checklist, References and Prerequisites, How to start). Title: `[<task-id>] <imperative title>`.
2. **Group**: one parent (tracking) Issue per phase / epic, titled `[Phase N] <name> — tracking`, with each task Issue attached as a sub-issue. The parent is closed when all children are closed.
3. **Start from an Issue**: on "Resolve Issue #N" the agent reads the Issue and its parent, `AGENTS.md` and every reference; checks the Prerequisites are merged (otherwise stops and reports); creates `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` linking the Issue (Phase 2); follows the lifecycle; opens the PR with `Closes #N`.
4. **One Issue per session**: anything a later session needs (decisions, open questions) goes into the Issue or the plan documents, never only into chat.
5. **Scope discipline**: findings outside the Issue's scope become new Issues, not extra changes in the PR.

---

## 🛠️ The 7-Phase Execution Lifecycle

```text
[Phase 1: Issue Scoping]
   └──> [Phase 2: Implementation Plan & Task (Approval Gate)]
           └──> [Phase 3: Sibling Worktree Provisioning]
                   └──> [Phase 4: Blueprint Sync, Implementation & Quality Gate]
                           └──> [Phase 5: Walkthrough Generation (Sealing)]
                                   └──> [Phase 6: Rebase onto Base & PR Creation]
                                           └──> [Phase 7: Rebase Merge & Workspace Clean]
```

### Phase 1: Issue Definition & Scoping

Create or reference a GitHub Issue with clear intent and Acceptance Criteria:

```bash
gh issue create \
  --title "feat: <Short imperative description>" \
  --body "## 概要 / Overview\n\n## 変更理由 / Why\n\n## 受け入れ基準 / Acceptance Criteria\n- [ ] ..." \
  --label "enhancement"
```

Record the Issue number (e.g. `#42`) and name the branch after the change (`.agents/rules/git-rules-commit.md` §2):

```bash
pnpm change-dev:branch name --issue 42                          # type + title from the Issue → feat/42-cost-center-export
pnpm change-dev:branch name feat 42 "Add cost center export"    # explicit
pnpm change-dev:branch check [branch]                           # validate (default: current branch)
```

`<type>/<issue>-<slug>`: a Conventional Commits type, the Issue number, 2-6 lowercase English words (slug ≤ 40 chars, whole name ≤ 60). Pass `--slug` for a long or non-English title. `change-dev:finish` and the `Branch Name Check` workflow refuse other names (except `main`, `data/audit`, `fork/custom`, `dependabot/**`).

---

### Phase 2: Implementation Plan & Task Orchestration (Pre-Execution Gate)

Before writing any application code or provisioning worktrees:

1. **Formulate `implementation_plan.md`** in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` of the original repository root — proposed file changes, risks, and verification commands (see structure A).
2. **Initialize `task.md`** in the same directory — the phase checklist (see structure B).
3. **Plan Review Gate (branches on `CHG_DEV_AUTO_PILOT`)**: check the mode first with `pnpm change-dev:mode` (off by default in this repository).
   - **Auto-Pilot off (manual)**: wait for the user's sign-off — the Antigravity **Proceed** button (`RequestFeedback: true`), Claude Code plan approval, or the user's / reviewer's reply — before moving to Phase 3.
   - **Auto-Pilot on**: do **not** wait. Commit the plan with the change, report a short summary to the user, and continue to Phase 3; the plan is reviewed again in the PR. Stop and ask only when the plan cannot be executed safely without a decision: a prerequisite is not merged, the Issue's scope is ambiguous, or a step is irreversible or destructive (data deletion, history rewrite, credential changes).
   - On Antigravity with Auto-Pilot on, write `implementation_plan.md` with `RequestFeedback: false` so that the UI does not block.
4. **Plan First (enforced)**: commit `implementation_plan.md` and `task.md` **by themselves, before any implementation file is created or edited**, then run `pnpm change-dev:plan-check`. The check fails when the plan is missing, committed after the first implementation commit, or in the same commit as it. Documentation-only branches are exempt. `change-dev:finish` runs the same check before merging. Writing the plan after the implementation is a defect even if the content is the same: it no longer works as a pre-execution gate.
   - The last items of `task.md` are "create the PR" **and** "merge with `change-dev:finish`" (Auto-Pilot on); the task is not done at PR creation.

---

### Phase 3: Sibling Worktree Provisioning

> [!NOTE]
> **Claude Code cloud session** (`CLAUDE_CODE_REMOTE=true`): skip the worktree. The session already runs in its own isolated VM with a fresh clone; the VM is the isolation unit. Rename the branch the session was given (below), work on it and push only to it.

**Cloud session: rename the assigned branch before the first push.** The platform starts the session on `claude/<adjective>-<name>-<id>` (e.g. `claude/quirky-cray-71fqmx`), which says nothing about the change. Right after Phase 1 (before the plan commit is pushed):

```bash
pnpm change-dev:branch rename --issue 42            # or: rename feat 42 "Add cost center export" / --slug <slug>
git push -u origin feat/42-cost-center-export        # first push; from now on this is the session's branch
```

The helper refuses when the assigned branch already has pushed work of its own, when the new name exists locally or on `origin`, or when the current branch is `main` / a long-lived branch. This is the owner-approved exception to "push only to the assigned branch" (`.agents/rules/instructions-rules-precedence.md` §2); push only to the renamed branch afterwards. The unused assigned branch is not on `origin` in the normal case; if it is, report that it can be deleted (the proxy rejects deletion).

To prevent multi-agent race conditions, file locking, and git index collisions, **never edit directly in the root working tree**. Worktrees are always provisioned in a **sibling directory** (`../claude-audit-dashboard-worktrees/<slug>`), never inside the repository (that would pollute the secret scanner, Vitest and `git status`):

```bash
# Automated via repository helper (scripts/worktree-manage.ts):
pnpm worktree:add feat/42-new-feature
```

_(Manual equivalent)_:

```bash
git fetch origin main
git worktree add ../claude-audit-dashboard-worktrees/feat-42-new-feature -b feat/42-new-feature origin/main
cd ../claude-audit-dashboard-worktrees/feat-42-new-feature
pnpm install --frozen-lockfile
```

---

### Phase 4: Implementation, Blueprint Synchronization & Local Quality Gate

In the isolated worktree directory:

1. Update `docs/BLUEPRINT.md` if behavior or architecture changes. When compliance rules or thresholds change, also sync `README.md` / `README.ja.md` (`.agents/rules/compliance-rules-management.md`).
2. Respect the Clean Architecture boundaries and ESLint limits (`docs/PLUGIN-ARCHITECTURE.md`, `AGENTS.md` rule 9).
3. Implement with atomic [Conventional Commits](https://www.conventionalcommits.org/) (`feat(collector):`, `fix(dashboard):`, `docs:`, `refactor(core):`, `test:`).
4. Update `task.md` continuously.
5. Run the 5-stage quality gate plus the CI-only checks:

   ```bash
   pnpm fork:verify
   pnpm typecheck
   pnpm test
   pnpm secret-scan
   pnpm build
   pnpm lint && pnpm format:check   # also enforced by CI
   ```

   > [!IMPORTANT]
   > All checks must pass with exit code 0. Zero detected secrets or PII. Zero audit data files (`data/snapshots/`, `data/reports/`, `data/*.json`) on the code branch.

---

### Phase 5: Walkthrough Generation & Evidence Sealing

Once all checks pass cleanly:

1. Create `.devs/changes/yyyy-mm-dd_<ChangeTitle>/walkthrough.md` (see structure C) — summary, modified files, and the quality-gate results table.
2. Mark every task as completed (`[x]`) in `task.md`.
3. Place the finished copies of `implementation_plan.md`, `task.md` and `walkthrough.md` in `.devs/changes/` and commit them with the change; run `pnpm secret-scan` first.
4. Reuse the walkthrough as the "Key Changes" / "Verification" body of the PR (`.github/PULL_REQUEST_TEMPLATE.md`).

---

### Phase 6: Rebase onto Base & Create Pull Request

1. Rebase onto the latest base for a clean linear history:

   ```bash
   git fetch origin main
   git rebase origin/main
   ```

   On conflicts: resolve the markers, re-run `pnpm typecheck && pnpm test`, `git add <file>`, `git rebase --continue`. Regenerate `pnpm-lock.yaml` with `pnpm install` rather than hand-merging it.

2. Push the branch:

   ```bash
   git push -u origin feat/42-new-feature                   # first push
   git push --force-with-lease origin feat/42-new-feature   # after a rebase (own branch only)
   ```

3. Before opening the PR run `pnpm change-dev:plan-check` (the plan must precede the implementation). Open the Pull Request following `.github/PULL_REQUEST_TEMPLATE.md`. **Draft or not is decided by `CHG_DEV_AUTO_PILOT`** (`pnpm change-dev:mode`):

   | Mode           | PR state                           | Why                                                         |
   | :------------- | :--------------------------------- | :---------------------------------------------------------- |
   | Auto-Pilot on  | **Ready for review** (not a draft) | A draft cannot be merged; Phase 7 runs right after creation |
   | Auto-Pilot off | **Draft**                          | A person reviews it and marks it ready                      |

   Local (`gh` CLI; add `--draft` when Auto-Pilot is off):

   ```bash
   gh pr create [--draft] \
     --base main \
     --head feat/42-new-feature \
     --title "feat: Add new feature (#42)" \
     --body "## Description\n\nCloses #42\n\n## Verification & Quality Gate\n- [x] Plan approved & walkthrough sealed\n- [x] 5-stage quality gate passed\n- [x] Rebased onto latest base\n- [x] Zero secrets/PII verified"
   ```

   Claude Code cloud session: create it with the built-in GitHub tool (`create_pull_request`, `draft` set from the table). This repository rule decides the draft setting and takes precedence over a generic "create pull requests as drafts" default. If the PR was created as a draft anyway, Phase 7 marks it ready.

   Body: `Closes #42`, summary, and the checklist (plan & walkthrough, 5-stage quality gate, rebased onto base, zero secrets/PII).

---

### Phase 7: Rebase & Merge and Workspace Cleanup

> [!NOTE]
> When Auto-Pilot is enabled (`CHG_DEV_AUTO_PILOT=true`, see below), Phase 7 runs automatically right after Phase 6 without waiting for a manual approval/merge instruction.

1. Merge with **Rebase & Merge** once CI is green. The helper works locally and in Claude Code cloud sessions (REST only):

   ```bash
   pnpm change-dev:finish 42          # ready if draft -> plan/branch checks -> CI -> approve -> rebase merge
   pnpm change-dev:finish 42 --wait   # local: poll CI instead of exiting with 2
   ```

   Manual equivalent (local only; `gh pr` subcommands use GraphQL, which the cloud GitHub proxy rejects): `gh pr checks 42 && gh pr merge 42 --rebase --delete-branch`.

2. Clean up from the primary repository:

   ```bash
   pnpm worktree:clean feat/42-new-feature
   ```

   _(Manual equivalent)_:

   ```bash
   cd ../../claude-audit-dashboard
   git checkout main
   git pull --ff-only origin main
   git worktree remove ../claude-audit-dashboard-worktrees/feat-42-new-feature
   git branch -d feat/42-new-feature
   ```

   Check active worktrees at any time with `pnpm worktree:list` (or `git worktree list`).

---

## 🚀 Auto-Pilot Mode (`CHG_DEV_AUTO_PILOT`)

Opt-in mode that carries a change from **PR creation to Rebase & Merge completion** without manual intervention.

### Activation

| Item             | Value                                                                                                                       |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| Key              | `CHG_DEV_AUTO_PILOT`                                                                                                        |
| Enabled when     | value is `true` (case-insensitive) or `1`                                                                                   |
| Disabled when    | unset or any other value (default: manual)                                                                                  |
| Resolution order | process environment → `.env` → `.env.example` (repository default)                                                          |
| This repository  | **disabled** by default (`CHG_DEV_AUTO_PILOT=false` in `.env.example`); set it in `.env` or the cloud environment to opt in |

### What the mode decides

`pnpm change-dev:mode` prints the resolved value, its source and the branches below (`scripts/change-dev-autopilot.ts`).

| Decision point                           | Auto-Pilot on (`true` / `1`)                                               | Auto-Pilot off (unset or any other value)  |
| :--------------------------------------- | :------------------------------------------------------------------------- | :----------------------------------------- |
| After `implementation_plan.md` (Phase 2) | Report the plan and continue (stop only for the blocking cases in Phase 2) | Wait for **Proceed** / the user's approval |
| PR at creation (Phase 6)                 | Ready for review                                                           | Draft                                      |
| After the PR (Phase 7)                   | Automatic: CI, approval, Rebase & Merge, cleanup                           | Manual                                     |

### Behavior (after Phase 6 PR creation)

1. **Ready**: if the PR is a draft, mark it ready for review.
2. **Wait for CI**: every check run on the PR head must complete. Locally, `pnpm change-dev:finish <id> --wait` polls. In a cloud session do not poll: the PR is subscribed and a `check_suite.completed` event wakes the session; then run `pnpm change-dev:finish <id>` (exit code `2` = still running, wait for the next event).
3. **Self-heal**: if a check fails, fix it, re-run the quality gate, push, and go back to step 2. Never skip or disable tests. Address review comments the same way; do not merge while a review thread waits on the agent.
4. **Approval with the same account**: the agent approves with the account it runs as, also when that account opened the PR. GitHub rejects an approval by the PR author with `422 Can not approve your own pull request` (no repository or branch setting changes this on github.com). The helper treats that response as expected and merges without an approval only when the base branch requires **0** approvals (`required_approving_review_count: 0`). If the branch requires approvals, it stops and reports: only another account can supply them.
5. **Rebase & Merge**: when CI is green and there is no conflict, merge with the `rebase` method at the checked head SHA (`PUT /repos/{owner}/{repo}/pulls/{n}/merge`, `merge_method=rebase`, `sha=<head>`), so a commit pushed after the check is never merged unchecked.
6. **Cleanup**: always delete the merged branch (never `main`). `change-dev:finish` does it right after the merge: `git push origin --delete`, then REST `DELETE git/refs/heads/<branch>`. Locally also remove the worktree (Phase 7 step 2). If the cloud GitHub proxy rejects both, the helper warns instead of failing: report it and have the branch deleted manually, or enable _Automatically delete head branches_ in the repository settings. **Recommended for every repository using this workflow**: with it on, GitHub deletes the head branch at merge itself (also for Rebase & Merge), bypassing the proxy. Check with `gh api repos/{owner}/{repo} --jq .delete_branch_on_merge` (read-only). Never leave an undeleted branch unreported. The VM is discarded with the session.
7. **Next task in the same session**: after the merge, start the next change from the latest base under its own name (`git fetch origin main && git checkout -b <type>/<issue>-<slug> origin/main`); never stack new commits on merged history and never reuse the merged branch's name for a different change.

### Guardrails (never relaxed by Auto-Pilot)

- Never use `--admin`, never bypass branch protection or rulesets, never push to `main` directly.
- Never merge with a failed or still-running check, a merge conflict, or an unanswered review thread.
- Stop and report to the user when: the base branch requires approvals the agent's account cannot give, a rebase conflict is non-trivial, checks stay red after fixes, or a Phase 2 blocking case appears.
- The quality gate (plus `pnpm lint && pnpm format:check`) always runs before the PR, in both modes.

---

## ☁️ Claude Code Cloud Sessions (`CLAUDE_CODE_REMOTE=true`)

**Precedence**: this skill, the agent, and the rules replace the Claude Cloud Session default instructions where they conflict (for example "create PRs as drafts" and "after the PR, subscribe and end the turn"). Apply them without asking and report a conflict only in the final result (`既定指示との競合`). Permission and security boundaries are not overridden. See `.agents/rules/instructions-rules-precedence.md`.

Facts about the cloud environment (Claude Code docs _Configure cloud environments_ and _Use Claude Code in the cloud_) and what this skill does about each:

| Fact                                                                                                                                                                                                                                                                                     | Consequence for change-dev                                                                                                                                                                           |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The session VM sets `CLAUDE_CODE_REMOTE=true`; it is never `true` locally.                                                                                                                                                                                                               | The helper switches to the cloud behavior on it.                                                                                                                                                     |
| GitHub traffic goes through the **GitHub proxy**, which attaches the user's credential server-side. `gh` is pre-installed and REST calls (`gh api repos/{owner}/{repo}/...`) work without `gh auth login`; `gh auth status` reports the placeholder token as invalid, which is expected. | Use REST only. The helper calls `gh api`.                                                                                                                                                            |
| The proxy **rejects GraphQL** (HTTP 403) and names REST fallbacks plus routes for what REST lacks: `POST /repos/{o}/{r}/pulls/{n}/ccr/ready_for_review`, `POST .../ccr/convert_to_draft`, `PUT`/`DELETE .../ccr/auto_merge`, `GET .../ccr/review_threads`.                               | `gh pr view / checks / ready / merge / review` do not work. Ready-for-review uses `ccr/ready_for_review`; the merge uses REST `PUT .../merge`.                                                       |
| The proxy **rejects branch deletion** (git `--delete` and REST `DELETE git/refs`) and non-branch pushes (tags); it does not limit which branch a push updates.                                                                                                                           | The helper still tries to delete the merged branch, and when rejected reports that it must be deleted manually. Push only to the session's branch (the renamed one).                                 |
| The platform names the session branch `claude/<adjective>-<name>-<id>` and pushes there unless the session is told to use another branch.                                                                                                                                                | Rename it to `<type>/<issue>-<slug>` before the first push (`pnpm change-dev:branch rename`, Phase 3).                                                                                               |
| Environment variables come from the cloud environment's settings (`.env` format). `.env` is git-ignored and absent from a fresh clone.                                                                                                                                                   | Resolution stays environment setting, then `.env`, then `.env.example` (`false` here). To turn Auto-Pilot on for cloud sessions, set `CHG_DEV_AUTO_PILOT=true` in the cloud environment's variables. |
| PR events (CI results, reviews, merge) wake a subscribed session.                                                                                                                                                                                                                        | Wait for `check_suite.completed`, then run `change-dev:finish`; do not poll with `sleep`.                                                                                                            |
| PRs and reviews created through the proxy act as the user's GitHub account, so the agent is the PR author.                                                                                                                                                                               | GitHub rejects the approval (Behavior step 4); the merge relies on the base branch requiring 0 approvals.                                                                                            |
| Repository auto-merge (`allow_auto_merge`) may be disabled.                                                                                                                                                                                                                              | The helper merges directly with REST instead of enabling auto-merge, so it works whether or not auto-merge is allowed.                                                                               |

---

## 🔗 Repository References

- **Specifications**: `docs/BLUEPRINT.md`, `docs/PLUGIN-ARCHITECTURE.md`, `CONTRIBUTING.md`
- **Rules (`.agents/rules/`)**: `development-workflow.md`, `git-rules-commit.md`, `instructions-rules-precedence.md`, `quality-rules-gate.md`, `language-rules-output.md`, `naming-rules-general.md`, `security-zero-leakage.md`, `storage-and-data-routing.md`, `compliance-rules-management.md`
- **Agent personas (`.agents/`)**: `change-dev.agent.md`, `fork-sync.agent.md`
- **Antigravity docs** (verify artifact behavior when in doubt): `https://antigravity.google/docs`, `https://antigravity.google/docs/skills`, `https://antigravity.google/docs/rules-workflows`

---

## ✅ Agent Self-Verification Checklist

Before finalizing any task or proposing changes:

1. **Plan gate**: Was the implementation plan committed on its own before any code was written (`pnpm change-dev:plan-check`) and approved by the user (Auto-Pilot off) or reported (Auto-Pilot on)?
2. **Artifact destination**: Are `implementation_plan.md`, `task.md` and `walkthrough.md` in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` under the repository root (not `<appDataDir>`), committed with the change, and free of secrets, PII and absolute paths? On Antigravity, do they carry the right `ArtifactMetadata` (plan `RequestFeedback: true`, others `false`, all `UserFacing: true`) while other repository files carry none?
3. **Isolation**: Were edits made in a sibling worktree (or an isolated session checkout), not the shared root working tree?
4. **Docs sync**: Is `docs/BLUEPRINT.md` (and README rule tables, if compliance rules changed) up to date?
5. **Formatting**: Do alerts use GitHub Alert syntax (`> [!IMPORTANT]`, `> [!WARNING]`, `> [!NOTE]`)? Are file references repository-relative?
6. **Quality gate**: Did all of the following exit `0`?

   ```bash
   pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build
   ```
