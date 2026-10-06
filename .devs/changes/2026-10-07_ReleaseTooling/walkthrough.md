# Walkthrough: release tooling (#122, refs #41)

## Summary

- `pnpm verify:all` (`scripts/verify-all.ts`): ordered step list as data, stops at the first failing step.
- `scripts/release-integrity.ts` + `pnpm release:check`: pure checkers (version consistency, strict rules from 1.0.0, tag comparison, CHANGELOG section extraction).
- `.github/workflows/release.yml`: `v*` tag push, `verify` job then a `release` job (only `contents: write`).
- Docs: AGENTS.md rule 5, quality-rules-gate.md, CLAUDE.md `/gate`, BLUEPRINT 12.1 / 18.2, CONTRIBUTING.md, DEPLOYMENT.md (Releasing, TODO for #41 item 3), CHANGELOG.
- `ci.yml` is unchanged; a guard test keeps it covering every `verify:all` step and keeps the job names.

## Not done (owner)

Version bump, BLUEPRINT `Stable`, tag, GitHub Release, real-tenant release-candidate record (#41 item 3, #29, #38). No tag was pushed and the workflow was not run.

## Quality gate

`pnpm verify:all` ran end to end with exit 0 (fork:verify, typecheck, test, secret-scan, build, lint, format:check, audit:deps, test:e2e: 565 passed, 250 skipped).
