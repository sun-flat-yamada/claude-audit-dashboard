---
title: 'Git Commit & Branch Rules'
description: 'Conventional Commits, branch naming, pre-commit verification and noreply commit identities.'
category: 'rules'
type: 'specification'
status: 'active'
date: 2026-10-03
updated: 2026-10-25
lang: 'en'
tags:
  - 'rules'
  - 'git'
  - 'commits'
  - 'privacy'
alwaysApply: true
---

# Git Commit & Branching Rules (`git-rules-commit`)

## 1. Conventional Commits

```text
<type>(<optional-scope>): <short imperative description>

[optional body: motivation and trade-offs]

[optional footer(s): Closes #123, BREAKING CHANGE: ...]
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

## 2. Branch Naming

A branch is named after the change it carries, so that `git branch -r`, the PR list and the history tell what it is for.

```text
<type>/<issue>-<slug>     e.g. feat/42-cost-center-export, fix/118-overview-section-header
<type>/<slug>             only when there is no Issue (small documentation-only changes)
```

| Part    | Rule                                                                                                                                                         |
| :------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`  | A Conventional Commits type (§1): `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Use the type of the PR title |
| `issue` | The Issue number the PR closes, without `#`                                                                                                                  |
| `slug`  | 2-6 English words that describe the change, lowercase `a-z` / `0-9`, single hyphens, at most 40 characters; no articles, no dates, no agent or session names |
| Total   | At most 60 characters                                                                                                                                        |

- Generate and check the name with the helper instead of typing it: `pnpm change-dev:branch name <type> <issue> "<title>"` (or `name --issue <n>`, which takes the type and title from the Issue) and `pnpm change-dev:branch check [branch]`.
- **Names that do not describe the change are not used for PRs**, in particular the names the Claude Code cloud platform assigns to a session (`claude/<adjective>-<name>-<id>`, `ccr-<hex>-<id>`). A cloud session renames its assigned branch before the first push (`pnpm change-dev:branch rename ...`; see `development-workflow.md` and `instructions-rules-precedence.md` §2).
- Enforcement: `change-dev:finish` stops on a non-conforming head branch, and the `Branch Name Check` workflow (`.github/workflows/branch-name.yml`) fails such a PR. Long-lived and bot branches (`main`, `data/audit`, `fork/custom`, `dependabot/**`) and PRs from forks are exempt.
- Sibling worktrees live at `../<repo>-worktrees/<branch with / replaced by ->` (see `development-workflow.md`).
- Direct commits/pushes to `main` on upstream are forbidden (see `development-workflow.md`).

## 3. Language of Commits and Pull Requests

See [`language-rules-output.md`](language-rules-output.md): commit messages in English, PR titles keep the English Conventional Commits prefix, PR descriptions (filled `.github/PULL_REQUEST_TEMPLATE.md`) in Japanese.

## 4. Pre-Commit Verification

Before committing, run the quality gate defined in [`quality-rules-gate.md`](quality-rules-gate.md). `pnpm secret-scan` is mandatory.

## 5. Commit Identity (noreply e-mail addresses only)

Every commit that can reach upstream `main` (pushes and pull requests, **including PRs from forks**) records **noreply e-mail addresses only**: the author, the committer, every `*-by:` trailer (`Co-Authored-By`, `Signed-off-by`, `Reviewed-by`, ...) and any address in the message text. A personal or corporate address in a public commit is PII that cannot be removed from the history later (`security-zero-leakage.md` §2).

| Allowed address                                                          | Used by                                                  |
| :----------------------------------------------------------------------- | :------------------------------------------------------- |
| `<id>+<login>@users.noreply.github.com` (also `<login>@`, `[bot]` forms) | People and GitHub Apps / bots                            |
| `noreply@github.com`                                                     | GitHub web-flow (web edits, merges made on github.com)   |
| `noreply@anthropic.com`                                                  | Claude Code agents (author and `Co-Authored-By` lines)   |
| `Signed-off-by: dependabot[bot] <support@github.com>` (trailer only)     | Dependabot's automatic sign-off (exact name and address) |

The message text may also mention reserved example domains (`example.com` / `.org` / `.net`, `*.example`). The list is `ALLOWED_EMAILS` / `SERVICE_TRAILERS` in `scripts/commit-email-check.ts`; change it there only.

- **Set up once**: `git config --global user.email "<id>+<login>@users.noreply.github.com"` (the address is shown in GitHub > Settings > Emails), and enable _Keep my email addresses private_ and _Block command line pushes that expose my email_ there.
- **Local hooks** (opt-in): `pnpm hooks:install` sets `core.hooksPath=.githooks`; `commit-msg` refuses a commit with a non-noreply identity or trailer and `pre-push` checks every commit about to be pushed. Check a range by hand with `pnpm commit-email:check [--range <base>..<head>]` (default `origin/main..HEAD`).
- **Enforcement**: the `Commit E-mail Check` workflow (`.github/workflows/commit-email.yml`, job `Commit e-mails are noreply`) checks `base..head` of every pull request (forks included) and every push to `main`. Offending addresses are logged masked (`j***@c***.example`).
- **Fixing a branch**: set the noreply address, then rewrite only your own unmerged commits: `git rebase --exec 'git commit --amend --no-edit --reset-author' origin/main` (author and committer), edit any offending trailer with `git rebase -i origin/main` (`reword`), and `git push --force-with-lease`. The history of `main` is never rewritten for this.
