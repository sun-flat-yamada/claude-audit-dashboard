# Adopt CLAUDE.md and split agent rules

Closes #77. Ports the agent-instruction layout of the sibling repository (a `CLAUDE.md` entrypoint, one rule file per concern under `.agents/rules/`, YAML frontmatter, `*.agent.md` naming) to this pnpm monorepo, adapted to its facts (data branch `data/audit`, `docs/BLUEPRINT.md` instead of SDD specs, compliance rules, `.devs/changes/`, `CHG_DEV_AUTO_PILOT=false` by default).

## User Review Required

> [!IMPORTANT]
> Documentation and agent-configuration only; no code, contract or data change. Agent definitions are renamed from `<name>-agent.md` to `<name>.agent.md` (`git mv`, history kept).

> [!WARNING]
> `development-workflow.md`, `instructions-rules-precedence.md`, `.agents/change-dev.agent.md` and `.agents/skills/change-dev/SKILL.md` are owned by another work unit and are not edited here. Their references to `fork-sync-agent.md` stay until that unit updates them.

## Proposed Changes

### Root instruction files

#### [NEW] `CLAUDE.md`

- Frontmatter; `@` imports of `AGENTS.md` and every rule in `.agents/rules/`; Commands (`/status`, `/test`, `/gate`, `/secret-scan`, `/verify-fork`, `/change-dev`, `/branch`, `/plan`) using pnpm scripts that exist in `package.json`; Directives (zero secrets / PII, quality gate, worktree isolation, output language, instruction precedence, plan first, branch naming, naming, compliance dual-sync, clean architecture).

#### [MODIFY] `AGENTS.md`

- Frontmatter; a "→ rule file" link per Core Rule; Rule 10 Git & Language Conventions; Rule 11 Instruction Precedence. Existing content kept.

#### [MODIFY] `GEMINI.md`

- Frontmatter only.

### Rules (`.agents/rules/`)

#### [NEW] `quality-rules-gate.md`

- Mandatory gate `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`; CI-only `pnpm lint && pnpm format:check` (and `pnpm audit:deps`); blueprint alignment with `docs/BLUEPRINT.md`.

#### [NEW] `language-rules-output.md`

- Replies and PR descriptions in Japanese; commits, code, identifiers and comments in English; documentation keeps its language (`README.md` / `README.ja.md` in sync).

#### [NEW] `naming-rules-general.md`

- `*.agent.md` suffix, rule / skill naming, legacy rule names (`development-workflow.md`, `security-zero-leakage.md`, `storage-and-data-routing.md`, `compliance-rules-management.md`), frontmatter convention.

#### [MODIFY] `security-zero-leakage.md`, `storage-and-data-routing.md`, `compliance-rules-management.md`

- Add the frontmatter convention (keeping existing keys).

#### [MODIFY] `git-rules-commit.md`

- §3 points to `language-rules-output.md`, §4 to `quality-rules-gate.md`.

### Agent definitions (`.agents/`)

#### [MODIFY] rename

- `audit-collector-agent.md`, `compliance-checker-agent.md`, `dashboard-ui-agent.md`, `fork-sync-agent.md`, `report-notification-agent.md` → `<name>.agent.md`; heading identifiers updated; references updated repository-wide except the files listed in the warning above.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- `pnpm change-dev:plan-check && pnpm change-dev:branch check`

### Manual Verification

- `grep` for `-agent.md` finds only the files owned by the other unit.
- Every `@` import in `CLAUDE.md` resolves to an existing file; every command uses an existing `package.json` script.
