# Walkthrough: Harden Fork-Safety of Live Data Branches (#155)

## Summary

Live audit data can no longer be saved from a public repository: `data-branch.sh save` checks the repository visibility first and fails with `::error::` for `public` (and for an unknown value). Every data-writing workflow passes the visibility to its save step; inside GitHub Actions an empty value (e.g. a `schedule` payload without `repository`) is resolved with `gh api` and fails closed. The upcoming monthly ledger `data/ledger/` is gitignored and rejected by `pnpm fork:verify`. The repository-side guards that a script cannot enforce (ruleset against deletion / force push of `data/**`, _Copy the `main` branch only_ for a fork of a fork) are documented.

## Changes Made

### Scripts and workflows

- `.github/scripts/data-branch.sh`: `resolve_visibility` / `guard_visibility`, called first in `save`.
- `.github/workflows/{collect-audit,weekly-report,monthly-report,ack-alert}.yml`: save step env `REPOSITORY_VISIBILITY: ${{ github.event.repository.visibility }}`, `GH_TOKEN: ${{ github.token }}`.
- `scripts/fork-verify-paths.ts` (new): `FORBIDDEN_PATHS` (+ `data/ledger`) and `findTrackedLiveData()`; `scripts/fork-verify.ts` uses it.
- `.gitignore`: `data/ledger/`.

### Tests

- `scripts/__tests__/data-branch-visibility.test.ts`: public / private / internal / unset (local) / unknown value against a temporary repository with a bare `origin`; Actions with an empty value through a stub `gh` (public refuses, private saves, unknown fails closed); every data-writing workflow wires the variable.
- `scripts/__tests__/fork-verify-paths.test.ts`: `data/ledger/` detection, `.gitkeep` and look-alike paths, `.gitignore`.

### Documentation

- `docs/DEPLOYMENT.md`: section _Protecting the data branches_ (visibility guard, `data/**` ruleset steps, fork of a fork) and checklist items.
- `docs/BLUEPRINT.md` §4.2 / §4.4, `.agents/rules/storage-and-data-routing.md`: guard, ruleset, `data/ledger/`.
- `CHANGELOG.md` `[Unreleased]`.

## Verification Results

| Stage                    | Command                                                       | Result                                          |
| :----------------------- | :------------------------------------------------------------ | :---------------------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`                                            | ✅ Clean (exit 0)                               |
| TypeScript Check         | `pnpm typecheck`                                              | ✅ Pass (exit 0)                                |
| Unit & Integration Tests | `pnpm test`                                                   | ✅ core 316, collector 323, dashboard 464, scripts 82 pass |
| Zero Secret / PII Scan   | `pnpm secret-scan`                                            | ✅ 0 leaks (exit 0)                             |
| Production Build         | `pnpm build`                                                  | ✅ Built                                        |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check`                              | ✅ Clean                                        |
| Manual: public guard     | `REPOSITORY_VISIBILITY=public data-branch.sh save x`          | ✅ `::error::`, exit 1                          |
| Manual: ledger tracked   | `git add -f data/ledger/2026-01/x.json && pnpm fork:verify`   | ✅ fails (exit 1); file removed afterwards      |
