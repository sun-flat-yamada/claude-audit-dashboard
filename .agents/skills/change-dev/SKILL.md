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
> Hosted agent sessions that are assigned a fixed branch (e.g. Claude Code on the web) work on that branch in their own isolated container; the container already gives worktree-level isolation, so Phase 3 is satisfied by the session checkout. All other phases still apply.

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
| **`implementation_plan.md`** | Pre-execution technical blueprint & contract   | Before any code changes / worktree edits      | ✅ Yes                   |
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
> - The plan gate is **blocking**: do not provision worktrees or edit code until the user approves the plan.
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
- [ ] Phase 7: Rebase & Merge and Worktree Cleanup
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

`<type>/<issue>-<slug>`: a Conventional Commits type, the Issue number, 2-6 lowercase English words (slug ≤ 40 chars, whole name ≤ 60). Pass `--slug` for a long or non-English title. `change-dev:finish` refuses other names (except `main`, `data/audit`, `fork/custom`, `dependabot/**`).

---

### Phase 2: Implementation Plan & Task Orchestration (Pre-Execution Gate)

Before writing any application code or provisioning worktrees:

1. **Formulate `implementation_plan.md`** in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` of the original repository root — proposed file changes, risks, and verification commands (see structure A).
2. **Initialize `task.md`** in the same directory — the phase checklist (see structure B).
3. **Plan first**: commit `implementation_plan.md` and `task.md` on their own **before** any implementation file is touched; verify with `pnpm change-dev:plan-check` (`change-dev:finish` re-checks before merging). Documentation-only branches are exempt.
4. **Await user sign-off** — Antigravity **Proceed** button, Claude Code plan approval, or reviewer confirmation — unless Auto-Pilot is on (below), in which case report the plan and continue, stopping only for a missing prerequisite, an ambiguous scope, or an irreversible / destructive step. Do not move to Phase 3 without sign-off or Auto-Pilot.

---

### Phase 3: Sibling Worktree Provisioning

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

3. Open the Pull Request following `.github/PULL_REQUEST_TEMPLATE.md`. **Draft or not is decided by `CHG_DEV_AUTO_PILOT`** (`pnpm change-dev:mode`): on = ready for review, off = draft (`--draft`):

   ```bash
   gh pr create [--draft] \
     --base main \
     --head feat/42-new-feature \
     --title "feat: Add new feature (#42)" \
     --body "## Description\n\nCloses #42\n\n## Verification & Quality Gate\n- [x] Plan approved & walkthrough sealed\n- [x] 5-stage quality gate passed\n- [x] Rebased onto latest base\n- [x] Zero secrets/PII verified"
   ```

---

### Phase 7: Rebase & Merge and Workspace Cleanup

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

Opt-in mode that carries a change from **PR creation to Rebase & Merge** without manual intervention.

| Item             | Value                                                                                                                       |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| Enabled when     | `true` (case-insensitive) or `1`                                                                                            |
| Resolution order | process environment → `.env` → `.env.example` (repository default)                                                          |
| This repository  | **disabled** by default (`CHG_DEV_AUTO_PILOT=false` in `.env.example`); set it in `.env` or the cloud environment to opt in |

`pnpm change-dev:mode` prints the resolved value, its source and the branches below (`scripts/change-dev-autopilot.ts`).

| Decision point                           | Auto-Pilot on                                              | Auto-Pilot off         |
| :--------------------------------------- | :--------------------------------------------------------- | :--------------------- |
| After `implementation_plan.md` (Phase 2) | Report and continue                                        | Wait for user approval |
| PR at creation (Phase 6)                 | Ready for review                                           | Draft                  |
| After the PR (Phase 7)                   | `change-dev:finish`: CI, approval, Rebase & Merge, cleanup | Manual                 |

Behavior after PR creation: mark ready → wait for CI (cloud: do not poll; the `check_suite.completed` event wakes the session, then rerun `change-dev:finish`; exit code `2` = still running) → self-heal failures (fix, rerun the quality gate, push; never skip tests) → approve with the agent's account (GitHub rejects the author's own approval with 422; the helper then merges only when the base requires 0 approvals) → Rebase & Merge at the checked head SHA → cleanup.

Guardrails (never relaxed): no `--admin`, no bypassing branch protection, no direct push to `main`; never merge with a failed or running check, a conflict or an unanswered review thread; stop and report when required approvals cannot be given, a rebase conflict is non-trivial, or checks stay red after fixes. The quality gate always runs before the PR.

---

## ☁️ Claude Code Cloud Sessions (`CLAUDE_CODE_REMOTE=true`)

- The session checkout replaces the sibling worktree (Phase 3).
- GitHub traffic goes through a proxy that **rejects GraphQL**: use REST (`gh api`, as the helper does); `gh pr view / checks / ready / merge` do not work. Ready-for-review uses `POST .../pulls/{n}/ccr/ready_for_review`.
- The proxy may reject branch deletion: the helper reports a branch it could not delete.
- The platform names the session branch `claude/<adjective>-<name>-<id>`. When the session may choose its branch, rename it before the first push with `pnpm change-dev:branch rename --issue 42` (refused if the branch has pushed work of its own, the new name exists, or it is a long-lived branch; `.agents/rules/instructions-rules-precedence.md` §2). When the session is told to use an assigned branch, keep it and push only there.
- Repository rules take precedence over cloud defaults (`.agents/rules/instructions-rules-precedence.md`); conflicts are reported only in the final reply.

---

## 🔗 Repository References

- **Specifications**: `docs/BLUEPRINT.md`, `docs/PLUGIN-ARCHITECTURE.md`, `CONTRIBUTING.md`
- **Rules (`.agents/rules/`)**: `development-workflow.md`, `git-rules-commit.md`, `instructions-rules-precedence.md`, `security-zero-leakage.md`, `storage-and-data-routing.md`, `compliance-rules-management.md`
- **Agent personas (`.agents/`)**: `change-dev.agent.md`, `fork-sync-agent.md`
- **Antigravity docs** (verify artifact behavior when in doubt): `https://antigravity.google/docs`, `https://antigravity.google/docs/skills`, `https://antigravity.google/docs/rules-workflows`

---

## ✅ Agent Self-Verification Checklist

Before finalizing any task or proposing changes:

1. **Plan gate**: Was the implementation plan approved before any code was written?
2. **Artifact destination**: Are `implementation_plan.md`, `task.md` and `walkthrough.md` in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` under the repository root (not `<appDataDir>`), committed with the change, and free of secrets, PII and absolute paths? On Antigravity, do they carry the right `ArtifactMetadata` (plan `RequestFeedback: true`, others `false`, all `UserFacing: true`) while other repository files carry none?
3. **Isolation**: Were edits made in a sibling worktree (or an isolated session checkout), not the shared root working tree?
4. **Docs sync**: Is `docs/BLUEPRINT.md` (and README rule tables, if compliance rules changed) up to date?
5. **Formatting**: Do alerts use GitHub Alert syntax (`> [!IMPORTANT]`, `> [!WARNING]`, `> [!NOTE]`)? Are file references repository-relative?
6. **Quality gate**: Did all of the following exit `0`?

   ```bash
   pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build
   ```
