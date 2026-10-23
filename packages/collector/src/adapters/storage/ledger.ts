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
  type LedgerFileDigest,
  type LedgerHasher,
  type LedgerManifest,
  type LedgerManifestCarry,
  type LedgerRepository,
  type LedgerSealRecord,
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
/** Sub-directory of a sealed month for entries that arrived after the seal (U6). */
export const LEDGER_REVISIONS = 'revisions';

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

  private monthDir(month: string, sub = ''): string {
    if (!LEDGER_MONTH.test(month)) throw new Error(`Invalid ledger month: ${month}`);
    return `${this.dir}/${month}${sub ? `/${sub}` : ''}`;
  }

  private file(month: string, dataset: string, sub = ''): string {
    if (!ledgerSpecFor(dataset))
      throw new Error(`Dataset ${dataset} is not registered for the ledger`);
    return `${this.monthDir(month, sub)}/${dataset}${this.codec.suffix}`;
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

  private async readFile(path: string): Promise<LedgerEntry[]> {
    const text = await this.text(path);
    return text === null ? [] : parseLedgerEntries(text, path);
  }

  /** Writes the entries when the decoded content changed; resolves the text, or null if unchanged. */
  private async writeFile(path: string, entries: readonly LedgerEntry[]): Promise<string | null> {
    const text = serializeLedgerEntries(entries);
    if ((await this.text(path)) === text) return null;
    await this.store.write(path, this.codec.encode(text));
    return text;
  }

  read(month: string, dataset: string): Promise<LedgerEntry[]> {
    return this.readFile(this.file(month, dataset));
  }

  async write(month: string, dataset: string, entries: readonly LedgerEntry[]): Promise<boolean> {
    return (await this.writeFile(this.file(month, dataset), entries)) !== null;
  }

  async manifest(month: string): Promise<LedgerManifest | null> {
    const path = `${this.dir}/${month}/${LEDGER_MANIFEST}`;
    const raw = await this.store.readJson(path);
    if (raw === null) return null;
    const parsed = ledgerManifestSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Unreadable ledger manifest ${path}`);
    return parsed.data;
  }

  /** Dataset files of one directory as `[dataset, decoded text]`, in name order. */
  private async files(dir: string): Promise<[string, string][]> {
    const files: [string, string][] = [];
    for (const entry of await this.store.list(dir)) {
      const dataset = entry.name.slice(0, -this.codec.suffix.length);
      if (entry.directory || !entry.name.endsWith(this.codec.suffix) || !ledgerSpecFor(dataset))
        continue;
      const text = await this.text(`${dir}/${entry.name}`);
      if (text !== null) files.push([dataset, text]);
    }
    return files;
  }

  /** Writes `MANIFEST.json` built from the month's files; resolves it, and whether it changed. */
  private async writeManifest(month: string, carry: LedgerManifestCarry) {
    const dir = this.monthDir(month);
    const files = (await this.files(dir)).map(([dataset, text]) => ({
      dataset,
      entries: parseLedgerEntries(text, `${dir}/${dataset}${this.codec.suffix}`),
      sha256: sha256Hex(text),
    }));
    const manifest = buildLedgerManifest(month, files, carry);
    const next = stableStringify(manifest);
    const path = `${dir}/${LEDGER_MANIFEST}`;
    const current = await this.store.readBytes(path);
    if (current?.toString('utf8') === next) return { manifest, changed: false };
    await this.store.write(path, next);
    return { manifest, changed: true };
  }

  async refreshManifest(month: string): Promise<boolean> {
    return (await this.writeManifest(month, (await this.manifest(month)) ?? {})).changed;
  }

  private async digestsIn(dir: string): Promise<LedgerFileDigest[]> {
    return (await this.files(dir)).map(([dataset, text]) => ({
      dataset,
      sha256: sha256Hex(text),
      count: parseLedgerEntries(text, `${dir}/${dataset}${this.codec.suffix}`).length,
    }));
  }

  digests(month: string): Promise<LedgerFileDigest[]> {
    return this.digestsIn(this.monthDir(month));
  }

  revisionDigests(month: string): Promise<LedgerFileDigest[]> {
    return this.digestsIn(this.monthDir(month, LEDGER_REVISIONS));
  }

  async seal(month: string, record: LedgerSealRecord): Promise<LedgerManifest> {
    const previous = (await this.manifest(month)) ?? {};
    return (await this.writeManifest(month, { ...previous, sealed: true, seal: record })).manifest;
  }

  readRevisions(month: string, dataset: string): Promise<LedgerEntry[]> {
    return this.readFile(this.file(month, dataset, LEDGER_REVISIONS));
  }

  /** Writes `revisions/<dataset>` and lists it in the manifest; the dataset files stay as sealed. */
  async writeRevisions(
    month: string,
    dataset: string,
    entries: readonly LedgerEntry[],
  ): Promise<boolean> {
    const text = await this.writeFile(this.file(month, dataset, LEDGER_REVISIONS), entries);
    if (text === null) return false;
    const manifest = await this.manifest(month);
    if (!manifest) throw new Error(`Ledger ${month} has no manifest to list revisions in`);
    const revisions = {
      ...manifest.revisions,
      [dataset]: {
        count: entries.length,
        sha256: sha256Hex(text),
        lastRecordedAt:
          entries
            .map((e) => e.recordedAt)
            .sort()
            .at(-1) ?? null,
      },
    };
    await this.store.write(
      `${this.monthDir(month)}/${LEDGER_MANIFEST}`,
      stableStringify({ ...manifest, revisions }),
    );
    return true;
  }
}
