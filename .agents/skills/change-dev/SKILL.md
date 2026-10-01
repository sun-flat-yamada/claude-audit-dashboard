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

Record the Issue number (e.g. `#42`) and choose the branch name: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/...`, `refactor/...`.

---

### Phase 2: Implementation Plan & Task Orchestration (Pre-Execution Gate)

Before writing any application code or provisioning worktrees:

1. **Formulate `implementation_plan.md`** in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` of the original repository root — proposed file changes, risks, and verification commands (see structure A).
2. **Initialize `task.md`** in the same directory — the phase checklist (see structure B).
3. **Await user sign-off** — Antigravity **Proceed** button, Claude Code plan approval, or reviewer confirmation. Do not move to Phase 3 without it.

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

3. Open the Pull Request following `.github/PULL_REQUEST_TEMPLATE.md`:

   ```bash
   gh pr create \
     --base main \
     --head feat/42-new-feature \
     --title "feat: Add new feature (#42)" \
     --body "## Description\n\nCloses #42\n\n## Verification & Quality Gate\n- [x] Plan approved & walkthrough sealed\n- [x] 5-stage quality gate passed\n- [x] Rebased onto latest base\n- [x] Zero secrets/PII verified"
   ```

---

### Phase 7: Rebase & Merge and Workspace Cleanup

1. Merge with **Rebase & Merge** once CI is green:

   ```bash
   gh pr checks 42
   gh pr merge 42 --rebase --delete-branch
   ```

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

## 🔗 Repository References

- **Specifications**: `docs/BLUEPRINT.md`, `docs/PLUGIN-ARCHITECTURE.md`, `CONTRIBUTING.md`
- **Rules (`.agents/rules/`)**: `development-workflow.md`, `security-zero-leakage.md`, `storage-and-data-routing.md`, `compliance-rules-management.md`
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
