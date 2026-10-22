# Accept Configuration Overrides from a Repository Variable

Issue #156 (U2, parent #154). A downstream fork can change collection settings (content-view activity types, `sources.featureUsage`, later the ledger settings) only by editing `config/default.json`, which makes its `main` diverge from upstream and conflicts on _Sync fork_. This change adds the optional environment variable `AUDIT_CONFIG_OVERRIDES` (a JSON object) that is deep-merged over the loaded configuration and validated with the existing schema, and passes the repository variable `vars.AUDIT_CONFIG_OVERRIDES` to the collection and report workflows.

## User Review Required

> [!IMPORTANT]
> Merge semantics: plain objects merge recursively; arrays, scalars and `null` replace the file value (arrays are never concatenated). The merged object is validated with `appConfigSchema`, so the override can only set fields the file could set. The variable applies to `config/default.json` only (not `custom-rules.json`).

> [!WARNING]
> Overridden values may be sensitive (organization-specific names in `compliance.params`), so no error or log line contains them: invalid JSON is reported without the parser message (V8 quotes the input), a non-object root is reported by its type, and a schema violation lists only the field paths and zod issue codes. Keys `__proto__`, `constructor` and `prototype` are rejected (prototype pollution).

## Proposed Changes

### Collector infrastructure

#### [MODIFY] `packages/collector/src/infrastructure/env.ts`

- `AUDIT_CONFIG_OVERRIDES` (optional, blank = absent) in the env schema; `Environment.configOverrides: string | undefined`.

#### [NEW] `packages/collector/src/infrastructure/config-overrides.ts`

- `parseConfigOverrides(raw)` (JSON object or error without the value), `mergeConfigOverrides(base, overrides)` (pure deep merge, arrays replace).

#### [MODIFY] `packages/collector/src/infrastructure/config.ts`

- `loadConfig(configDir, overrides?)`: validate the file as today (unchanged message), then, when overrides are given, merge and validate again with a value-free message (`Invalid AUDIT_CONFIG_OVERRIDES: <path> (<code>)`).

#### [MODIFY] `packages/collector/src/main/container.ts`

- Pass `env.configOverrides` to `loadConfig`; the effective config view (`detail/config.json`) is built from the container config, so overrides reach it automatically.

### Workflows

#### [MODIFY] `.github/workflows/{collect-audit,weekly-report,monthly-report,ack-alert}.yml`

- Job-level `env: AUDIT_CONFIG_OVERRIDES: ${{ vars.AUDIT_CONFIG_OVERRIDES }}` so every step that loads the configuration (pipeline, archive, notify, size, build:detail, reports, alerts) sees the same configuration.

### Tests

- `packages/collector/src/infrastructure/__tests__/config-overrides.test.ts`: no override, partial override, array replacement, invalid JSON, non-object root, schema violation, forbidden keys, and that no error message contains the override value.
- Container / config view test: an override is reflected in `configViewInput`.
- Workflow wiring test: each data workflow passes the variable.

### Documentation

- `docs/BLUEPRINT.md` appendix A (environment variable and merge rules), `docs/SETUP.md` (example with `excludeTypes: []` and `featureUsage.enabled: true`, troubleshooting row), `.env.example` (commented entry), `CHANGELOG.md` `[Unreleased]`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- Targeted: `pnpm --filter @claude-audit/collector test -- config-overrides`

### Manual Verification

- `AUDIT_CONFIG_OVERRIDES='{"sources":{"featureUsage":{"enabled":true}}}' pnpm demo`-style local run is not needed; the container test covers the effective config view.
