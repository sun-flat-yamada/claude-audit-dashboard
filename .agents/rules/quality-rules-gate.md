---
title: 'Quality Gate Rules'
description: 'Mandatory verification gate, CI-only checks and blueprint alignment.'
category: 'rules'
type: 'specification'
status: 'active'
date: 2026-10-05
updated: 2026-10-05
lang: 'en'
tags:
  - 'rules'
  - 'quality'
  - 'blueprint'
alwaysApply: true
---

# Quality Gate Rules (`quality-rules-gate`)

## 1. Mandatory Gate

Every change must pass cleanly (exit code 0) before commit / PR:

```bash
pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build
```

`npm run <script>` is equivalent. `pnpm secret-scan` must always be run before committing or finalizing changes, including changes that touch only `.devs/changes/` artifacts.

## 2. CI-Only Checks

CI (`.github/workflows/`) additionally runs the following; run them locally before opening a PR so CI does not fail:

```bash
pnpm lint && pnpm format:check
pnpm audit:deps
```

The browser suite (`pnpm test:e2e`: Playwright E2E and axe accessibility checks of the dashboard) is not part of `pnpm test`. CI runs it as the `E2E and accessibility` job; run it locally when you change `packages/dashboard` (`CONTRIBUTING.md`, Step 4 item 6).

`pnpm format` (`prettier --write .`) fixes formatting, `pnpm lint:fix` fixes auto-fixable lint findings.

## 3. Blueprint Alignment

- Architectural decisions and features must align with `docs/BLUEPRINT.md` (requirements), `docs/ARCHITECTURE.md` (layers and extension recipes) and `docs/API-MAPPING.md` (Claude Enterprise API usage).
- When requirements, data schemas, compliance rules or collection schedules change, update the relevant document in the same change. Compliance rule changes follow [`compliance-rules-management.md`](compliance-rules-management.md).
