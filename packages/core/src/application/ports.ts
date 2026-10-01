import type { ComplianceReport, Severity } from '../domain/compliance/types.js';
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
