# B2-12 F-014 Effective configuration view (#/config)

Closes #69. Refs #37 (tracking). Plan source: `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` section B2-12. Owner accepted D1-D8. Prerequisites B2-0 and B2-2 are merged; the patterns of B2-4, B2-5 and B2-7 are reused.

## User Review Required

> [!IMPORTANT]
> The effective configuration is built from an explicit allowlist, never from a dump of the loaded config. Every field of the output contract is named; notification channels are booleans per kind (console, Slack, Discord, e-mail), so webhook URLs, SMTP settings and recipient addresses cannot be represented at all. Free text (rule names, custom rule settings, parameter values) additionally passes a redaction guard (URLs, e-mail addresses, key/token shapes, absolute paths and long opaque tokens become `[hidden]`), and `checkDetailBundle` (used by `fork:verify`) rejects such content in `detail/config.json`.

> [!WARNING]
> The `pnpm demo` configuration is **illustrative**: it shows a disabled rule, an overridden parameter, a custom rule and a notification policy, but it is not applied to the sample compliance results, so that `dashboard.json`, `compliance-report.json` and the reports stay byte-identical. The docs say so. `detail/config.json` follows the detail publication rule (`PAGES_DATA_SOURCE=live` and `PAGES_DETAIL_DATA=true`, Private Pages only); the configuration is not secret, but it describes the audit posture.

## Proposed Changes

### packages/core (pure)

- `[NEW] contracts/config-view.ts` (exported from `contracts/index.ts`): `CONFIG_VIEW_SCHEMA_VERSION = 1`, `DETAIL_CONFIG_PATH = detail/config.json`, `detailConfigSchema` (rules with state / origin / effective parameters with defaults and an overridden flag; custom rules; data sources; notification policy with channel kinds; retention; `maskPii`; unknown ids).
- `[MODIFY] contracts/detail-view.ts`: `DETAIL_KINDS` gains `config`; the manifest entry `schemaVersion` becomes a positive integer so the file keeps its own version.
- `[NEW] application/presenters/config-view.ts`: `buildConfigView(input)` (pure allowlist mapper, redaction guard `safeText` / `safeValue`).
- `[MODIFY] application/presenters/detail-view.ts` / `contracts/detail-bundle.ts`: the config file is listed in the manifest and validated (schema, count, no secret / URL / e-mail / path shaped content).

### packages/collector

- `[NEW] main/config-view.ts`: maps `AppConfig` + custom rules + channel presence to the presenter input (booleans only), parses with the contract at the single write site.
- `[MODIFY] main/container.ts`: keeps `customRules`; `main/detail.ts` writes `detail/config.json` and the manifest entry; `main/demo.ts` supplies the illustrative demo configuration.

### packages/dashboard

- `[NEW] lib/config-view.ts` (search / grouping helpers), `pages/Config.tsx`, route `/config` + nav entry "Configuration". Reuses `DetailControls.tsx`, `Badges`, `Card`.
- States: loading, not published, not collected (reason from the manifest), error, empty, no match.

### Tests

core: allowlist mapper (defaults, disabled, override, custom, unknown ids), negative test with seeded webhook URLs / API keys / e-mail addresses / paths in every free-text slot, bundle check negatives; collector: writer (env with webhook + SMTP values leaves no trace), demo golden; dashboard: helper unit, component tests for every state, stage-data.

### Docs

`docs/DASHBOARD-FEATURES.md` F-014, `docs/BLUEPRINT.md` sections 4.2 / 9, `docs/DEPLOYMENT.md`, `docs/SETUP.md`, `.agents/rules/storage-and-data-routing.md`.

## Verification Plan

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- `pnpm demo` then `git diff --exit-code data/sample` is clean; only `detail/index.json` changes and `detail/config.json` is added.
- Manual: `DASHBOARD_DATA_SOURCE=sample pnpm dev`, open `#/config` at 390 px in both themes.
