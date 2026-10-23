# Walkthrough: Ledger daily member activity and model-only cost (U4)

## Summary

Resolves #158 (parent #154, builds on the U3 ledger of #157). A new opt-in dataset
`memberActivityDaily` fetches the Enterprise Analytics `users` endpoint in single-day mode
(`date=<YYYY-MM-DD>`) for the last published days and lands in the ledger as a `daily` dataset
keyed by `date|userId`. The model-only cost and usage series (`group_by[]=model`, already one of
the four dimensions of `usage` / `cost`) lands in the ledger as `date|model|<model>`; every
`usage_report` / `cost_report` request is now limited to 31-day windows, and `pnpm ledger update`
warns when a day's model rows do not add up to its total. Facts that need a real tenant are in #166.

## Changes Made

### Core

- `domain/model/optional-entities.ts`, `optional-datasets.ts`: `MemberDayActivity`, dataset
  `memberActivityDaily` (source flag `memberActivityDaily`, off by default).
- `domain/ledger/datasets.ts`: `memberActivityDaily` registered as `daily` (`date|userId`).
- `domain/ledger/reconcile.ts` (new): `breakdownGaps()`, `snapshotBreakdownGaps()` (model rows vs.
  total, cost 0.005 USD and tokens 0 tolerance; group rows are never checked because they overlap).
- `application/use-cases/ledger.ts`: `LedgerUpdateResult.gaps` (one finding per day, newest wins).

### Collector

- `adapters/anthropic/member-daily-api.ts` (new): latest published day (13:30 UTC next day),
  `dailyActivityDays()` (never before 2026-01-01), one `next_page` series per day with the 410
  restart, a 400 on the newest day drops only that day.
- `adapters/anthropic/http-client.ts`: optional `minIntervalMs` / `now` pacing (1.5 s for the
  daily series: at most 40 of the 60 requests a minute).
- `adapters/anthropic/analytics-api.ts`: shared `memberActivityOf()` mapper; `usageReport` /
  `costReport` split the range into 31-day windows per dimension.
- `optional-collectors.ts`, `main/container.ts` (paced Analytics client), `infrastructure/config.ts`
  (`sources.memberActivityDaily { enabled: false, lookbackDays: 3 }`), `storage/repositories.ts`
  (sort key), `demo/demo-member-daily.ts`, `fixture/optional-fixture.ts` (per-day replay by
  `date`), `main/fixture.ts`, `main/ledger.ts` (gap warnings).
- Fixtures: `__tests__/fixtures/member-daily/` (two pages of one day, example.com only); covered by
  `scripts/secret-scan.ts` and `scripts/fork-verify.ts`.
- Tests: `member-daily-api.test.ts` (availability, paging, 410 restart, newest-day 400, pacing),
  `analytics-model-cost.test.ts` (model rows add up to the total, 31-day windows),
  `main/__tests__/ledger-sources.test.ts` (fixture tenant -> ledger, nothing per member published).

### Dashboard (E2E only)

- `scripts/e2e-profiles.mjs`, `e2e/optional-sources/coverage.spec.ts`: the dataset in the
  optional-sources and optional-unavailable profiles.

### Docs

- `docs/API-MAPPING.md` §4 / §6 / §8, `docs/BLUEPRINT.md` §5.4 / §6.5, `docs/SETUP.md`,
  `docs/ARCHITECTURE.md`, `.agents/rules/storage-and-data-routing.md`, `CHANGELOG.md`, `.env.example`.

`data/sample/` is unchanged (`pnpm demo` regenerates it byte-identically; the source is off in the
default profile).

## Verification Results

| Stage                    | Command                          | Result                                                    |
| :----------------------- | :------------------------------- | :-------------------------------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`               | ✅ Clean (exit 0)                                         |
| TypeScript Check         | `pnpm typecheck`                 | ✅ Pass (exit 0)                                          |
| Unit & Integration Tests | `pnpm test`                      | ✅ core 342, collector 362, dashboard 464, scripts 83 pass |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | ✅ 0 leaks (exit 0)                                       |
| Production Build         | `pnpm build`                     | ✅ Built                                                  |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | ✅ Clean                                                  |
| E2E / a11y               | `pnpm test:e2e`                  | ✅ 565 passed, 250 skipped (per-profile skips)            |
| Sample regeneration      | `pnpm demo`                      | ✅ `data/sample/` unchanged                               |
