import { SNAPSHOT_SCHEMA_VERSION, type AuditSnapshot } from '../model/snapshot.js';

/** Test hasher: FNV-1a (hex). Production injects SHA-256. */
export const fnv = (text: string): string => {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
};

type Data = Record<string, unknown[]>;

export function snapshotOf(
  collectedAt: string,
  data: Data,
  meta: Record<string, { status?: 'ok' | 'error' | 'unavailable'; asOf?: string }> = {},
): AuditSnapshot {
  const coverage = Object.fromEntries(
    Object.keys(data).map((name) => [name, { status: 'ok', ...meta[name] }]),
  );
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: `${collectedAt.slice(0, 19).replaceAll(':', '-')}Z`,
    collectedAt,
    coverage,
    data,
  } as AuditSnapshot;
}
