import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  captureFileName,
  loadCaptureEntries,
  type RawCaptureEntry,
} from '../adapters/anthropic/raw-capture.js';
import { Sanitizer } from '../adapters/anthropic/sanitizer.js';
import { stableStringify } from '../adapters/storage/file-store.js';

export interface SanitizeResult {
  files: number;
  emails: number;
  ids: number;
  names: number;
  ips: number;
}

const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
};

/**
 * Sanitizes every capture file of `inDir` into `outDir` with ONE mapping (the same real ID
 * becomes the same synthetic ID in all files). Output names are rebuilt from the sanitized
 * path, and nothing is written when an original value would survive in any output.
 */
export async function sanitizeDirectory(inDir: string, outDir: string): Promise<SanitizeResult> {
  const from = resolve(inDir);
  const to = resolve(outDir);
  if (inside(from, to) || inside(to, from)) {
    throw new Error('Input and output directories must be separate, non-nested directories');
  }
  const existing = await readdir(to).catch(() => []);
  if (existing.length > 0) throw new Error(`Output directory is not empty: ${outDir}`);
  const entries = await loadCaptureEntries(from);
  if (entries.length === 0) throw new Error(`No capture files (*.json) in ${inDir}`);
  const sanitizer = new Sanitizer();
  const outputs = entries.map((entry) => sanitizer.sanitize<RawCaptureEntry>(entry));
  const texts = outputs.map((entry) => stableStringify(entry));
  const leaked = texts.flatMap((text) => sanitizer.residue(text));
  if (leaked.length > 0) {
    throw new Error(
      `Sanitizing left ${leaked.length} original value(s) in the output; nothing written`,
    );
  }
  await mkdir(to, { recursive: true });
  await Promise.all(
    outputs.map((entry, i) =>
      writeFile(join(to, captureFileName(i + 1, entry.request.path)), texts[i] ?? ''),
    ),
  );
  return { files: outputs.length, ...sanitizer.stats() };
}
