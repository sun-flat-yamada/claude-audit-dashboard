# Make the encrypted ledger restorable by hand (U9)

Resolves #174 (parent tracking #154). Prerequisites merged: #162 (U8, encryption at rest), #161 (U7, external copies), #160 (U6, seal / verify).

The owner approved keeping the decryption key `LEDGER_PIPELINE_KEY` as an Actions secret on the condition that the ledger can also be restored by hand. GitHub secrets are write-only, `pnpm ledger decrypt` accepts only a recipient identity, the restore steps are spread over several documents, and the key commands refuse CI but not an agent-operated ephemeral environment such as a Claude Code cloud session.

## User Review Required

> [!IMPORTANT]
>
> - Key and plaintext commands (`keygen`, `decrypt`, `encrypt --identity / --pipeline-key`, `key-check --identity / --pipeline-key`) refuse to run on CI **and** when `CLAUDE_CODE_REMOTE=true`. The check is one small function (`untrustedKeyHost(env)`) over the injected `Environment`, never `process.env` directly, so the repository's own tests still run in a cloud session.
> - `key-check` without a key option reads `LEDGER_PIPELINE_KEY` from the environment (the workflow's route); it writes nothing and logs only counts, fingerprints and `<month>/<file>` names.
> - The new `Ledger Key Check` workflow only restores `data/audit` (no save, read-only `contents: read`, its own concurrency group).

> [!WARNING]
>
> - No real key material is generated, printed or handled in this session: tests generate keys at run time in temporary directories.
> - Restoring from SharePoint / Google Drive by hand and the workflow with the real secret cannot be confirmed here: a `needs-real-tenant` Issue (sub-issue of #154) is opened.

## Proposed Changes

### Collector: host guard

#### [NEW] `packages/collector/src/infrastructure/key-host.ts`

- `untrustedKeyHost(env)`: a registry of checks (`CI`, `CLAUDE_CODE_REMOTE`) returning the name of the first host that matches, else `null`; `refuseOnUntrustedKeyHost(env, action)` throws a message naming the host only.

#### [MODIFY] `packages/collector/src/infrastructure/env.ts`

- Read `CLAUDE_CODE_REMOTE` into `Environment.claudeCodeRemote`.

### Collector: crypto and repository

#### [MODIFY] `packages/collector/src/adapters/storage/ledger-crypto.ts`

- `parsePipelineKeyFile(content)` (first non-comment line, like identity files).
- `LedgerKeyring.readPipelines`: extra pipeline keys that only unwrap (a backup of the old key while a new one is written).

#### [MODIFY] `packages/collector/src/adapters/storage/ledger.ts`

- `LedgerKeySettings.pipelineKeys` (read-only pipeline keys from files) passed to the codec.

### Collector: commands

#### [MODIFY] `packages/collector/src/main/ledger-keys.ts`

- `decrypt --identity <file> | --pipeline-key <file>`; `encrypt --identity <file> | --pipeline-key <file>` (the key that reads the current files).
- Key options read only from files; refused on untrusted hosts. `keygen --pipeline` tells the user to keep an offline backup.

#### [NEW] `packages/collector/src/main/ledger-key-check.ts`

- `ledger key-check [--identity <file> | --pipeline-key <file>] [--month <yyyy-mm>]`: decodes every stored file of every month in memory with exactly the selected key, compares `sha256` and `encryptedSha256` with `MANIFEST.json`, reports files missing from or not listed in the manifest. Writes nothing; logs counts and file names only; fails with a non-zero exit on any finding.

#### [MODIFY] `packages/collector/src/main/ledger.ts`

- Register `key-check`; usage string.

### Workflow

#### [NEW] `.github/workflows/ledger-key-check.yml`

- `workflow_dispatch` + monthly schedule (opt-in `ENABLE_SCHEDULED_JOBS`), `main` only, `contents: read`, job-level `AUDIT_CONFIG_OVERRIDES`, restore → `pnpm ledger key-check` with the secret. No save, no artifact.

#### [MODIFY] `scripts/__tests__/ledger-encryption-workflows.test.ts`, `scripts/__tests__/config-overrides-workflows.test.ts`

- Wire the new workflow into the existing checks; assert restore only, no save, no decrypt / keygen.

### Docs

- `docs/DEPLOYMENT.md`: _Manual restore runbook_ (key custody, getting a month from `data/audit` or each sink, decrypting with an identity or the pipeline-key backup, checking against `sha256` / `encryptedSha256`, rotation, lost keys).
- `docs/SETUP.md`, `docs/BLUEPRINT.md` §6.5 (+ workflow list), `.agents/rules/storage-and-data-routing.md`, `CHANGELOG.md`.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- Targeted: `pnpm --filter @claude-audit/collector test -- ledger-encryption ledger-key-check key-host`
- New cases: decrypt with a pipeline-key file, wrong key, CI / cloud-session refusal (env injected), key-check pass / wrong key / tampered bytes / changed content, logs free of keys and content, no file written.

### Manual Verification

- Real fork: the `Ledger Key Check` workflow with the real secret, and a restore drill from `data/audit` and each sink (split-out Issue).
