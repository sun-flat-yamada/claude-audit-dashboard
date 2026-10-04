import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { stableStringify } from '../storage/file-store.js';

/**
 * One captured API exchange. Deliberately has no header fields: authentication headers and keys
 * never reach a capture, so a capture can only leak tenant data, never credentials.
 */
export interface RawCaptureEntry {
  request: { method: string; path: string; query: Record<string, string[]> };
  response: { status: number; body: unknown };
}

/** Sink for captured exchanges (opt-in, default off). */
export interface RawCapture {
  record(entry: RawCaptureEntry): Promise<void>;
}

export const rawCaptureEntrySchema = z.object({
  request: z.object({
    method: z.string(),
    path: z.string(),
    query: z.record(z.string(), z.array(z.string())),
  }),
  response: z.object({ status: z.number().int(), body: z.unknown() }),
});

/** Query string as `name -> values[]` (repeated parameters keep their order). */
export function queryOf(url: URL): Record<string, string[]> {
  const query: Record<string, string[]> = {};
  for (const [name, value] of url.searchParams) (query[name] ??= []).push(value);
  return query;
}

/** UUIDs and prefixed IDs are kept out of file names (real IDs must not leak through them). */
const ID_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:[a-z]+_)+[A-Za-z0-9]*\d[A-Za-z0-9]*)$/i;

/** `0007_organizations-users.json`: a sequence number keeps the request order, the slug the endpoint. */
export function captureFileName(sequence: number, path: string): string {
  const slug = path
    .replace(/^\/v1\//, '')
    .split('/')
    .map((segment) => (ID_SEGMENT.test(segment) ? 'id' : segment))
    .join('/')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${String(sequence).padStart(4, '0')}_${slug || 'root'}.json`;
}

/** Writes one file per request into `dir`. Real tenant data: keep the directory out of Git. */
export class FileRawCapture implements RawCapture {
  private sequence = 0;
  private ready: Promise<unknown> | undefined;

  constructor(readonly dir: string) {}

  async record(entry: RawCaptureEntry): Promise<void> {
    const sequence = ++this.sequence;
    this.ready ??= mkdir(this.dir, { recursive: true });
    await this.ready;
    await writeFile(
      join(this.dir, captureFileName(sequence, entry.request.path)),
      stableStringify(entry),
    );
  }
}

/** Reads every capture file of a directory in file-name (= request) order. */
export async function loadCaptureEntries(dir: string): Promise<RawCaptureEntry[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(
    names.map(async (name) => {
      const parsed = rawCaptureEntrySchema.safeParse(
        JSON.parse(await readFile(join(dir, name), 'utf8')),
      );
      if (!parsed.success) throw new Error(`${name} is not a capture file`);
      return parsed.data;
    }),
  );
}

/** Where raw captures may go inside the working directory (gitignored, see `.gitignore`). */
export const LOCAL_CAPTURE_DIR = 'data/raw';

/**
 * Resolves and validates the capture directory: never in CI, and either outside the working
 * directory (the repository) or under the gitignored `data/raw/`.
 */
export function resolveCaptureDir(baseDir: string, dir: string, ci: string | undefined): string {
  if (ci?.toLowerCase() === 'true' || ci === '1') {
    throw new Error('Raw capture is disabled in CI: it stores real tenant data');
  }
  const resolved = resolve(baseDir, dir);
  const rel = relative(baseDir, resolved);
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  const local = rel === LOCAL_CAPTURE_DIR || rel.startsWith(`${LOCAL_CAPTURE_DIR}${sep}`);
  if (!outside && !local) {
    throw new Error(
      `Raw capture directory must be outside the repository or under ${LOCAL_CAPTURE_DIR}/ (gitignored): ${rel || '.'}`,
    );
  }
  return resolved;
}
