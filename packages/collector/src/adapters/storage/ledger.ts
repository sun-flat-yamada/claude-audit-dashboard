import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  LEDGER_MONTH,
  buildLedgerManifest,
  ledgerManifestSchema,
  ledgerSpecFor,
  parseLedgerEntries,
  serializeLedgerEntries,
  type LedgerEntry,
  type LedgerHasher,
  type LedgerManifest,
  type LedgerRepository,
} from '@claude-audit/core';
import { stableStringify, type FileStore } from './file-store.js';

/** SHA-256 (hex) of a UTF-8 text: the ledger's content hash. */
export const sha256Hex: LedgerHasher = (text) => createHash('sha256').update(text).digest('hex');

/**
 * How a ledger file is stored on disk. The content (JSON Lines) is codec-independent; the
 * manifest hashes the decoded text, so another codec (e.g. encryption, U8) keeps the hashes.
 */
export interface LedgerCodec {
  /** File name suffix after the dataset name, e.g. `.jsonl.gz`. */
  readonly suffix: string;
  encode(text: string): Uint8Array;
  decode(bytes: Uint8Array): string;
}

export const gzipLedgerCodec: LedgerCodec = {
  suffix: '.jsonl.gz',
  encode: (text) => gzipSync(text, { level: 9 }),
  decode: (bytes) => gunzipSync(bytes).toString('utf8'),
};

export const LEDGER_DIR = 'ledger';
export const LEDGER_MANIFEST = 'MANIFEST.json';

/**
 * `ledger/<yyyy-mm>/<dataset>.jsonl.gz` and `ledger/<yyyy-mm>/MANIFEST.json` in the data
 * directory (the `data/audit` checkout). Raw data (e-mail and IP addresses): never staged for
 * Pages or `detail/`. Writes are atomic and skipped when the decoded content is unchanged, so an
 * unchanged month keeps identical bytes. An unreadable file throws and is never overwritten.
 */
export class FsLedgerRepository implements LedgerRepository {
  constructor(
    private readonly store: FileStore,
    private readonly codec: LedgerCodec = gzipLedgerCodec,
    private readonly dir = LEDGER_DIR,
  ) {}

  private file(month: string, dataset: string): string {
    if (!LEDGER_MONTH.test(month)) throw new Error(`Invalid ledger month: ${month}`);
    if (!ledgerSpecFor(dataset))
      throw new Error(`Dataset ${dataset} is not registered for the ledger`);
    return `${this.dir}/${month}/${dataset}${this.codec.suffix}`;
  }

  async months(): Promise<string[]> {
    return (await this.store.list(this.dir))
      .filter((e) => e.directory && LEDGER_MONTH.test(e.name))
      .map((e) => e.name);
  }

  /** Decoded text of one file; null when it does not exist. */
  private async text(path: string): Promise<string | null> {
    const bytes = await this.store.readBytes(path);
    if (!bytes) return null;
    try {
      return this.codec.decode(bytes);
    } catch (error) {
      throw new Error(`Unreadable ledger file ${path}: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  async read(month: string, dataset: string): Promise<LedgerEntry[]> {
    const path = this.file(month, dataset);
    const text = await this.text(path);
    return text === null ? [] : parseLedgerEntries(text, path);
  }

  async write(month: string, dataset: string, entries: readonly LedgerEntry[]): Promise<boolean> {
    const path = this.file(month, dataset);
    const text = serializeLedgerEntries(entries);
    if ((await this.text(path)) === text) return false;
    await this.store.write(path, this.codec.encode(text));
    return true;
  }

  async manifest(month: string): Promise<LedgerManifest | null> {
    const path = `${this.dir}/${month}/${LEDGER_MANIFEST}`;
    const raw = await this.store.readJson(path);
    if (raw === null) return null;
    const parsed = ledgerManifestSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Unreadable ledger manifest ${path}`);
    return parsed.data;
  }

  /** Dataset files of one month as `[dataset, decoded text]`, in name order. */
  private async files(month: string): Promise<[string, string][]> {
    const files: [string, string][] = [];
    for (const entry of await this.store.list(`${this.dir}/${month}`)) {
      const dataset = entry.name.slice(0, -this.codec.suffix.length);
      if (entry.directory || !entry.name.endsWith(this.codec.suffix) || !ledgerSpecFor(dataset))
        continue;
      const text = await this.text(`${this.dir}/${month}/${entry.name}`);
      if (text !== null) files.push([dataset, text]);
    }
    return files;
  }

  async refreshManifest(month: string): Promise<boolean> {
    const previous = await this.manifest(month);
    const files = (await this.files(month)).map(([dataset, text]) => ({
      dataset,
      entries: parseLedgerEntries(text, `${this.dir}/${month}/${dataset}${this.codec.suffix}`),
      sha256: sha256Hex(text),
    }));
    const next = stableStringify(buildLedgerManifest(month, files, previous?.sealed ?? false));
    const path = `${this.dir}/${month}/${LEDGER_MANIFEST}`;
    const current = await this.store.readBytes(path);
    if (current?.toString('utf8') === next) return false;
    await this.store.write(path, next);
    return true;
  }
}
