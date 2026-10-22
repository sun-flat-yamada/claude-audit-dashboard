# Walkthrough: Accept Configuration Overrides from a Repository Variable (#156)

## Summary

A fork can now change its collector settings without editing `config/default.json` on `main`. The optional environment variable `AUDIT_CONFIG_OVERRIDES` (a JSON object, in GitHub Actions the repository variable of the same name) is deep-merged over `config/default.json` and validated with the existing `appConfigSchema`. Objects merge key by key; arrays, scalars and `null` replace. Invalid JSON, a non-object root, prototype keys (`__proto__`, `constructor`, `prototype`) and schema violations stop the run with a message that names only the field path and the zod issue code, never the value. The four configuration-loading workflows pass the variable at job level, so the effective configuration view (`detail/config.json`) shows the merged result.

Done condition: `{"sources":{"activities":{"excludeTypes":[]},"featureUsage":{"enabled":true}}}` as a repository variable enables the content-view activity types and `featureUsage` with `main` unchanged.

## Changes Made

### Collector

- `packages/collector/src/infrastructure/config-overrides.ts` (new): `parseConfigOverrides()` and the pure `mergeConfigOverrides()`.
- `packages/collector/src/infrastructure/config.ts`: `loadConfig(configDir, overrides?)` validates the file as before, then the merged object with a value-free message.
- `packages/collector/src/infrastructure/env.ts`: `AUDIT_CONFIG_OVERRIDES` (blank = absent) as `Environment.configOverrides`.
- `packages/collector/src/main/container.ts`: passes the overrides to `loadConfig`.

### Workflows

- `.github/workflows/{collect-audit,weekly-report,monthly-report,ack-alert}.yml`: job-level `AUDIT_CONFIG_OVERRIDES: ${{ vars.AUDIT_CONFIG_OVERRIDES }}`.

### Tests

- `packages/collector/src/infrastructure/__tests__/config-overrides.test.ts`: no override, partial override, array replacement, invalid JSON, non-object root, prototype keys, schema violation (paths and codes only; a marker value never appears in the message), invalid file still reported as the file.
- `packages/collector/src/main/__tests__/config-overrides-view.test.ts`: the override reaches the effective configuration view input.
- `scripts/__tests__/config-overrides-workflows.test.ts`: every configuration-loading workflow passes the variable.

### Documentation

- `docs/BLUEPRINT.md` appendix A, `docs/SETUP.md` (secrets/variables table, new section with the example, troubleshooting row), `.env.example`, `CHANGELOG.md`.

## Verification Results

| Stage                    | Command                          | Result                                                              |
| :----------------------- | :------------------------------- | :------------------------------------------------------------------ |
| Code-Data Decoupling     | `pnpm fork:verify`               | ✅ Clean (exit 0)                                                   |
| TypeScript Check         | `pnpm typecheck`                 | ✅ Pass (exit 0)                                                    |
| Unit & Integration Tests | `pnpm test`                      | ✅ core 316, collector 336, dashboard 464, scripts 83 — all passing |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | ✅ 0 leaks (exit 0)                                                 |
| Production Build         | `pnpm build`                     | ✅ Built                                                            |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | ✅ Clean                                                            |
