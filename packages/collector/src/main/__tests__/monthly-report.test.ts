import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MONTHLY_INDEX_PATH,
  monthlyReportIndexSchema,
  monthlyReportPath,
  monthlyReportSchema,
} from '@claude-audit/core/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_NOW, createDemoCollectors } from '../../adapters/demo/demo-source.js';
import { fixedClock, silentLogger } from '../../infrastructure/runtime.js';
import { createContainer, type Container } from '../container.js';
import { writeMonthlyView } from '../monthly-report.js';
import { collect, generateReport } from '../workflows.js';

let dir: string;
let c: Container;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'monthly-'));
  c = await createContainer({
    env: {},
    cwd: dir,
    dataDir: dir,
    clock: fixedClock(DEMO_NOW),
    collectors: createDemoCollectors(),
    logger: silentLogger,
    source: 'demo',
  });
  await collect(c);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const readIndex = async () =>
  monthlyReportIndexSchema.parse(JSON.parse(await readFile(join(dir, MONTHLY_INDEX_PATH), 'utf8')));

describe('writeMonthlyView', () => {
  it('writes the mapped month file and index, and keeps earlier months listed', async () => {
    for (const month of ['2026-07', '2026-08']) {
      const { document } = await generateReport(c, 'monthly', month);
      const written = await writeMonthlyView(c, document);
      expect(Object.keys(written).sort()).toEqual(
        [MONTHLY_INDEX_PATH, monthlyReportPath(`monthly-${month}`)].sort(),
      );
    }
    expect((await readIndex()).reports.map((r) => r.month)).toEqual(['2026-08', '2026-07']);
    const report = monthlyReportSchema.parse(
      JSON.parse(await readFile(join(dir, monthlyReportPath('monthly-2026-08')), 'utf8')),
    );
    expect(report.status).toBe('ok');
    expect(report.byGroup.length).toBeGreaterThan(0);
  });

  it('regenerating a month replaces its entry instead of duplicating it', async () => {
    const { document } = await generateReport(c, 'monthly', '2026-08');
    await writeMonthlyView(c, document);
    await writeMonthlyView(c, document);
    expect((await readIndex()).reports).toHaveLength(1);
  });

  it('ignores other report kinds and writes nothing', async () => {
    const { document } = await generateReport(c, 'weekly');
    expect(await writeMonthlyView(c, document)).toEqual({});
  });

  it('keeps the full report files under reports/ (the public view is a separate mapped file)', async () => {
    const { paths } = await generateReport(c, 'monthly', '2026-08');
    expect(paths).toContain('reports/monthly/monthly-2026-08.json');
    expect(paths.every((p) => p.startsWith('reports/monthly/'))).toBe(true);
  });
});
