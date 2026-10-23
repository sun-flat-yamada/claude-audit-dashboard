import { LEDGER_MONTH } from './entry.js';
import type { LedgerManifest } from './manifest.js';

/**
 * Copies of sealed months in external storage (#161 U7). A copy has the ledger's own layout, so
 * it can be restored by hand: `<yyyy-mm>/<dataset>.jsonl.gz[.enc]`,
 * `<yyyy-mm>/revisions/<dataset>.jsonl.gz[.enc]` and `<yyyy-mm>/MANIFEST.json`, each file the
 * bytes as stored in `data/ledger/` (encrypted files stay encrypted).
 */

/** File name of the manifest inside a month. */
export const TRANSFER_MANIFEST_NAME = 'MANIFEST.json';

/** `<yyyy-mm>/<name>` or `<yyyy-mm>/revisions/<name>`; names are dataset files or the manifest. */
const SINK_PATH = /^(\d{4}-\d{2})(\/revisions)?\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Throws unless `path` is a path a sink stores (no traversal, no other directory). */
export function assertSinkPath(path: string): string {
  const match = SINK_PATH.exec(path);
  if (!match || !LEDGER_MONTH.test(match[1] ?? '') || path.includes('..'))
    throw new Error(`Invalid ledger sink path: ${path}`);
  return path;
}

/** The manifest as copied: without `transfers`, so recording a copy never makes it stale. */
export function transferManifestOf(manifest: LedgerManifest): LedgerManifest {
  const copy: LedgerManifest = { ...manifest };
  delete copy.transfers;
  return copy;
}

/** Hashes of stored bytes: `stored` of the bytes, `content` of the decompressed text (plain files). */
export interface LedgerStoredDigest {
  stored: string;
  content?: string | undefined;
}

/**
 * What a stored file must hash to: `encryptedSha256` (the stored bytes) for an encrypted file,
 * otherwise `sha256` (the decompressed content). Null when the manifest does not list it.
 */
export interface LedgerFileExpectation {
  form: 'stored' | 'content';
  sha256: string;
}

export function expectationOf(
  manifest: LedgerManifest,
  dataset: string,
  revision: boolean,
): LedgerFileExpectation | null {
  const entry = revision ? manifest.revisions?.[dataset] : manifest.datasets[dataset];
  if (!entry) return null;
  return entry.encryptedSha256
    ? { form: 'stored', sha256: entry.encryptedSha256 }
    : { form: 'content', sha256: entry.sha256 };
}

export const matchesExpectation = (
  digest: LedgerStoredDigest,
  expected: LedgerFileExpectation,
): boolean => (expected.form === 'stored' ? digest.stored : digest.content) === expected.sha256;
