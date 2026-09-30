import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/** JSON file store rooted at a data directory (the `data/audit` orphan-branch checkout). */
export class FileStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private resolvePath(relPath: string): string {
    const full = resolve(this.root, relPath);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Path escapes store root: ${relPath}`);
    }
    return full;
  }

  async readJson<T>(relPath: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.resolvePath(relPath), 'utf8')) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Atomic write (temp file + rename). */
  async writeJson(relPath: string, value: unknown): Promise<void> {
    const full = this.resolvePath(relPath);
    await mkdir(dirname(full), { recursive: true });
    const tmp = `${full}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(tmp, full);
  }

  /** List `.json` file names in a directory, sorted ascending. */
  async listJson(relDir: string): Promise<string[]> {
    try {
      const names = await readdir(join(this.resolvePath(relDir)));
      return names.filter((n) => n.endsWith('.json')).sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }
}
