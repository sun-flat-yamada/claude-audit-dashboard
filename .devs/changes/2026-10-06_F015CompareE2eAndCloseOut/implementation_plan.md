# F-015 PR5: compare E2E and axe suite, docs close-out

Closes #119 (Work-Unit Issue, sub-issue of #42). The last F-015 PR (design D-5, PR5 row of `.devs/changes/2026-10-05_F015MultiTimePointSampleData/implementation_plan.md`). Merged inputs: PR1 #103 (#101), PR2 #108 (#106), PR3 #113 (#110), PR4 #118 (#116).

## User Review Required

> [!IMPORTANT]
> - Owner decisions applied: the `optional-sources` profile carries the multi-point data (it is a copy of the 3-point sample with the optional sources on at T3); the fixture tenant stays single-point to exercise "comparison not possible".
> - Two derived data profiles are added to `scripts/e2e-prepare.mjs` (each validated against the core contract schemas, like the existing derived profiles): `compare-archived` (sample whose `detail/compare/index.json` also lists two `archived` points) and the `empty` profile now also carries an empty compare index (`points: []`).
> - Whether `Closes #42` is used is decided at the end by reading #42's acceptance criteria one by one (see the walkthrough).

## Proposed Changes

### packages/dashboard (E2E only; app code changes only where axe or the specs find a real defect)

#### [NEW] `e2e/support/compare.ts`
- Loads the compare index and point summaries of the profile under test through `request`, builds the expected diff with `diffTimePoints` from `@claude-audit/core/contracts`, and exposes locators / helpers shared by the compare specs.

#### [NEW] `e2e/sample/compare.spec.ts`
- 3-point sample: default selection, selectors, swap, hash and deep link (reload), back / forward, regressed-first order with icon + label, chips with counts, search, coverage, KPI deltas, Markdown / CSV / JSON downloads (core formatter and the collector goldens for the sample's three pairs, deterministic file names), unknown ids and failure states via route interception.

#### [NEW] `e2e/sample/compare-a11y.spec.ts`, `compare-keyboard.spec.ts`
- Keyboard only: skip link, selectors, swap, chips, search, export buttons, focus order. axe (wcag2a, wcag2aa, critical / serious 0) on `/compare` in light, dark and 390 px (no horizontal page scroll), including a regression filter, an export done and the archived option focus.

#### [NEW] `e2e/optional-sources/compare.spec.ts`, `e2e/fixtures/compare.spec.ts`, `e2e/compare-archived/compare-archived.spec.ts`
- optional-sources: multi-point data, same core assertions against that profile's files. fixtures: one point, "comparison not possible". compare-archived: disabled archived option, real `pnpm cli restore <id>` / `pnpm build:detail --snapshot <id>` text, archived id in the deep link, a11y of that state.

#### [MODIFY] `e2e/unavailable/not-published.spec.ts`, `e2e/empty/empty-states.spec.ts`, `e2e/stale/schema-mismatch.spec.ts`
- not published / not collected (manifest via route interception) guidance, empty index guidance, stale compare file named with `pnpm build:detail`.

#### [MODIFY] `scripts/e2e-prepare.mjs`, `scripts/e2e-profiles.mjs`, `playwright.config.ts`, `scripts/__tests__/e2e-profiles.test.mjs`
- New profile `compare-archived`, empty compare index in the `empty` profile, project mapping.

### Docs

`docs/DASHBOARD-FEATURES.md` (F-015 Implemented, feature matrix and Testing rows), `docs/BLUEPRINT.md` (§9, §17, §18.2 / §18.3 profile and spec lists), `README.md` / `README.ja.md` feature lists, `CHANGELOG.md`, `CONTRIBUTING.md` when the run instructions change.

## Verification Plan

### Automated Tests
- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`, `pnpm lint && pnpm format:check && pnpm audit:deps`.
- `pnpm test:e2e` (full suite once) and `pnpm test:e2e --repeat-each=5` limited to the compare specs; `retries: 0` stays.

### Manual Verification
- Read #42's acceptance criteria one by one and record the status in the walkthrough.
