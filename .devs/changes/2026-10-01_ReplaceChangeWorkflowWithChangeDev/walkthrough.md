# Walkthrough: Replace change-workflow with change-dev

## Summary
`change-workflow` is now `change-dev`. Plan, task and walkthrough artifacts are stored per change in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` and committed with the change; the rest of `.devs/` is gitignored.

## Changes Made
- `.agents/change-dev.agent.md`, `.agents/skills/change-dev/SKILL.md`, `.agents/rules/development-workflow.md`: renamed and updated for the artifact directory.
- `.gitignore`, `.prettierignore`: `.devs/` handling.
- `AGENTS.md`, `GEMINI.md`, `CONTRIBUTING.md`, `README.md`, `README.ja.md`, `docs/BLUEPRINT.md`, `CHANGELOG.md`, PR template: references and lifecycle.

## Verification Results
See the PR description for the quality-gate results.
