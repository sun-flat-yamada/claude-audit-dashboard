# Ledger-oriented fetching: daily member activity and model-only cost (U4)

Resolves #158 (parent tracking #154; prerequisite #157 U3 is merged). The monthly ledger (U3)
records whatever a snapshot collected. This change adds a per-day member activity dataset for it
and makes the model-only cost / usage series a verified ledger contract.

## User Review Required

> [!IMPORTANT]
>
> - New **optional** dataset `memberActivityDaily` behind `sources.memberActivityDaily.enabled`
>   (default `false`, `lookbackDays` default 3, 1-31). Off by default like every optional source:
>   coverage, OP-002, score and `data/sample/` of existing tenants are unchanged. Enable it with
>   `config/default.json` or `AUDIT_CONFIG_OVERRIDES` (#156).
> - Rows are per member (user id, e-mail): stored only in snapshots and in the ledger on
>   `data/audit`; never in `dashboard.json` or `detail/` (only its Data coverage row: status, count).
> - The model-only series is already requested (`group_by[]=model` alone, one of the four
>   dimensions of `usage` / `cost`), so the ledger's daily `usage` / `cost` files already hold
>   `dimension: model` rows (key `date|model|<model>`). U4 keeps that request, splits every
>   `usage_report` / `cost_report` request into windows of at most 31 days (V8: a longer range is
>   HTTP 400, relevant for U5 backfill ranges) and checks per day that the model rows add up to the
>   total row (warning in `pnpm ledger update`, never a failure).

> [!WARNING]
>
> - Real-tenant facts that sanitized fixtures cannot prove are split into a `needs-real-tenant`
>   Issue: the publication time of a day (13:30 UTC next day), the error for a too-recent `date`,
>   single-day-mode row shape, 410 on daily paging, and whether model rows always add up to the total.
> - Rate limit 60 req/min (`read:analytics`): the daily series is fetched day by day, serially,
>   through a paced client (minimum 1.5 s between requests: at most 40 req/min, leaving headroom for
>   the ~10 other analytics requests of a run); 429 `retry-after` stays the backstop.

## Proposed Changes

### Core (`packages/core`)

#### [MODIFY] `src/domain/model/optional-entities.ts`, `optional-datasets.ts`

- `MemberDayActivity { date, userId, email, active, lastActiveOn, engagement? }`; dataset
  `memberActivityDaily` with source flag `memberActivityDaily`.

#### [MODIFY] `src/domain/ledger/datasets.ts`

- `memberActivityDaily: { kind: 'daily', key: date|userId }` (newer collection wins: revisions).

#### [NEW] `src/domain/ledger/reconcile.ts`

- Pure `breakdownGaps(rows, dimension, value, tolerance)`: days whose breakdown rows do not add up to
  the `total` row; a small registry of checks (`cost` amount, `usage` tokens by `model`).

#### [MODIFY] `src/application/use-cases/ledger.ts`

- `LedgerUpdateResult.gaps`: reconciliation findings of the recorded snapshots.

### Collector (`packages/collector`)

#### [NEW] `src/adapters/anthropic/member-daily-api.ts`

- `GET /v1/organizations/analytics/users?date=<YYYY-MM-DD>&limit=1000` per day, `next_page`
  paging with the shared 410 restart; latest day = yesterday after 13:30 UTC, else the day before;
  never before 2026-01-01; a 400 on the newest day only drops that day (not yet published).

#### [MODIFY] `src/adapters/anthropic/http-client.ts`

- Optional `minIntervalMs` pacing (injected clock and sleep).

#### [MODIFY] `src/adapters/anthropic/analytics-api.ts`

- `usageReport` / `costReport` split their range with `splitRange` (31 days) per dimension.

#### [MODIFY] `optional-collectors.ts`, `main/container.ts`, `infrastructure/config.ts`, `storage/repositories.ts`, demo + fixture sources

- Register the collector (paced Analytics client), config flag, storage sort key, demo collector
  (synthetic `example.com` members) and a sanitized replay fixture for the fixture tenant.

#### [MODIFY] `src/main/ledger.ts`

- Report reconciliation gaps as warnings.

### Dashboard E2E

- Add the dataset to the optional-sources coverage spec and the optional-unavailable profile.

### Docs

- `docs/API-MAPPING.md` §4/§6, `docs/BLUEPRINT.md` (optional sources, §6.5 ledger, publication),
  `docs/SETUP.md`, `.agents/rules/storage-and-data-routing.md`, `CHANGELOG.md`, `.env.example`.

## Verification Plan

### Automated Tests

- Daily fetch: one series per day, `next_page` paging, 410 mid-walk restart, availability cutoff,
  newest-day 400 tolerated, pacing interval.
- Model-only cost: model rows of the fixture add up to the total row; `breakdownGaps` flags a
  mismatch; windows of at most 31 days for a long range; daily rows land in the ledger by
  `date|userId` and model rows by `date|model|<model>`.
- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`; `pnpm test:e2e` (optional-sources profiles changed)

### Manual Verification

- `pnpm demo --profile optional-sources` shows `memberActivityDaily` collected in Data coverage and no
  per-person rows in `dashboard.json` / `detail/`.
