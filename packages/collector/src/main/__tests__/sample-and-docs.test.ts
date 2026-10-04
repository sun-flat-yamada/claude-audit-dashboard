import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRuleCatalog } from '@claude-audit/core';
import { checkDetailBundle, dashboardViewSchema } from '@claude-audit/core/contracts';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../infrastructure/runtime.js';
import { writeDemoSample } from '../demo.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('public sample data (data/sample)', () => {
  it('is exactly what `pnpm demo` generates — regenerate with `pnpm demo` after changing the code', async () => {
    const out = await mkdtemp(join(tmpdir(), 'sample-'));
    try {
      const generated = await writeDemoSample(out, { cwd: ROOT, env: {}, logger: silentLogger });
      for (const [name, content] of Object.entries(generated)) {
        expect(await readFile(join(ROOT, 'data/sample', name), 'utf8'), `data/sample/${name}`).toBe(
          content,
        );
      }
      dashboardViewSchema.parse(JSON.parse(generated['dashboard.json'] ?? '{}'));
      const detail = Object.fromEntries(
        Object.entries(generated).filter(([name]) => name.startsWith('detail/')),
      );
      expect(Object.keys(detail).length).toBeGreaterThanOrEqual(5);
      expect(checkDetailBundle(detail, { requireDemo: true })).toEqual([]);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});

/** AGENTS.md rule 8: documented rule tables must match the implemented catalog. */
describe('rule documentation', () => {
  const ids = buildRuleCatalog()
    .rules.map((r) => r.meta.id)
    .sort();
  const documented = async (file: string) => {
    const text = await readFile(join(ROOT, file), 'utf8');
    return [
      ...new Set(
        [...text.matchAll(/^\|\s*\*{0,2}([A-Z]{2}-\d{3})\*{0,2}\s*\|/gm)].map((m) => m[1]),
      ),
    ].sort();
  };

  it.each(['docs/BLUEPRINT.md', 'README.md', 'README.ja.md'])(
    '%s lists every rule and no retired one',
    async (file) => {
      expect(await documented(file)).toEqual(ids);
    },
  );
});
