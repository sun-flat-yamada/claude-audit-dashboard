# Walkthrough: Branch Name Check workflow

## Summary

Added `.github/workflows/branch-name.yml`, which runs `pnpm change-dev:branch check` on the PR head branch (fork PRs and Dependabot skipped). Rule and skill text now name the workflow.

## Known limitation

The session branch `claude/<adjective>-<name>-<id>` is rejected by design, so the PR for this change fails the new check until the branch is renamed.

## Verification Results

| Stage | Command | Result |
| :-- | :-- | :-- |
| Gate | `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build` | ✅ exit 0 |
| CI extras | `pnpm lint && pnpm format:check` | ✅ clean |
| Check | `pnpm change-dev:branch check feat/1-example` / `claude/admiring-volta-b9zgzi` | ✅ ok / ❌ rejected |
