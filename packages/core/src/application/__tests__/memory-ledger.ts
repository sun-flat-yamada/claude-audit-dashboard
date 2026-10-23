import { fnv } from '../../domain/__tests__/ledger-fixtures.js';
import {
  buildLedgerManifest,
  serializeLedgerEntries,
  type LedgerEntry,
  type LedgerFileDigest,
  type LedgerManifest,
  type LedgerSealRecord,
  type LedgerStatus,
} from '../../domain/ledger/index.js';
import { emptyLedgerStatus } from '../../domain/ledger/health.js';
import type { LedgerRepository, LedgerStatusStore } from '../ports.js';

const parse = (text: string): LedgerEntry[] =>
  text.trim() === '' ? [] : (JSON.parse(`[${text.trim().split('\n').join(',')}]`) as LedgerEntry[]);

/** In-memory repository holding the serialized text, like the file adapter (minus the codec). */
export class MemoryLedger implements LedgerRepository {
  readonly files = new Map<string, string>();
  readonly entries = new Map<string, LedgerEntry[]>();
  readonly revisions = new Map<string, string>();
  readonly manifests = new Map<string, LedgerManifest>();
  writes = 0;

  months = async () => [...new Set([...this.entries.keys()].map((k) => k.slice(0, 7)))].sort();
  read = async (month: string, dataset: string) => this.entries.get(`${month}/${dataset}`) ?? [];
  manifest = async (month: string) => this.manifests.get(month) ?? null;

  async write(month: string, dataset: string, entries: readonly LedgerEntry[]) {
    const text = serializeLedgerEntries(entries);
    const path = `${month}/${dataset}`;
    if (this.files.get(path) === text) return false;
    this.writes += 1;
    this.files.set(path, text);
    this.entries.set(path, parse(text));
    return true;
  }

  private build(month: string, carry: Parameters<typeof buildLedgerManifest>[2]) {
    const files = [...this.entries]
      .filter(([path]) => path.startsWith(`${month}/`))
      .map(([path, entries]) => ({
        dataset: path.slice(8),
        entries,
        sha256: fnv(this.files.get(path) ?? ''),
      }));
    return buildLedgerManifest(month, files, carry);
  }

  async refreshManifest(month: string) {
    const next = this.build(month, this.manifests.get(month) ?? {});
    if (JSON.stringify(next) === JSON.stringify(this.manifests.get(month))) return false;
    this.manifests.set(month, next);
    return true;
  }

  private digestsOf(map: ReadonlyMap<string, string>, month: string): LedgerFileDigest[] {
    return [...map]
      .filter(([path]) => path.startsWith(`${month}/`))
      .map(([path, text]) => ({
        dataset: path.slice(8),
        sha256: fnv(text),
        count: parse(text).length,
      }))
      .sort((a, b) => (a.dataset < b.dataset ? -1 : 1));
  }

  digests = async (month: string) => this.digestsOf(this.files, month);
  revisionDigests = async (month: string) => this.digestsOf(this.revisions, month);

  async seal(month: string, record: LedgerSealRecord) {
    const previous = this.manifests.get(month);
    const next = this.build(month, { ...previous, sealed: true, seal: record });
    this.manifests.set(month, next);
    return next;
  }

  readRevisions = async (month: string, dataset: string) =>
    parse(this.revisions.get(`${month}/${dataset}`) ?? '');

  async writeRevisions(month: string, dataset: string, entries: readonly LedgerEntry[]) {
    const text = serializeLedgerEntries(entries);
    const path = `${month}/${dataset}`;
    if (this.revisions.get(path) === text) return false;
    this.revisions.set(path, text);
    const manifest = this.manifests.get(month);
    if (manifest)
      this.manifests.set(month, {
        ...manifest,
        revisions: {
          ...manifest.revisions,
          [dataset]: {
            count: entries.length,
            sha256: fnv(text),
            lastRecordedAt:
              entries
                .map((e) => e.recordedAt)
                .sort()
                .at(-1) ?? null,
          },
        },
      });
    return true;
  }
}

/** In-memory `STATUS.json`. */
export class MemoryLedgerStatus implements LedgerStatusStore {
  status: LedgerStatus = emptyLedgerStatus();
  load = async () => structuredClone(this.status);
  save = async (status: LedgerStatus) => {
    this.status = structuredClone(status);
  };
}
