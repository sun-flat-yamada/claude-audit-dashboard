import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRuleCatalog } from '@claude-audit/core';
import {
  DETAIL_ARCHIVE_PATH,
  DETAIL_CONFIG_PATH,
  MONTHLY_INDEX_PATH,
  checkDetailBundle,
  dashboardViewSchema,
  detailArchiveSchema,
  detailConfigSchema,
  monthlyReportIndexSchema,
} from '@claude-audit/core/contracts';
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
      const config = detailConfigSchema.parse(JSON.parse(generated[DETAIL_CONFIG_PATH] ?? '{}'));
      expect(config.rules.some((r) => !r.enabled)).toBe(true);
      expect(config.customRules.length).toBeGreaterThanOrEqual(1);
      expect(config.rules.some((r) => r.parameters.some((p) => p.overridden))).toBe(true);
      expect(config.notifications.channels.some((ch) => ch.kind !== 'console' && ch.enabled)).toBe(
        true,
      );
      const archive = detailArchiveSchema.parse(JSON.parse(generated[DETAIL_ARCHIVE_PATH] ?? '{}'));
      expect(archive.years.length).toBeGreaterThanOrEqual(3);
      expect(archive.totals.snapshots).toBeGreaterThan(0);
      expect(archive.ignoredEntries).toBeGreaterThanOrEqual(1);
      const index = monthlyReportIndexSchema.parse(
        JSON.parse(generated[MONTHLY_INDEX_PATH] ?? '{}'),
      );
      expect(index.reports.length).toBeGreaterThanOrEqual(3);
      // Months are generated with the same data as the existing Markdown report (no change there).
      expect(generated['monthly-report.md']).toContain('2026-08');
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
