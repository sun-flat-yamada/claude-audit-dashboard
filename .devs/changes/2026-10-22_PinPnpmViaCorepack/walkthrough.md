# Walkthrough: Pin pnpm via Corepack

## Summary

Every install now runs the same pnpm: `packageManager` pins `pnpm@9.15.4` with its Corepack integrity hash, `.npmrc` makes any other pnpm version refuse to run, CI takes pnpm from `packageManager` and Node from `.nvmrc`, and the setup docs describe `corepack enable` with troubleshooting (#150). The pinned version and the lockfile are unchanged.

## Changes Made

### Toolchain

- `package.json`: `packageManager` `pnpm@9.15.4+sha512.<hash>` (from `corepack use pnpm@9.15.4`); `engines.pnpm` `^9.15.4`.
- `.npmrc` (new): `package-manager-strict-version=true`.
- `.github/actions/setup/action.yml`: `node-version-file: .nvmrc`; comment that `pnpm/action-setup` installs the `packageManager` pin.

### Guard

- `scripts/__tests__/toolchain-pin.test.ts` (new, part of `pnpm test:scripts`): hash format, caret `engines.pnpm`, strict setting, setup action inputs, `.nvmrc` vs `engines.node`, no workflow setting up pnpm / Node on its own.

### Documentation

- `README.md`, `README.ja.md`, `CONTRIBUTING.md`, `docs/SETUP.md` (prerequisites, local runs, three troubleshooting rows), `docs/BLUEPRINT.md` (tech stack, tree), `CHANGELOG.md`.

## Verification Results

| Stage                | Command                                 | Result                                                       |
| :------------------- | :-------------------------------------- | :----------------------------------------------------------- |
| Code-Data Decoupling | `pnpm fork:verify`                      | ✅ Clean (exit 0)                                            |
| TypeScript Check     | `pnpm typecheck`                        | ✅ Pass (exit 0)                                             |
| Tests                | `pnpm test`                             | ✅ Pass (exit 0, incl. 6 new toolchain tests)                |
| Secret Scan          | `pnpm secret-scan`                      | ✅ Clean (exit 0)                                            |
| Build                | `pnpm build`                            | ✅ Pass (exit 0)                                             |
| Lint / Format        | `pnpm lint && pnpm format:check`        | ✅ Pass (exit 0)                                             |
| Strict version       | `npx pnpm@9.15.3 -v` in the repository  | ✅ Refused: "configured to use v9.15.4 of pnpm"              |
| Pinned version       | `pnpm -v` (Corepack)                    | ✅ `9.15.4`                                                  |
