---
title: 'Git Commit & Branch Rules'
description: 'Conventional Commits, branch naming and pre-commit verification.'
category: 'rules'
type: 'specification'
status: 'active'
date: 2026-10-03
updated: 2026-10-03
lang: 'en'
tags:
  - 'rules'
  - 'git'
  - 'commits'
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

Commit messages and PR titles use the English Conventional Commits prefix; PR bodies follow `.github/PULL_REQUEST_TEMPLATE.md`.

## 4. Pre-Commit Verification

Before committing, run the quality gate defined in `AGENTS.md` (Core Rule 5). `pnpm secret-scan` is mandatory.
