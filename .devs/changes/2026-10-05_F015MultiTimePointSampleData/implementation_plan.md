# F-015 PR1: multi-time-point synthetic data and design decisions

Closes #101 (Work-Unit Issue, sub-issue of #42), Refs #42 (F-015 snapshot / report diff view). Prerequisites #29 / #37 / #38 / #39 / #40 stay partly open (human real-tenant work); the owner decided to proceed. Merged inputs: B1 #47, B2 #50 to #76, B3 #86, B4 #89, B5 #100.

This is the FIRST of several F-015 PRs, as #42 allows ("multi-time-point synthetic data" first). It (a) settles the open design decisions for the whole of F-015 (section "F-015 design decisions") and (b) makes `pnpm demo` collect and judge the synthetic tenant at three fixed-clock time points. It implements none of the diff core, the compare UI, the export, the integration test or the E2E additions.

## User Review Required

> [!IMPORTANT]
> - **The `DashboardView` contract is NOT changed** and the root files of `data/sample/` (`dashboard.json`, `compliance-report.json`, `weekly-report.md`, `monthly-report.md`, `detail/**`) stay byte-identical. The latest time point (T3) is today's single-point sample, produced by the unchanged code path. The two earlier points are additional files under `data/sample/history/<snapshot id>/` (`dashboard.json`, `compliance-report.json`; existing contracts only).
> - **`compliance.history` in the committed `dashboard.json` keeps its single point.** A real pipeline accumulates reports and therefore shows N points; the sample deliberately does not, so no dashboard-visible sample data and no E2E expectation changes in this PR. Each earlier point's own `history/<id>/dashboard.json` carries its cumulative history (T2: 2 points). Open question for the owner: widen the sample's trend to 3 points (changes `dashboard.json` and the E2E expectations that rely on the one-point "not enough history" display).
> - Raw snapshots of the earlier points are not committed (activity history makes them large); they are regenerated in memory on every `pnpm demo`. What is committed per earlier point is the judged report plus the dashboard view (coverage, KPIs, results), which is exactly the input the later summary builder needs.

> [!WARNING]
> - The B4 optional-dataset enabling is only expressible in the `optional-sources` profile (the default profile keeps optional sources off at every point, otherwise T3 could not stay identical). In that profile T1 / T2 have the optional sources off and T3 has them on. That profile's directory is gitignored and checked by `fork:verify` when present.
> - `fork:verify` gains a `history/` check (contract, `source: "demo"`, `example.*` only); no new contract is introduced.

## F-015 design decisions (for all F-015 PRs)

### D-1 Data path: option (b), per-time-point summary files (decided)

Past time points are published as detail-style files with their own `schemaVersion`, not as a pre-computed diff inside `dashboard.json`.

| Aspect | (a) diff pre-computed in `dashboard.json` | (b) summary files + diff in the SPA (chosen) |
| --- | --- | --- |
| Contract | `DashboardView` v3: every consumer, `fork:verify`, fixture and E2E profiles regenerate | `DashboardView` v2 untouched; new file kinds with their own version, like `usage-matrix.json` (B2-8, #75) |
| Free pair selection | Pair fixed at build time; N points need N x N diffs or a single base | Any two points; the diff is a pure function of two summaries |
| Publishing | Past results become part of the always-public `dashboard.json` | Only under the `PAGES_DETAIL_DATA=true` gate (decisions D1 / D2: org-level results and cost are confidential) |
| Size | Grows `dashboard.json` | Small files (about 6 KB per point), fetched on demand |

Files (published copy, staged like the other detail files; listed in the `detail/index.json` manifest as a new kind, `unavailable` when absent):

- `detail/compare/index.json`: the selectable points, newest first, capped (default 90, same as the report history limit): `{ schemaVersion, generatedAt, points: [{ id, collectedAt, state: 'summary' | 'archived', score }] }`.
- `detail/compare/<snapshot id>.json`: one `TimePointSummary` `{ schemaVersion, id, collectedAt, score, assessed, rules: [{ id, name, category, severity, status }], disabledRules: string[], datasets: [{ name, status, count }], kpis: [{ id, label, unit, value }] }`. Statuses and counts only: no evidence, no labels, no per-person data, therefore no identifier masking is needed (the masked-id rules still apply if a later field adds identifiers). `fork:verify` validates it with the detail contract checks.
- Persistent source (not published as is): the collector writes a summary next to each judged snapshot (`data/summaries/<snapshot id>.json` on `data/audit`), because snapshots are archived after `retention.snapshotDays` and a report alone has neither coverage nor KPIs. `build:detail` copies the newest N into `data/detail/compare/` and writes the index.

### D-2 Archived snapshots and the restore path

- A summary outlives the snapshot, so an archived point stays comparable when its summary exists (`state: 'summary'`).
- Archived points without a summary (written before this feature) are listed from the archive inventory (`archive.json` knows the ids) with `state: 'archived'`: the UI explains how to bring them back (`pnpm cli restore <id>` then `pnpm build:detail --snapshot <id>`, which writes that point's summary into the store) instead of offering a broken selection.
- The integration test (later PR) uses the B3 synthetic long history (#82) and the restore round trip; `restore` stays byte-identical and never overwrites.

### D-3 Where the diff is computed

- Pure functions in `@claude-audit/core`: `buildTimePointSummary(report, coverage, kpis)` (collector side) and `diffTimePoints(base, target)` (SPA side) with the summary schema. They live next to the other pure, contract-adjacent helpers and are exported through `@claude-audit/core/contracts` (precedent: `COMPLIANCE_EXPORT_COLUMNS`, `checkDetailBundle`), so the dashboard keeps importing only `@claude-audit/core/contracts`. No Node API, no I/O, no clock access.
- Status ranks for classification: `pass` < `warning` < `fail` are assessed; `skipped` and `error` are "not assessed". Changes: `regressed`, `improved`, `unchanged`, `added` (rule only in target), `removed` (rule only in base), `assessed` (not assessed -> assessed), `unassessed` (assessed -> not assessed). The 5 x 5 table is tested in full. The score delta is reported next to the change of the assessed-rule count.
- Dataset coverage changes use `ok` / `unavailable` / `error`, including datasets present on one side only (B4 datasets). KPI deltas: members, MAU, seat utilization, month-to-date cost, open findings, score.
- Export (Markdown / CSV / JSON) reuses the B2-1 export helper (RFC 4180 and formula-injection guard).

### D-4 Routing and UX

`#/compare?base=<id>&target=<id>` (query support from #83). Fewer than two points: a "comparison not possible" notice with the reason. 390 px without horizontal scroll, status as icon + label + color.

### D-5 Proposed split of the remaining F-015 work (each one Work-Unit Issue, one PR, all `Refs #42`)

| PR | Content | Notes |
| --- | --- | --- |
| PR2 | Core: `TimePointSummary` schema, `buildTimePointSummary`, `diffTimePoints`, export formatters; collector writes the summary store and `detail/compare/*`; manifest kind, `fork:verify`, sample regeneration (new `detail/compare/*` files in `data/sample/`), 5 x 5 table-driven tests, export goldens built from the PR1 `history/` files | The only PR that changes `data/sample/detail/`; may be split into core and collector if it grows |
| PR3 | Compare UI: `#/compare` route, point selectors, rule / coverage / KPI diff, empty / single-point states, export buttons, component tests | Dashboard imports only the contracts entry |
| PR4 | Archived-snapshot comparison integration test (B3 synthetic long history + `restore` + `build:detail --snapshot`), `archived` state in the index | No UI change |
| PR5 | E2E and axe additions to the B5 suite (all data profiles incl. single-point and unavailable), docs sync (`DASHBOARD-FEATURES` F-015 to Implemented, `BLUEPRINT` §9, README, CHANGELOG) | Closes #42 |

Open questions for the owner: (1) cap of selectable points (proposal 90); (2) persistent summary store location `data/summaries/` on `data/audit` (proposal) versus deriving from reports; (3) widen the sample trend to 3 points (see above); (4) whether the E2E profiles other than the default sample need their own multi-point data in PR5 (proposal: the `optional-sources` profile yes, fixtures profile single point to test the notice).

## Proposed Changes

### packages/collector

#### [NEW] `src/adapters/demo/demo-history.ts`

- `DEMO_TIME_POINTS`: T1 = latest - 28 days (`2026-09-01T12:00Z`), T2 = latest - 14 days (`2026-09-15T12:00Z`), T3 = `DEMO_NOW`. Each point is a `DemoScenario`: rules disabled, rule parameter overrides, datasets forced `unavailable` / `error`, per-dataset item transforms (members, adoption, cost, usage, settings, activities, credentials, invites, spend limits). A wrapper turns the demo collectors into the collectors of one point. T3 has the empty scenario.
- Intended changes (rule: T1 / T2 / T3):
  - `pass -> fail`: AK-003 (T1 -> T2, the SIEM key ages), CF-003 (T2 -> T3, IP allowlist off in one org), UA-001 (T2 -> T3)
  - `fail -> pass`: CF-006 (T1 -> T2), AC-002 and OP-002 (T2 -> T3)
  - `warning -> pass`: AM-002 (T1 -> T2); `pass -> warning`: AM-006 (T1 -> T2)
  - `pass -> skipped`: AC-004, UA-003, UA-004 (T1 -> T2, dataset not collected); `skipped -> fail` / `warning` afterwards
  - `error -> pass`: UA-001 (T1 invalid parameter -> T2)
  - rule added / removed (`disabledRules`): DG-001, AM-007 added and AK-002 removed (T1 -> T2), AK-002 added again (T2 -> T3)
  - coverage: `invites` ok -> error -> ok, `spendLimits` ok -> unavailable -> ok, `groups` unavailable -> error -> ok
  - members 34 -> 43 -> 40, MAU 23 -> 32 -> 30, cost and usage up then down
- The exact table is asserted by a test, not by this list.

#### [MODIFY] `src/main/demo.ts`

- Keep the T3 path unchanged (fresh store, same calls, same bytes). Add the earlier points in a separate store: per point set the state, collect with the point's collectors and clock, judge with the point's parameters / disabled rules, build the dashboard view from the cumulative reports, and emit `history/<snapshot id>/dashboard.json` and `history/<snapshot id>/compliance-report.json`. `optional-sources`: T1 / T2 without the optional collectors, T3 with them.
- Deterministic (fixed clocks, seeded data) and fast (no timers, one in-memory-sized store per point).

### scripts

#### [MODIFY] `scripts/fork-verify.ts`

- Validate `history/*/dashboard.json` (contract, `source: "demo"`) for `data/sample/` and `data/sample-optional-sources/`; the e-mail domain check already walks every file.

### Tests

#### [NEW] `src/main/__tests__/demo-history.test.ts`

- Evaluates the points and asserts every intended transition between consecutive points by comparing rule statuses, coverage statuses, disabled rules and KPIs; asserts T3 equals the shipped root sample and that the point ids are strictly increasing; asserts `history/` of the committed sample equals the generated file set (no stale files).

#### [MODIFY] `src/main/__tests__/sample-and-docs.test.ts`

- The golden already compares every generated file with the committed one; add the file-set check for `history/`.

### Data and docs

- `data/sample/history/**` regenerated by `pnpm demo` (new files only; list in the PR).
- `docs/DASHBOARD-FEATURES.md` F-015 status text (Planned, multi-point data available), `docs/BLUEPRINT.md` §9 / §17 notes, `CHANGELOG.md`.
- B3 synthetic long history (`packages/collector/src/adapters/` long-history helpers) and the B1 fixture tenant are not touched.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- `pnpm test:e2e` (full suite, about 4 minutes; no dashboard-visible data should change)
- `pnpm demo` twice: `git status` shows no diff the second time (determinism); `git diff --stat data/sample` shows only new files under `history/`.

### Manual Verification

- Inspect `data/sample/history/*/compliance-report.json` summaries against the transition table in the test.
