---
name: change-workflow
description: >
  End-to-end development lifecycle using sibling Git worktrees for concurrent
  AI agents. Covers Issue creation, sibling worktree provisioning, local quality
  gates, rebase synchronization, PR authoring, rebase merge, and workspace cleanup.
---

# Change Workflow Skill

## Lifecycle

```
Issue → Sibling Worktree → Quality Gate → PR → Rebase Merge → Clean
```

## Steps

### 1. Create Issue
Create a GitHub Issue describing the change.

### 2. Provision Worktree
```bash
git worktree add ../claude-audit-dashboard-worktrees/<branch> -b <branch>
cd ../claude-audit-dashboard-worktrees/<branch>
pnpm install
```

### 3. Implement Changes
Make changes in the worktree. Commit with conventional commits.

### 4. Quality Gate
```bash
pnpm run fork:verify
pnpm run typecheck
pnpm test
pnpm run secret-scan
pnpm run build
```

### 5. Create PR
Push branch and create PR referencing the issue.

### 6. Merge & Clean
Rebase merge to main. Remove worktree:
```bash
git worktree remove ../claude-audit-dashboard-worktrees/<branch>
git branch -d <branch>
```
