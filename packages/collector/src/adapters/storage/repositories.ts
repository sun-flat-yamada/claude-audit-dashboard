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
import { stableStringify, type FileStore } from './file-store.js';

type Item = Record<string, unknown>;

export type StorageSortKeyFn = (item: Record<string, unknown>) => string;

/** Stable item order per dataset so re-collected, unchanged data is byte-identical. */
export const SORT_KEYS: Partial<Record<DatasetName, StorageSortKeyFn>> = {
  activities: (a) => `${String(a.createdAt)}|${String(a.id)}`,
  usage: (r) => `${String(r.date)}|${String(r.dimension)}|${String(r.key ?? '')}`,
  cost: (r) => `${String(r.date)}|${String(r.dimension)}|${String(r.key ?? '')}`,
  adoption: (r) => String(r.date),
  memberActivity: (r) => String(r.userId),
  credentialUsage: (r) => String(r.credentialId),
  settings: (r) => String(r.organizationId),
  spendLimits: (r) => `${String(r.userId)}|${String(r.period)}`,
  consoleUsage: (r) => `${String(r.date)}|${String(r.workspaceId ?? '')}|${String(r.model ?? '')}`,
  consoleCost: (r) =>
    `${String(r.date)}|${String(r.workspaceId ?? '')}|${String(r.model ?? '')}|${String(r.costType ?? '')}`,
  claudeCodeActivity: (r) =>
    `${String(r.date)}|${String(r.actorKind)}|${String(r.actor ?? '')}|${String(r.terminalType ?? '')}|${String(r.customerType ?? '')}`,
  skillUsage: (r) => String(r.name),
  connectorUsage: (r) => String(r.name),
  pluginUsage: (r) => `${String(r.name)}|${String(r.pluginId ?? '')}`,
  chatProjectUsage: (r) => String(r.id),
};

export function registerStorageSortKey(dataset: DatasetName, keyFn: StorageSortKeyFn): void {
  SORT_KEYS[dataset] = keyFn;
}

export function storageSortKeyFor(dataset: DatasetName): StorageSortKeyFn {
  return SORT_KEYS[dataset] ?? ((item: Item) => String(item.id ?? ''));
}

const sortForStorage = (dataset: DatasetName, items: readonly unknown[]): unknown[] => {
  const key = storageSortKeyFor(dataset);
  return [...(items as Item[])].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
};

const manifestSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string(),
  collectedAt: z.string(),
  coverage: z.record(z.string(), z.looseObject({ status: z.enum(['ok', 'unavailable', 'error']) })),
});

/**
 * The files of one snapshot as `[relative path, content]`, in write order: one file per dataset,
 * the manifest last (it marks a complete snapshot). Pure; also what the synthetic history writes.
 */
export function snapshotFiles(dir: string, snapshot: AuditSnapshot): [string, string][] {
  const base = `${dir}/${snapshot.id}`;
  const files: [string, string][] = [];
  for (const [name, items] of Object.entries(snapshot.data)) {
    if (isDatasetName(name) && items)
      files.push([`${base}/${name}.json`, stableStringify(sortForStorage(name, items))]);
  }
  const { schemaVersion, id, collectedAt, coverage } = snapshot;
  files.push([
    `${base}/manifest.json`,
    stableStringify({ schemaVersion, id, collectedAt, coverage }),
  ]);
  return files;
}

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
    for (const [path, content] of snapshotFiles(this.dir, snapshot))
      await this.store.write(path, content);
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
