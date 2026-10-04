import { COMPLIANCE_EXPORT_COLUMNS } from '@claude-audit/core/contracts';
import { complianceReportDefinition, type ReportContext } from '@claude-audit/core';
import { describe, expect, it } from 'vitest';
import { csvRenderer } from '../renderers/csv.js';

/**
 * The dashboard's client-side export (`packages/dashboard/src/lib/export.ts`) starts with
 * COMPLIANCE_EXPORT_COLUMNS; this pins the collector's `pnpm report:compliance` CSV to the same list.
 */
describe('compliance export column parity', () => {
  it('report:compliance CSV header equals COMPLIANCE_EXPORT_COLUMNS', () => {
    const document = complianceReportDefinition.build({
      now: new Date('2026-10-04T00:00:00Z'),
      compliance: {
        snapshotId: 's1',
        generatedAt: '2026-10-04T00:00:00Z',
        summary: { score: 90, passed: 1, failed: 1, warnings: 0, skipped: 0, errors: 0, total: 2 },
        results: [],
      },
      complianceHistory: [],
    } as unknown as ReportContext);
    const findings = csvRenderer.render(document).find((f) => f.suffix.endsWith('findings.csv'));
    expect(findings?.content.split('\r\n')[0]).toBe(COMPLIANCE_EXPORT_COLUMNS.join(','));
  });
});
