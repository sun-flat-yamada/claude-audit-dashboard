# Implementation Plan - Monthly ledger: update and bootstrap (U3)

Issue: #157 (parent tracking #154). Prerequisite #155 (U1: `data/ledger/` is gitignored and checked by `pnpm fork:verify`) is merged.

## Context & Problem

The data branch stores one snapshot per collection run. Usage / cost rows of the last 31 days are stored again in every snapshot (up to ~120 versions of the same day), and the state datasets are copied in full every time. There is no month-by-month record without duplicates. This unit adds the monthly ledger `data/ledger/<yyyy-mm>/` with merge rules per data kind, the `ledger update` step at the end of `pipeline` and `ledger bootstrap` from the existing `snapshots/` and `archive/*.json.gz`.

## User Review Required

> [!IMPORTANT]
>
> - Merge rules (pure, in `@claude-audit/core` `domain/ledger/`), chosen by a dataset → kind registry (no switch):
>   - **event** (`activities`): key `id`, the first-recorded version is kept, filed under the UTC month of `createdAt`.
>   - **daily** (`usage`, `cost`, `adoption`, `consoleUsage`, `consoleCost`, `claudeCodeActivity`): key `date` + `dimension` + `key` (dataset-specific key parts for the optional daily datasets), the version with the newer `asOf` (dataset `asOf`, else the collection time) wins, filed under the UTC month of `date`.
>   - **rollup** (`memberActivity`, `credentialUsage`, `skillUsage`, `connectorUsage`, `pluginUsage`, `chatProjectUsage`): key month + target id, the newest collection overwrites, filed under the UTC month of the collection time.
>   - **state** (`organizations`, `members`, `invites`, `groups`, `settings`, `credentials`, `spendLimits`, `consoleWorkspaces`, `consoleApiKeys`): one version (whole dataset, items in canonical order) per content change, `validFrom` = collection time, `hash` = SHA-256 of the canonical JSON. A version equal to its predecessor in the same month is dropped, so an unchanged dataset adds nothing. Each month starts with its own opening version so a month is self-contained (needed to seal and transfer months alone, U6 / U7).
> - Every merge is commutative and idempotent (ties broken by collection time, then canonical JSON), so batches, re-runs and later backfills (U5) give the same bytes regardless of order.
> - Only datasets with coverage `ok` are recorded (an `unavailable` / `error` dataset is a gap, never an empty state).

> [!WARNING]
>
> - The ledger holds raw data (e-mail addresses, IP addresses). It lives only on `data/audit` (`data/ledger/` is gitignored and a forbidden path for `fork:verify`) and is never staged for Pages or `detail/`.
> - A month whose `MANIFEST.json` says `sealed: true` is never modified by `update` / `bootstrap` (reported instead); sealing and `revisions/` are U6.
> - `ledger update` runs at the end of `pipeline` (after `detail`); the collect workflow already saves all of `data/` to `data/audit`, so no workflow change is needed (avoids a conflict with PR #164).

## Proposed Changes

### Core (`@claude-audit/core`, pure)

#### [NEW] `packages/core/src/domain/ledger/`

- `entry.ts`: `LedgerEntry` envelope (`key`, `recordedAt`, optional `asOf` / `validFrom` / `hash` / `window`, `item`), `canonicalJson` (sorted keys, compact).
- `kinds.ts`: the four kind strategies (`toEntries`, `prefer` / `merge`, `timeOf`) in a `LEDGER_KINDS` record.
- `datasets.ts`: `LEDGER_DATASETS` (dataset → kind + key function, `satisfies Record<DatasetName, …>` so a new dataset fails typecheck until it is registered) and `registerLedgerDataset` for extensions (U4 adds daily member activity here).
- `ledger.ts`: `ledgerEntriesOf(snapshot, hash)` (grouped by month and dataset), `mergeLedgerEntries(kind, existing, incoming)`, `summarizeLedgerFile(kind, entries)` (count + window), `LEDGER_MANIFEST_SCHEMA_VERSION`.

#### [NEW] `packages/core/src/application/use-cases/ledger.ts` + port in `application/ports.ts`

- `LedgerRepository` port (`read`, `write` → changed?, `isSealed`, `writeManifest`).
- `updateLedger(snapshots, { repository, hash, batchSize })`: accumulates the entries of a batch of snapshots in memory, merges each (month, dataset) once with the stored file, writes only changed files, rewrites the manifest of every touched month; skips sealed months.

### Collector

#### [NEW] `packages/collector/src/adapters/storage/ledger.ts`

- `FsLedgerRepository`: `ledger/<yyyy-mm>/<dataset>.jsonl.gz` (one canonical JSON line per entry, sorted by key), a replaceable codec (gzip by default; U8 adds encryption), atomic writes, no rewrite when the uncompressed content is unchanged, zod validation of every line (an unreadable file stops the run and is never overwritten).
- `MANIFEST.json` per month: `schemaVersion`, `month`, `sealed: false`, and per dataset `kind`, `count`, `sha256` (of the uncompressed JSON Lines), `window` (from / to of the entries' time).
- `sha256Hex` hasher (node:crypto) passed to the use case.

#### [MODIFY] `packages/collector/src/adapters/storage/archive.ts`

- Export the archived-snapshot listing / reading so bootstrap can stream `archive/<year>/*.json.gz`.

#### [NEW] `packages/collector/src/main/ledger.ts` + [MODIFY] `main/commands.ts`, `package.json`

- `ledger update [--snapshot <id>]` (latest snapshot by default) and `ledger bootstrap` (all archived + stored snapshots in id order, de-duplicated by id). `pnpm ledger <update|bootstrap>`. `pipeline` ends with `ledger update`.

#### [MODIFY] `packages/collector/src/adapters/storage/git-size.ts`, `main/size.ts`, core `domain/capacity/capacity.ts`

- `pnpm size` reports the ledger footprint (distinct blobs and bytes under `ledger/`) next to the snapshot datasets; the total already includes it.

### Tests

- Core: merge rules per kind (duplicates, order swap, month boundary, `asOf` comparison, unchanged state adds no version, sealed months, registry completeness).
- Collector: idempotent `ledger update` (byte-identical after a second run), bootstrap from a synthetic history (`synthetic-history.ts`) with archived and stored snapshots and zero duplicate keys, sizes include the ledger, CLI wiring.

### Docs

- `docs/BLUEPRINT.md`, `docs/ARCHITECTURE.md` (§3, §8.3 recipe, §10 CLI), `.agents/rules/storage-and-data-routing.md`, `CHANGELOG.md`, `README.md` / `README.ja.md` command lists if they list CLI commands.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- Targeted: `pnpm --filter @claude-audit/core test -- ledger`, `pnpm --filter @claude-audit/collector test -- ledger`

### Manual Verification

- `pnpm demo` output unchanged (the sample has no ledger).
- Run `ledger bootstrap` then `ledger update` twice on a temporary data directory and compare the bytes.
