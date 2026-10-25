# Enforce noreply commit e-mails

Every commit that can reach upstream `main` (pushes and pull requests, including PRs from forks) must record noreply e-mail addresses only: the author, the committer and every `*-by:` trailer (`Co-Authored-By`, `Signed-off-by`, ...). A personal or corporate address in a public commit is PII that cannot be removed from the history later (`.agents/rules/security-zero-leakage.md` §2). Issue: #179.

The current history of `main` is clean (authors / committers: the owner's `<id>+<login>@users.noreply.github.com`, `noreply@anthropic.com`, `dependabot[bot]`'s noreply address; trailers: `noreply@anthropic.com`, Copilot's noreply address and Dependabot's `Signed-off-by: dependabot[bot] <support@github.com>`). **No history is rewritten.**

## User Review Required

> [!IMPORTANT]
>
> - Allowed addresses (one list, `ALLOWED_EMAILS` in `scripts/commit-email-check.ts`): `*@users.noreply.github.com` (incl. `<id>+<login>@` and bot forms), `noreply@github.com` (GitHub web-flow / merges) and `noreply@anthropic.com` (Claude Code agents).
> - One narrow service exception: the trailer `Signed-off-by: dependabot[bot] <support@github.com>` that Dependabot adds to every commit (a GitHub role address, not a person; it is already in the history and cannot be configured away). It is accepted only with that exact name and only as a trailer.
> - Addresses in the free text of the message body are also checked; besides the allowed list, reserved example domains (`example.com` / `.org` / `.net`, `*.example`, RFC 2606) are accepted there.
> - The local hooks are opt-in (`pnpm hooks:install` sets `core.hooksPath=.githooks`); nothing changes a contributor's git configuration automatically.

> [!WARNING]
>
> - The new required check must be added to the branch protection / ruleset of `main` by the owner (check name `Commit e-mails are noreply`).
> - Contributors whose existing branch carries a non-noreply address must rewrite their own branch (documented with `git rebase --exec 'git commit --amend --no-edit --reset-author'`).

## Proposed Changes

### Checker

#### [NEW] `scripts/commit-email-check.ts`

- Pure functions: `isAllowedEmail`, `maskEmail` (e.g. `j***@e***.com`; offending addresses are never printed in full), `parseTrailers`, `findEmailIssues(commit)`, `parseGitLog` (unit / record separators).
- CLI `pnpm commit-email:check [--range <base>..<head>] [-- <git log revision args>]` (default `origin/main..HEAD`): reports `<sha7> <field>: <masked> is not a noreply address` and exits 1.
- `--message-file <file>` (commit-msg hook): checks `git var GIT_AUTHOR_IDENT` / `GIT_COMMITTER_IDENT` and the message.

#### [NEW] `scripts/__tests__/commit-email-check.test.ts`

- Allowed / refused addresses, masking, trailer parsing, Dependabot exception scoping, body scan, git log parsing, a temp-repo integration run, and workflow wiring (`commit-email.yml` fetches the full history and checks base..head).

### CI and hooks

#### [NEW] `.github/workflows/commit-email.yml`

- `pull_request` (also from forks, read-only token) and `push` to `main`; `fetch-depth: 0`; checks `base.sha..head.sha` (PR) or `before..after` (push; a new or unreachable `before` checks `after` alone). SHAs pass through the environment.

#### [NEW] `.githooks/commit-msg`, `.githooks/pre-push`

- `commit-msg`: refuses a commit whose author / committer identity or message trailers are not noreply.
- `pre-push`: checks every commit about to be pushed (also those made by rebase / cherry-pick, which skip `commit-msg`).

#### [MODIFY] `package.json`

- Scripts `commit-email:check` and `hooks:install`.

### Docs

#### [MODIFY] `CONTRIBUTING.md`, `.agents/rules/git-rules-commit.md` (new §5 Commit identity, `updated` bumped), `AGENTS.md` (rule 10), `CLAUDE.md` (directive), `docs/BLUEPRINT.md` (CI list, if present), `CHANGELOG.md` `[Unreleased]`

- How to set `git config user.email <id>+<login>@users.noreply.github.com`, GitHub's _Keep my email addresses private_ and _Block command line pushes that expose my email_, enabling the hooks, and how to fix offending commits.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- `pnpm commit-email:check --range <root>..origin/main` over the whole `main` history passes.

### Manual Verification

- A temp repository with a non-noreply author is refused by the checker and both hooks, with the address masked.
