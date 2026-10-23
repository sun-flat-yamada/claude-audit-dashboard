import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { assertSinkPath, LEDGER_MONTH, type LedgerSink } from '@claude-audit/core';

const codeOf = (error: unknown): string => (error as NodeJS.ErrnoException).code ?? 'error';

/** The error of a failed file operation: the error code only (Node's message quotes the path). */
const fsError = (what: string, error: unknown): Error =>
  new Error(`filesystem: cannot ${what} (${codeOf(error)})`);

/**
 * `filesystem`: a local directory (tests, verification, a mounted share). The copy has the
 * ledger's layout (`<yyyy-mm>/<file>`), so it can be restored by copying it back. Errors name the
 * file inside the month and the error code, never the directory.
 */
export class FilesystemLedgerSink implements LedgerSink {
  readonly kind = 'filesystem';

  constructor(private readonly root: string) {}

  private full(path: string): string {
    return join(this.root, ...assertSinkPath(path).split('/'));
  }

  async put(path: string, bytes: Uint8Array): Promise<void> {
    const file = this.full(path);
    const temp = `${file}.tmp-${String(process.pid)}`;
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(temp, bytes);
      await rename(temp, file);
    } catch (error) {
      throw fsError(`write ${path}`, error);
    }
  }

  async get(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.full(path)));
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return null;
      throw fsError(`read ${path}`, error);
    }
  }

  async list(prefix: string): Promise<string[]> {
    if (!LEDGER_MONTH.test(prefix)) throw new Error(`Invalid ledger sink month: ${prefix}`);
    const dir = join(this.root, prefix);
    try {
      const entries = await readdir(dir, { recursive: true, withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && !e.name.includes('.tmp-'))
        .map((e) => `${prefix}/${relative(dir, join(e.parentPath, e.name)).split(sep).join('/')}`)
        .sort();
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return [];
      throw fsError(`list ${prefix}`, error);
    }
  }
}

/** Resolves `LEDGER_SINK_DIR`; refuses the data directory and the repository (raw data). */
export function filesystemSinkRoot(dir: string, baseDir: string, dataDir: string): string {
  const full = resolve(baseDir, dir);
  for (const root of [resolve(dataDir), resolve(baseDir)])
    if (full === root || full.startsWith(root + sep))
      throw new Error(
        'LEDGER_SINK_DIR must be outside the data directory and the repository (it could be committed)',
      );
  return full;
}
