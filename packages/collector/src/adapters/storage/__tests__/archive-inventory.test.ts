import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listArchiveEntries, summarizeArchive } from '../archive-inventory.js';
import { FileStore } from '../file-store.js';

let dir: string;
let store: FileStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'archive-inventory-'));
  store = new FileStore(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const put = async (rel: string, size: number) => {
  await mkdir(join(dir, rel, '..'), { recursive: true });
  await writeFile(join(dir, rel), Buffer.alloc(size, 1));
};

describe('archive inventory (adapter)', () => {
  it('lists an archive that does not exist yet as empty', async () => {
    expect(await listArchiveEntries(store)).toEqual([]);
    expect((await summarizeArchive(store)).totals.snapshots).toBe(0);
  });

  it('reads sizes and aggregates by year, ignoring unrelated files and directories', async () => {
    await put('archive/2024/2024-12-01T06-00-00Z.json.gz', 100);
    await put('archive/2024/2024-03-01T06-00-00Z.json.gz', 50);
    await put('archive/2025/2025-01-05T06-00-00Z.json.gz', 7);
    await put('archive/2025/notes.txt', 999);
    await put('archive/2025/nested/2025-01-06T06-00-00Z.json.gz', 999);
    await put('archive/stray.json.gz', 999);
    await put('archive/not-a-year/2024-01-01T06-00-00Z.json.gz', 999);
    await put('snapshots/2024-01-01T06-00-00Z/manifest.json', 999);
    const summary = await summarizeArchive(store);
    expect(summary.years).toEqual([
      {
        year: '2025',
        snapshots: 1,
        bytes: 7,
        oldest: '2025-01-05T06-00-00Z',
        newest: '2025-01-05T06-00-00Z',
      },
      {
        year: '2024',
        snapshots: 2,
        bytes: 150,
        oldest: '2024-03-01T06-00-00Z',
        newest: '2024-12-01T06-00-00Z',
      },
    ]);
    expect(summary.totals).toMatchObject({ snapshots: 3, bytes: 157, years: 2 });
    // notes.txt, nested/, stray.json.gz and not-a-year/ are ignored (counted, not named).
    expect(summary.ignoredEntries).toBe(4);
    expect(JSON.stringify(summary)).not.toMatch(/notes|nested|stray|not-a-year/);
  });
});
