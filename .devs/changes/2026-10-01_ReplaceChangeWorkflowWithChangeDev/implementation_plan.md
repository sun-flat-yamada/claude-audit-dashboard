# Replace `change-workflow` with `change-dev`

Adopt `.agents/change-dev.agent.md` from github-copilot-dashboard in place of the `change-workflow` agent, skill and rule, and update everything that refers to them.

## Proposed Changes

### Agent / skill / rule
- [RENAME] `.agents/change-workflow-agent.md` -> `.agents/change-dev.agent.md`
- [RENAME] `.agents/skills/change-workflow/` -> `.agents/skills/change-dev/`
- [MODIFY] `.agents/rules/development-workflow.md`: artifacts live in `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` and are committed.

### Repository plumbing and docs
- [MODIFY] `.gitignore` (track only `.devs/changes/`), `.prettierignore` (`.devs/`)
- [MODIFY] `AGENTS.md`, `GEMINI.md`, `CONTRIBUTING.md`, `README*.md`, `docs/BLUEPRINT.md`, `CHANGELOG.md`, PR template

## Verification Plan
- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build && pnpm lint && pnpm format:check`
- `scripts/secret-scan.ts` already walks dot-directories, so `.devs/changes/` is covered without code changes.
