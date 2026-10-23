import { createHash } from 'node:crypto';
import type { LedgerManifest, StoredLedgerFile } from '@claude-audit/core';
import {
  ENCRYPTED_LEDGER_SUFFIX,
  encryptedLedgerCodec,
  parsePipelineKey,
  type LedgerKeyring,
} from '../adapters/storage/ledger-crypto.js';
import { FsLedgerRepository, gzipLedgerCodec, sha256Hex } from '../adapters/storage/ledger.js';
import type { Container } from './container.js';
import { assertFlags, localKeysOf, namesKeyFile, valueOf } from './ledger-key-files.js';

/**
 * `ledger key-check [--identity <file> | --pipeline-key <file>] [--month <yyyy-mm>]` (#174 U9):
 * decodes every stored file in memory with exactly one key and compares it with `MANIFEST.json`
 * (`encryptedSha256` of the stored bytes, `sha256` of the content). Nothing is written; the log
 * holds counts, key fingerprints and `<month>/<file>` names only, never key material or content.
 * Without an option it checks `LEDGER_PIPELINE_KEY` (the `Ledger Key Check` workflow); a key file
 * is refused on CI and in a Claude Code cloud session.
 */

interface KeyUnderTest {
  /** `pipeline key <fingerprint>` / `identity <fingerprint>` (not secret). */
  label: string;
  keyring: LedgerKeyring;
}

interface CheckTally {
  files: number;
  encrypted: number;
  findings: string[];
}

const bytesSha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The one key the check uses: a key file, else `LEDGER_PIPELINE_KEY`. */
async function keyUnderTest(c: Container, args: readonly string[]): Promise<KeyUnderTest> {
  if (!namesKeyFile(args)) {
    if (!c.env.ledgerPipelineKey)
      throw new Error(
        'ledger key-check needs LEDGER_PIPELINE_KEY, --pipeline-key <file> or --identity <file>',
      );
    const pipeline = parsePipelineKey(c.env.ledgerPipelineKey);
    return {
      label: `pipeline key ${pipeline.fingerprint}`,
      keyring: { recipients: [], identities: [], pipeline },
    };
  }
  const { identities, readPipelineKeys } = await localKeysOf(c, args, 'key-check with a key file');
  if (identities.length + readPipelineKeys.length !== 1)
    throw new Error('ledger key-check takes one key: --identity <file> or --pipeline-key <file>');
  const [identity] = identities;
  const label = identity
    ? `identity ${identity.recipient.fingerprint}`
    : `pipeline key backup ${readPipelineKeys[0]?.fingerprint ?? ''}`;
  return {
    label,
    keyring: { recipients: [], identities, pipeline: null, readPipelines: readPipelineKeys },
  };
}

/** The manifest entry of a stored file (dataset or revision). */
const listedOf = (manifest: LedgerManifest | null, file: StoredLedgerFile) =>
  file.revision
    ? manifest?.revisions?.[file.dataset ?? '']
    : manifest?.datasets[file.dataset ?? ''];

/** One finding for a stored file, or null when it reads and matches the manifest. */
function checkFile(
  file: StoredLedgerFile,
  manifest: LedgerManifest | null,
  keyring: LedgerKeyring,
): string | null {
  const listed = listedOf(manifest, file);
  if (!listed) return 'not listed in MANIFEST.json';
  const encrypted = file.name.endsWith(ENCRYPTED_LEDGER_SUFFIX);
  if (encrypted && listed.encryptedSha256 !== bytesSha256(file.bytes))
    return 'stored bytes differ from encryptedSha256 in MANIFEST.json';
  let text: string;
  try {
    text = (encrypted ? encryptedLedgerCodec(keyring) : gzipLedgerCodec).decode(file.bytes);
  } catch (error) {
    return `unreadable: ${(error as Error).message}`;
  }
  return sha256Hex(text) === listed.sha256 ? null : 'content differs from sha256 in MANIFEST.json';
}

/** Datasets the manifest lists but the month does not store. */
function missingFiles(manifest: LedgerManifest | null, files: readonly StoredLedgerFile[]) {
  const stored = new Set(files.map((f) => `${f.revision ? 'revisions/' : ''}${f.dataset ?? ''}`));
  const listed = [
    ...Object.keys(manifest?.datasets ?? {}),
    ...Object.keys(manifest?.revisions ?? {}).map((d) => `revisions/${d}`),
  ];
  return listed.filter((name) => !stored.has(name));
}

async function checkMonth(
  repository: FsLedgerRepository,
  month: string,
  key: KeyUnderTest,
  tally: CheckTally,
): Promise<void> {
  const manifest = await repository.manifest(month);
  const files = await repository.storedFiles(month);
  for (const file of files) {
    tally.files += 1;
    if (file.name.endsWith(ENCRYPTED_LEDGER_SUFFIX)) tally.encrypted += 1;
    const finding = checkFile(file, manifest, key.keyring);
    if (finding) tally.findings.push(`${month}/${file.name}: ${finding}`);
  }
  for (const name of missingFiles(manifest, files))
    tally.findings.push(`${month}/${name}: listed in MANIFEST.json but missing`);
}

export async function ledgerKeyCheck(c: Container, args: readonly string[]): Promise<void> {
  assertFlags(args, ['--identity', '--pipeline-key', '--month']);
  const key = await keyUnderTest(c, args);
  const repository = new FsLedgerRepository(c.store);
  const month = valueOf(args, '--month');
  const months = month ? [month] : await repository.months();
  const tally: CheckTally = { files: 0, encrypted: 0, findings: [] };
  for (const m of months) await checkMonth(repository, m, key, tally);
  const summary = `${String(tally.files)} file(s) of ${String(months.length)} month(s), ${String(tally.encrypted)} encrypted, checked with the ${key.label}`;
  if (tally.findings.length === 0) {
    c.logger.info(`Ledger key check pass: ${summary}; every file matches MANIFEST.json`);
    if (c.config.ledger.encryption.recipients.length > 0 && tally.encrypted < tally.files)
      c.logger.warn(
        `Ledger key check: ${String(tally.files - tally.encrypted)} file(s) are not encrypted`,
      );
    return;
  }
  for (const finding of tally.findings) c.logger.error(`Ledger key check: ${finding}`);
  throw new Error(
    `Ledger key check failed: ${String(tally.findings.length)} finding(s) in ${summary}`,
  );
}
