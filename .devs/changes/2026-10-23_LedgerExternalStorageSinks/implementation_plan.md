# Implementation Plan - Copy sealed ledger months to external storage (U7)

Resolves #161 (parent tracking #154). Prerequisites are merged: #157 (U3 ledger core), #160 (U6
seal / verify, the `SealedMonthSink` hook, `ledger-seal.yml` on the 10th, `notify-once.ts`) and
#162 (U8 optional encryption: `.jsonl.gz.enc`, `encryptedSha256` in `MANIFEST.json`).

## Context & Problem

A Git branch can be deleted or force-pushed, so `data/audit` alone cannot guarantee a retention
period. A sealed month must also be kept in the organization's cloud storage, where a retention
policy (label / Vault rule) can be set, without storing a long-lived secret in GitHub.

## User Review Required

> [!IMPORTANT]
>
> - **Off by default (fork-safe)**: `ledger.sink` (default `none`), set with
>   `AUDIT_CONFIG_OVERRIDES`, e.g. `{"ledger":{"sink":"sharepoint"}}`. With `none` nothing is
>   read, no network call is made, and every existing command behaves as before.
> - **Port**: `LedgerSink` (`put` / `get` / `list`) in `@claude-audit/core` application ports.
>   Sinks are adapters registered in a registry (`adapters/ledger-sinks/`, no switch): `filesystem`
>   (tests and verification), `gdrive` (Google Drive shared drive) and `sharepoint`
>   (SharePoint / OneDrive document library). Adding one = one adapter + one registry entry.
> - **No secrets (OIDC only)**: both cloud adapters exchange the GitHub Actions OIDC token
>   (`ACTIONS_ID_TOKEN_REQUEST_URL` / `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, present with
>   `permissions: id-token: write`):
>   - `sharepoint`: token with audience `api://AzureADTokenExchange` -> Entra ID
>     `client_credentials` with a federated `client_assertion` -> Microsoft Graph
>     (`Sites.Selected`). Files <= 4 MiB use `PUT .../content`, larger ones an upload session in
>     320 KiB-multiple chunks.
>   - `gdrive`: Workload Identity Federation: Google STS token exchange -> IAM Credentials
>     `generateAccessToken` for the service account -> Drive API v3 (`supportsAllDrives`), one
>     folder per month under a root folder of the shared drive, resumable uploads.
>   - Identifiers come from repository **variables** (not secrets): `LEDGER_SHAREPOINT_TENANT_ID`,
>     `LEDGER_SHAREPOINT_CLIENT_ID`, `LEDGER_SHAREPOINT_DRIVE_ID`, `LEDGER_SHAREPOINT_FOLDER`,
>     `LEDGER_GDRIVE_WORKLOAD_IDENTITY_PROVIDER`, `LEDGER_GDRIVE_SERVICE_ACCOUNT`,
>     `LEDGER_GDRIVE_DRIVE_ID`, `LEDGER_GDRIVE_FOLDER_ID`; `LEDGER_SINK_DIR` for `filesystem`
>     (refused inside the data directory and the repository). All listed empty in `.env.example`.
>   - Plain `fetch`, no SDK, no new dependency.
> - **`pnpm ledger push [--month <yyyy-mm> | --all] [--notify]`** (default: the previous month):
>   only sealed months. Each stored file (`<dataset>.jsonl.gz[.enc]`, `revisions/...`) is first
>   checked against `MANIFEST.json` locally, then transferred **as stored** (encrypted bytes stay
>   encrypted), read back and verified: `encryptedSha256` for an encrypted file, otherwise the
>   `sha256` of the decompressed content. `MANIFEST.json` is copied last. A mismatch is retried
>   (HTTP 429 / 5xx / network errors are retried with backoff, `Retry-After` honored).
> - **Idempotent**: a remote file that already verifies is not uploaded again; remote files that
>   are not in the ledger are reported, never deleted (retention). On success `MANIFEST.json`
>   gets `transfers.<sink kind> = { transferredAt, files }` (no URL, no ID), updated only when
>   something was uploaded. The copied `MANIFEST.json` is the manifest without `transfers`, so
>   recording a transfer never makes the remote copy stale. `transfers` is carried by every later
>   manifest rewrite (update, revisions, re-encode).
> - **Workflow**: `ledger-seal.yml` gets `permissions: id-token: write`, passes the variables to
>   the seal step (the `SealedMonthSink` hook copies a freshly sealed month right away) and adds a
>   `Copy the sealed month to external storage` step (`pnpm ledger push --notify`, also copies
>   later `revisions/`) between the seal and the save. Restore / save through `data-branch.sh`,
>   the `audit-data` group, `REPOSITORY_VISIBILITY` / `GH_TOKEN` and job-level
>   `AUDIT_CONFIG_OVERRIDES` stay. With `none` the step logs one line and succeeds.
> - **Logs and errors never contain tokens, URLs or IDs**: adapters report the operation, the
>   file name inside the month and the HTTP status (plus an API error code such as
>   `accessDenied`), never response bodies or request URLs.

> [!WARNING]
>
> - The cloud adapters are implemented against the official Google Drive API v3, Google STS /
>   IAM Credentials and Microsoft Graph / Entra ID documentation and tested with HTTP fakes. A
>   check against real tenants (federated credential, `Sites.Selected` grant, shared drive
>   membership, retention labels / Vault rules) is split out into a new `needs-real-tenant`
>   Issue under #154.
> - Re-encrypting a sealed month (`ledger encrypt --all`) changes its stored bytes; the next push
>   uploads the new form (the storage keeps versions where it is configured to).

## Proposed Changes

### Core (`packages/core`)

- [NEW] `domain/ledger/transfer.ts`: transfer record schema, `transferManifestOf` (manifest
  without `transfers`), expected digest per file.
- [MODIFY] `domain/ledger/manifest.ts`: optional `transfers`; carried by `buildLedgerManifest`.
- [MODIFY] `application/ports.ts`: `LedgerSink`, `LedgerFileAccess` (stored files, digest,
  record transfer).
- [NEW] `application/use-cases/ledger-push.ts`: `pushLedgerMonth` (check, transfer, verify,
  retry, record).
- [MODIFY] `application/ledger-alert.ts`: `ledgerPushAlert`.
- Tests: `application/__tests__/ledger-push.test.ts`, manifest carry.

### Collector (`packages/collector`)

- [NEW] `adapters/ledger-sinks/{registry,filesystem,gdrive,sharepoint,oidc,http}.ts`.
- [MODIFY] `adapters/storage/ledger.ts`: `storedFiles`, `digestStored`, `recordTransfer`.
- [MODIFY] `infrastructure/config.ts` (`ledger.sink`), `infrastructure/env.ts` (variables).
- [NEW] `main/ledger-push.ts`; [MODIFY] `main/ledger.ts` (`push` action), `main/container.ts`
  (`ledgerSink`, `sealSinks`).
- Tests: adapter tests with HTTP fakes (transfer, verify, retry, no token / URL / ID in errors),
  filesystem integration test on the synthetic tenant (seal -> push -> idempotent re-run).

### Workflows, scripts and docs

- [MODIFY] `.github/workflows/ledger-seal.yml`, `scripts/__tests__/ledger-schedule-workflows.test.ts`
  (wiring test for the push step).
- [MODIFY] `.env.example`, `AGENTS.md`, `.agents/rules/security-zero-leakage.md`,
  `.agents/rules/storage-and-data-routing.md`, `docs/SETUP.md` (Entra ID app + federated
  credential + `Sites.Selected` + retention label; WIF + service account + shared drive + Vault
  retention rule), `docs/DEPLOYMENT.md`, `docs/BLUEPRINT.md`, `docs/PLUGIN-ARCHITECTURE.md`,
  `CHANGELOG.md`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- Targeted: `pnpm --filter @claude-audit/collector exec vitest run ledger-push ledger-sinks`

### Manual Verification

- `pnpm ledger push --month <sealed month>` with `ledger.sink=filesystem` and `LEDGER_SINK_DIR`
  outside the repository: files copied, a second run uploads nothing.
