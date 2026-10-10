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
   - **Data source**: tests and E2E use `DASHBOARD_DATA_SOURCE=sample` (committed `data/sample/`), `fixtures` (`pnpm fixture` output, which `pnpm test` regenerates), `empty` (`data/sample-empty/`, from `pnpm demo --profile empty`), `unavailable` (`data/sample-unavailable/`, from `pnpm demo --profile unavailable`), or `optional-sources` (`data/sample-optional-sources/`); never `live` (`fork:verify` enforces). Staging default (`DASHBOARD_DATA_SOURCE` unset) stays: live `data/dashboard.json` if present, else sample.
   - **Selector convention**: find elements by role and accessible name (`getByRole('link', { name: 'Overview' })`, `getByRole('navigation', { name: 'Primary' })`), then by label or visible text. Do not add `data-testid`. If an element cannot be found this way, fix the markup (landmark, label, `aria-current`) instead of the test; this is also what the Playwright and axe suite (item 6) relies on.
   - **Deep links**: screens are hash routes (`#/members`); set `window.location.hash` before `render(<App />)`. Pages hosts the app under `VITE_BASE_PATH`, and only the hash is routed.
   - **Detail files**: load them with `useDetailFile(path, schema)` (loading / missing / error states, injectable `fetch`) and test the missing state, not only the happy path.
6. **E2E and accessibility tests** (`packages/dashboard/e2e`, Playwright + `@axe-core/playwright`; **not** part of `pnpm test`, they need a browser):
   ```bash
   pnpm test:e2e                          # builds, prepares the data profiles, runs everything
   pnpm test:e2e --repeat-each=5          # stability check: must stay green without retries
   pnpm --filter @claude-audit/dashboard test:e2e -g "axe"              # a subset (after the profiles exist)
   pnpm --filter @claude-audit/dashboard test:e2e:report                # open the HTML report
   ```
   - **How it runs**: the root script builds the collector, regenerates `data/fixture/` (`pnpm fixture`) and `data/sample-optional-sources/` (`pnpm demo --profile optional-sources`), then `packages/dashboard/scripts/e2e-prepare.mjs` builds the SPA once with `VITE_BASE_PATH=/claude-audit-dashboard/` (the Pages base path) and assembles one copy per data profile under `packages/dashboard/.e2e/` (gitignored); `scripts/e2e-serve.mjs` serves each with `vite preview`. One Playwright project per profile: `sample`, `fixtures`, `optional-sources`, `optional-unavailable` (no Console key), `unavailable` (detail files answer 404), `empty` (detail files without rows), `stale-detail` and `stale-dashboard` (`schemaVersion` mismatch) and `compare-archived` (the sample whose compare index also lists archived snapshots without a summary, F-015). Specs live in `e2e/shared` (every profile that lists them), `e2e/sample`, `e2e/fixtures`, `e2e/optional-sources`, `e2e/unavailable`, `e2e/empty`, `e2e/stale` and `e2e/compare` (the F-015 compare view; each spec skips the profiles it does not apply to); which folder a project runs is set in `playwright.config.ts`.
   - **No live data**: profiles read only `data/sample`, `data/fixture`, `data/sample-optional-sources`, `data/sample-empty`, and `data/sample-unavailable`; `DASHBOARD_DATA_SOURCE=live` (or any other source) makes the run fail at once, a profile whose `dashboard.json` is not `source: "demo"` is refused, and `fork:verify` rejects specs that name `live` data.
   - **Deterministic**: `reducedMotion: 'reduce'`, `en-US`, `UTC`, no animation in the charts, and any request that leaves the preview server fails the test; no retries (`retries: 0`). Do not add `waitForTimeout`; wait for a role / text with `expect`.
   - **Accessibility**: `e2e/shared/a11y.spec.ts` runs axe with `wcag2a` + `wcag2aa` on every route x light / dark in four profiles and fails on any critical or serious violation (`e2e/compare/a11y.spec.ts` adds the compare view's interactive states: a filter applied, an export done, the focused archived option, at 390px too); the full result is attached to each test (`axe-*.json` in the report). Fix the markup; do not disable a rule. A rule can only be suppressed with a written justification in the PR.
   - **Downloads**: read exports with `page.waitForEvent('download')` and compare the content (`e2e/support/csv.ts`).
   - **Browser**: `pnpm --filter @claude-audit/dashboard exec playwright install --with-deps chromium` once. Cloud sessions with a preinstalled Chromium (`/opt/pw-browsers`) need nothing (never run `playwright install` there): the config falls back to `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` or `/opt/pw-browsers/chromium` when the Playwright-pinned build is absent.
   - **CI and branch protection**: the `E2E and accessibility` job of `.github/workflows/ci.yml` (`needs: quality, test`) runs on every PR and `main` push, caches the browser by Playwright version and uploads the report, traces, screenshots and axe results as the `playwright-e2e-results` artifact when it fails. To make it a required check (repository admin): Settings -> Branches -> branch protection rule for `main` -> _Require status checks to pass before merging_ -> add `E2E and accessibility` (it appears in the list after the job has run once on a PR or on `main`) next to `Lint, types & fork safety`, `Test`, `Dependency audit` and `Build`.
7. **One command for everything**: `pnpm verify:all` runs `fork:verify`, `typecheck`, `test`, `secret-scan`, `build`, `lint`, `format:check`, `audit:deps` and the E2E / axe suite (item 6) in this order and stops at the first failure (10+ minutes; `--list` shows the steps). Use it on a release PR; the release workflow runs the same command. CI keeps its parallel jobs and job names. Release metadata is checked by `pnpm release:check` and, as a unit test over fixtures and the working tree, by `pnpm test` (`pnpm test:scripts`).

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
