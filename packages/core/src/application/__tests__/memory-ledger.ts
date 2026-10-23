import { fnv } from '../../domain/__tests__/ledger-fixtures.js';
import {
  buildLedgerManifest,
  serializeLedgerEntries,
  type LedgerEntry,
  type LedgerManifest,
} from '../../domain/ledger/index.js';
import type { LedgerRepository } from '../ports.js';

/** In-memory repository holding the serialized text, like the file adapter (minus the codec). */
export class MemoryLedger implements LedgerRepository {
  readonly files = new Map<string, string>();
  readonly entries = new Map<string, LedgerEntry[]>();
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
    this.entries.set(path, JSON.parse(`[${text.trim().split('\n').join(',')}]`) as LedgerEntry[]);
    return true;
  }

  async refreshManifest(month: string) {
    const files = [...this.entries]
      .filter(([path]) => path.startsWith(`${month}/`))
      .map(([path, entries]) => ({
        dataset: path.slice(8),
        entries,
        sha256: fnv(this.files.get(path) ?? ''),
      }));
    const next = buildLedgerManifest(month, files, this.manifests.get(month)?.sealed ?? false);
    if (JSON.stringify(next) === JSON.stringify(this.manifests.get(month))) return false;
    this.manifests.set(month, next);
    return true;
  }
}
