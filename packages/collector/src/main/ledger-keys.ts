import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  generateIdentity,
  generatePipelineKey,
  parsePipelineKey,
} from '../adapters/storage/ledger-crypto.js';
import { FsLedgerRepository, ledgerCodecsFor, sha256Hex } from '../adapters/storage/ledger.js';
import { refuseOnUntrustedKeyHost } from '../infrastructure/key-host.js';
import type { Container } from './container.js';
import { ledgerKeyCheck } from './ledger-key-check.js';
import { assertFlags, localKeysOf, namesKeyFile, valueOf } from './ledger-key-files.js';

/**
 * Key handling of the encrypted ledger (#162 U8, #174 U9): `ledger keygen`, `ledger encrypt`,
 * `ledger decrypt` and `ledger key-check`. Key material and decrypted content never reach a log
 * line: keys go to a new file (mode 0600), decrypted files to a directory outside the data
 * directory and the repository. Whatever handles a private key, a key backup or plaintext refuses
 * to run on CI and in a Claude Code cloud session (`key-host.ts`).
 */

/** Resolves `path`; refuses one inside the data directory or the directory pnpm started in. */
function outsideRepository(c: Container, path: string, what: string): string {
  const full = resolve(c.env.baseDir, path);
  for (const root of [c.store.root, resolve(c.env.baseDir)])
    if (full === root || full.startsWith(root + sep))
      throw new Error(
        `${what} must be outside the data directory and the repository (it could be committed)`,
      );
  return full;
}

/** Writes a new file readable by the owner only; never overwrites. */
async function writePrivate(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { mode: 0o600, flag: 'wx' });
}

/** `keygen --out <file> [--pipeline]`: a recipient identity, or the workflows' pipeline key. */
async function keygen(c: Container, args: readonly string[]): Promise<void> {
  assertFlags(args, ['--out', '--pipeline']);
  refuseOnUntrustedKeyHost(c.env, 'keygen');
  const out = valueOf(args, '--out');
  if (!out) throw new Error('ledger keygen requires --out <file> (outside the repository)');
  const path = outsideRepository(c, out, 'The key file');
  if (args.includes('--pipeline')) {
    const key = generatePipelineKey();
    await writePrivate(
      path,
      `# claude-audit ledger pipeline key: store it as the Actions secret LEDGER_PIPELINE_KEY and keep\n# this file offline as the backup (GitHub secrets cannot be read back). Never commit it.\n${key}\n`,
    );
    c.logger.info(
      `Ledger pipeline key ${parsePipelineKey(key).fingerprint} written to ${path} (mode 0600)`,
    );
    return;
  }
  const { identity, recipient } = generateIdentity();
  await writePrivate(
    path,
    `# claude-audit ledger identity (private key). Keep it offline: never commit it or store it in GitHub.\n# public key: ${recipient}\n${identity}\n`,
  );
  c.logger.info(`Ledger identity written to ${path} (mode 0600)`);
  c.logger.info(`Public key (add to ledger.encryption.recipients): ${recipient}`);
}

/**
 * `encrypt [--all] [--identity <file>] [--pipeline-key <file>]`: re-stores the plain files
 * encrypted. `--all` also re-encrypts the encrypted files to the current recipients and pipeline
 * key; `--identity` (a local private key) or `--pipeline-key` (the backup of the previous pipeline
 * key) reads them when the pipeline key was rotated or lost.
 */
async function encrypt(c: Container, args: readonly string[]): Promise<void> {
  assertFlags(args, ['--all', '--identity', '--pipeline-key']);
  const recipients = c.config.ledger.encryption.recipients;
  if (recipients.length === 0)
    throw new Error('ledger encrypt needs ledger.encryption.recipients (encryption is off)');
  const keys = await localKeysOf(c, args, 'encrypt with a key file');
  const codecs = ledgerCodecsFor({ recipients, pipelineKey: c.env.ledgerPipelineKey, ...keys });
  const repository = new FsLedgerRepository(c.store, codecs);
  let files = 0;
  const months = await repository.months();
  for (const month of months) files += await repository.reencode(month, args.includes('--all'));
  c.logger.info(
    `Ledger: ${String(files)} file(s) of ${String(months.length)} month(s) stored encrypted`,
  );
  if (files > 0)
    c.logger.warn(
      'Ledger: earlier versions stay in the data/audit git history until the branch is rotated (docs/DEPLOYMENT.md)',
    );
}

/** Decrypts one month into `<out>/<month>/`; resolves the files written and hash mismatches. */
async function decryptMonth(repository: FsLedgerRepository, month: string, out: string) {
  const manifest = await repository.manifest(month);
  let files = 0;
  const mismatches: string[] = [];
  for (const file of await repository.decodedFiles(month)) {
    const listed = file.revision
      ? manifest?.revisions?.[file.dataset]
      : manifest?.datasets[file.dataset];
    if (listed?.sha256 !== sha256Hex(file.text)) mismatches.push(`${month}/${file.name}`);
    await writePrivate(join(out, month, `${file.name}.jsonl`), file.text);
    files += 1;
  }
  if (manifest)
    await writePrivate(join(out, month, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { files, mismatches };
}

/**
 * `decrypt (--identity <file> | --pipeline-key <file>) --out <dir> [--month <yyyy-mm>]`: a local
 * private key or the offline backup of the pipeline key; never `LEDGER_PIPELINE_KEY` itself.
 */
async function decrypt(c: Container, args: readonly string[]): Promise<void> {
  assertFlags(args, ['--identity', '--pipeline-key', '--out', '--month']);
  refuseOnUntrustedKeyHost(c.env, 'decrypt');
  const outArg = valueOf(args, '--out');
  if (!namesKeyFile(args) || !outArg)
    throw new Error(
      'ledger decrypt requires --identity <file> or --pipeline-key <file>, and --out <dir>',
    );
  const out = outsideRepository(c, outArg, 'The output directory');
  const keys = await localKeysOf(c, args, 'decrypt');
  const codecs = ledgerCodecsFor({ recipients: [], pipelineKey: undefined, ...keys });
  const repository = new FsLedgerRepository(c.store, codecs);
  const month = valueOf(args, '--month');
  const months = month ? [month] : await repository.months();
  let files = 0;
  const mismatches: string[] = [];
  for (const m of months) {
    const result = await decryptMonth(repository, m, out);
    files += result.files;
    mismatches.push(...result.mismatches);
  }
  c.logger.info(`Ledger: ${String(files)} file(s) of ${String(months.length)} month(s) decrypted`);
  if (mismatches.length > 0)
    throw new Error(`Decrypted content differs from MANIFEST.json: ${mismatches.join(', ')}`);
}

/** The key actions of `ledger` (registered in its action map). */
export const LEDGER_KEY_ACTIONS = {
  keygen,
  encrypt,
  decrypt,
  'key-check': ledgerKeyCheck,
} as const;
