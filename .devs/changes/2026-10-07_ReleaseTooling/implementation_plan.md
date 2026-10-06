# Implementation plan: release tooling (#122, refs #41)

Scope: items 1, 2 and 4 of "テストを成立させる実装" in #41, which #41 allows before its prerequisites (#46, #42) close. Item 3 (real-tenant release-candidate record) and the 1.0.0 release itself stay with the owner. This PR uses `Refs #41`, never `Closes #41`.

## Proposed changes

1. `scripts/verify-all.ts` (`pnpm verify:all`): the step list is data (`VERIFY_STEPS`); `runVerify(steps, runner)` runs them in order and stops at the first failing step; the real runner spawns `pnpm run <script>` with inherited stdio. Order: fork:verify, typecheck, test, secret-scan, build, lint, format:check, audit:deps, test:e2e. Unit test with a fake runner (order, stop on first failure, exit code, list/dry-run).
2. `scripts/release-integrity.ts`: pure functions over injected file contents: `checkReleaseIntegrity({ versions, changelog, blueprint })`, `checkTagMatchesVersions(tag, versions)`, `extractChangelogSection(changelog, version)`; a small CLI (`pnpm release:check`, `--tag`, `--notes <file>`) reads the files. For versions below 1.0.0 it requires consistent versions and a well-formed CHANGELOG (an `[Unreleased]` section); from 1.0.0 it also requires the dated `## [x.y.z] - yyyy-mm-dd` heading, an empty `[Unreleased]` and BLUEPRINT Status `Stable`.
3. `scripts/__tests__/release-integrity.test.ts` (run by `pnpm test:scripts`): the real repository passes now (0.x); crafted fixtures fail (version mismatch, simulated 1.0.0 with a missing heading, leftover Unreleased items, Draft status); tag comparison and section extraction fixtures; workflow guard tests.
4. `.github/workflows/release.yml`: `v*` tag push; `verify` job (setup action, Chromium, `pnpm verify:all`, tag check, notes extraction as an artifact), then `release` job (`needs: verify`, the only job with `contents: write`) creating the GitHub Release with `gh release create` from the notes. Tag passed via env and validated by a strict regex; no `pull_request_target`; concurrency group per tag, no cancel.
5. CI wiring: existing `ci.yml` jobs and names are untouched (branch protection may require them). They already run the same commands in parallel for speed; `verify:all` is the sequential single-command form used locally, by the release PR author, and in `release.yml`. A guard test asserts that ci.yml still covers every verify step so the two cannot drift.
6. Docs: AGENTS.md rule 5, quality-rules-gate.md, CLAUDE.md `/gate`, BLUEPRINT §18.2, CONTRIBUTING.md, DEPLOYMENT.md (release procedure, TODO pointer to #41 item 3), CHANGELOG `[Unreleased]`.

## Risks

- `verify:all` takes 10+ minutes (it includes the browser suite); documented, `--list` prints the plan without running.
- Release workflow is not run here; it is reviewed through guard tests (permissions, trigger, strict tag regex, ordering).
- Version bumps, BLUEPRINT status, tag and Release are not touched.

## Verification

`pnpm test:scripts`, `pnpm lint`, `pnpm format:check`, `pnpm secret-scan`, `pnpm fork:verify`, then one full `pnpm verify:all` run as evidence.
