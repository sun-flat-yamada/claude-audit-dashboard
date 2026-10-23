# Walkthrough: Ledger backfill within the API retention windows (U5)

## Summary

`pnpm ledger backfill --from <yyyy-mm> [--to <yyyy-mm>] [--datasets a,b] [--force]` and the manual
**Ledger Backfill** workflow fill the monthly ledger with past months straight from the APIs (#159,
parent #154). The request is planned purely in core (one unit per month and dataset, truncated to
what each API still serves, the cut-off ranges reported as warnings), each unit is fetched over a
paced client per API family, merged with the existing idempotent `updateLedger` and recorded in
`data/ledger/BACKFILL.json`, so an interrupted run continues. State datasets are reported as not
backfillable. Real-tenant facts are split out into #168 (`needs-real-tenant`, sub-issue of #154).

## Changes Made

### Core (`@claude-audit/core`, pure)

- `src/domain/ledger/backfill.ts`: `backfillMonths`, `retentionStart` (first whole UTC day of the
  last N days), `planBackfill` (units + exclusions with reason `epoch` / `retention`),
  `isFinalBackfill` (resume rule: covered range fetched 8 days after its end), `backfillUnitKey`.
- `src/application/use-cases/ledger-backfill.ts`: `backfillLedger` (fetch → one-dataset in-memory
  snapshot → `updateLedger` → progress), outcomes `fetched` / `skipped` / `unavailable` / `failed`.
- `src/application/ports.ts`: `BackfillSource`, `BackfillProgress`, `BackfillProgressStore`.
- `src/domain/ledger/kinds.ts`: a roll-up whose window ended in an earlier month than the collection
  is filed under that month (regular collections unchanged).
- Tests: `domain/__tests__/ledger-backfill.test.ts`, `application/__tests__/ledger-backfill.test.ts`
  (shared `memory-ledger.ts` helper extracted from `ledger-update.test.ts`).

### Collector

- `adapters/anthropic/backfill-sources.ts`: registry of the 10 backfillable datasets with their API
  limits; paced intervals `BACKFILL_MIN_INTERVAL_MS` (Analytics 1100 ms, Compliance 110 ms);
  date-granular periods starting today are skipped; Activity Feed windows end `lagMinutes` before now.
- `analytics-api.ts` (`listUserActivityIn`, `endingDate`, `dateWindow`), `feature-usage-api.ts`
  (`rollup(kind, range, now)`), `member-daily-api.ts` (`listDailyActivityIn`, `publishedDaysIn`).
- `adapters/storage/backfill-progress.ts`: `ledger/BACKFILL.json` (zod-validated, unreadable stops).
- `main/ledger-backfill.ts` + `main/ledger.ts`: argument parsing, default datasets (optional ones only
  when enabled, `sources.disabled` respected), reports; `ledger update` runs first.
- `main/container.ts`: `backfill` registry over paced clients; `httpTiming` option (clock and sleep).
- Tests: `__tests__/backfill-tenant.ts` (synthetic tenant enforcing the documented limits with 400),
  `main/__tests__/ledger-backfill.test.ts` (2026-01 to the current month without gaps; 365-day
  exclusion with warnings; resume after a failed unit; rate limits with a virtual clock, incl.
  `retry-after`), `adapters/anthropic/__tests__/backfill-sources.test.ts`.

### CI

- `.github/workflows/ledger-backfill.yml`, `.github/scripts/validate-backfill-inputs.sh`;
  `scripts/__tests__/ledger-backfill-workflow.test.ts`; the workflow is added to the visibility and
  `AUDIT_CONFIG_OVERRIDES` wiring lists.

### Docs

- `docs/SETUP.md` (Step 4 first-time backfill, _Backfilling the ledger_), `docs/BLUEPRINT.md` §6.5,
  `docs/API-MAPPING.md` §2.1 / §4, `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md` §10,
  `.agents/rules/storage-and-data-routing.md`, `CHANGELOG.md`.

## Verification Results

| Stage                    | Command                          | Result                                                    |
| :----------------------- | :------------------------------- | :-------------------------------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`               | ✅ Clean (exit 0)                                         |
| TypeScript Check         | `pnpm typecheck`                 | ✅ Pass (exit 0)                                          |
| Unit & Integration Tests | `pnpm test`                      | ✅ core 358, collector 375, dashboard 464, scripts 92 pass |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | ✅ 0 leaks (exit 0)                                       |
| Production Build         | `pnpm build`                     | ✅ Built                                                  |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | ✅ Clean                                                  |

`data/sample/` is unchanged (`pnpm demo` golden test passes); the dashboard is untouched, so the
E2E suite is not affected.
