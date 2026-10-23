import type { ComplianceReport, Severity } from '../domain/compliance/types.js';
import type { LedgerEntry } from '../domain/ledger/entry.js';
import type { LedgerStatus } from '../domain/ledger/health.js';
import type {
  LedgerManifest,
  LedgerSealRecord,
  LedgerTransferRecord,
} from '../domain/ledger/manifest.js';
import type { LedgerStoredDigest } from '../domain/ledger/transfer.js';
import type { LedgerFileDigest } from '../domain/ledger/verify.js';
import type { DatasetMap, DatasetName, TimeWindow } from '../domain/model/dataset.js';
import type { AuditSnapshot } from '../domain/model/snapshot.js';
import type { DateRange } from '../domain/util/time.js';
import type { ReportDocument } from './documents.js';
import type { CollectorState } from './state.js';

// ─── Data sources ───────────────────────────────────────────────────────────

export interface CollectContext {
  now: Date;
  /** Period for time-bounded datasets (usage, cost, adoption). */
  range: DateRange;
  /** Whatever this collector returned as `cursor` last time (validate before use). */
  cursor: unknown;
}

export interface CollectResult<T> {
  items: T;
  /** Persisted and handed back on the next run (e.g. an Activity Feed window). */
  cursor?: unknown;
  /** Endpoint that actually served the data (fallback chains). */
  source?: string | undefined;
  window?: TimeWindow | undefined;
  asOf?: string | undefined;
}

/** Supplies one dataset. Implemented by API adapters, the demo source or test fakes. */
export interface DatasetCollector<K extends DatasetName = DatasetName> {
  readonly dataset: K;
  readonly source: string;
  collect(context: CollectContext): Promise<CollectResult<DatasetMap[K]>>;
}

/** Thrown when a dataset cannot be collected here (no key, missing scope, disabled API). */
export class DataUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataUnavailableError';
  }
}

// ─── Persistence ────────────────────────────────────────────────────────────

export interface SnapshotRepository {
  save(snapshot: AuditSnapshot): Promise<void>;
  latest(): Promise<AuditSnapshot | null>;
  /** Snapshots collected at or after `from`, oldest first. */
  since(from: Date): Promise<AuditSnapshot[]>;
}

export interface ComplianceReportRepository {
  save(report: ComplianceReport): Promise<void>;
  latest(): Promise<ComplianceReport | null>;
  /** Most recent reports, oldest first. */
  history(limit: number): Promise<ComplianceReport[]>;
}

/**
 * The monthly ledger (`ledger/<yyyy-mm>/<dataset>.<ext>` + `MANIFEST.json`). Files hold entries
 * in the order `mergeLedgerEntries` returns; an unreadable file must make `read` throw (never
 * treat it as empty, or the next write would overwrite it).
 */
export interface LedgerRepository {
  /** Months that have a ledger directory, oldest first. */
  months(): Promise<string[]>;
  /** Stored entries of one month file; empty when the file does not exist. */
  read(month: string, dataset: string): Promise<LedgerEntry[]>;
  /** Stores one month file; resolves true when its content changed. */
  write(month: string, dataset: string, entries: readonly LedgerEntry[]): Promise<boolean>;
  manifest(month: string): Promise<LedgerManifest | null>;
  /** Recomputes `MANIFEST.json` from the month's files; resolves true when it changed. */
  refreshManifest(month: string): Promise<boolean>;
  /** Hash and entry count of every dataset file of a month as stored now (U6 verify). */
  digests(month: string): Promise<LedgerFileDigest[]>;
  /** Same for the month's `revisions/` files. */
  revisionDigests(month: string): Promise<LedgerFileDigest[]>;
  /** Writes `MANIFEST.json` from the month's files with `sealed: true` and the seal record. */
  seal(month: string, record: LedgerSealRecord): Promise<LedgerManifest>;
  /** Stored revision entries of a sealed month's dataset; empty when there are none. */
  readRevisions(month: string, dataset: string): Promise<LedgerEntry[]>;
  /**
   * Stores the revision file of a sealed month's dataset and lists it in `MANIFEST.json`
   * (`revisions`); the dataset files and their manifest entries stay unchanged. Resolves true
   * when the content changed.
   */
  writeRevisions(month: string, dataset: string, entries: readonly LedgerEntry[]): Promise<boolean>;
}

/** `ledger/STATUS.json` (U6); an unreadable store must make `load` throw. */
export interface LedgerStatusStore {
  load(): Promise<LedgerStatus>;
  save(status: LedgerStatus): Promise<void>;
}

/**
 * External storage for sealed months (#161 U7): local directory, Google Drive, SharePoint /
 * OneDrive. Paths are `<yyyy-mm>/<name>` or `<yyyy-mm>/revisions/<name>` (`assertSinkPath`).
 * Errors never carry tokens, URLs or storage IDs.
 */
export interface LedgerSink {
  /** The registered kind (`filesystem`, `gdrive`, `sharepoint`); recorded in `MANIFEST.json`. */
  readonly kind: string;
  /** Stores the bytes at `path`, replacing a file that is there. */
  put(path: string, bytes: Uint8Array): Promise<void>;
  /** The stored bytes; null when there is no file at `path`. */
  get(path: string): Promise<Uint8Array | null>;
  /** Every file under the month `prefix` (`yyyy-mm`), recursively, as full paths. */
  list(prefix: string): Promise<string[]>;
}

/** One ledger file as stored (`<dataset>.jsonl.gz[.enc]`, `revisions/...`), for a copy. */
export interface StoredLedgerFile {
  /** Path inside the month, e.g. `usage.jsonl.gz` or `revisions/usage.jsonl.gz.enc`. */
  name: string;
  /** Dataset of a dataset or revision file; undefined for the manifest. */
  dataset?: string | undefined;
  revision: boolean;
  bytes: Uint8Array;
}

/** The stored form of the ledger, as `ledger push` needs it (implemented by the ledger store). */
export interface LedgerFileAccess {
  manifest(month: string): Promise<LedgerManifest | null>;
  /** Dataset files, then revision files, of a month, each in the form stored. */
  storedFiles(month: string): Promise<StoredLedgerFile[]>;
  /** `MANIFEST.json` as copied (the manifest given, serialized as the ledger stores it). */
  manifestFile(manifest: LedgerManifest): StoredLedgerFile;
  /** Hashes of stored bytes; `content` only for a readable plain file. Never throws. */
  digest(name: string, bytes: Uint8Array): LedgerStoredDigest;
  /** Records a verified copy in `MANIFEST.json` (`transfers.<kind>`); the files stay. */
  recordTransfer(month: string, kind: string, record: LedgerTransferRecord): Promise<void>;
}

/**
 * Receives a month right after it was sealed (U7: the configured `ledger.sink` copies it).
 * A failing sink is reported; it never unseals the month.
 */
export interface SealedMonthSink {
  readonly id: string;
  deliver(month: string, manifest: LedgerManifest): Promise<void>;
}

/**
 * Fetches one period of one dataset straight from its API for the ledger backfill (#159 U5).
 * Throws `DataUnavailableError` when the dataset cannot be fetched here (no key, missing scope).
 */
export interface BackfillSource {
  readonly dataset: DatasetName;
  readonly source: string;
  fetch(range: DateRange, now: Date): Promise<CollectResult<unknown[]>>;
}

/** What `ledger/BACKFILL.json` remembers of one fetched unit (key `yyyy-mm/<dataset>`). */
export interface BackfillUnitRecord {
  from: string;
  to: string;
  completedAt: string;
  count: number;
}

export interface BackfillProgress {
  schemaVersion: 1;
  units: Record<string, BackfillUnitRecord>;
}

/** Progress of the ledger backfill; an unreadable store must make `load` throw. */
export interface BackfillProgressStore {
  load(): Promise<BackfillProgress>;
  save(progress: BackfillProgress): Promise<void>;
}

export interface StateRepository {
  load(): Promise<CollectorState>;
  save(state: CollectorState): Promise<void>;
}

/** Writes generated files (dashboard data, rendered reports) below the data directory. */
export interface ArtifactWriter {
  write(path: string, content: string): Promise<void>;
}

// ─── Output ─────────────────────────────────────────────────────────────────

export interface RenderedFile {
  /** Suffix appended to the document id, e.g. `.md` or `.cost-by-model.csv`. */
  suffix: string;
  mediaType: string;
  content: string;
}

export interface DocumentRenderer {
  readonly id: string;
  render(document: ReportDocument): RenderedFile[];
}

export interface AlertMessage {
  /** De-duplication key for the cooldown. */
  key: string;
  title: string;
  severity: Severity;
  lines: string[];
  link?: string | undefined;
  document?: ReportDocument | undefined;
}

export interface Notifier {
  readonly id: string;
  send(alert: AlertMessage): Promise<void>;
}

// ─── Runtime ────────────────────────────────────────────────────────────────

export interface Clock {
  now(): Date;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
