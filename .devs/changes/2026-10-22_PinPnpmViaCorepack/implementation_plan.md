# Pin pnpm via Corepack

Contributors, agents and CI must run the same pnpm (and Node major) so that the lockfile and the build do not depend on whatever is installed globally (#150).

## User Review Required

> [!IMPORTANT]
> `.npmrc` gains `package-manager-strict-version=true`: a pnpm whose version differs from `packageManager` refuses to run in this repository. The fix for a contributor is `corepack enable` (documented).

> [!WARNING]
> The pinned version stays `pnpm@9.15.4` (no upgrade, no lockfile change), so the open Dependabot lockfile PRs are not affected.

## Proposed Changes

### Toolchain

#### [MODIFY] `package.json`

- `packageManager`: `pnpm@9.15.4+sha512.<hash>` (written by `corepack use pnpm@9.15.4`).
- `engines.pnpm`: `>=9.0.0` -> `^9.15.4`.

#### [NEW] `.npmrc`

- `package-manager-strict-version=true`.

#### [MODIFY] `.github/actions/setup/action.yml`

- `actions/setup-node` reads `node-version-file: .nvmrc` instead of a hardcoded `22`; pnpm keeps coming from `packageManager` via `pnpm/action-setup` (no `version:` input).

### Guard

#### [NEW] `scripts/__tests__/toolchain-pin.test.ts`

- `packageManager` is `pnpm@x.y.z+sha512.<128 hex>` and satisfies `engines.pnpm`.
- `.npmrc` enables `package-manager-strict-version`.
- The setup action takes pnpm from `packageManager` and Node from `.nvmrc`; no workflow uses `pnpm/action-setup` / `actions/setup-node` directly or installs pnpm with npm.

### Documentation

#### [MODIFY] `README.md`, `README.ja.md`, `CONTRIBUTING.md`, `docs/SETUP.md`, `docs/BLUEPRINT.md`, `CHANGELOG.md`

- `corepack enable` before `pnpm install`; troubleshooting (old Corepack signature error -> `npm install -g corepack@latest`; Node without bundled Corepack -> `npm install -g corepack`).

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`

### Manual Verification

- `corepack enable && pnpm -v` prints `9.15.4`; `npx pnpm@9.15.3 install` (a different version) fails with the strict-version error.
