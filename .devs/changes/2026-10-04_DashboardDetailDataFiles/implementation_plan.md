# B2-2 Detail data file contract, writer, staging, publication condition

Closes #57. Refs #37 (tracking). Plan source: `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` section B2-2. Owner accepted D1-D8: D1 manifest + per-entity files with their own `schemaVersion` (activity paged by month), user / key IDs masked as stable short hashes so rows stay joinable, `DashboardView` stays v2; D2 per-person detail data is published to Pages only with `PAGES_DETAIL_DATA=true` (default off) on top of `PAGES_DATA_SOURCE=live` (Private Pages only, `docs/DEPLOYMENT.md` Option 1). Prerequisite B2-0 (#49) is merged. No screens are built here (B2-3, B2-4, B2-5, B2-10).

## User Review Required

> [!IMPORTANT]
> New published contract `detail-view.ts` (`DETAIL_SCHEMA_VERSION = 1`). `dashboard.json` and `DashboardView` v2 are untouched (the existing golden bytes for `dashboard.json` must not change).

> [!WARNING]
> Per-person data. With `dashboard.maskPii=true` (default) e-mails become `j***@example.com`, names become initials (`A*** E***`), IP addresses are dropped, and user / key / invite IDs become `u_` / `k_` / `i_` + 12 hex characters (deterministic, so rows join across files). With `maskPii=false` raw values are written. The Pages workflow publishes detail files only when `PAGES_DATA_SOURCE=live` **and** `PAGES_DETAIL_DATA=true` (an owner attestation that the site is Private Pages); the synthetic sample detail files ship with the default sample deployment.

## Proposed Changes

### packages/core (pure)

- `[NEW] contracts/detail-view.ts` (exported from `contracts/index.ts`): `DETAIL_SCHEMA_VERSION`, zod schemas `detailManifestSchema`, `detailMembersSchema`, `detailApiKeysSchema`, `detailActivitySchema`, `detailOrgGroupsSchema`, path helpers (`DETAIL_DIR`, `detailActivityPath(month)`).
- `[NEW] contracts/detail-bundle.ts`: `checkDetailBundle(files)` validates a path -> text map (manifest, every listed file, schemaVersions, manifest <-> files consistency, `example.*` e-mails only, masked identifiers/names/IPs when the manifest says `maskPii`). Used by `fork:verify` and tests.
- `[NEW] domain/util/mask.ts` additions: `maskName`, `hashId(prefix, value)` (53-bit string hash, 12 hex).
- `[NEW] application/presenters/detail-{members,api-keys,activity,org-groups,view}.ts`: pure builders from `AuditSnapshot` + compliance report; assembled by `buildDetailView()`.

### packages/collector

- `[NEW] main/detail.ts`: `writeDetail(c)` builds, parses every file with its schema, writes `detail/*.json` through `c.artifacts`, returns the path -> content map. Thresholds (AC-001 `inactiveDays`, AK-001 `unusedDays`, AK-003 `maxAgeDays`) come from the effective compliance params.
- `commands.ts`: new `detail` command; included in `pipeline` (hence `build:data`). `demo.ts` / `fixture.ts` add the detail files to their output (`data/sample/detail/`, `data/fixture/detail/`).

### Staging and publication

- `stage-data.mjs`: stages the `detail/` directory next to the selected `dashboard.json` (sample / fixtures / live / default); removes a stale staged `public/data/detail` when the source has none; `STAGED_DATA=1` keeps CI staging untouched.
- `deploy-pages.yml`: sample deployments stage `data/sample/detail`; `live` stages `detail/` from `data/audit` only if `vars.PAGES_DETAIL_DATA == 'true'`.
- `scripts/fork-verify.ts`: recursive sample e-mail scan, `checkDetailBundle` over `data/sample/detail`.

### Docs

`DEPLOYMENT.md` (Option 1, variable), `SETUP.md`, `.env.example`, `BLUEPRINT.md` (4.2 / 9 / variables), `DASHBOARD-FEATURES.md`, `.agents/rules/storage-and-data-routing.md`.

## Verification Plan

Unit tests: hash/mask helpers, each presenter with maskPii on/off, month paging/cap boundaries, manifest consistency, schema round trip, `checkDetailBundle` negative cases (real-looking e-mail, unmasked ID, unmasked name, IP, manifest mismatch), collector `writeDetail`, demo golden (`data/sample/detail/*`), fixture-tenant detail validation, `dashboard.json` bytes unchanged, stage-data detail staging. Gate: `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`, `pnpm lint`, `pnpm format:check`, `pnpm audit:deps`, `pnpm demo` then `git diff --exit-code data/sample` clean.
