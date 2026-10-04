# Contributing to claude-audit-dashboard

Thank you for your interest in improving **claude-audit-dashboard**! We welcome contributions from both human engineers and autonomous AI agents.

---

## Code of Conduct

All contributors and maintainers are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before participating.

---

## Repository Roles & Direct Push Rules

| Target Repository                         | Direct Commit/Push to `main`             | Enforced Workflow                                                                     |
| :---------------------------------------- | :--------------------------------------- | :------------------------------------------------------------------------------------ |
| **Upstream Original (`sun-flat-yamada`)** | 🚫 **Strictly Forbidden**                | **Full enforcement: Issue -> Sibling Worktree -> Quality Gate -> PR -> Rebase Merge** |
| **Downstream Fork**                       | ⚠️ Permitted for small operational tasks | **Worktree + PR strongly recommended** for multi-agent or feature work                |

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
[1. Issue] ──> [2. Plan (approval)] ──> [3. Sibling Worktree] ──> [4. Quality Gate] ──> [5. Walkthrough] ──> [6. Rebase & PR] ──> [7. Rebase Merge & Clean]
```

#### Step 1: Create or Reference an Issue

All non-trivial changes start with an Issue defining the objective, scope, and Acceptance Criteria:

```bash
gh issue create --title "feat: Add new compliance check rule AK-004" --label "enhancement"
```

Record the assigned Issue number (e.g. `#42`).

#### Step 2: Write the Implementation Plan and Get Approval

Before touching code, write `implementation_plan.md` (proposed changes, risks, verification plan) and `task.md` in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` at the repository root and wait for the maintainer's approval. When the change is done, add `walkthrough.md` (summary, files, quality-gate results) and commit the finished artifacts with the change. They must contain no secrets, PII or absolute paths; `pnpm secret-scan` covers `.devs/changes/`. See `.agents/skills/change-dev/SKILL.md`.

#### Step 3: Provision an Isolated Sibling Worktree

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

#### Step 4: Implement & Run Local Quality Gate

1. **Branch Naming**: `<type>/<issue>-<slug>` (e.g. `feat/42-cost-center-export`); generate and check with `npm run change-dev:branch -- name --issue 42` / `-- check` (`.agents/rules/git-rules-commit.md`). Commit the implementation plan on its own before any implementation (`npm run change-dev:plan-check`). With `CHG_DEV_AUTO_PILOT=true`, `npm run change-dev:finish -- <pr>` carries a PR through CI and Rebase & Merge.
2. **Conventional Commits**: `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`.
3. **Mandatory 5-Stage Quality Gate** (run inside the worktree):
   ```bash
   npm run fork:verify   # Verify zero data files on code branch
   npm run typecheck     # TypeScript compiler verification
   npm test              # Unit & regression tests
   npm run secret-scan   # Multi-layered secrets & PII audit (Exit 0 mandatory)
   npm run build         # Production monorepo & dashboard build
   ```
4. **Test fixtures from a real tenant** (maintainers with a key only): capture with `pnpm collect --capture-raw <dir outside the repo>`, then `pnpm sanitize <dir> packages/collector/src/adapters/anthropic/__tests__/fixtures/tenant`. Commit only the sanitized files (example.com e-mails, synthetic IDs, `192.0.2.0/24` IPs; `fork:verify` and `secret-scan` check this); never commit or share a raw capture. Procedure: [docs/SETUP.md](docs/SETUP.md#capturing-real-responses-as-test-fixtures-maintainers). `pnpm fixture` (alias `pnpm fixture:tenant`, optional `--out <dir>`, default `data/fixture/`, gitignored) runs collect → check → dashboard on the fixtures without a key.
5. **Dashboard tests** (`packages/dashboard`, Vitest + Testing Library + jsdom, part of `pnpm test`):
   - **Data source**: tests and E2E use `DASHBOARD_DATA_SOURCE=sample` (committed `data/sample/`) or `fixtures` (`pnpm fixture` output, which `pnpm test` regenerates); never `live` (`fork:verify` enforces). Staging default (`DASHBOARD_DATA_SOURCE` unset) stays: live `data/dashboard.json` if present, else sample.
   - **Selector convention**: find elements by role and accessible name (`getByRole('link', { name: 'Overview' })`, `getByRole('navigation', { name: 'Primary' })`), then by label or visible text. Do not add `data-testid`. If an element cannot be found this way, fix the markup (landmark, label, `aria-current`) instead of the test; this is also what Playwright and axe rely on in Phase B5.
   - **Deep links**: screens are hash routes (`#/members`); set `window.location.hash` before `render(<App />)`. Pages hosts the app under `VITE_BASE_PATH`, and only the hash is routed.
   - **Detail files**: load them with `useDetailFile(path, schema)` (loading / missing / error states, injectable `fetch`) and test the missing state, not only the happy path.

#### Step 5: Rebase onto Base & Create PR

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

#### Step 6: Rebase & Merge

We standardise on **Rebase & Merge** (preserving linear history and ensuring clean `git bisect` / fork sync):

```bash
gh pr merge 42 --rebase --delete-branch
```

#### Step 7: Worktree & Branch Cleanup

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
