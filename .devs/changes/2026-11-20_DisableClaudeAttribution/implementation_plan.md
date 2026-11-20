# Disable Claude Attribution in Commits and PRs

Claude Code adds a `Co-Authored-By` / session trailer to commits and a "Generated with Claude Code" line to pull request descriptions by default. This change pins the repository policy in a committed project setting so that no attribution is added, independent of per-session instructions (Issue #200).

## User Review Required

> [!IMPORTANT]
> The setting applies to every Claude Code session that opens this repository (project scope, `.claude/settings.json`). Personal overrides stay possible in `.claude/settings.local.json` (not committed).

> [!WARNING]
> `includeCoAuthoredBy` is a legacy key; it is kept only for older Claude Code versions that do not know `attribution`. No `$schema` line: no JSON file in the repository uses one.

## Proposed Changes

### Agent configuration

#### [NEW] `.claude/settings.json`

- `attribution.commit: ""`, `attribution.pr: ""` and `includeCoAuthoredBy: false`.

### Documentation

#### [MODIFY] `.agents/rules/git-rules-commit.md`

- §5: one line naming the setting; frontmatter `updated: 2026-11-20`.

#### [MODIFY] `CONTRIBUTING.md`

- One sentence in the commit-identity section.

#### [MODIFY] `CHANGELOG.md`

- `[Unreleased]` entry.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- `pnpm commit-email:check`

### Manual Verification

- `git check-ignore .claude/settings.json` reports nothing (the file is tracked).
