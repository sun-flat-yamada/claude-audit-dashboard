# Implementation Plan - Seal and verify ledger months on a schedule (U6)

Resolves #160 (parent tracking #154). Prerequisites #157 (U3: ledger core, `MANIFEST.json` with
`sealed: false`) and #159 (U5: `BackfillSource` registry, paced clients, `planBackfill`) are merged.

## Context & Problem

The ledger (U3) has no point at which a month is final, and nothing notices a silent gap: Analytics
values are revised until about a week after the month, spend-limit month-to-date spend resets on
the 1st, and a stopped collection leaves missing days that nobody sees.

## User Review Required

> [!IMPORTANT]
>
> - **`pnpm ledger seal [--month <yyyy-mm>] [--notify]`** (default: the previous month). Allowed from
>   month end + 8 days (`BACKFILL_REVISION_DAYS`). Records the stored snapshots first
>   (`ledger update`), then re-fetches the whole month through the U5 backfill sources
>   (`planBackfill` for one month, no duplicated fetch code) into memory and compares it with the
>   ledger, per kind (registry, no switch):
>   - `event` / `daily`: compared by key and item content (metadata such as `recordedAt` / `asOf`
>     is ignored): rows missing in the ledger, extra rows, changed rows (counts and affected dates).
>   - `rollup`: the calendar-month roll-up from the API replaces the month file (regular collections
>     store rolling-window roll-ups that can never equal it); this is the month's final value.
>   - `state` and datasets without a backfill source: kept as recorded (the APIs have no history).
>   - A dataset that has a ledger file but cannot be re-fetched (missing key, failed request, period
>     outside what the API still serves) blocks the seal; one without a file and without data is
>     skipped.
>   - All match: the roll-ups are written, `MANIFEST.json` gets `sealed: true` and a `seal` record
>     (`sealedAt`, per dataset the policy, re-fetched window and count; SHA-256 and counts stay in
>     `datasets`). Any difference: nothing is written, the month stays unsealed, the command
>     reports the counts and notifies (`--notify`; key `ledger-seal:<month>`). Remedy (documented):
>     `pnpm ledger backfill --from <m> --to <m> --force`, then seal again.
>   - Sealing a sealed month re-verifies it: differences are never written into the month files but
>     appended to `ledger/<yyyy-mm>/revisions/<dataset>.jsonl.gz` (merged by the kind's rule, so a
>     repeated difference is stored once) and listed in `MANIFEST.json` `revisions`; notified.
> - **Revisions from regular collections**: `ledger update` / `bootstrap` / `backfill` keep leaving a
>   sealed month's files unchanged but now append the entries that would change it to `revisions/`
>   (same rule) and report them. The daily verify notifies new revisions (key
>   `ledger-revision:<month>`), because the collection's pipeline step has no notification secrets.
> - **`pnpm ledger verify [--notify] [--json]`**: checks (pure functions in `domain/ledger/verify.ts`)
>   - missing days of the daily datasets `ledger.verify.dailyDatasets` (default `usage`, `cost`) in
>     unsealed months, from the first recorded day of that dataset up to `lagDays` (3) days ago;
>   - hours since the last recorded collection (`lastRecordedAt`) > `maxStaleHours` (24);
>   - sealed months: SHA-256 and count of every file (and revision file) against `MANIFEST.json`,
>     files missing or not listed.
>   The result goes to `data/ledger/STATUS.json` (`verify`: time, status, findings, `failingSince`;
>   `seals`: the last seal attempt per month; `notifiedRevisions`). With `--notify` it alerts when
>   the verification has failed on `notifyAfterDays` (7) consecutive UTC days (key
>   `ledger-verify:fail`, usual cooldown), and on new revisions. Findings never contain identities
>   (months, datasets, dates and counts only). Exit code 0 unless a file is unreadable.
> - **Operational rules** (compliance-rules-management.md): new built-in dataset `ledgerHealth`
>   (one row: the last verification, its findings and per month the sealed state, revisions and
>   last seal attempt), collected every run by a local collector from `STATUS.json` and the
>   manifests (`local:data/ledger`; zero rows when there is no ledger yet, never `unavailable`, so
>   OP-002 is unaffected). Not recorded in the ledger itself (derived data).
>   - `OP-003 Ledger Verification` (High, `ledgerHealth`): latest verification failed, or older than
>     `maxVerifyAgeHours` (48) -> fail; no ledger / no verification yet -> skipped.
>   - `OP-004 Ledger Month Sealing` (Medium, `ledgerHealth`): a month ended more than
>     `maxUnsealedDays` (20) days ago and not sealed -> fail (`ignoreMonths`); a sealed month with
>     revisions or an unsealed month whose last seal attempt found differences -> warning.
>   - Shown on the dashboard through the existing compliance views; sample regenerated (`pnpm demo`,
>     the demo tenant reports a passing ledger).
> - **Workflows** (all `audit-data` concurrency, restore / save through `data-branch.sh`,
>   `REPOSITORY_VISIBILITY` / `GH_TOKEN` on save, job-level `AUDIT_CONFIG_OVERRIDES`, scheduled
>   runs behind `ENABLE_SCHEDULED_JOBS`, added to the wiring tests):
>   - `collect-audit.yml`: extra cron `30 23 28-31 * *`; `.github/scripts/month-end-guard.sh` lets
>     that schedule run only when the next UTC day is the 1st (month-end state and spend-limit
>     values). Other triggers unchanged.
>   - New `ledger-seal.yml`: 10th 04:00 UTC (previous month) + manual `month` input validated by
>     `.github/scripts/validate-ledger-inputs.sh`.
>   - New `ledger-verify.yml`: daily 05:30 UTC + manual.
> - **Hooks for U7 / U8**: a `SealedMonthSink` port (called after a successful seal; none registered
>   yet, a failing sink is reported, never unseals); revision files use the same `LedgerCodec`.

> [!WARNING]
>
> - Whether every day has `usage` / `cost` rows on a real tenant (zero-usage days), the lag before a
>   day is published, and whether a month re-fetched on the 10th equals the collected ledger can only
>   be confirmed on a real Enterprise tenant: split out into a new `needs-real-tenant` Issue.
> - Rule IDs OP-003 / OP-004 are new built-ins: BLUEPRINT §7.1, README.md, README.ja.md, AGENTS.md,
>   CHANGELOG and `data/sample/` change together; the score of the sample changes slightly.

## Proposed Changes

### core

- [NEW] `domain/ledger/seal.ts`: seal policies per kind, content comparison, revision entries,
  `sealReadyAt`.
- [NEW] `domain/ledger/verify.ts`: day-gap, staleness and digest checks, failing-days count.
- [NEW] `domain/ledger/health.ts`: `LedgerHealth` row type and builder; `LedgerStatus` shape.
- [MODIFY] `domain/ledger/manifest.ts`: optional `seal` and `revisions`, preserved on refresh.
- [MODIFY] `domain/ledger/datasets.ts`: `ledgerHealth` is not a ledger dataset.
- [MODIFY] `domain/model/dataset.ts`: built-in dataset `ledgerHealth`.
- [MODIFY] `domain/compliance/rules/operational.ts`: OP-003, OP-004.
- [MODIFY] `application/ports.ts`: `LedgerRepository` digests / seal / revisions,
  `LedgerStatusStore`, `SealedMonthSink`.
- [NEW] `application/use-cases/ledger-seal.ts`, `ledger-verify.ts`; [MODIFY] `ledger.ts` (revisions
  for sealed months), `ledger-backfill.ts` (export the unit snapshot builder).
- [NEW] `application/ledger-alert.ts`: alert messages (counts only).

### collector

- [MODIFY] `adapters/storage/ledger.ts`: digests, seal, revisions files.
- [NEW] `adapters/storage/ledger-status.ts`: `STATUS.json` store; `ledger-health-collector.ts`.
- [NEW] `main/ledger-seal.ts`, `main/ledger-verify.ts`, `main/notify-once.ts` (shared with `size`).
- [MODIFY] `main/ledger.ts` (commands), `main/container.ts` (local collector), config schema
  (`ledger.verify.*`), demo source (`ledgerHealth`).

### workflows / scripts / docs

- `.github/workflows/{collect-audit,ledger-seal,ledger-verify}.yml`, `.github/scripts/
  {month-end-guard,validate-ledger-inputs}.sh`, script tests and wiring lists.
- `docs/BLUEPRINT.md` §6.5 / §7.1 / §12, `README.md`, `README.ja.md`, `docs/DEPLOYMENT.md`,
  `docs/SETUP.md`, `.agents/rules/storage-and-data-routing.md`, `AGENTS.md`, `CHANGELOG.md`,
  `data/sample/`.

## Verification Plan

### Automated Tests

- core: seal comparison / policies / revisions, verify checks, OP-003 / OP-004 pass / fail /
  warning / skipped, use cases with the in-memory ledger.
- collector: seal and verify end to end on a temporary data directory with synthetic data (a
  removed day makes verify fail; a changed row makes seal refuse and notify; a sealed month gets
  revisions instead of changes; a tampered file fails the hash check).
- scripts: input validation, month-end guard, wiring (concurrency, data-branch.sh, visibility,
  overrides).
- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`, `pnpm test:e2e` (sample changes).

### Manual Verification

- `pnpm demo` and the compliance view of the dashboard (OP-003 / OP-004 rows).
