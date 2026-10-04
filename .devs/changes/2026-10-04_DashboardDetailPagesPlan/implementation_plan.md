# Phase B2 plan: dashboard detail pages (work-unit table B2-0..B2-12)

Refs #37 (tracking, parent #46). **Plan only**: this PR adds this document and changes no code.
After approval the Work-Unit Issues B2-0..B2-12 are created (`.github/ISSUE_TEMPLATE/work_unit.yml`) and linked as sub-issues of #37.
Features: F-003, F-005..F-014 (F-011 theme toggle included; Issue #37 is the source of truth for the B2 scope).

## User Review Required

> [!IMPORTANT]
> Decisions D1-D8 (section "Open design decisions") need an owner answer before B2-0 / B2-2 / B2-6 start. Each has a recommendation; if the owner agrees with all, the table below stands as written.

> [!WARNING]
> - Today `dashboard.json` (`DashboardView` v2) is published on Pages and contains aggregates only. Per-person data (F-005 search, F-006, F-007, F-012) must never be added to it (Issue #37 common requirement, `docs/DASHBOARD-FEATURES.md` Principles).
> - `parseState()` **resets** unknown/older `state.json` (`STATE_SCHEMA_VERSION` 2). Any change to `state.json` therefore needs a migration, not a plain bump (affects D3).
> - `stage-data.mjs` prefers a local live `data/dashboard.json`, so tests can read live data today (B2-0 fixes this).
> - The model x group heatmap (F-010) needs a cross-dimension; the collector currently issues one `group_by[]` call per dimension (total / product / model / rbac_group_id), so pairwise data does not exist yet (D6).

## Baseline (inspected code)

| Area | Fact |
| :-- | :-- |
| Dashboard | Single page, no router. Files: `App.tsx`, `components/{sections,ComplianceResults,KpiTiles,ShareBars,TimeSeriesChart,Badges,Card}.tsx`, `lib/{data,view,format}.ts`. Only test: `lib/__tests__/view.test.ts` (vitest, node). Deps: React 19, Recharts 3, Tailwind 4. `base` = `VITE_BASE_PATH` or `/claude-audit-dashboard/`. |
| Loading | `loadDashboard(baseUrl)` fetches `data/dashboard.json`, only checks `schemaVersion === 2`. |
| Contract | `packages/core/src/contracts/dashboard-view.ts` (zod, `DASHBOARD_VIEW_SCHEMA_VERSION = 2`), exported via `contracts/index.ts`. Written by `writeDashboard()` in `collector/src/main/workflows.ts`; `maskPii` applied in `core/application/presenters/dashboard-view.ts`. |
| Staging | `packages/dashboard/scripts/stage-data.mjs`: live `data/dashboard.json` else `data/sample/dashboard.json`; `STAGED_DATA=1` keeps CI staging. `deploy-pages.yml` copies sample, or `data/audit:data/dashboard.json` when `PAGES_DATA_SOURCE=live`. |
| Demo | `collector/src/main/demo.ts` + `adapters/demo/demo-source.ts` write `data/sample/{dashboard.json,compliance-report.json,weekly-report.md,monthly-report.md}` (golden-tested in `main/__tests__/sample-and-docs.test.ts`). |
| Fixture tenant (PR #47) | `adapters/anthropic/__tests__/fixtures/tenant/*.json` (27 files), `adapters/fixture/fixture-source.ts`, `main/fixture.ts` (`fixture` command: collect -> check -> dashboard, `source: "demo"`), `main/__tests__/fixture-tenant.test.ts`. |
| Reports | `generateReport()` already writes `reports/<kind>/<id>` in every renderer; `renderers/index.ts` already emits `.json` (`stableStringify(document)`), so a structured monthly report exists on disk. |
| Alerts | `state.json` `notifications.lastSent: Record<string,string>` only (last send time per key); no history, no acknowledgement. |
| Archive | `adapters/storage/archive.ts` writes `archive/<year>/<id>.json.gz` into `data/audit`; no inventory function. |
| Rules | `docs/BLUEPRINT.md` section 9.3 says "no router"; B2-0 changes this line (hash routing). |

## Cross-cutting design (applies to every unit)

1. **Contracts.** New files live in `packages/core/src/contracts/` (pure zod, no I/O), exported from `contracts/index.ts`. The dashboard imports only `@claude-audit/core/contracts` (AGENTS.md rule 9). `DashboardView` stays v2 unless a unit says otherwise; each new file has its own `schemaVersion` constant starting at 1, so units do not force a v3 on the published file.
2. **Writers.** New collector workflow functions next to `writeDashboard()` (`workflows.ts` is near the lint limits; put new builders in `core/application/presenters/` and thin writers in `collector/src/main/detail.ts`). Output validated with `schema.parse()` at the single write site, as for `dashboard.json`.
3. **File layout** (all under `data/`, i.e. on `data/audit`, gitignored on `main`): `detail/index.json` (manifest: file names, schemaVersions, generatedAt, maskPii flag), `detail/members.json`, `detail/api-keys.json`, `detail/activity-<yyyy-mm>.json` (paged by month, bounded size), `detail/org-groups.json`, `alerts/history.json`, `reports/monthly/<id>.json` (existing), `inventory/archive.json`, `inventory/config.json`. Names are provisional until D1.
4. **Staging.** `stage-data.mjs` stages `dashboard.json` plus every file the selected source offers into `public/data/`. Detail files are staged only for sources `sample|fixtures|live` and, for Pages, only under the D2 publication condition.
5. **UI.** Hash routes (`#/`, `#/compliance`, `#/activity`, `#/members`, `#/keys`, `#/alerts`, `#/reports/monthly/<id>`, `#/models`, `#/orgs/<id>`, `#/groups/<id>`, `#/archive`, `#/config`), implemented with a ~60-line in-house router (no new dependency, keeps "React/Recharts/Tailwind only"). Per-route lazy `import()`; detail files fetched on route entry; missing file renders a "not collected / not published" state, never an error screen.
6. **Per-screen acceptance** (from #37): icon + label + color status, table view for every chart, no horizontal scroll at 390 px, light/dark, role + accessible-name selectors only (no `data-testid`), `maskPii` on/off tested, normal/empty/`unavailable` states tested.
7. **Test layers.** (a) view-helper unit tests in `src/lib/__tests__`; (b) component tests (B2-0 base) rendering each screen from builders; (c) collector tests for writers and the demo golden; (d) **regression**: every screen renders from `data/sample/*` and from the fixture-tenant output (`pnpm fixture`), and all Phase A tests keep passing unchanged.
8. **Docs per unit.** `docs/DASHBOARD-FEATURES.md` feature matrix row + `docs/BLUEPRINT.md` section 9 (and 4.2 / 6 for new files), `docs/SETUP.md`/`DEPLOYMENT.md` where publication is touched.

## Proposed Changes: work-unit table

PR order (dependency graph): `B2-0 -> {B2-1, B2-6, B2-7, B2-8, B2-9, B2-11, B2-12}` and `B2-0 -> B2-2 -> {B2-3, B2-4, B2-5, B2-10}`. Suggested merge order: **B2-0, B2-9, B2-1, B2-2, B2-4, B2-5, B2-3, B2-10, B2-7, B2-12, B2-11, B2-6, B2-8** (cheap/low-risk first, B2-8 last because D6 may need collector API work; B2-6 after D3 is answered). Units with disjoint files can proceed in parallel after B2-0 and B2-2; `demo-source.ts`, `sample-and-docs.test.ts` and `data/sample/*` are shared hot spots, so rebase before regenerating the golden.

### B2-0 Test foundation, data-source switch, hash routing (no feature)

- Scope: Testing Library + vitest jsdom in `packages/dashboard` (`vitest.config.ts` or `vite.config.ts` test block, `src/test/setup.ts`, devDeps `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`); included in `pnpm test`. `DASHBOARD_DATA_SOURCE=sample|fixtures|live` in `stage-data.mjs` (default = current behaviour: live else sample; `fixtures` reads the output of `pnpm fixture`, written to a gitignored `data/fixture/`; `live` fails if absent; tests and E2E set `sample` or `fixtures`). Hash router + `NavBar` with `aria-current`, skip link, back/forward support, unknown route -> not found. Selector convention documented (role + accessible name). Split `App.tsx` into `routes.tsx`, `pages/Overview.tsx` (current content, unchanged output). Generic `useDetailFile(path, schema)` loader with loading/error/missing states and `fetch` injection.
- Files: `packages/dashboard/{package.json,vite.config.ts,scripts/stage-data.mjs,src/App.tsx,src/lib/{router,detail-data}.ts,src/components/NavBar.tsx,src/test/*}`, `packages/collector/src/main/fixture.ts` (default output path only), `.gitignore`, `scripts/fork-verify.ts` (assert dashboard tests do not default to `live`), `docs/{BLUEPRINT.md section 9.3,CONTRIBUTING.md}`.
- Contract / schemaVersion: none.
- Demo/sample data: none; `data/sample/` unchanged. Adds empty / `unavailable` demo profile generator hook (`pnpm demo --profile empty`, written to a temp dir for tests only, not committed) used by later units.
- Tests: stage-data unit test (script exported function; each source, `live` missing -> exit 1, `STAGED_DATA=1`); router unit tests (parse/format/hash change); component smoke: Overview renders from sample and from fixture-tenant `dashboard.json`; all Phase A `view.test.ts` untouched and green; jsdom `matchMedia`/`localStorage` stubs verified.
- Depends on: #29 / PR #47 (merged). PR order: 1.
- Open: D4 (router), D5 (source semantics).

### B2-1 F-003 Compliance results export

- Scope: client-side CSV and JSON export of `compliance.results` (+ evidence) from the Compliance view; columns and order aligned with `pnpm report:compliance` CSV (`renderers/csv.ts`); deterministic file name (`compliance-results-<collectedAt yyyymmdd>.csv|json`); CSV escaping (comma, newline, quote) and formula-injection guard (leading `=` `+` `-` `@` and tab/CR prefixed with `'`); honors the active status filter (decision: export filtered rows, label states it). Route `#/compliance`.
- Files: `packages/dashboard/src/lib/export.ts`, `components/ExportButtons.tsx`, `components/ComplianceResults.tsx`, `pages/Compliance.tsx`; docs.
- Contract: none (uses v2 `compliance.results`). A column-parity test imports the collector CSV column list via the contract-level constant (add `COMPLIANCE_EXPORT_COLUMNS` to `contracts/` so both sides share it; additive, no version bump).
- Demo data: none (existing results).
- Tests: unit (escaping matrix, injection cells, column order, file name, empty results); component (button names, Blob content via mocked `URL.createObjectURL`, filter respected); parity test against `csv.ts` header; regression on sample + fixture tenant.
- Depends: B2-0. Order: 3.

### B2-2 Detail data file contract, writer, staging, publication condition

- Scope: zod schemas `detail-manifest`, `detail-members`, `detail-api-keys`, `detail-activity` (paged per month with `page`/`total`), `detail-org-groups` (members of group, group settings deviations CF-xxx, per-group spend) in `contracts/detail-view.ts` (`DETAIL_SCHEMA_VERSION = 1`); presenters in `core/application/presenters/` building them from `AuditSnapshot` (pure); `writeDetail()` in `collector/src/main/detail.ts`, new CLI command `detail` and inclusion in `pnpm pipeline`/`build:data`; `maskPii` applied in the presenter (same masking function as `dashboard.json`; user IDs and key IDs masked/hashed per D1); staging in `stage-data.mjs` and `deploy-pages.yml` per D2; `fork:verify` validates `data/sample/detail/*` and the fixture-tenant detail output against the schemas and rejects non-`example.com` e-mails and unmasked identifiers; `data-branch.sh` already mirrors `data/` so no change expected (verify).
- Files: `packages/core/src/contracts/{detail-view.ts,index.ts}`, `packages/core/src/application/presenters/detail-*.ts`, `packages/collector/src/main/{detail.ts,cli.ts,commands.ts}`, `main/demo.ts`, `adapters/demo/demo-source.ts`, `adapters/fixture`/`main/fixture.ts`, `packages/dashboard/scripts/stage-data.mjs`, `.github/workflows/{deploy-pages.yml,...}`, `scripts/{fork-verify,secret-scan}.ts`, `.agents/rules/storage-and-data-routing.md`, `docs/{BLUEPRINT.md sections 4.2/9.1,DEPLOYMENT.md,SETUP.md}`.
- Contract: new, `DETAIL_SCHEMA_VERSION = 1`; `DashboardView` stays v2 (optional additive `detail` availability hint is **not** added; the manifest is the discovery mechanism).
- Demo data: `data/sample/detail/{index,members,api-keys,activity-2026-xx,org-groups}.json` from the synthetic tenant (example.com only), generated by `pnpm demo`; golden updated.
- Tests: schema round trip; presenter unit tests (masking on/off, inactive-member flag source data, key age); pagination boundaries; manifest <-> files consistency; golden; fork:verify negative tests (planted real-looking e-mail, unmasked id); stage-data unit tests for detail files; regression: fixture-tenant detail output validates, `dashboard.json` byte-identical to before for the same input.
- Depends: B2-0. Order: 4. Open: D1, D2.

### B2-3 F-005 Activity search and timeline

- Scope: `#/activity`; filters (time range, activity type, actor, rule match), text search over type/actor, paged timeline (page size 50), deep-linkable filter state in the hash query (`#/activity?type=...&q=...&page=2`), table-first (a timeline list; a small count-by-day chart with table view).
- Files: `pages/Activity.tsx`, `lib/activity-view.ts` (filter/sort/page pure helpers), `components/Timeline.tsx`.
- Contract: reads B2-2 `detail-activity`; none new. Demo: enough events (>120, several types, two months) to exercise paging and month files. 
- Tests: helper unit (filters, paging, month boundary, empty); component (filter by role/name, pagination, empty/missing file, masked/unmasked actors); regression on sample + fixture tenant.
- Depends: B2-2. Order: 7.

### B2-4 F-006 Member view

- Scope: `#/members`; table of role, last activity, group membership, status, inactive highlighted (AC-001 threshold taken from the effective config in the detail file, not hardcoded); sort/filter; icon + label for inactive.
- Files: `pages/Members.tsx`, `lib/members-view.ts`.
- Contract: B2-2 `detail-members`. Demo: members incl. inactive, pending invite, multiple groups.
- Tests: helper unit (inactive derivation edge: never active, exactly at threshold); component (highlight not color-only, sort); `maskPii` on/off; empty/`unavailable` (users dataset not collected); regression sample + fixture.
- Depends: B2-2. Order: 5.

### B2-5 F-007 API key inventory

- Scope: `#/keys`; scopes, age in days, last use, rotation recommendation (AK-001..AK-003 thresholds from effective config); never shows key material (only IDs/hints that the API returns).
- Files: `pages/ApiKeys.tsx`, `lib/keys-view.ts`.
- Contract: B2-2 `detail-api-keys`. Demo: keys that are fresh, near rotation, expired-threshold, unused, over-scoped.
- Tests: helper unit (age/recommendation boundaries, null last-use); component; masked ID display; empty/`unavailable`; fork:verify negative test that a key-like string in a detail file fails; regression.
- Depends: B2-2. Order: 6.

### B2-6 F-008 Alert history and acknowledgement

- Scope: `#/alerts`; history of alerts sent (time, channel, rule, key) with acknowledgement status (open / acknowledged by (masked) / at). Writer: `alerts/history.json` appended by the notify step (record id, ruleId, channel, sentAt, dedupe key); acknowledgement store and update path per D3. Collector command `pnpm alerts ack <id> [--by <label>]` (pure `applyAck()` unit-testable) and, if D3 = workflow, a `workflow_dispatch` workflow that runs it and saves to `data/audit` under the `audit-data` concurrency group. SPA is strictly read-only.
- Files: `core/contracts/alerts-view.ts` (`ALERTS_SCHEMA_VERSION = 1`), `core/application/alerts-history.ts` (append, ack, merge; pure), `collector/src/main/{alerts.ts,commands.ts,cli.ts}`, notify hook (where `notifications.lastSent` is updated), optional `.github/workflows/alert-ack.yml`, `pages/Alerts.tsx`, `lib/alerts-view.ts`, docs (`BLUEPRINT.md` section 10, `DEPLOYMENT.md`).
- Contract: new file schema v1; `state.json` unchanged (history is a separate file) to avoid the `parseState` reset hazard. Demo: sent alerts across channels with a mix of acknowledged / open / stale.
- Tests: append idempotency by dedupe key; ack of unknown id; double ack; concurrent write ordering (merge by id); file-size cap/rotation; component (status icon + label; empty -> "No alerts sent"); regression: notify behaviour and Phase A notification tests unchanged; fixture tenant produces an empty history gracefully.
- Depends: B2-0 (+ D3 answer); not B2-2, but it follows the B2-2 publication rule because acknowledger labels are personal. Order: 12.

### B2-7 F-009 Monthly cost report viewer

- Scope: `#/reports/monthly` (list) and `#/reports/monthly/<id>`; render the structured `reports/monthly/<id>.json` (already produced by the JSON renderer) instead of Markdown; charge-back table per RBAC group; note that group totals may exceed the overall total because of overlapping membership (CHANGE-PLAN section 10 V7) with the overall total taken from the ungrouped value; month list from `reports/monthly/index.json` (new, written with the report).
- Files: `core/contracts/report-view.ts` (schema for the staged subset: id, period, currency, total, byGroup, byModel, byProduct, notes; `REPORT_VIEW_SCHEMA_VERSION = 1`) with a mapper from `ReportDocument`, `collector` writes `reports/monthly/index.json`, `stage-data.mjs` stages `reports/monthly/*.json`, `pages/MonthlyReport.tsx`, `lib/report-view.ts`.
- Contract: new staged-report schema v1 (the on-disk `ReportDocument` JSON is not the public contract). Demo: two months of monthly JSON (current + previous) with overlapping groups so the note renders.
- Tests: mapper unit; chargeback helper (overlap detection, percent of total, rounding); component (note present only when sum > total; table + chart toggle); empty (no report yet); regression: existing Markdown/CSV/HTML reports byte-identical; sample monthly golden updated.
- Depends: B2-0. Order: 9. Open: D2 (cost figures are confidential; same publication rule as detail files? see D2).

### B2-8 F-010 Model x group heatmap and model-mix trend

- Scope: `#/models`; heatmap (rows model, columns RBAC group, single-hue sequential scale, legend with min/max, cell value on hover/focus and a full table view); model-mix trend (share of spend per model per day/week, stacked or small multiples, with table). Needs pairwise model x group data (D6); until then the unit ships the mix trend from `usage.daily`-level data only if available.
- Files: depends on D6: either `collector` extra `group_by[]=model&group_by[]=rbac_group_id` request + `core` projection + contract field, or derive from existing dimensions (not possible exactly). Dashboard: `pages/Models.tsx`, `components/Heatmap.tsx`, `lib/heatmap.ts`.
- Contract: if pairwise data is collected, `DashboardView` gets `usage.byModelGroup` and `usage.modelMix` -> **v3** (aggregates only, safe for `dashboard.json`), otherwise a staged `usage-matrix.json` v1 (D6). Demo: matrix with zero cells, a dominant model, overlapping groups.
- Tests: heatmap scale unit (zeros, single non-zero, equal values, null), legend ticks, color-not-only (value text in cells), table parity; collector gateway test against fixture response for the new `group_by` (fixture tenant file added); component; regression: v2->v3 migration message in `asDashboardView`; Phase A tests updated only for the version constant.
- Depends: B2-0, D6 (possibly a collector/API spike first). Order: 13 (last).

### B2-9 F-011 Theme toggle

- Scope: toggle (light / dark / system) in the nav; sets `data-theme` on `<html>`; persistence in `localStorage` wrapped in try/catch (renders default theme when storage throws); no-flash inline script in `index.html` also guarded.
- Files: `components/ThemeToggle.tsx`, `lib/theme.ts`, `index.html`, `index.css` (only if tokens are missing).
- Contract: none. Demo: none.
- Tests: unit (resolve order stored > system > default; storage throwing); component (aria-pressed/name, persistence across remount, storage blocked still toggles for the session); regression: no change when nothing stored (follows `prefers-color-scheme`).
- Depends: B2-0. Order: 2 (small, validates the B2-0 foundation).

### B2-10 F-012 Organization / group drill-down

- Scope: `#/orgs/<id>` and `#/groups/<id>`: members, settings deviations (CF-xxx results filtered to the entity), spend breakdown; links from Members and Compliance evidence.
- Files: `pages/{Org,Group}.tsx`, `lib/drilldown-view.ts`.
- Contract: B2-2 `detail-org-groups` (spend per group uses ungrouped-vs-group note from V7). Demo: two linked orgs, three groups with a deviation each.
- Tests: helper unit (join of results to entity, unknown id -> not found page, group with no members); component; deep link opens directly; regression sample + fixture tenant (multiple orgs/groups present in the tenant fixtures).
- Depends: B2-2 (and B2-4 for member links, soft). Order: 8.

### B2-11 F-013 Archive inventory

- Scope: `#/archive`; years, snapshot counts, sizes. Collector function `summarizeArchive(store)` (counts per year, compressed bytes, oldest/newest id), shared with B3 (#38) capacity measurement; writes `inventory/archive.json`; staging as aggregate (counts/bytes only, safe for Pages -> published with `dashboard.json` rules, no per-person data).
- Files: `collector/src/adapters/storage/archive-inventory.ts`, `core/contracts/archive-view.ts` (v1), `main/detail.ts` (or `inventory.ts`), `pages/Archive.tsx`, `FileStore` listing helper if missing.
- Contract: new v1. Demo: archive across 3 years (synthetic sizes, e.g. via in-memory store) ; fixture tenant: empty archive.
- Tests: summarize unit (multi-year, empty, unrelated files ignored, incomplete dirs); component (empty -> "No archived snapshots"); real-data validation stays in B3 (#38).
- Depends: B2-0 (not B2-2). Order: 11.

### B2-12 F-014 Effective configuration view (read-only)

- Scope: `#/config`; disabled rules, parameters/thresholds, custom rules, notification policy (channels listed by type only, never webhook URLs/addresses/credentials). Collector emits `inventory/config.json` from the loaded effective config via an allowlist mapper (not a blind dump).
- Files: `core/contracts/config-view.ts` (v1), presenter, `collector/src/main/detail.ts`, `pages/Config.tsx`.
- Contract: new v1. Demo: disabled rule, overridden param, one custom rule, a notification policy. Also feeds AC-001/AK thresholds used by B2-4/B2-5 (the detail files embed the thresholds they need, so no hard dependency).
- Tests: allowlist mapper unit incl. a negative test that secret-shaped values (webhook URL, SMTP password, `ALERT_EMAIL_*`) never appear; `secret-scan` over generated sample; component; regression.
- Depends: B2-0. Order: 10.

## Open design decisions (owner input required)

| ID | Decision | Options | Recommendation |
| :-- | :-- | :-- | :-- |
| D1 | Detail-data-file contract | (a) one `detail.json`; (b) manifest + per-entity files with own `schemaVersion`, activity paged by month; (c) bump `DashboardView` to v3 with embedded detail | (b): small files fetched on demand, `dashboard.json` stays v2 and aggregate-only. Identifier handling: user/key IDs masked consistently with `maskPii` (stable short hash) so rows stay joinable without raw IDs. |
| D2 | Publication condition for detail files (per-person data, also monthly cost) | (a) never on Pages, local viewing only; (b) staged only when `PAGES_DATA_SOURCE=live` **and** a new explicit repo variable `PAGES_DETAIL_DATA=true`, documented as valid only for Private Pages (DEPLOYMENT Option 1); (c) same as `dashboard.json` | (b) with a hard default of off. The workflow cannot detect Pages visibility, so the variable is an explicit owner attestation; the SPA shows "not published" when files are absent. Question: is `monthly/*.json` (cost per group) allowed under the existing `PAGES_DATA_SOURCE=live` alone? Recommend yes only if it contains no per-person data. |
| D3 | F-008 acknowledgement storage and update | (a) `alerts/ack.json` on `data/audit`, updated by `pnpm alerts ack` and a `workflow_dispatch` workflow; (b) one GitHub Issue per alert, ack = close; (c) no ack, history only | (a) (testable, no extra GitHub dependency, offline-friendly). Keep it out of `state.json` (the reset-on-unknown-version behaviour makes in-place changes risky). Is a workflow-dispatch trigger acceptable for who may acknowledge (repo write access)? |
| D4 | Hash routing implementation | in-house ~60-line router vs `react-router` | In-house (BLUEPRINT 9.3 lists dependencies as React/Recharts/Tailwind only; hash routing is enough for Pages). Requires editing that BLUEPRINT line. |
| D5 | `DASHBOARD_DATA_SOURCE` semantics | default unchanged (live else sample) vs default `sample` | Keep current default per #37; `pnpm test`/E2E always set `sample` or `fixtures`; `fixtures` reads gitignored `data/fixture/` produced by `pnpm fixture`. Is a new gitignored `data/fixture/` directory acceptable (must also be forbidden on `main` by fork:verify)? |
| D6 | F-010 model x group data | (a) add a collector request grouped by model + rbac_group_id (verify the Analytics API supports multi-`group_by`; the fixture tenant has no such response today), publish as aggregate in `DashboardView` v3; (b) staged `usage-matrix.json` v1; (c) heatmap limited to what exists and mix trend only | Spike inside B2-8 first (confirm API support with a captured response, see B1 capture tooling). Prefer (b) to avoid a v3 bump; (a) if the owner wants it on the overview. |
| D7 | Export scope (B2-1) | export all rows vs the filtered view | Filtered view with the filter named in the file and on the button; plus an explicit "export all" button. |
| D8 | F-009 data source | structured `reports/monthly/<id>.json` (existing JSON renderer output) mapped to a small public schema vs adding the full `ReportDocument` to contracts | Small mapped schema (keeps the report internals out of the public contract). |

## Verification Plan

### Automated Tests

This PR only adds documents: `pnpm secret-scan` and `pnpm format:check` (run before commit). Each later work unit runs `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`, plus `pnpm lint && pnpm format:check`, plus `pnpm demo` followed by a clean `git diff --exit-code data/sample` after regeneration.

### Manual Verification

- Per unit: `DASHBOARD_DATA_SOURCE=sample pnpm dev` and `DASHBOARD_DATA_SOURCE=fixtures pnpm dev` after `pnpm fixture`; open each route directly by URL, use back/forward, check 390 px width and both themes.

## Out of scope

Real-tenant verification (B1 human task), E2E/a11y automation (B5 #40), F-015 (#42), archive validation on real data (B3 #38), Work-Unit Issue creation (after approval).
