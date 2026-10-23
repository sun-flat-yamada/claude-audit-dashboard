import type { LedgerManifest } from '../../domain/ledger/manifest.js';
import {
  expectationOf,
  matchesExpectation,
  transferManifestOf,
  type LedgerFileExpectation,
} from '../../domain/ledger/transfer.js';
import { errorMessage } from '../../domain/util/mask.js';
import type { Clock, LedgerFileAccess, LedgerSink, StoredLedgerFile } from '../ports.js';

/** Upload and read-back attempts per file before the push fails. */
export const LEDGER_PUSH_ATTEMPTS = 3;

export interface LedgerPushDeps {
  files: LedgerFileAccess;
  sink: LedgerSink;
  clock: Clock;
  /** Default `LEDGER_PUSH_ATTEMPTS`. */
  attempts?: number | undefined;
}

export type LedgerPushFileStatus = 'uploaded' | 'unchanged';

export interface LedgerPushFile {
  /** Path inside the month (`usage.jsonl.gz`, `revisions/...`, `MANIFEST.json`). */
  name: string;
  status: LedgerPushFileStatus;
  /** Uploads it took (0 when the copy was already there). */
  attempts: number;
}

export interface LedgerPushResult {
  month: string;
  sink: string;
  files: LedgerPushFile[];
  /** Files in the copy that the ledger does not have (kept: a copy is never deleted from). */
  extra: string[];
  /** True when `MANIFEST.json` got a new `transfers` record. */
  recorded: boolean;
}

interface PlannedFile {
  file: StoredLedgerFile;
  expected: LedgerFileExpectation;
}

/** Each stored file with the hash the manifest expects; throws when the ledger does not match. */
function planFiles(
  month: string,
  manifest: LedgerManifest,
  stored: readonly StoredLedgerFile[],
  files: LedgerFileAccess,
): PlannedFile[] {
  const planned: PlannedFile[] = [];
  for (const file of stored) {
    const expected = expectationOf(manifest, file.dataset ?? '', file.revision);
    if (!expected || !matchesExpectation(files.digest(file.name, file.bytes), expected))
      throw new Error(
        `Ledger ${month}/${file.name} does not match MANIFEST.json: nothing copied (run pnpm ledger verify)`,
      );
    planned.push({ file, expected });
  }
  const listed = [
    ...Object.keys(manifest.datasets).map((d) => `${d}:false`),
    ...Object.keys(manifest.revisions ?? {}).map((d) => `${d}:true`),
  ];
  const present = new Set(stored.map((f) => `${f.dataset ?? ''}:${String(f.revision)}`));
  const missing = listed.filter((key) => !present.has(key));
  if (missing.length > 0)
    throw new Error(
      `Ledger ${month} lacks ${String(missing.length)} file(s) listed in MANIFEST.json: nothing copied`,
    );
  return planned;
}

/** True when the copy at `path` has the expected hash (an unreadable copy does not). */
async function verified(path: string, planned: PlannedFile, deps: LedgerPushDeps) {
  const bytes = await deps.sink.get(path);
  if (bytes === null) return false;
  return matchesExpectation(deps.files.digest(planned.file.name, bytes), planned.expected);
}

/** Uploads until the read-back matches; a failed upload counts as an attempt. */
async function upload(path: string, planned: PlannedFile, deps: LedgerPushDeps) {
  const attempts = deps.attempts ?? LEDGER_PUSH_ATTEMPTS;
  let reason = 'the copy does not match MANIFEST.json';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await deps.sink.put(path, planned.file.bytes);
      if (await verified(path, planned, deps)) return attempt;
      reason = 'the copy does not match MANIFEST.json';
    } catch (error) {
      reason = errorMessage(error);
    }
  }
  throw new Error(
    `${deps.sink.kind}: ${path} not copied after ${String(attempts)} attempt(s): ${reason}`,
  );
}

async function transfer(
  month: string,
  planned: PlannedFile,
  remote: ReadonlySet<string>,
  deps: LedgerPushDeps,
): Promise<LedgerPushFile> {
  const path = `${month}/${planned.file.name}`;
  if (remote.has(path) && (await verified(path, planned, deps)))
    return { name: planned.file.name, status: 'unchanged', attempts: 0 };
  return {
    name: planned.file.name,
    status: 'uploaded',
    attempts: await upload(path, planned, deps),
  };
}

/** The copied manifest, checked by the hash of its bytes. */
function manifestPlan(manifest: LedgerManifest, deps: LedgerPushDeps): PlannedFile {
  const file = deps.files.manifestFile(transferManifestOf(manifest));
  return {
    file,
    expected: { form: 'stored', sha256: deps.files.digest(file.name, file.bytes).stored },
  };
}

/**
 * `ledger push` (#161 U7): copies one sealed month to external storage as stored (encrypted files
 * stay encrypted), reads every file back and checks it against `MANIFEST.json`, the manifest
 * last. Idempotent: a copy that already matches is not uploaded again, files only the copy has
 * are reported and kept. A copy is recorded in `MANIFEST.json` (`transfers.<kind>`: time and file
 * count) when something was uploaded or no copy was recorded yet.
 */
export async function pushLedgerMonth(
  month: string,
  deps: LedgerPushDeps,
): Promise<LedgerPushResult> {
  const manifest = await deps.files.manifest(month);
  if (!manifest) throw new Error(`Ledger ${month} has no MANIFEST.json`);
  if (!manifest.sealed)
    throw new Error(`Ledger ${month} is not sealed: only sealed months are copied`);
  const planned = [
    ...planFiles(month, manifest, await deps.files.storedFiles(month), deps.files),
    manifestPlan(manifest, deps),
  ];
  const remote = new Set(await deps.sink.list(month));
  const files: LedgerPushFile[] = [];
  for (const file of planned) files.push(await transfer(month, file, remote, deps));
  const local = new Set(planned.map((p) => `${month}/${p.file.name}`));
  const extra = [...remote].filter((path) => !local.has(path)).sort();
  const uploaded = files.some((f) => f.status === 'uploaded');
  const recorded = uploaded || !manifest.transfers?.[deps.sink.kind];
  if (recorded)
    await deps.files.recordTransfer(month, deps.sink.kind, {
      transferredAt: deps.clock.now().toISOString(),
      files: files.length,
    });
  return { month, sink: deps.sink.kind, files, extra, recorded };
}
