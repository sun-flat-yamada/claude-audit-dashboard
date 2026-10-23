# Implementation Plan - Optionally encrypt ledger files at rest (U8)

Resolves #162 (parent tracking #154). Prerequisites #157 (U3: ledger core, the replaceable
`LedgerCodec` in `adapters/storage/ledger.ts`, manifest SHA-256 over the uncompressed text) and
#160 (U6: seal / verify, `revisions/`, `STATUS.json`) are merged. #161 (U7, sinks) is not merged
yet; its sinks receive the files as stored, so an encrypted month is transferred encrypted.

## Context & Problem

The ledger keeps raw data (unmasked e-mail and IP addresses). When a fork of a fork copies every
branch, or the storage permissions are set wrong, anyone who can read `data/audit` can read the
whole history. The files must be unreadable without a key, while the scheduled workflows keep
updating, sealing and verifying the ledger.

## User Review Required

> [!IMPORTANT]
>
> - **Off by default (fork-safe)**: `ledger.encryption.recipients` (default `[]`). A non-empty
>   list turns encryption on; set it with the repository variable `AUDIT_CONFIG_OVERRIDES` (U2),
>   e.g. `{"ledger":{"encryption":{"recipients":["<public key>"]}}}`. Public keys are not
>   secret.
> - **Algorithm (Node's built-in `node:crypto`, no new dependency)**: envelope encryption like
>   age. Each file gets a fresh random 256-bit file key; the gzip bytes are encrypted with
>   AES-256-GCM (random 96-bit IV, the header is the additional authenticated data). The file key
>   is wrapped once per reader in a header "stanza":
>   - `x25519` per recipient: ephemeral X25519 key pair, ECDH with the recipient's public key,
>     HKDF-SHA256 (salt = ephemeral public key + recipient public key) -> AES-256-GCM key wrap.
>   - `pipeline`: HKDF-SHA256 of the symmetric pipeline key -> AES-256-GCM key wrap.
>     age itself was considered: the pure-JS packages add a dependency for something
>     `node:crypto` covers (X25519, HKDF, AES-GCM), and the CLI is not available in the runners.
> - **Why a pipeline key**: the merge rules (update, backfill, revisions) and the seal / verify
>   checks must read the stored files, but the recipients' private keys never go to Actions (Issue:
>   "秘密鍵は Actions に渡さない"). The workflows therefore get a separate symmetric key, the
>   Actions secret **`LEDGER_PIPELINE_KEY`**, used only to read back what the pipeline wrote.
>   It is not copied by a fork and not readable from the branch, which covers the Issue's threat
>   (branch copied / storage readable). The recipients' private keys can always decrypt, also after
>   the pipeline key is rotated or lost. With recipients set and no pipeline key, every ledger
>   command fails closed before writing (a file the pipeline cannot read could never be merged).
> - **Keys**: `pnpm ledger keygen --out <file>` writes a recipient identity (private key) to a new
>   file (mode 0600) and prints only the public key; `pnpm ledger keygen --pipeline --out <file>`
>   writes a pipeline key. Both refuse to run on CI, refuse to overwrite and refuse paths inside
>   the data directory or the directory pnpm was started from (the repository). Text formats:
>   `cadl-pub-<base64url 32 bytes>`, `CADL-SECRET-<base64url 32 bytes>`,
>   `CADL-PIPELINE-<base64url 32 bytes>`; `pnpm secret-scan` gets patterns for the two secret
>   forms. Tests generate keys at run time; no key is written into the repository.
> - **File format**: `<dataset>.jsonl.gz.enc` = magic `CADLENC1` + uint32 header length + header
>   JSON (version, algorithm, IV, stanzas with recipient fingerprints) + ciphertext + GCM tag.
>   Plain `.jsonl.gz` files stay readable (mixed ledgers while migrating); a write stores the
>   configured format and removes the other form of the same file.
> - **Manifest**: `sha256` stays the hash of the uncompressed text (seal / verify compare it, so
>   U6 works unchanged); encrypted files add `encryptedSha256` (SHA-256 of the stored bytes) to
>   their `datasets` / `revisions` entry. `ledger verify` also reports a stored file whose
>   encrypted hash differs from the manifest. An unchanged month keeps identical bytes (writes
>   are skipped when the decoded content is unchanged).
> - **`pnpm ledger encrypt [--all]`** migrates the existing plaintext files (sealed months too:
>   their content and `sha256` do not change; only the stored form and `encryptedSha256`); `--all`
>   also re-encrypts already encrypted files to the current recipients (key rotation).
> - **`pnpm ledger decrypt --identity <file> --out <dir> [--month <yyyy-mm>]`** decrypts with a
>   local private key only: refuses on CI and refuses output inside the data directory or the
>   repository; checks every decrypted file against the manifest `sha256`; logs months, datasets
>   and counts only. Never part of a workflow.

> [!WARNING]
>
> - Encryption does not rewrite git history: plaintext files committed before `ledger encrypt`
>   stay in the `data/audit` history until the branch is rotated (`docs/DEPLOYMENT.md`). Snapshots
>   (`data/snapshots/`) are not encrypted by this change (out of scope of #162).
> - Losing every recipient private key and the pipeline key makes the ledger unreadable.
> - End-to-end confirmation on a live fork (collect -> seal -> verify with an encrypted ledger,
>   `ledger decrypt` of a sealed month) needs a real tenant: split out into a `needs-real-tenant`
>   Issue (sub-issue of #154).

## Proposed Changes

### core (pure)

#### [MODIFY] `packages/core/src/domain/ledger/manifest.ts`

- Optional `encryptedSha256` on dataset and revision entries; `LedgerManifestFile.storedSha256`.

#### [MODIFY] `packages/core/src/domain/ledger/verify.ts`

- `LedgerFileDigest.encryptedSha256?`; `compareListed` reports a stored-hash mismatch / a file
  stored in another form than listed.

### collector

#### [NEW] `packages/collector/src/adapters/storage/ledger-crypto.ts`

- Key text formats, `generateIdentity`, `generatePipelineKey`, `parseRecipient`,
  `parseIdentity`, `parsePipelineKey`, `encryptEnvelope`, `decryptEnvelope` (stanza types in a
  registry, no switch), `encryptedLedgerCodec`.

#### [MODIFY] `packages/collector/src/adapters/storage/ledger.ts`

- `LedgerCodecs` (`write` + readable codecs); read/list any known form, write the configured one
  and remove the other form; `encryptedSha256` for encrypted files; `reencode(month, all)`.

#### [MODIFY] `packages/collector/src/infrastructure/{config,env}.ts`

- `ledger.encryption.recipients`; `LEDGER_PIPELINE_KEY` (blank = absent).

#### [MODIFY] `packages/collector/src/main/{container,ledger,ledger-seal,ledger-verify,ledger-backfill}.ts`, `adapters/storage/ledger-status.ts`

- One `ledgerCodecs` built in the container (fail closed on recipients without pipeline key);
  every repository uses it.

#### [NEW] `packages/collector/src/main/ledger-keys.ts`

- `ledger keygen`, `ledger encrypt`, `ledger decrypt` actions (registered in the `ACTIONS` map).

### Scripts, workflows, docs

- `scripts/secret-scan.ts`: patterns for `CADL-SECRET-` / `CADL-PIPELINE-`.
- `collect-audit.yml`, `ledger-backfill.yml`, `ledger-seal.yml`, `ledger-verify.yml`:
  `LEDGER_PIPELINE_KEY: ${{ secrets.LEDGER_PIPELINE_KEY }}` on the steps that read the ledger.
- `.env.example` (`LEDGER_PIPELINE_KEY=`), `AGENTS.md` / `security-zero-leakage.md` secret
  lists, `docs/SETUP.md`, `docs/DEPLOYMENT.md`, `docs/BLUEPRINT.md` §6.5,
  `storage-and-data-routing.md`, `CHANGELOG.md`, `config/default.json` if it lists ledger keys.

## Verification Plan

### Automated Tests

- Crypto: round trip, several recipients (each decrypts alone), pipeline-only read, wrong key
  (key mismatch error, nothing decrypted), tampered header / ciphertext, malformed keys (error
  without the key text), no plaintext in the encrypted bytes.
- Repository: encrypted write/read, manifest `sha256` equals the plaintext hash and
  `encryptedSha256` the stored bytes, unchanged content keeps bytes, mixed plain/encrypted month,
  unreadable without a key (never overwritten), `reencode`.
- Commands: update / seal / verify / backfill pass on an encrypted ledger; fail closed without the
  pipeline key; keygen / encrypt / decrypt (refuse CI, refuse paths in data dir / repository, no
  secret or decrypted content in log lines).
- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`

### Manual Verification

- `pnpm ledger keygen` -> set recipients -> `pnpm ledger bootstrap` on demo data -> `ledger
decrypt` and compare with the plaintext ledger.
