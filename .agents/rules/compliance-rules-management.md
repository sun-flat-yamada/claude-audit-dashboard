---
title: 'Compliance Rules Management'
description: 'Synchronization of compliance rule code, tests, docs/BLUEPRINT.md, READMEs and sample data; rule contract and ID convention.'
category: 'rules'
type: 'specification'
status: 'active'
date: 2026-10-05
updated: 2026-10-05
lang: 'en'
tags:
  - 'rules'
  - 'compliance'
  - 'blueprint'
alwaysApply: true
---

# Compliance Rules Management

## Rule Synchronization Policy

When compliance rules are added, updated, or removed, the following MUST change together (AGENTS.md rule 8):

1. **Implementation** — a `defineRule({...})` in `packages/core/src/domain/compliance/rules/<category>.ts` (added to that file's rule array), or a definition in `packages/core/src/domain/compliance/factories/defaults.ts` (configuration baselines `CF-xxx`, activity watches `AM-xxx`)
2. **Tests** — pass / fail / skipped cases in `packages/core/src/domain/compliance/__tests__/`
3. **Blueprint** — `docs/BLUEPRINT.md` §7.1 rule table (ID, category, severity, required datasets, default check)
4. **READMEs** — the rule tables in `README.md` and `README.ja.md`
5. **Sample data** — run `pnpm demo` and commit the regenerated `data/sample/` (the golden test fails otherwise)
6. **Change log** — `CHANGELOG.md`

`packages/collector/src/main/__tests__/sample-and-docs.test.ts` fails when the ID lists in the three documents differ from the rule catalog, or when `data/sample/` differs from `pnpm demo` output.

## Rule Contract

- Declare every dataset the rule reads in `requires`; the engine reports the rule as `skipped` (with the reason) when one was not collected. Never treat missing data as compliant.
- Parameters are a zod schema with defaults; users override them in `config/default.json` under `compliance.params.<ID>`.
- `evaluate` is pure (no I/O, no clock access other than the `now` input) and returns `pass`, `fail`, `warn` or `skip` (helpers: `failIfAny`).
- Evidence labels may contain e-mail addresses; the dashboard masks them, so do not pre-format or truncate identities in the rule.

## Rule ID Convention

| Prefix | Category            | Source                           |
| ------ | ------------------- | -------------------------------- |
| AC-xxx | access-control      | code (`rules/access-control.ts`) |
| AK-xxx | api-key-management  | code (`rules/credentials.ts`)    |
| UA-xxx | usage-anomaly       | code (`rules/usage.ts`)          |
| DG-xxx | data-governance     | code (`rules/governance.ts`)     |
| OP-xxx | operational         | code (`rules/operational.ts`)    |
| CF-xxx | configuration       | setting-baseline definitions     |
| AM-xxx | activity-monitoring | activity-watch definitions       |

IDs 001–099 are reserved for built-in definitions; use 101+ for organization-specific custom rules.

## Adding a Custom Rule Without Code

Add a `settingBaselines` or `activityWatches` entry to `config/custom-rules.json` (schema in `docs/BLUEPRINT.md` §7.3). An entry with the ID of a built-in definition overrides it. Custom rules are fork-specific and are not listed in the built-in rule tables.
