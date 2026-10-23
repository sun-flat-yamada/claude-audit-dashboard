# Walkthrough: Make the encrypted ledger restorable by hand (U9)

## Summary

The encrypted ledger (#162) can now be restored without GitHub Actions, on an operator's machine, with a recipient identity **or** the offline backup of the pipeline key, and checked against `MANIFEST.json`. A new read-only `key-check` command and the `Ledger Key Check` workflow find a wrong, rotated or lost `LEDGER_PIPELINE_KEY` before a restore needs it. Every command that handles a private key, a key backup or plaintext refuses to run on CI and in a Claude Code cloud session (`CLAUDE_CODE_REMOTE=true`). `docs/DEPLOYMENT.md` gains the _Manual restore runbook_. Checks that need real keys, a private fork and real storage are in #177.

## Changes Made

### Collector

- `packages/collector/src/infrastructure/key-host.ts` (new): `untrustedKeyHost(env)` / `refuseOnUntrustedKeyHost(env, action)`, a registry of untrusted hosts (`CI`, `CLAUDE_CODE_REMOTE`) read from the injected `Environment`, never `process.env`, so the test suite behaves the same in a cloud session.
- `packages/collector/src/infrastructure/env.ts`: `Environment.claudeCodeRemote`.
- `packages/collector/src/adapters/storage/ledger-crypto.ts`: `parsePipelineKeyFile`; `LedgerKeyring.readPipelines` (keys that only unwrap).
- `packages/collector/src/adapters/storage/ledger.ts`: `LedgerKeySettings.readPipelineKeys`.
- `packages/collector/src/main/ledger-key-files.ts` (new): option parsing and key files (`--identity`, `--pipeline-key`, registry), refused on untrusted hosts before a file is opened.
- `packages/collector/src/main/ledger-keys.ts`: `decrypt` and `encrypt` accept `--pipeline-key <file>`; the host guard replaces the CI-only check; `keygen --pipeline` asks to keep the file offline as the backup.
- `packages/collector/src/main/ledger-key-check.ts` (new): `ledger key-check [--identity <file> | --pipeline-key <file>] [--month <yyyy-mm>]` decodes every stored file in memory with exactly one key and compares `encryptedSha256` / `sha256`, reports missing and unlisted files; writes nothing, logs counts, fingerprints and file names only, exits non-zero on a finding.
- `packages/collector/src/main/ledger.ts`: `key-check` registered, usage.

### Tests

- `packages/collector/src/__tests__/encrypted-ledger.ts` (new): shared setup extracted from `ledger-encryption.test.ts`; keys generated at run time, environment injected.
- `packages/collector/src/main/__tests__/ledger-key-check.test.ts` (new): decrypt with the pipeline-key backup, wrong / malformed key, rotation with the old backup, key-check pass (env key, identity, backup) with an unchanged data tree, wrong key, tampered bytes, changed content, missing file, one key only, refusal of all key / plaintext commands on CI and in a cloud session, and the env-key route still working there.
- `packages/collector/src/infrastructure/__tests__/key-host.test.ts` (new).
- `scripts/__tests__/ledger-encryption-workflows.test.ts`, `scripts/__tests__/config-overrides-workflows.test.ts`: the new workflow is wired in (secret, job-level `AUDIT_CONFIG_OVERRIDES`, restore only, no save, no key file, no artifact, no expression in a run line).

### Workflow

- `.github/workflows/ledger-key-check.yml` (new): the 11th of each month 05:00 UTC (opt-in) and manual, `main` only, `contents: read`, own concurrency group, `data-branch.sh restore` → `pnpm ledger key-check` with `LEDGER_PIPELINE_KEY`.

### Docs

- `docs/DEPLOYMENT.md`: _Manual restore runbook_ (K key custody, G getting a month from `data/audit` or each sink, D check and decrypt, V verify with `sha256sum`, R rotation, L lost keys); encryption section updated (keep the pipeline-key backup).
- `docs/SETUP.md`, `docs/BLUEPRINT.md` §6.5 and §12.1, `docs/ARCHITECTURE.md` §10, `.agents/rules/storage-and-data-routing.md`, `CHANGELOG.md`.

## Verification Results

| Stage                    | Command                          | Result                                                    |
| :----------------------- | :------------------------------- | :-------------------------------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`               | ✅ Clean (exit 0)                                         |
| TypeScript Check         | `pnpm typecheck`                 | ✅ Pass (exit 0)                                          |
| Unit & Integration Tests | `pnpm test`                      | ✅ core 404, dashboard 464, collector 435, scripts 113 pass |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | ✅ 0 leaks (exit 0)                                       |
| Production Build         | `pnpm build`                     | ✅ Built                                                  |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | ✅ Clean                                                  |

The suite ran in this Claude Code cloud session (`CLAUDE_CODE_REMOTE=true`) and passed: the host guard reads the injected environment only. No real key material was generated, printed or handled; the tests generate keys at run time in temporary directories.
