import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * JSON with object keys sorted (code-unit order) and a trailing newline. Identical data always
 * serializes to identical bytes, so git stores unchanged datasets only once.
 */
export const stableStringify = (value: unknown): string =>
  `${JSON.stringify(
    value,
    (_key, v: unknown) =>
      isPlainObject(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => byCodeUnit(a, b)))
        : v,
    2,
  )}\n`;

export interface Entry {
  name: string;
  directory: boolean;
}

/** File access rooted at the data directory (the `data/audit` orphan-branch checkout). */
export class FileStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Absolute path of `relPath`; refuses paths that escape the root. */
  path(relPath: string): string {
    const full = resolve(this.root, relPath);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Path escapes the data directory: ${relPath}`);
    }
    return full;
  }

  async readJson(relPath: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.path(relPath), 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Atomic write (temporary file + rename). */
  async write(relPath: string, content: string | Uint8Array): Promise<void> {
    const full = this.path(relPath);
    await mkdir(dirname(full), { recursive: true });
    const temporary = `${full}.tmp`;
    await writeFile(temporary, content);
    await rename(temporary, full);
  }

  writeJson(relPath: string, value: unknown): Promise<void> {
    return this.write(relPath, stableStringify(value));
  }

  /** Entries of a directory sorted by name; empty when it does not exist. */
  async list(relDir: string): Promise<Entry[]> {
    try {
      const entries = await readdir(this.path(relDir), { withFileTypes: true });
      return entries
        .map((e) => ({ name: e.name, directory: e.isDirectory() }))
        .sort((a, b) => byCodeUnit(a.name, b.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  remove(relPath: string): Promise<void> {
    return rm(this.path(relPath), { recursive: true, force: true });
  }
}
