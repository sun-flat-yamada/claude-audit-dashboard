import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStore } from '../file-store.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'store-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileStore', () => {
  it('round-trips JSON and lists sorted files', async () => {
    const store = new FileStore(dir);
    await store.writeJson('snapshots/b.json', { n: 2 });
    await store.writeJson('snapshots/a.json', { n: 1 });
    expect(await store.readJson('snapshots/a.json')).toEqual({ n: 1 });
    expect(await store.listJson('snapshots')).toEqual(['a.json', 'b.json']);
  });

  it('returns null/[] for missing entries', async () => {
    const store = new FileStore(dir);
    expect(await store.readJson('nope.json')).toBeNull();
    expect(await store.listJson('nope')).toEqual([]);
  });

  it('rejects path traversal', async () => {
    await expect(new FileStore(dir).writeJson('../evil.json', {})).rejects.toThrow(/escapes/);
  });
});
