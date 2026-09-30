import { pathToFileURL } from 'node:url';
import type { AuditSnapshot } from '@claude-audit/shared';
import { runComplianceChecks } from '../checkers/index.js';
import { FileStore } from '../storage/file-store.js';

/** Runs the compliance checks against the newest stored snapshot and stores the report. */
export async function checkLatestSnapshot(store: FileStore) {
  const files = await store.listJson('snapshots');
  const latest = files.at(-1);
  if (!latest) throw new Error('No snapshots found: run collect-audit first');
  const snapshot = await store.readJson<AuditSnapshot>(`snapshots/${latest}`);
  if (!snapshot) throw new Error(`Snapshot not readable: ${latest}`);
  const report = await runComplianceChecks(snapshot);
  await store.writeJson(`reports/${latest}`, report);
  return report;
}

export async function main(): Promise<void> {
  const report = await checkLatestSnapshot(new FileStore(process.env.DATA_DIR ?? 'data'));
  const { compliance_score, failed, total_checks } = report.summary;
  console.log(
    `Compliance score ${compliance_score}/100 (${failed} failed of ${total_checks} checks)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
