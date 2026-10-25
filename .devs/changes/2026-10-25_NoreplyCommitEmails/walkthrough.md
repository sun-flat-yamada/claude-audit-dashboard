# Walkthrough: Enforce noreply commit e-mails

## Summary

Commits that can reach upstream `main` (pushes and pull requests, fork PRs included) are now checked for non-noreply e-mail addresses in the author, the committer, every `*-by:` trailer and the message text (#179). The existing history of `main` passes (247 commits); nothing was rewritten.

## Changes Made

### Checker and hooks

- `scripts/commit-email-check.ts`: one allowlist (`ALLOWED_EMAILS`: `*@users.noreply.github.com`, `noreply@github.com`, `noreply@anthropic.com`; `SERVICE_TRAILERS`: Dependabot's sign-off only), masked reporting (`j***@c***.example`), `--range`, git log passthrough (`-- <revisions>`) and `--message-file` (commit-msg) modes.
- `scripts/__tests__/commit-email-check.test.ts`: allowlist, masking, trailers, Dependabot scoping, message text, parsing, a temp-repository run of the CLI and both hooks, and the workflow wiring.
- `.githooks/commit-msg`, `.githooks/pre-push`; `package.json` scripts `commit-email:check` and `hooks:install`.

### CI

- `.github/workflows/commit-email.yml` (job `Commit e-mails are noreply`): `pull_request` (forks included) and `push` to `main`, `fetch-depth: 0`, `base..head` / `before..after`, SHAs through the environment, `contents: read`.

### Docs

- `.agents/rules/git-rules-commit.md` §5 _Commit Identity_, `CONTRIBUTING.md` (_Commit identity_, required checks), `AGENTS.md` rule 10, `CLAUDE.md`, `docs/BLUEPRINT.md` 12.1, `CHANGELOG.md`.

## Verification Results

| Stage                    | Command                                     | Result                                                 |
| :----------------------- | :------------------------------------------ | :----------------------------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`                          | ✅ Clean (exit 0)                                      |
| TypeScript Check         | `pnpm typecheck`                            | ✅ Pass (exit 0)                                       |
| Unit & Integration Tests | `pnpm test`                                 | ✅ core 404, dashboard 464, collector 435, scripts 132 |
| Zero Secret / PII Scan   | `pnpm secret-scan`                          | ✅ 0 leaks (exit 0)                                    |
| Production Build         | `pnpm build`                                | ✅ Built                                               |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check`            | ✅ Clean                                               |
| History of `main`        | `pnpm commit-email:check -- origin/main`    | ✅ 247 commits, noreply only                           |
