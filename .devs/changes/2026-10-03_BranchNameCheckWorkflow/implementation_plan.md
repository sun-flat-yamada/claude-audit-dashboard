# Add the Branch Name Check workflow

Follow-up to the change-dev import: add the CI check that fails a pull request whose head branch does not follow `<type>/<issue>-<slug>`.

## User Review Required

> [!WARNING]
> This session is bound to its assigned `claude/<adjective>-<name>-<id>` branch, which the check rejects by design. The PR for this change will therefore fail the new check until the branch is renamed or the check is exempted.

## Proposed Changes

#### [NEW] `.github/workflows/branch-name.yml`

- On `pull_request` (opened, reopened, synchronize, edited), run `pnpm change-dev:branch check "$HEAD_REF"` using the repository's setup action.
- Skip fork PRs and Dependabot (they keep their own naming).

#### [MODIFY] `.agents/rules/git-rules-commit.md`, `.agents/skills/change-dev/SKILL.md`

- Replace the "workflow can run this" hint with the workflow's name.

## Verification Plan

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- `pnpm change-dev:branch check feat/1-example` passes; the `claude/...` name fails.
