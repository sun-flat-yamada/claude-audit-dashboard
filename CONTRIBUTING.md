# Contributing to claude-audit-dashboard

Thank you for your interest in improving **claude-audit-dashboard**! We welcome contributions from both human engineers and autonomous AI agents.

---

## Code of Conduct

All contributors and maintainers are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before participating.

---

## Repository Roles & Direct Push Rules

| Target Repository | Direct Commit/Push to `main` | Enforced Workflow |
| :--- | :--- | :--- |
| **Upstream Original (`sun-flat-yamada`)** | 🚫 **Strictly Forbidden** | **Full enforcement: Issue -> Sibling Worktree -> Quality Gate -> PR -> Rebase Merge** |
| **Downstream Fork** | ⚠️ Permitted for small operational tasks | **Worktree + PR strongly recommended** for multi-agent or feature work |

---

## Development Workflow (Issue -> Worktree -> PR -> Rebase)

To prevent edit collisions, git index locks, and untracked file bleed in multi-agent environments, all work proceeds through **Sibling Git Worktrees**.

### 1. Prerequisites & Initial Setup
- **Node.js**: v22.x+ (Recommended: LTS)
- **pnpm**: v9.x+
- **Git** & **GitHub CLI (`gh`)**

```bash
git clone https://github.com/your-username/claude-audit-dashboard.git
cd claude-audit-dashboard
pnpm install
npm run fork:verify
```

---

### 2. Step-by-Step Change Lifecycle

```text
[1. Issue] ──> [2. Sibling Worktree] ──> [3. Quality Gate] ──> [4. Rebase & PR] ──> [5. Rebase Merge & Clean]
```

#### Step 1: Create or Reference an Issue
All non-trivial changes start with an Issue defining the objective, scope, and Acceptance Criteria:
```bash
gh issue create --title "feat: Add new compliance check rule AK-004" --label "enhancement"
```
Record the assigned Issue number (e.g. `#42`).

#### Step 2: Provision an Isolated Sibling Worktree
Worktrees are provisioned in a sibling directory (`../claude-audit-dashboard-worktrees/<branch>`) so concurrent agents never interfere with each other or the primary root checkout:
```bash
# Automated via helper script:
npm run worktree:add feat/42-api-key-scope

# Or manually:
git fetch origin main
git worktree add ../claude-audit-dashboard-worktrees/feat-42-api-key-scope -b feat/42-api-key-scope origin/main
cd ../claude-audit-dashboard-worktrees/feat-42-api-key-scope
pnpm install
```

#### Step 3: Implement & Run Local Quality Gate
1. **Branch Naming**: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/...`, `refactor/...`.
2. **Conventional Commits**: `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`.
3. **Mandatory 5-Stage Quality Gate** (run inside the worktree):
   ```bash
   npm run fork:verify   # Verify zero data files on code branch
   npm run typecheck     # TypeScript compiler verification
   npm test              # Unit & regression tests
   npm run secret-scan   # Multi-layered secrets & PII audit (Exit 0 mandatory)
   npm run build         # Production monorepo & dashboard build
   ```

#### Step 4: Rebase onto Base & Create PR
1. Rebase onto the latest base to guarantee linear history:
   ```bash
   git fetch origin main
   git rebase origin/main
   git push -u origin feat/42-api-key-scope
   ```
2. Open a Pull Request linking the issue:
   ```bash
   gh pr create \
     --base main \
     --head feat/42-api-key-scope \
     --title "feat: Add new compliance check rule AK-004 (#42)" \
     --body "## Summary\n\nCloses #42"
   ```

#### Step 5: Rebase & Merge
We standardise on **Rebase & Merge** (preserving linear history and ensuring clean `git bisect` / fork sync):
```bash
gh pr merge 42 --rebase --delete-branch
```

#### Step 6: Worktree & Branch Cleanup
Return to the primary repo directory and clean up:
```bash
# Automated:
npm run worktree:clean feat/42-api-key-scope

# Or manually:
cd ../../claude-audit-dashboard
git checkout main && git pull --ff-only origin main
git worktree remove ../claude-audit-dashboard-worktrees/feat-42-api-key-scope
git branch -d feat/42-api-key-scope
```

List active worktrees at any time: `npm run worktree:list`
