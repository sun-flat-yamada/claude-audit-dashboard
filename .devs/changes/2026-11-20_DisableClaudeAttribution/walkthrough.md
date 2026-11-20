# Walkthrough: Disable Claude Attribution in Commits and PRs

## Summary

A committed project setting `.claude/settings.json` stops Claude Code from adding attribution: `attribution.commit` and `attribution.pr` are empty strings, and the legacy `includeCoAuthoredBy: false` covers older Claude Code versions. Commits carry no `Co-Authored-By` / session trailer and pull request descriptions no "Generated with Claude Code" line (Issue #200).

## Changes Made

### Agent configuration

- `.claude/settings.json` (new): the attribution setting. No `$schema` line, as no JSON file in the repository uses one.
- `.gitignore`: ignores the personal `.claude/settings.local.json`; the project `.claude/settings.json` stays tracked.

### Documentation

- `.agents/rules/git-rules-commit.md` §5: new bullet _No Claude attribution_; frontmatter `updated: 2026-11-20`.
- `CONTRIBUTING.md`: one paragraph in _Commit identity_.
- `CHANGELOG.md`: `[Unreleased]` entry.

## Verification Results

| Stage                    | Command                          | Result              |
| :----------------------- | :------------------------------- | :------------------ |
| Code-Data Decoupling     | `pnpm fork:verify`               | ✅ Clean (exit 0)   |
| TypeScript Check         | `pnpm typecheck`                 | ✅ Pass (exit 0)    |
| Unit & Integration Tests | `pnpm test`                      | ✅ Pass (exit 0)    |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | ✅ 0 leaks (exit 0) |
| Production Build         | `pnpm build`                     | ✅ Built            |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | ✅ Clean            |
| Plan first               | `pnpm change-dev:plan-check`     | ✅ Pass             |
| Commit identity          | `pnpm commit-email:check`        | ✅ noreply only     |
| Not ignored              | `git check-ignore .claude/settings.json` | ✅ Not ignored (exit 1) |
