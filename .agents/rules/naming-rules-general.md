---
title: 'Naming Rules'
description: 'File and directory naming conventions for agents, rules, skills and change artifacts.'
category: 'rules'
type: 'specification'
status: 'active'
date: 2026-10-05
updated: 2026-10-05
lang: 'en'
tags:
  - 'rules'
  - 'naming-conventions'
alwaysApply: true
---

# File & Directory Naming Rules (`naming-rules-general`)

1. **Agent definitions** (`.agents/*.agent.md`): MUST end with `.agent.md`; MUST NEVER use an `agent-` prefix or an `-agent` suffix before the extension. Lowercase kebab-case name (e.g. `change-dev.agent.md`, `fork-sync.agent.md`).
2. **Rules** (`.agents/rules/`): lowercase kebab-case `.md`. New rules should follow `<category>-rules-<scope>.md` (e.g. `git-rules-commit.md`). Legacy files (`development-workflow.md`, `security-zero-leakage.md`, `storage-and-data-routing.md`) keep their names to avoid breaking references; `compliance-rules-management.md` already follows the pattern.
3. **Skills** (`.agents/skills/<name>/SKILL.md`): lowercase kebab-case directory with a `SKILL.md` entrypoint.
4. **Change artifacts**: `.devs/changes/yyyy-mm-dd_<ChangeTitle>/` (`<ChangeTitle>` in PascalCase) holding `implementation_plan.md`, `task.md` and `walkthrough.md` (see the `change-dev` skill).
5. **Branches**: see [`git-rules-commit.md`](git-rules-commit.md) §2.

## Frontmatter Convention

Every Markdown file under `.agents/rules/` and the root agent instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) carries YAML frontmatter. Values use single quotes (Prettier `singleQuote`):

```yaml
---
title: '...'
description: '...'
category: 'rules' # rules | meta
type: 'specification' # specification | configuration
status: 'active'
date: YYYY-MM-DD
updated: YYYY-MM-DD # bump on every substantive edit
lang: 'en'
tags:
  - '...'
alwaysApply: true # rules only
---
```
