# Walkthrough: B2-2 detail data files

Closes #57. Refs #37.

## What changed

- **Contract** (`packages/core/src/contracts/detail-view.ts`, `detail-bundle.ts`): `DETAIL_SCHEMA_VERSION = 1`; zod schemas for the manifest, members, API keys, activity (per UTC month, capped at 2000 rows with `total` / `truncated`) and org-groups; `checkDetailBundle()` validates a whole `detail/` directory (schemas, manifest <-> files, counts, `example.*` e-mails, masked IDs / names / IPs).
- **Presenters** (`application/presenters/detail-*.ts`, pure): masking through `identityMasker` (`domain/util/mask.ts`): e-mail `j***@example.com`, name initials, IP dropped, IDs `u_` / `k_` / `i_` + 12 hex (stable, so rows join). `maskPii=false` writes raw values and the manifest records it.
- **Collector**: `main/detail.ts` `writeDetail()` (zod parse at the single write site, thresholds from effective AC-001 / AK-001 / AK-003 params), `detail` command, part of `pipeline`; `demo` and `fixture` outputs now include `detail/`.
- **Staging / publication**: `stage-data.mjs` stages the `detail/` directory next to the chosen source (and removes a stale staged copy); `deploy-pages.yml` publishes live detail files only with `PAGES_DETAIL_DATA=true` on top of `PAGES_DATA_SOURCE=live`; sample deployments ship `data/sample/detail/`.
- **fork:verify**: recursive sample e-mail scan, `data/detail` forbidden on main, `checkDetailBundle` over `data/sample/detail` (negative cases verified by planting a real-looking e-mail and an unmasked ID).
- **Docs**: DEPLOYMENT, SETUP, `.env.example`, BLUEPRINT (4.2, 4.4, 9.1, variables), DASHBOARD-FEATURES, READMEs, storage-and-data-routing rule.

## Evidence

- `data/sample/dashboard.json` byte-identical (only `data/sample/detail/*` added).
- Tests: core 82, collector 105, dashboard 94 (incl. new detail presenter / bundle-checker / writer / stage-data cases).
- Gate: `pnpm fork:verify`, `typecheck`, `test`, `secret-scan`, `build`, `lint`, `format:check`, `audit:deps` all exit 0.

## Caveats

- The synthetic tenant has one month of activity (79 rows) and no organization-scoped members, so multi-month paging and per-org member counts are covered by unit tests, not by the sample. B2-3 / B2-10 extend the demo data.
- No screens are built here.
