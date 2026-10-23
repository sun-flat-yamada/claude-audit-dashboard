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
  type LedgerRevisionSummary,
  type LedgerRepository,
  type LedgerSealRecord,
  type LedgerFileAccess,
  type LedgerStoredDigest,
  type LedgerTransferRecord,
  type StoredLedgerFile,
} from '@claude-audit/core';
import { stableStringify, type FileStore } from './file-store.js';
import {
  ENCRYPTED_LEDGER_SUFFIX,
  encryptedLedgerCodec,
  parsePipelineKey,
  parseRecipient,
  type LedgerIdentity,
} from './ledger-crypto.js';

/** SHA-256 (hex) of a UTF-8 text: the ledger's content hash. */
export const sha256Hex: LedgerHasher = (text) => createHash('sha256').update(text).digest('hex');

/**
 * How a ledger file is stored on disk. The content (JSON Lines) is codec-independent; the
 * manifest hashes the decoded text, so the encrypted codec (U8) keeps the hashes.
 */
export interface LedgerCodec {
  /** File name suffix after the dataset name, e.g. `.jsonl.gz`. */
  readonly suffix: string;
  /** True when the stored bytes are encrypted (the manifest then also lists their hash). */
  readonly encrypted?: boolean;
  encode(text: string): Uint8Array;
  decode(bytes: Uint8Array): string;
}

export const gzipLedgerCodec: LedgerCodec = {
  suffix: '.jsonl.gz',
  encode: (text) => gzipSync(text, { level: 9 }),
  decode: (bytes) => gunzipSync(bytes).toString('utf8'),
};

/**
 * The codec new files are written with, and the codecs files may be read with (a ledger can hold
 * plain and encrypted files while it is migrated). `read` need not repeat `write`.
 */
export interface LedgerCodecs {
  readonly write: LedgerCodec;
  readonly read: readonly LedgerCodec[];
}

export const plainLedgerCodecs: LedgerCodecs = { write: gzipLedgerCodec, read: [] };

/**
 * Every suffix a ledger file can have, longest first: a file with a suffix no codec at hand reads
 * (an encrypted file without the key) is unreadable, never treated as absent.
 */
export const LEDGER_SUFFIXES = [ENCRYPTED_LEDGER_SUFFIX, gzipLedgerCodec.suffix] as const;

/** SHA-256 (hex) of stored bytes. */
const bytesSha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export interface DecodedLedgerFile {
  dataset: string;
  /** True for a file of `revisions/`. */
  revision: boolean;
  /** `<dataset>` or `revisions/<dataset>`. */
  name: string;
  text: string;
}

/** One dataset file as stored: its decoded text and, when encrypted, the hash of its bytes. */
interface StoredText {
  text: string;
  encryptedSha256: string | undefined;
}

export const LEDGER_DIR = 'ledger';
export const LEDGER_MANIFEST = 'MANIFEST.json';
/** Sub-directory of a sealed month for entries that arrived after the seal (U6). */
export const LEDGER_REVISIONS = 'revisions';

/**
 * `ledger/<yyyy-mm>/<dataset>.jsonl.gz` (or `.jsonl.gz.enc` when encrypted, U8) and
 * `ledger/<yyyy-mm>/MANIFEST.json` in the data directory (the `data/audit` checkout). Raw data
 * (e-mail and IP addresses): never staged for Pages or `detail/`. Writes are atomic and skipped
 * when the decoded content is unchanged, so an unchanged month keeps identical bytes. A write
 * stores the `write` codec's form and removes the other form of the same file. An unreadable file
 * (also an encrypted one without the key) throws and is never overwritten.
 */
export class FsLedgerRepository implements LedgerRepository, LedgerFileAccess {
  private readonly codecs: readonly LedgerCodec[];

  constructor(
    private readonly store: FileStore,
    private readonly codec: LedgerCodecs = plainLedgerCodecs,
    private readonly dir = LEDGER_DIR,
  ) {
    this.codecs = [codec.write, ...codec.read.filter((c) => c.suffix !== codec.write.suffix)];
  }

  private monthDir(month: string, sub = ''): string {
    if (!LEDGER_MONTH.test(month)) throw new Error(`Invalid ledger month: ${month}`);
    return `${this.dir}/${month}${sub ? `/${sub}` : ''}`;
  }

  /** Path of a dataset file without the suffix. */
  private base(month: string, dataset: string, sub = ''): string {
    if (!ledgerSpecFor(dataset))
      throw new Error(`Dataset ${dataset} is not registered for the ledger`);
    return `${this.monthDir(month, sub)}/${dataset}`;
  }

  async months(): Promise<string[]> {
    return (await this.store.list(this.dir))
      .filter((e) => e.directory && LEDGER_MONTH.test(e.name))
      .map((e) => e.name);
  }

  /** Decodes stored bytes with the codec of `suffix`; throws when none at hand reads it. */
  private decode(path: string, suffix: string, bytes: Uint8Array): StoredText {
    const codec = this.codecs.find((c) => c.suffix === suffix);
    try {
      if (!codec)
        throw new Error('encrypted file, but no ledger key is configured (LEDGER_PIPELINE_KEY)');
      return {
        text: codec.decode(bytes),
        encryptedSha256: codec.encrypted ? bytesSha256(bytes) : undefined,
      };
    } catch (error) {
      throw new Error(`Unreadable ledger file ${path}: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  /** The stored file of `base` in the preferred form; null when no form exists. */
  private async stored(base: string): Promise<StoredText | null> {
    for (const suffix of this.suffixOrder()) {
      const bytes = await this.store.readBytes(`${base}${suffix}`);
      if (bytes) return this.decode(`${base}${suffix}`, suffix, bytes);
    }
    return null;
  }

  /** The `write` form first, then every other known suffix. */
  private suffixOrder(): string[] {
    const write = this.codec.write.suffix;
    return [write, ...LEDGER_SUFFIXES.filter((s) => s !== write)];
  }

  private async readFile(base: string): Promise<LedgerEntry[]> {
    const file = await this.stored(base);
    return file === null ? [] : parseLedgerEntries(file.text, base);
  }

  /** Stores `text` in the `write` form and removes the other forms of the file. */
  private async persist(base: string, text: string): Promise<StoredText> {
    const bytes = this.codec.write.encode(text);
    await this.store.write(`${base}${this.codec.write.suffix}`, bytes);
    for (const suffix of LEDGER_SUFFIXES)
      if (suffix !== this.codec.write.suffix) await this.store.remove(`${base}${suffix}`);
    return { text, encryptedSha256: this.codec.write.encrypted ? bytesSha256(bytes) : undefined };
  }

  /** Writes the entries when the decoded content changed; resolves the file, or null if unchanged. */
  private async writeFile(
    base: string,
    entries: readonly LedgerEntry[],
  ): Promise<StoredText | null> {
    const text = serializeLedgerEntries(entries);
    if ((await this.stored(base))?.text === text) return null;
    return this.persist(base, text);
  }

  read(month: string, dataset: string): Promise<LedgerEntry[]> {
    return this.readFile(this.base(month, dataset));
  }

  async write(month: string, dataset: string, entries: readonly LedgerEntry[]): Promise<boolean> {
    return (await this.writeFile(this.base(month, dataset), entries)) !== null;
  }

  async manifest(month: string): Promise<LedgerManifest | null> {
    const path = `${this.dir}/${month}/${LEDGER_MANIFEST}`;
    const raw = await this.store.readJson(path);
    if (raw === null) return null;
    const parsed = ledgerManifestSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Unreadable ledger manifest ${path}`);
    return parsed.data;
  }

  /** Datasets with a file in `dir` (any form), in name order. */
  private async datasetsIn(dir: string): Promise<string[]> {
    const datasets = new Set<string>();
    for (const entry of await this.store.list(dir)) {
      const suffix = LEDGER_SUFFIXES.find((s) => entry.name.endsWith(s));
      const dataset = suffix ? entry.name.slice(0, -suffix.length) : '';
      if (!entry.directory && suffix && ledgerSpecFor(dataset)) datasets.add(dataset);
    }
    return [...datasets].sort();
  }

  /** Dataset files of one directory as `[dataset, stored file]`, in name order. */
  private async files(dir: string): Promise<[string, StoredText][]> {
    const files: [string, StoredText][] = [];
    for (const dataset of await this.datasetsIn(dir)) {
      const file = await this.stored(`${dir}/${dataset}`);
      if (file !== null) files.push([dataset, file]);
    }
    return files;
  }

  /** Writes `MANIFEST.json` built from the month's files; resolves it, and whether it changed. */
  private async writeManifest(month: string, carry: LedgerManifestCarry) {
    const dir = this.monthDir(month);
    const files = (await this.files(dir)).map(([dataset, file]) => ({
      dataset,
      entries: parseLedgerEntries(file.text, `${dir}/${dataset}`),
      sha256: sha256Hex(file.text),
      encryptedSha256: file.encryptedSha256,
    }));
    const manifest = buildLedgerManifest(month, files, carry);
    return { manifest, changed: await this.putManifest(month, manifest) };
  }

  /** Writes `MANIFEST.json` when its text changed; resolves whether it did. */
  private async putManifest(month: string, manifest: LedgerManifest): Promise<boolean> {
    const next = stableStringify(manifest);
    const path = `${this.monthDir(month)}/${LEDGER_MANIFEST}`;
    const current = await this.store.readBytes(path);
    if (current?.toString('utf8') === next) return false;
    await this.store.write(path, next);
    return true;
  }

  async refreshManifest(month: string): Promise<boolean> {
    return (await this.writeManifest(month, (await this.manifest(month)) ?? {})).changed;
  }

  private async digestsIn(dir: string): Promise<LedgerFileDigest[]> {
    return (await this.files(dir)).map(([dataset, file]) => ({
      dataset,
      sha256: sha256Hex(file.text),
      count: parseLedgerEntries(file.text, `${dir}/${dataset}`).length,
      ...(file.encryptedSha256 ? { encryptedSha256: file.encryptedSha256 } : {}),
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
    return this.readFile(this.base(month, dataset, LEDGER_REVISIONS));
  }

  /** Writes `revisions/<dataset>` and lists it in the manifest; the dataset files stay as sealed. */
  async writeRevisions(
    month: string,
    dataset: string,
    entries: readonly LedgerEntry[],
  ): Promise<boolean> {
    const file = await this.writeFile(this.base(month, dataset, LEDGER_REVISIONS), entries);
    if (file === null) return false;
    const manifest = await this.manifest(month);
    if (!manifest) throw new Error(`Ledger ${month} has no manifest to list revisions in`);
    const revisions = { ...manifest.revisions, [dataset]: revisionSummary(entries, file) };
    await this.store.write(
      `${this.monthDir(month)}/${LEDGER_MANIFEST}`,
      stableStringify({ ...manifest, revisions }),
    );
    return true;
  }

  /** The stored form of `base` (first suffix in read order); null when none exists. */
  private async storedForm(base: string): Promise<{ suffix: string; bytes: Uint8Array } | null> {
    for (const suffix of this.suffixOrder()) {
      const bytes = await this.store.readBytes(`${base}${suffix}`);
      if (bytes) return { suffix, bytes };
    }
    return null;
  }

  /** Dataset files, then revision files, of a month as stored (`ledger push`, #161 U7). */
  async storedFiles(month: string): Promise<StoredLedgerFile[]> {
    const files: StoredLedgerFile[] = [];
    for (const sub of ['', LEDGER_REVISIONS]) {
      const dir = this.monthDir(month, sub);
      for (const dataset of await this.datasetsIn(dir)) {
        const form = await this.storedForm(`${dir}/${dataset}`);
        if (!form) continue;
        const name = `${sub ? `${sub}/` : ''}${dataset}${form.suffix}`;
        files.push({ name, dataset, revision: sub !== '', bytes: form.bytes });
      }
    }
    return files;
  }

  /** `MANIFEST.json` serialized as the ledger stores it. */
  manifestFile(manifest: LedgerManifest): StoredLedgerFile {
    return {
      name: LEDGER_MANIFEST,
      revision: false,
      bytes: Buffer.from(stableStringify(manifest), 'utf8'),
    };
  }

  /** Hash of the bytes and, for a readable plain file, of its decompressed text. */
  digest(name: string, bytes: Uint8Array): LedgerStoredDigest {
    const stored = bytesSha256(bytes);
    if (!name.endsWith(gzipLedgerCodec.suffix)) return { stored };
    try {
      return { stored, content: sha256Hex(gzipLedgerCodec.decode(bytes)) };
    } catch {
      return { stored };
    }
  }

  /** Lists a verified copy under `transfers.<kind>`; the files and their entries stay. */
  async recordTransfer(month: string, kind: string, record: LedgerTransferRecord): Promise<void> {
    const manifest = await this.manifest(month);
    if (!manifest) throw new Error(`Ledger ${month} has no manifest to record a copy in`);
    await this.putManifest(month, {
      ...manifest,
      transfers: { ...manifest.transfers, [kind]: record },
    });
  }

  /** Decoded text of every dataset and revision file of a month (`pnpm ledger decrypt`). */
  async decodedFiles(month: string): Promise<DecodedLedgerFile[]> {
    const decoded: DecodedLedgerFile[] = [];
    for (const sub of ['', LEDGER_REVISIONS])
      for (const [dataset, file] of await this.files(this.monthDir(month, sub)))
        decoded.push({
          dataset,
          revision: sub !== '',
          name: sub ? `${sub}/${dataset}` : dataset,
          text: file.text,
        });
    return decoded;
  }

  /**
   * Re-stores the files of one month (and its `revisions/`) in the `write` form: files in another
   * form, and with `all` also files already in it (new recipients). The content and its `sha256`
   * stay the same, so a sealed month stays sealed; the manifest gets the new stored hashes.
   * Resolves the number of files re-stored.
   */
  async reencode(month: string, all = false): Promise<number> {
    let count = 0;
    const revisions = new Map<string, string | undefined>();
    for (const sub of ['', LEDGER_REVISIONS]) {
      const dir = this.monthDir(month, sub);
      for (const dataset of await this.datasetsIn(dir)) {
        const file = await this.reencodeFile(`${dir}/${dataset}`, all);
        if (file.changed) count += 1;
        if (sub) revisions.set(dataset, file.encryptedSha256);
      }
    }
    if (count > 0) await this.restoreManifest(month, revisions);
    return count;
  }

  /** Re-stores one file when it is in another form (or always with `all`). */
  private async reencodeFile(base: string, all: boolean) {
    const inForm = (await this.store.readBytes(`${base}${this.codec.write.suffix}`)) !== null;
    const current = await this.stored(base);
    if (current === null || (inForm && !all)) return { ...current, changed: false };
    return { ...(await this.persist(base, current.text)), changed: true };
  }

  /** Rebuilds the manifest after `reencode`, keeping the seal and the revision summaries. */
  private async restoreManifest(
    month: string,
    stored: ReadonlyMap<string, string | undefined>,
  ): Promise<void> {
    const previous: LedgerManifestCarry = (await this.manifest(month)) ?? {};
    const revisions: Record<string, LedgerRevisionSummary> = {};
    for (const [dataset, summary] of Object.entries(previous.revisions ?? {})) {
      const rest: LedgerRevisionSummary = { ...summary };
      delete rest.encryptedSha256;
      const next = stored.get(dataset);
      revisions[dataset] = next ? { ...rest, encryptedSha256: next } : rest;
    }
    await this.writeManifest(month, { ...previous, revisions });
  }
}

/** The manifest entry of a revision file. */
function revisionSummary(entries: readonly LedgerEntry[], file: StoredText): LedgerRevisionSummary {
  return {
    count: entries.length,
    sha256: sha256Hex(file.text),
    ...(file.encryptedSha256 ? { encryptedSha256: file.encryptedSha256 } : {}),
    lastRecordedAt:
      entries
        .map((e) => e.recordedAt)
        .sort()
        .at(-1) ?? null,
  };
}

export interface LedgerKeySettings {
  /** `ledger.encryption.recipients`; non-empty turns encryption on. */
  recipients: readonly string[];
  /** `LEDGER_PIPELINE_KEY`. */
  pipelineKey: string | undefined;
  /** Local recipient identities (`pnpm ledger decrypt` only). */
  identities?: readonly LedgerIdentity[];
}

/**
 * The codecs of the configured ledger (#162 U8). Without recipients new files stay plain, and
 * encrypted files remain readable with the pipeline key (encryption turned off later). With
 * recipients the pipeline key is required: a file the workflows cannot read back could never be
 * merged again, so the command fails before it writes anything.
 */
export function ledgerCodecsFor(settings: LedgerKeySettings): LedgerCodecs {
  const recipients = settings.recipients.map((text, index) => {
    try {
      return parseRecipient(text);
    } catch {
      throw new Error(`Invalid ledger.encryption.recipients[${String(index)}] (value not shown)`);
    }
  });
  const pipeline = settings.pipelineKey ? parsePipelineKey(settings.pipelineKey) : null;
  if (recipients.length > 0 && !pipeline)
    throw new Error(
      'ledger.encryption.recipients is set but LEDGER_PIPELINE_KEY is not: the ledger is left unchanged',
    );
  const identities = settings.identities ?? [];
  if (!pipeline && identities.length === 0) return plainLedgerCodecs;
  const encrypted = encryptedLedgerCodec({ recipients, identities, pipeline });
  return recipients.length > 0
    ? { write: encrypted, read: [gzipLedgerCodec] }
    : { write: gzipLedgerCodec, read: [encrypted] };
}
