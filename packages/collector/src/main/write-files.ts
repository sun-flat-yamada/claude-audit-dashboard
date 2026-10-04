import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Writes a path -> content map below `outDir`, creating sub-directories (e.g. `detail/`). */
export async function writeFiles(outDir: string, files: Readonly<Record<string, string>>) {
  await Promise.all(
    Object.entries(files).map(async ([name, content]) => {
      const target = join(outDir, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }),
  );
}
