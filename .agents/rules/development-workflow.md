# Development Workflow

## Lifecycle

```
Issue → Sibling Worktree → Quality Gate → PR → Rebase Merge → Clean
```

## Multi-Agent Isolation

When multiple AI agents work concurrently:
1. Provision sibling worktree: `../claude-audit-dashboard-worktrees/<branch>`
2. Never edit directly on root workspace
3. Each agent operates on its own branch

## Quality Gate (Pre-PR)

```bash
npm run fork:verify    # Data isolation check
npm run typecheck      # TypeScript compilation
npm test               # Unit tests
npm run secret-scan    # Secret detection
npm run build          # Full build
```

## Branch Naming

- `feat/<scope>/<description>` — New features
- `fix/<scope>/<description>` — Bug fixes
- `docs/<description>` — Documentation
- `chore/<scope>/<description>` — Maintenance

## Commit Convention

[Conventional Commits](https://www.conventionalcommits.org/)

Scopes: `collector`, `dashboard`, `shared`, `ci`, `notify`, `billing`, `plugin`
