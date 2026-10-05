# Walkthrough: B2-8 F-010 Model x group heatmap and model mix trend

## Summary

`#/models` now shows spend per model and RBAC group as a heatmap (single-hue sequential continuous scale, legend, value in every cell, hover / focus readout, "View as table") and the model mix per month. The data is the staged `detail/usage-matrix.json` (own `schemaVersion = 1`, decision D6 (b)); `DashboardView` stays v2. The pairwise `group_by[]` call is **assumed, not confirmed** for the Analytics API, so the collection is opt-in (`sources.usageMatrix.enabled`, default off) and fail-soft. Closes #75, refs #37. This is the last B2 unit.

## Spike result (Step A, recorded before implementation in the plan)

| Question | Finding | Status |
| :-- | :-- | :-- |
| `group_by` is an array parameter | `group_by[]=model&group_by[]=workspace_id` in the Admin Usage / Cost API reference notes; `buildUrl` already repeats `group_by[]` | Confirmed by repo docs |
| Analytics `usage_report` / `cost_report` accept `model` + `rbac_group_id` together | Not stated anywhere; the endpoint mirrors the Admin Usage / Cost API | Assumed (plausible) |
| Allowed pairs, `null` keys, row cap with two dimensions | No captured response (all fixtures are single-dimension) | Unknown |

Outcome: implemented behind an opt-in, not as a 14th snapshot dataset, so the 13 datasets, coverage, OP-002 and the score are identical with or without it. A rejected request is stored as `unavailable` (reason shown on the page), any other failure as `error`; the pipeline never stops.

## Changes Made

### packages/core

- `contracts/usage-matrix.ts` (`USAGE_MATRIX_SCHEMA_VERSION = 1`, `detail/usage-matrix.json`), manifest kind `usage-matrix`, `checkDetailBundle` rules (schema, count, cells refer to listed models / groups / months, duplicate keys, `example.*` e-mails).
- `presenters/usage-matrix-view.ts`: `aggregateMatrixRows()` (daily to monthly, order independent) and `buildUsageMatrixView()` (caps 12 models x 30 groups, ungrouped model totals and mix, names from the group directory); `detail-view.ts` part (entry only when the collection is on).

### packages/collector

- `AnalyticsApi.costMatrix()` (two `cost_report` series, tolerant zod read); existing single-dimension requests unchanged (the shared `buckets()` takes the field list).
- `sources.usageMatrix { enabled: false, lookbackDays: 90 }`, optional `Container.matrix`, `main/usage-matrix.ts` (`collectUsageMatrix`, tolerant `readUsageMatrixInput`), `usage-matrix` command (also `pnpm usage-matrix`) in `pipeline` after `collect`, `writeDetail` emits the file. `fork:verify` tracked-path guard and `.gitignore` gain `data/usage-matrix`.
- Demo: `demoUsageMatrixInput()` (3 months, dominant falling model, zero cell, no-group column, overlapping groups).

### packages/dashboard

- `lib/usage-matrix-view.ts`, `components/{Heatmap,MixTrend}.tsx`, `pages/Models.tsx`, route `/models`, nav "Models", tokens `--seq-lo` / `--seq-hi` (light and dark).

### Docs

`DASHBOARD-FEATURES.md` (F-010 section, matrix, detail table, planned list), `BLUEPRINT.md` (4.2 table, section 9, config keys), `API-MAPPING.md`, `DEPLOYMENT.md`, `SETUP.md`, `storage-and-data-routing.md`.

## Decisions and limits

- Cost is the only measure (no token matrix); the mix is the ungrouped per-model value, never the sum of group cells (V7). No row or column totals.
- Published like the other detail files (D2: `PAGES_DETAIL_DATA`), because group cost and names are confidential.
- Search narrows each dimension on its own: a query that matches only group names keeps every model.
- Cell value text sits on a surface-colored chip so its contrast never depends on the fill; the validated blue ramp provides the fill (not a rainbow, no animation).
- Not verified here: the pairwise response of a real tenant (human task, `--capture-raw`), and a visual check in a real browser at 390 px (jsdom tests cover structure, states and keyboard only; B5 #40 covers E2E / a11y).
- After the plan commit, one sentence of the plan was corrected (the B2-12 allowlist is not touched, so the sample `config.json` stays byte-identical).

## Verification Results

| Stage | Command | Result |
| :-- | :-- | :-- |
| Quality gate | `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build` | Pass (exit 0) |
| Lint | `pnpm lint` | Pass (exit 0) |
| Format | `pnpm format:check` | Pass (exit 0) |
| Dependency audit | `pnpm audit:deps` | Pass (no known vulnerabilities) |
| Golden | `pnpm demo` twice | Stable; only `detail/index.json` (one entry) changed and `detail/usage-matrix.json` is new |
| Tests | core 164, collector 138, dashboard 335 | All pass |

## B2 completion checklist (for closing tracking issue #37)

Every item is closed or ready with this PR. Issue numbers are the Work-Unit Issues (sub-issues of #37); PRs were rebase-merged.

| Unit | Feature | Issue | PR |
| :-- | :-- | :-- | :-- |
| B2-0 | Test foundation, data-source switch, hash routing | #49 | #50 |
| B2-9 | F-011 Theme toggle | #51 | #52 |
| B2-1 | F-003 Compliance results export | #53 | #54 |
| B2-2 | Detail data file contract, writer, staging, publication condition (enables F-005 to F-007, F-012) | #57 | #58 |
| B2-4 | F-006 Member view | #59 | #60 |
| B2-5 | F-007 API key inventory | #61 | #62 |
| B2-3 | F-005 Activity search and timeline | #63 | #64 |
| B2-10 | F-012 Organization / group drill-down | #65 | #66 |
| B2-7 | F-009 Monthly cost report viewer | #67 | #68 |
| B2-12 | F-014 Effective configuration view | #69 | #70 |
| B2-11 | F-013 Archive inventory | #71 | #72 |
| B2-6 | F-008 Alert history and acknowledgement | #73 | #74 |
| B2-8 | F-010 Model x group heatmap and model mix trend | #75 | this PR |

- [x] F-003 (#53 / #54), F-005 (#63 / #64), F-006 (#59 / #60), F-007 (#61 / #62), F-008 (#73 / #74), F-009 (#67 / #68)
- [ ] F-010 (#75 / this PR: merge it)
- [x] F-011 (#51 / #52), F-012 (#65 / #66), F-013 (#71 / #72), F-014 (#69 / #70)
- [x] Foundations B2-0 (#49 / #50) and B2-2 (#57 / #58)
- Done condition of #37 ("B2-0 to B2-12 closed; every detail view displays and is deep-linkable from the `pnpm demo` sample and the fixture tenant"): the sample covers all routes (`#/members`, `#/keys`, `#/activity`, `#/reports/monthly`, `#/models`, `#/config`, `#/archive`, `#/alerts`, `#/orgs`, `#/groups/<id>`); on the fixture tenant the views for data the tenant does not produce (monthly report, model x group matrix) show "not published" by design.
- Open items outside B2: real-tenant confirmation of the pairwise `group_by[]` response (B1-style capture, human task), E2E / a11y (B5 #40), archive validation on real data (B3 #38).
