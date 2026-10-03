# Import change-dev enhancements from github-copilot-dashboard

Port the newer `change-dev` capabilities of the sibling repository `sun-flat-yamada/github-copilot-dashboard` into this repository, adapted to this repo's pnpm monorepo and Vitest/ESLint setup.

## User Review Required

> [!IMPORTANT]
> The upstream flow renames a cloud session's assigned `claude/<adjective>-<name>-<id>` branch to `<type>/<issue>-<slug>`. This session is bound to its assigned branch, so this change keeps that branch and does **not** ship the `Branch Name Check` workflow (it would fail on this very PR). The branch-name validation lives in `change-dev-branch.ts` and `change-dev:finish`; the workflow can be added once branches are renamed.

> [!WARNING]
> `CHG_DEV_AUTO_PILOT` is added to `.env.example` as `false` here (manual: plan approval, draft PR), unlike upstream where it is `true`, because this repository's `AGENTS.md` requires user approval of the plan and direct merges are not wanted by default.

## Proposed Changes

### Scripts (`scripts/`)

#### [NEW] `scripts/change-dev-branch.ts`
- `name` / `check` / `rename` for `<type>/<issue>-<slug>` branch names.

#### [NEW] `scripts/plan-first-check.ts`
- Verifies `implementation_plan.md` is committed before implementation files.

#### [NEW] `scripts/change-dev-autopilot.ts`
- `mode` (resolve `CHG_DEV_AUTO_PILOT`) and `finish` (ready, CI check, approve, rebase merge) via GitHub REST (`gh api`); typed to satisfy ESLint (no `any`).

#### [NEW] `scripts/__tests__/*.test.ts`
- `node:test` unit tests run with `tsx --test` (no new dependency).

### Rules, skill, agent, templates

#### [MODIFY] `.agents/skills/change-dev/SKILL.md`, `.agents/change-dev.agent.md`, `.agents/rules/development-workflow.md`
- Add Work-Unit Issue, branch naming, plan-first, Auto-Pilot and cloud-session sections (pnpm commands, this repo's names).

#### [NEW] `.agents/rules/instructions-rules-precedence.md`, `.agents/rules/git-rules-commit.md`
- Precedence of repository rules over cloud defaults; commit and branch naming.

#### [NEW] `.github/ISSUE_TEMPLATE/work_unit.yml`
#### [MODIFY] `package.json`, `.env.example`, `AGENTS.md`, `CONTRIBUTING.md`

## Verification Plan

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- `pnpm change-dev:plan-check`, `pnpm change-dev:mode`
