# Walkthrough: Optionally encrypt ledger files at rest (U8)

## Summary

Resolves #162 (parent #154). The monthly ledger can be encrypted at rest; it is **off by default**
(`ledger.encryption.recipients: []`). With recipients set, every written ledger file is stored as
`<dataset>.jsonl.gz.enc` using envelope encryption built on `node:crypto` only (no new dependency):

- a fresh random 256-bit file key per file; the gzip bytes are encrypted with AES-256-GCM (random
  96-bit IV, the header authenticated as additional data);
- the file key is wrapped once per recipient (`x25519`: ephemeral X25519 ECDH, HKDF-SHA256,
  AES-256-GCM) and once for the workflows (`pipeline`: HKDF-SHA256 of the symmetric Actions secret
  `LEDGER_PIPELINE_KEY`, AES-256-GCM); stanza types are a registry;
- format: `CADLENC1` + uint32 header length + header JSON (version, IV, stanzas with key
  fingerprints) + ciphertext + GCM tag.

Recipient private keys never go to Actions. The workflows need to read what they wrote (merge
rules, revisions, seal and verify), so they use the separate pipeline key; a fork or a copy of
`data/audit` carries no secrets, so the files stay unreadable. Recipients without the pipeline key
make the ledger commands stop before writing (`pipeline` only warns). `MANIFEST.json` keeps the
plaintext `sha256` (seal / verify unchanged) and adds `encryptedSha256` of the stored bytes;
`ledger verify` also reports a stored file whose form or encrypted hash differs.

New local-only commands (refused on CI, refuse paths inside the data directory or the repository,
no key material or decrypted content in log lines):

- `pnpm ledger keygen --out <file> [--pipeline]`
- `pnpm ledger encrypt [--all] [--identity <file>]` (migration of plain files incl. sealed months;
  `--all` re-encrypts for new recipients; `--identity` reads with a private key to rotate or
  recover the pipeline key)
- `pnpm ledger decrypt --identity <file> --out <dir> [--month <yyyy-mm>]` (checks every file
  against `sha256`)

Real-tenant confirmation (live fork with Actions) is split out into #172 (`needs-real-tenant`).

## Changes Made

### core

- `packages/core/src/domain/ledger/manifest.ts`: optional `encryptedSha256` on dataset and revision
  entries.
- `packages/core/src/domain/ledger/verify.ts`: `LedgerFileDigest.encryptedSha256`; `fileDifference`
  reports stored-form and encrypted-hash mismatches.

### collector

- `packages/collector/src/adapters/storage/ledger-crypto.ts` (new): key formats, key generation,
  envelope encryption / decryption, encrypted codec.
- `packages/collector/src/adapters/storage/ledger.ts`: `LedgerCodecs` (write + read codecs), mixed
  plain / encrypted files (an encrypted file without a key is unreadable, never absent), removal of
  the other form on write, `encryptedSha256` in manifest and digests, `reencode`, `decodedFiles`,
  `ledgerCodecsFor` (fail closed).
- `packages/collector/src/infrastructure/{config,env}.ts`: `ledger.encryption.recipients`,
  `LEDGER_PIPELINE_KEY`.
- `packages/collector/src/main/container.ts`: `ledger()` factory used by update, bootstrap,
  backfill, seal and verify.
- `packages/collector/src/main/ledger-keys.ts` (new) and `ledger.ts`: `keygen` / `encrypt` /
  `decrypt` in the action registry.

### Scripts, workflows, docs

- `scripts/secret-scan.ts`: patterns for `CADL-SECRET-` and `CADL-PIPELINE-` keys.
- `collect-audit.yml`, `ledger-backfill.yml`, `ledger-seal.yml`, `ledger-verify.yml`:
  `LEDGER_PIPELINE_KEY` on the ledger steps; `.env.example` with an empty value.
- `AGENTS.md`, `security-zero-leakage.md`, `storage-and-data-routing.md`, `docs/SETUP.md`,
  `docs/DEPLOYMENT.md` (_Encryption at rest_), `docs/BLUEPRINT.md` §6.5 / §12.2 / appendix A,
  `CHANGELOG.md`.

### Tests

- `adapters/storage/__tests__/ledger-crypto.test.ts`: round trip, several recipients, pipeline
  only, key mismatch, forged fingerprint, tampered header / ciphertext, fresh IV, malformed keys
  not quoted, codec selection and fail-closed.
- `main/__tests__/ledger-encryption.test.ts`: backfill + seal + verify on an encrypted ledger with
  the same `sha256` as a plain one, byte-identical unchanged files, encrypted revisions, encrypted
  hash mismatch, unreadable without / with a wrong key, fail closed, keygen, migration of a sealed
  plain ledger and decryption with a second recipient, pipeline key rotation, refusals (CI, paths).
- `core/src/domain/__tests__/ledger-verify.test.ts`: encrypted digest findings.
- `scripts/__tests__/ledger-encryption-workflows.test.ts`: workflow wiring, no decrypt / keygen in
  workflows, `.env.example`, secret-scan patterns.

Test keys are generated at run time; no key material is in the repository.

## Verification Results

| Stage                    | Command                          | Result                                                    |
| :----------------------- | :------------------------------- | :-------------------------------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`               | ✅ Clean (exit 0)                                         |
| TypeScript Check         | `pnpm typecheck`                 | ✅ Pass (exit 0)                                          |
| Unit & Integration Tests | `pnpm test`                      | ✅ core 395, dashboard 464, collector 401, scripts 106    |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | ✅ 0 leaks (exit 0)                                       |
| Production Build         | `pnpm build`                     | ✅ Built                                                  |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | ✅ Clean                                                  |
