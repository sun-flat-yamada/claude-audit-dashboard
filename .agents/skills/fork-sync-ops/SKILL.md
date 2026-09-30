---
name: fork-sync-ops
description: Inspect downstream fork status, safely synchronize code updates from upstream (sun-flat-yamada/claude-audit-dashboard), enforce fork-safe storage rules, guard against upstream data leaks, and verify quality gates and deployment health.
---

# 🔄 Fork Synchronization & Maintenance Skill (`fork-sync-ops`)

Use this skill when auditing a downstream fork repository, fetching new releases/features from upstream (`sun-flat-yamada/claude-audit-dashboard`), safely merging changes without data conflicts, or diagnosing synchronization issues.

---

## 🧭 Branch Topology & Synchronization Model

Downstream forks can maintain upstream parity cleanly:

```text
main         = Pure mirror of upstream/main (fast-forward/reset only)
fork/custom  = Optional custom branch for organizational tweaks (merged from main)
```

- **`main`**: synchronized via `git merge upstream/main --ff-only`.
- **Zero Live Data on Code Branches**: All organizational audit snapshots and compliance reports must remain in gitignored paths or dedicated artifact storage.
- **Continuous Health Verification**: run `npm run fork:verify` before and after any sync operations.

---

## 📋 Core Principles to Enforce

1. **Zero Data on Code Branches**: Live audit data in `data/snapshots/` and `data/reports/` must never be committed.
2. **Zero Hardcoded Secrets / PII**: Anthropic Admin/Compliance keys, Slack/Discord webhooks, and corporate emails must only be supplied via GitHub Actions Secrets/Variables.
3. **Graceful Degradation**: Dashboard and scripts must degrade gracefully with friendly empty states if credentials are missing.
4. **Pre-Sync Health Audit**: Run `npm run fork:verify` to check remotes, cleanliness, and build status.

---

## 🛠️ Execution Workflow

### Step 1: Pre-Flight Health Audit

```bash
npm run fork:verify
```

- `Working Tree Cleanliness` warnings → run `git status -s`, stash/commit/clean before proceeding.
- `Code-Data Decoupling` failures → run `git rm -r --cached data/snapshots/ data/reports/` immediately.

### Step 2: Ensure Upstream Remote is Configured

Check existing remotes:

```bash
git remote -v
```

If `upstream` is missing:

```bash
git remote add upstream https://github.com/sun-flat-yamada/claude-audit-dashboard.git
```

### Step 3: Fetch & Sync from Upstream

```bash
git fetch upstream main
git checkout main
git merge upstream/main --ff-only
```

### Step 4: Verify Quality Gates

```bash
npm run fork:verify
npm run typecheck
npm test
npm run secret-scan
npm run build
```
