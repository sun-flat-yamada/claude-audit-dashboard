# Contributing

The contribution guide lives in the repository root: **[CONTRIBUTING.md](../CONTRIBUTING.md)**.

Related references:

- [E2E and accessibility tests](../CONTRIBUTING.md#step-4-implement--run-local-quality-gate) (item 6 of Step 4) — `pnpm test:e2e`, the data profiles, axe, the CI job and how to register it as a required check.
- [Development workflow rules](../.agents/rules/development-workflow.md)
- [Compliance rule synchronization policy](../.agents/rules/compliance-rules-management.md) — when adding a rule, update
  the rule in `packages/core/src/domain/compliance/rules/` (or a definition in `factories/defaults.ts`), its tests,
  `docs/BLUEPRINT.md` §7.1, `README.md` and `README.ja.md` together (a test checks the ID lists).
- [Extension architecture](PLUGIN-ARCHITECTURE.md) — how to add data sources, rules, analyzers, reports, renderers and channels.
- [Code of Conduct](../CODE_OF_CONDUCT.md)
