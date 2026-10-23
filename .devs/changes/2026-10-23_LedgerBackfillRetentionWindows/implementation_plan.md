# Implementation Plan - Ledger backfill within the API retention windows (U5)

Resolves #159 (parent tracking #154). Prerequisites #157 (U3: ledger core) and #158 (U4: daily
member activity, 31-day report windows, `HttpClient` pacing) are merged.

## Context & Problem

The ledger (U3) only records what the 6-hourly collections fetched: the Activity Feed starts with a
7-day window, the Analytics datasets with the last 30 / 90 days. Months before the first collection
(from 2026-01) are missing, and `usage_report` / `cost_report` serve only the last 365 days, so the
2026-01 usage and cost disappear from the API after 2026-12-31. A gap left by a stopped collection
(expired key, disabled workflow) cannot be filled either.

## User Review Required

> [!IMPORTANT]
>
> - New command `pnpm ledger backfill --from <yyyy-mm> [--to <yyyy-mm>] [--datasets a,b,...] [--force]`.
>   It fetches month by month straight from the APIs and merges the result into the ledger with the
>   existing `updateLedger` use case (no snapshot is written to `snapshots/`).
> - Backfilled datasets and their API windows (registry, no switch):
>   - `usage` / `cost`: `starting_at` truncated to "within the last 365 days and not before
>     2026-01-01" (the earliest **whole UTC day** inside the 365 days, so no partial day bucket is
>     recorded), split into windows of at most 31 days (existing `splitRange`).
>   - `adoption` (`summaries`), `memberActivity` (`users` range roll-up), `skillUsage`,
>     `connectorUsage`, `pluginUsage`, `chatProjectUsage`: one `starting_date` / `ending_date` period
>     per month (`ending_date` omitted for the current month, the API then uses today; at most 366 days).
>   - `memberActivityDaily` (`users?date=`): every published day of the month (U4 rules).
>   - `activities`: one `created_at.gte` / `created_at.lt` window per month (nothing exists before the
>     Compliance API was enabled).
>   - Default set: `activities`, `usage`, `cost`, `adoption`, `memberActivity`, plus
>     `memberActivityDaily` / the four feature datasets only when their optional source is enabled;
>     `sources.disabled` is respected. `--datasets` chooses explicitly.
> - Excluded ranges are printed as warnings (older than 365 days, before 2026-01-01). The state
>   datasets (`members`, `settings`, `groups`, …) have no history in the API: the output says they
>   are not backfilled.
> - Rate limits: one paced HTTP client per API family for the whole backfill: Analytics at least
>   1.1 s between request starts (at most ~55 of the 60 req/min), Compliance at least 110 ms (at most
>   ~546 of the 600 req/min); 429 `retry-after` remains the backstop. Pacing uses the injectable clock
>   and sleep of `HttpClient`, so tests replace the clock.
> - Resume: each (month, dataset) unit is merged and recorded in `data/ledger/BACKFILL.json` as soon
>   as it is fetched. A re-run skips a unit fetched with the same range after its revision period
>   (range end + 8 days) and fetches everything else again; the ledger merge is idempotent, so a
>   repeated unit changes nothing. `--force` ignores the progress file. A failed unit does not stop
>   the other units; the command fails at the end and names them.
> - The backfill first runs `ledger update` (so no stored snapshot is skipped later: backfilled
>   entries carry the backfill time as `recordedAt`).
> - Roll-up filing: a `rollup` entry is filed under the month its window ends in when that is
>   earlier than the collection month (a backfilled month), otherwise the collection month as before
>   (regular collections are unchanged).
> - New manual workflow `.github/workflows/ledger-backfill.yml` (`workflow_dispatch` only, `main`
>   only): inputs validated by `.github/scripts/validate-backfill-inputs.sh` through the environment
>   (same pattern as `validate-dispatch-inputs.sh`), restore / save through
>   `.github/scripts/data-branch.sh` in the `audit-data` concurrency group, `REPOSITORY_VISIBILITY` /
>   `GH_TOKEN` on the save step, job-level `AUDIT_CONFIG_OVERRIDES`. Partial progress is saved even
>   when a unit failed (the job still fails).

> [!WARNING]
>
> - The backfill reads raw data (e-mail / IP addresses) into the ledger on `data/audit` only; nothing
>   is published and `data/sample/` does not change.
> - Real-tenant facts the synthetic tenant cannot prove (exact 365-day boundary, `ending_date` on
>   past months for `users` / features / `summaries`, monthly Activity Feed volume and duration, 429
>   behaviour of a long run) are split into a `needs-real-tenant` Issue under #154.

## Proposed Changes

### Core (`@claude-audit/core`, pure)

#### [NEW] `packages/core/src/domain/ledger/backfill.ts`

- `backfillMonths(from, to)`, `earliestServed(limit, now)`, `planBackfill(request)` →
  `{ units: { dataset, month, range }[], excluded: { dataset, range, reason }[] }`.
- `isFinalUnit` (revision period) used by the resume rule.

#### [NEW] `packages/core/src/application/use-cases/ledger-backfill.ts` + port

- `BackfillSource` (fetch one range of one dataset) and `BackfillProgressStore` ports.
- `backfillLedger(plan, deps)`: per unit fetch → one in-memory snapshot → `updateLedger` → progress;
  skips final units, collects failures.

#### [MODIFY] `packages/core/src/domain/ledger/kinds.ts`

- Roll-up month: the window's end month when it is earlier than the collection month.

### Collector

#### [NEW] `packages/collector/src/adapters/anthropic/backfill-sources.ts`

- Registry of the backfill datasets (family, API limit, fetch), paced clients per family.

#### [MODIFY] `analytics-api.ts`, `feature-usage-api.ts`, `member-daily-api.ts`

- Range variants: `users` roll-up with `ending_date`, feature roll-ups with `ending_date`, daily
  users for the days of a range.

#### [NEW] `packages/collector/src/adapters/storage/backfill-progress.ts`

- `ledger/BACKFILL.json` (zod-validated; an unreadable file stops the run and is never overwritten).

#### [MODIFY] `packages/collector/src/main/ledger.ts`, `main/container.ts`

- `ledger backfill` argument parsing, report (exclusions, state datasets, skipped / failed units).
- Container: HTTP timing (fetch, clock, sleep) for the backfill clients.

### CI

- `.github/workflows/ledger-backfill.yml`, `.github/scripts/validate-backfill-inputs.sh`; script tests
  (input validation, injection safety, visibility / overrides wiring lists).

### Tests

- Core: month list, truncation (365 days, epoch, current month), units, roll-up filing, resume rule,
  use case (skip / failure / idempotent).
- Collector: a synthetic tenant that enforces the API limits (400 beyond 365 days / 31 days / before
  2026-01-01): backfill 2026-01 to the current month without gaps; a later clock excludes 2026-01
  usage / cost with a warning; resume after an interruption; rate-limit waits with a replaced clock
  (no 60-second window over 60 Analytics / 600 Compliance requests, `retry-after` honoured).

### Docs

- `docs/SETUP.md` (first-time steps), `docs/BLUEPRINT.md` §6.5, `docs/API-MAPPING.md`,
  `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md` (CLI list), `.agents/rules/storage-and-data-routing.md`,
  `CHANGELOG.md`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- Targeted: `pnpm --filter @claude-audit/core test -- backfill`, `pnpm --filter @claude-audit/collector test -- backfill`, `pnpm test:scripts`

### Manual Verification

- `pnpm demo` output unchanged (the sample has no ledger).
