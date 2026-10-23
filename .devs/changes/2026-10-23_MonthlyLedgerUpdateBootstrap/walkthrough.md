# Walkthrough: Monthly ledger update and bootstrap (U3)

## Summary

Adds the monthly ledger `data/ledger/<yyyy-mm>/` (#157, parent #154): one `<dataset>.jsonl.gz` per month and dataset without duplicates plus a `MANIFEST.json` per month, written by `pnpm ledger update` (the last, non-fatal step of `pnpm pipeline`) and `pnpm ledger bootstrap` (from `snapshots/` and `archive/*.json.gz`). The ledger is raw data, lives only on `data/audit` and is never staged for Pages or `detail/`.

| Kind     | Datasets                                                                                                   | Unique key                      | Month                 | Same key again                        |
| -------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------- | ------------------------------------- |
| `event`  | `activities`                                                                                               | `id`                            | UTC month of `createdAt` | first recorded copy kept           |
| `daily`  | `usage`, `cost`, `adoption`, `consoleUsage`, `consoleCost`, `claudeCodeActivity`                           | `date` + breakdown              | month of `date`       | newer `asOf` (else collection) wins   |
| `rollup` | `memberActivity`, `credentialUsage`, `skillUsage`, `connectorUsage`, `pluginUsage`, `chatProjectUsage`     | month + target id               | collection month      | latest collection wins                |
| `state`  | `organizations`, `members`, `invites`, `groups`, `settings`, `credentials`, `spendLimits`, `consoleWorkspaces`, `consoleApiKeys` | `validFrom` | collection month | no version while the SHA-256 is unchanged; each month opens with its own version |

All merges are commutative and idempotent (ties broken by collection time, then canonical JSON), so batches, re-runs and later backfills (U5) give identical bytes. Unchanged files are not rewritten; sealed months (`sealed: true`, U6) are never touched; an unreadable file stops the run and is never overwritten.

## Changes Made

### Core (`@claude-audit/core`, pure)

- `packages/core/src/domain/ledger/entry.ts`: `LedgerEntry` envelope, `canonicalJson`, JSON Lines (de)serialization, UTC month helper.
- `packages/core/src/domain/ledger/kinds.ts`: the four kind strategies in `LEDGER_KINDS` (no switch).
- `packages/core/src/domain/ledger/datasets.ts`: dataset -> kind / key table typed as `Record<DatasetName, …>` (a new dataset fails typecheck until classified) and `registerLedgerDataset` (U4 entry point).
- `packages/core/src/domain/ledger/ledger.ts`, `manifest.ts`: `ledgerEntriesOf`, `mergeLedgerEntries`, `summarizeLedgerFile`, `buildLedgerManifest` and its zod schema.
- `packages/core/src/application/ports.ts`: `LedgerRepository` port; `application/use-cases/ledger.ts`: `updateLedger` (batched) and `latestLedgerRecord`.
- `packages/core/src/domain/capacity/capacity.ts`: `RepoSizeMeasurement.ledger` (`LedgerFootprint`).

### Collector

- `packages/collector/src/adapters/storage/ledger.ts`: `FsLedgerRepository`, replaceable `LedgerCodec` (gzip default; U8 hook), `sha256Hex`.
- `packages/collector/src/adapters/storage/archive.ts`: `allArchivedIds`, exported `readArchived`.
- `packages/collector/src/adapters/storage/git-size.ts`, `main/size.ts`: ledger blobs and bytes in `pnpm size`.
- `packages/collector/src/main/ledger.ts`, `main/commands.ts`, `package.json`: `ledger update [--snapshot <id>]` (catches up from the last recorded collection), `ledger bootstrap`, `pnpm ledger`, last `pipeline` step (warns on failure).

### Tests

- `packages/core/src/domain/__tests__/ledger.test.ts`: registry completeness, UTC months, per-kind rules (duplicates, order swap, month boundary, `asOf`, unchanged / reordered state, change back, monthly opening version, failed datasets), JSON Lines round trip, manifest.
- `packages/core/src/application/__tests__/ledger-update.test.ts`: idempotency, batch / order independence, unique keys, sealed months.
- `packages/collector/src/main/__tests__/ledger.test.ts`: bootstrap of a 75-day synthetic history (300 snapshots, 150 archived, optional sources) with zero duplicate keys and manifest consistency, byte-identical re-runs of bootstrap and update, sealed month untouched, unreadable file not overwritten (pipeline step only warns), catch-up of missed runs, and `pnpm size` counting the ledger in a real git repository.

### Docs

- `docs/BLUEPRINT.md` (§3.2, §4.2, §6.3, new §6.5, §12.1), `docs/ARCHITECTURE.md` (§3, §7.2, §8.3, §10), `.agents/rules/storage-and-data-routing.md`, `docs/SETUP.md`, `docs/DEPLOYMENT.md`, `CHANGELOG.md`.

No workflow change: `collect-audit.yml` already runs `pnpm pipeline` and saves all of `data/`. `data/sample/` is unchanged.

## Verification Results

| Stage                    | Command                          | Result                                                          |
| :----------------------- | :------------------------------- | :-------------------------------------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`               | ✅ Clean (exit 0)                                               |
| TypeScript Check         | `pnpm typecheck`                 | ✅ Pass (exit 0)                                                |
| Unit & Integration Tests | `pnpm test`                      | ✅ core 335, collector 346, dashboard 464, scripts 83 (all pass) |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | ✅ 0 leaks (exit 0)                                             |
| Production Build         | `pnpm build`                     | ✅ Built                                                        |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | ✅ Clean                                                        |
