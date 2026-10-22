# Harden Fork-Safety of Live Data Branches

Issue #155 (U1, parent #154). The rule "no live data on `main`" is enforced, but four routes are only covered by documentation: saving live data from a public repository (F1), a fork of a fork copying every branch (F2), deleting or force-pushing the data branch (F3), and the upcoming `data/ledger/` leaking into `main` or an upstream PR (F4/F5). This change adds mechanical guards for F1, F4/F5 and documents the repository-side settings for F2/F3.

## User Review Required

> [!IMPORTANT]
> `data-branch.sh save` refuses to run when the repository is public. When `REPOSITORY_VISIBILITY` is empty **inside GitHub Actions** (`GITHUB_ACTIONS=true`, e.g. a `schedule` event whose payload may carry no `repository` object), the script resolves the visibility with `gh api repos/$GITHUB_REPOSITORY --jq .visibility` (the workflows pass `GH_TOKEN: ${{ github.token }}`) and **fails closed** if it still cannot tell. Outside Actions an unset value means a local run and behaves as before.

> [!WARNING]
> A public fork that relied on saving to `data/audit` stops saving (by design). No data is deleted: the run fails at the save step with `::error::`.

## Proposed Changes

### Data branch script

#### [MODIFY] `.github/scripts/data-branch.sh`

- New `guard_visibility` called first in `save`: `public` → `::error::` + exit 1; `private` / `internal` → continue; empty → local run unless `GITHUB_ACTIONS=true`, then look up via `gh api`, fail closed when unknown; any other value → refuse.

### Workflows

#### [MODIFY] `.github/workflows/{collect-audit,weekly-report,monthly-report,ack-alert}.yml`

- Save step env: `REPOSITORY_VISIBILITY: ${{ github.event.repository.visibility }}` and `GH_TOKEN: ${{ github.token }}`.

### Fork verification

#### [NEW] `scripts/fork-verify-paths.ts`

- `FORBIDDEN_PATHS` (moved from `fork-verify.ts`, plus `data/ledger`) and the pure `findTrackedLiveData(trackedFiles)`.

#### [MODIFY] `scripts/fork-verify.ts`, `.gitignore`

- Use the shared list; ignore `data/ledger/`.

### Tests

#### [NEW] `scripts/__tests__/data-branch-visibility.test.ts`

- `public` / `private` / `internal` / unset (local) cases against a temporary repository with a bare `origin`; Actions with an empty value resolved through a stub `gh` (public refuses, unknown fails closed); every data-writing workflow passes the variable to its save step.

#### [NEW] `scripts/__tests__/fork-verify-paths.test.ts`

- `data/ledger/` files are detected, `.gitkeep` and look-alike paths are not.

### Documentation

- `docs/DEPLOYMENT.md`: new section "Protecting the data branches" (visibility guard, `data/**` ruleset: restrict deletions + block force pushes, fork of a fork: "Copy the `main` branch only").
- `docs/BLUEPRINT.md` §4, `.agents/rules/storage-and-data-routing.md`: the guard, the ruleset and `data/ledger/` in the fork:verify list.
- `CHANGELOG.md` `[Unreleased]`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- Targeted: `pnpm test:scripts`

### Manual Verification

- `REPOSITORY_VISIBILITY=public .github/scripts/data-branch.sh save x` exits non-zero with `::error::`.
- A tracked file under `data/ledger/` makes `pnpm fork:verify` fail.
