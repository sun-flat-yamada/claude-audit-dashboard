# Walkthrough: Import change-dev enhancements

## Summary

Ported the newer `change-dev` capabilities from `sun-flat-yamada/github-copilot-dashboard` (branch naming, plan-first gate, Auto-Pilot `finish`, Work-Unit Issues, instruction precedence), adapted to the pnpm monorepo.

## Changes Made

- `scripts/change-dev-branch.ts`, `scripts/plan-first-check.ts`, `scripts/change-dev-autopilot.ts`: new helpers (typed REST responses, `data/audit` exempt branch); wired as `pnpm change-dev:{branch,plan-check,mode,finish}`.
- `scripts/__tests__/`: 23 `node:test` tests via `pnpm test:scripts`, chained into `pnpm test`.
- `.agents/`: skill, agent and `development-workflow.md` updated; new `git-rules-commit.md` and `instructions-rules-precedence.md`.
- `.github/ISSUE_TEMPLATE/work_unit.yml`, `.env.example` (`CHG_DEV_AUTO_PILOT=false`), `AGENTS.md`, `CONTRIBUTING.md`.

## Deliberately not imported

- `Branch Name Check` workflow: this session is bound to its assigned `claude/...` branch, so it would fail this PR.
- Auto-Pilot default is off (upstream: on).

## Verification Results

| Stage | Command | Result |
| :-- | :-- | :-- |
| Gate | `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build` | ✅ exit 0 |
| CI extras | `pnpm lint && pnpm format:check` | ✅ clean |
| Script tests | `pnpm test:scripts` | ✅ 23/23 |
