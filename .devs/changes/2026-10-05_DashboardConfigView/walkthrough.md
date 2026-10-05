# Walkthrough: B2-12 F-014 Effective configuration view

## Summary

`#/config` shows the effective configuration read-only: rule states, effective parameters next to the rule defaults, custom rules, the notification policy (channels by kind), data sources and retention. The collector emits it as `detail/config.json` from an explicit allowlist, listed in the detail manifest and validated by `checkDetailBundle` (so by `fork:verify`). Closes #69; refs #37.

## Changes Made

### packages/core

- `contracts/config-view.ts`: `CONFIG_VIEW_SCHEMA_VERSION = 1`, `detailConfigSchema`, `looksSensitive()` (shared by the presenter and the bundle check).
- `contracts/detail-view.ts`: manifest kind `config`; the entry `schemaVersion` is now the file's own version. `contracts/detail-bundle.ts`: schema, rule count and "no secret / URL / e-mail / path shaped string" check for the config file.
- `application/presenters/config-view.ts`: pure allowlist mapper with redaction (`safeText`, `safeValue`); `detail-view.ts` adds the config part when a configuration is supplied.

### packages/collector

- `main/config-view.ts` (maps only named fields; channels become booleans), `main/container.ts` (keeps `customRules`), `main/detail.ts` (writes and validates the file), `main/demo.ts` (fixed illustrative configuration).

### packages/dashboard

- `lib/config-view.ts`, `pages/Config.tsx`, route `/config`, enabled / disabled / overridden / default / invalid badges.

### Data and docs

- `data/sample/detail/config.json` added, `data/sample/detail/index.json` gains one entry; no other sample file changes.
- `docs/DASHBOARD-FEATURES.md` F-014, `docs/BLUEPRINT.md` (data table, 8.x detail section, 9.2), `docs/DEPLOYMENT.md`, `docs/SETUP.md`, `.agents/rules/storage-and-data-routing.md`.

## Verification Results

| Stage                | Command                                                                | Result            |
| :------------------- | :--------------------------------------------------------------------- | :---------------- |
| Quality gate         | `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build` | Pass (exit 0) |
| Lint / format / deps | `pnpm lint`, `pnpm format:check`, `pnpm audit:deps`                    | Pass (exit 0)     |
| Demo golden          | `pnpm demo` then `git diff data/sample`                                | Only the intended manifest entry and `config.json` |

Safety tests: a hostile input (webhook URLs, API key, e-mail addresses, paths, SMTP host, plus extra properties a caller might pass) yields none of them in the output; a collector test with webhook / SMTP / key environment values leaves no trace in `detail/config.json`; the bundle check rejects the same strings if they are injected into the file.

## Caveats

- The sample configuration is illustrative and not applied to the sample compliance results (keeps other sample files byte-identical).
- The 390 px / light-dark layout was checked by construction (contained table scroll, wrapping text, theme tokens), not in a real browser in this session.
