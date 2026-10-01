import type {
  ArtifactWriter,
  AuditSnapshot,
  CollectorState,
  ComplianceReport,
  ComplianceReportRepository,
  DatasetName,
  SnapshotRepository,
  StateRepository,
} from '@claude-audit/core';
import { isDatasetName, parseState, timestampId } from '@claude-audit/core';
import { z } from 'zod';
import type { FileStore } from './file-store.js';

type Item = Record<string, unknown>;

/** Stable item order per dataset so re-collected, unchanged data is byte-identical. */
const SORT_KEYS: Partial<Record<DatasetName, (item: Item) => string>> = {
  activities: (a) => `${String(a.createdAt)}|${String(a.id)}`,
  usage: (r) => `${String(r.date)}|${String(r.dimension)}|${String(r.key ?? '')}`,
  cost: (r) => `${String(r.date)}|${String(r.dimension)}|${String(r.key ?? '')}`,
  adoption: (r) => String(r.date),
  memberActivity: (r) => String(r.userId),
  credentialUsage: (r) => String(r.credentialId),
  settings: (r) => String(r.organizationId),
  spendLimits: (r) => `${String(r.userId)}|${String(r.period)}`,
};

const sortForStorage = (dataset: DatasetName, items: readonly unknown[]): unknown[] => {
  const key = SORT_KEYS[dataset] ?? ((item: Item) => String(item.id ?? ''));
  return [...(items as Item[])].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
};

const manifestSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string(),
  collectedAt: z.string(),
  coverage: z.record(z.string(), z.looseObject({ status: z.enum(['ok', 'unavailable', 'error']) })),
});

/**
 * `snapshots/<id>/manifest.json` + one file per dataset. The manifest is written last and
 * marks a complete snapshot; directories without one (interrupted runs) are ignored.
 */
export class FsSnapshotRepository implements SnapshotRepository {
  constructor(
    private readonly store: FileStore,
    private readonly dir = 'snapshots',
  ) {}

  async save(snapshot: AuditSnapshot): Promise<void> {
    const base = `${this.dir}/${snapshot.id}`;
    for (const [name, items] of Object.entries(snapshot.data)) {
      if (isDatasetName(name) && items)
        await this.store.writeJson(`${base}/${name}.json`, sortForStorage(name, items));
    }
    const { schemaVersion, id, collectedAt, coverage } = snapshot;
    await this.store.writeJson(`${base}/manifest.json`, {
      schemaVersion,
      id,
      collectedAt,
      coverage,
    });
  }

  async ids(): Promise<string[]> {
    return (await this.store.list(this.dir)).filter((e) => e.directory).map((e) => e.name);
  }

  async load(id: string): Promise<AuditSnapshot | null> {
    const base = `${this.dir}/${id}`;
    const manifest = manifestSchema.safeParse(await this.store.readJson(`${base}/manifest.json`));
    if (!manifest.success) return null;
    const data: Record<string, unknown> = {};
    for (const name of Object.keys(manifest.data.coverage).filter(isDatasetName)) {
      const items = await this.store.readJson(`${base}/${name}.json`);
      if (Array.isArray(items)) data[name] = items;
    }
    return { ...manifest.data, data } as AuditSnapshot;
  }

  async latest(): Promise<AuditSnapshot | null> {
    for (const id of (await this.ids()).reverse()) {
      const snapshot = await this.load(id);
      if (snapshot) return snapshot;
    }
    return null;
  }

  async since(from: Date): Promise<AuditSnapshot[]> {
    const first = timestampId(from);
    const loaded = await Promise.all(
      (await this.ids()).filter((id) => id >= first).map((id) => this.load(id)),
    );
    return loaded.filter((s): s is AuditSnapshot => s !== null);
  }
}

const reportSchema = z.looseObject({
  schemaVersion: z.literal(2),
  id: z.string(),
  snapshotId: z.string(),
  generatedAt: z.string(),
  summary: z.looseObject({ score: z.number() }),
  results: z.array(z.unknown()),
});

/** `reports/compliance/<snapshot id>.json`, one per evaluated snapshot. */
export class FsComplianceReportRepository implements ComplianceReportRepository {
  constructor(
    private readonly store: FileStore,
    private readonly dir = 'reports/compliance',
  ) {}

  save(report: ComplianceReport): Promise<void> {
    return this.store.writeJson(`${this.dir}/${report.snapshotId}.json`, report);
  }

  private async load(name: string): Promise<ComplianceReport | null> {
    const parsed = reportSchema.safeParse(await this.store.readJson(`${this.dir}/${name}`));
    return parsed.success ? (parsed.data as unknown as ComplianceReport) : null;
  }

  async history(limit: number): Promise<ComplianceReport[]> {
    const names = (await this.store.list(this.dir)).filter(
      (e) => !e.directory && e.name.endsWith('.json'),
    );
    const loaded = await Promise.all(names.slice(-limit).map((e) => this.load(e.name)));
    return loaded.filter((r): r is ComplianceReport => r !== null);
  }

  async latest(): Promise<ComplianceReport | null> {
    return (await this.history(1)).at(-1) ?? null;
  }
}

export class FsStateRepository implements StateRepository {
  constructor(
    private readonly store: FileStore,
    private readonly file = 'state.json',
  ) {}

  async load(): Promise<CollectorState> {
    return parseState(await this.store.readJson(this.file));
  }

  save(state: CollectorState): Promise<void> {
    return this.store.writeJson(this.file, state);
  }
}

export const fileArtifacts = (store: FileStore): ArtifactWriter => ({
  write: (path, content) => store.write(path, content),
});
