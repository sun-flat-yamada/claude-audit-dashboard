# Walkthrough: Copy sealed ledger months to external storage (U7)

## Summary

Resolves #161 (parent #154). Sealed months of the monthly ledger can now be copied to external
storage where the organization sets the retention: `ledger.sink` selects a registered adapter
(`filesystem`, `gdrive`, `sharepoint`; default `none`, nothing changes). `pnpm ledger push`
copies only sealed months, as stored (encrypted files stay encrypted), reads every file back and
verifies it against `MANIFEST.json` (`encryptedSha256`, else the decompressed `sha256`), copies
`MANIFEST.json` last, retries failures and is idempotent. A verified copy is recorded in the local
`MANIFEST.json` as `transfers.<kind>` (time and file count, no URL or ID). The copy keeps the
ledger's own layout, so a month can be restored by hand (tested: copied back into a fresh data
directory, `ledger verify` passes). The cloud adapters authenticate with the GitHub Actions OIDC
token only (Entra ID federated credential / Workload Identity Federation), use plain `fetch`, and
never report tokens, URLs or storage IDs. `ledger-seal.yml` gets `id-token: write` and a copy step.
Real-tenant checks are split out into #175 (`needs-real-tenant`).

## Changes Made

### Core (`packages/core`)

- `domain/ledger/manifest.ts`: optional `transfers` record, carried by every manifest rebuild.
- `domain/ledger/transfer.ts` (new): `assertSinkPath`, `transferManifestOf`, expected digests.
- `application/ports.ts`: `LedgerSink` (`put` / `get` / `list`), `LedgerFileAccess`,
  `StoredLedgerFile`.
- `application/use-cases/ledger-push.ts` (new): `pushLedgerMonth`.
- `application/ledger-alert.ts`: `ledgerPushAlert` (`ledger-push:<month>:<kind>`).
- Tests: `application/__tests__/ledger-push.test.ts`.

### Collector (`packages/collector`)

- `adapters/ledger-sinks/` (new): `http.ts` (retries, safe errors), `oidc.ts` (GitHub OIDC token,
  token cache, variable checks), `filesystem.ts`, `gdrive.ts` (STS + IAM Credentials + Drive API
  v3, resumable uploads), `sharepoint.ts` (Entra ID + Graph, upload sessions above 4 MiB,
  token-free redirects), `registry.ts` (`LEDGER_SINKS`).
- `adapters/storage/ledger.ts`: `FsLedgerRepository` implements `LedgerFileAccess`.
- `infrastructure/config.ts` (`ledger.sink`), `infrastructure/env.ts` (`ledgerSinkVariables`).
- `main/ledger-push.ts` (new), `main/ledger.ts` (`push` action), `main/container.ts`
  (`ledgerSink`, `sealSinks`).
- Tests: HTTP fakes of the official request / response shapes
  (`adapters/ledger-sinks/__tests__/fake-cloud.ts`), adapter tests (transfer, verify, retry,
  no token / URL / ID in errors), integration tests on the synthetic tenant
  (`main/__tests__/ledger-push.test.ts`: filesystem seal + push + idempotency + manual restore,
  `none` unchanged, encrypted month to SharePoint, failed Google Drive copy with notification and
  a completing re-run).

### Workflows, configuration and docs

- `.github/workflows/ledger-seal.yml`: `id-token: write`, storage identifiers from repository
  variables at job level, step _Copy the sealed month to external storage_; wiring tests in
  `scripts/__tests__/ledger-schedule-workflows.test.ts` and `ledger-encryption-workflows.test.ts`.
- `.env.example`: the sink variables, empty.
- `AGENTS.md`, `.agents/rules/security-zero-leakage.md`, `.agents/rules/storage-and-data-routing.md`,
  `docs/SETUP.md`, `docs/DEPLOYMENT.md`, `docs/BLUEPRINT.md` (§6.5, §12, appendix),
  `docs/ARCHITECTURE.md`, `docs/PLUGIN-ARCHITECTURE.md` (extension point 11), `CHANGELOG.md`.

## Verification Results

| Stage                    | Command                          | Result                                                  |
| :----------------------- | :------------------------------- | :------------------------------------------------------ |
| Code-Data Decoupling     | `pnpm fork:verify`               | ✅ Clean (exit 0)                                       |
| TypeScript Check         | `pnpm typecheck`                 | ✅ Pass (exit 0)                                        |
| Unit & Integration Tests | `pnpm test`                      | ✅ core 404, collector 423, dashboard 464, scripts 110  |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | ✅ 0 leaks (exit 0)                                     |
| Production Build         | `pnpm build`                     | ✅ Built                                                |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | ✅ Clean                                                |

No dependency was added (`pnpm audit:deps` not affected); the dashboard is unchanged (no
screenshots, `data/sample/` unchanged).
