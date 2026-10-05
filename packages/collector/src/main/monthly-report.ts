import type { ReportDocument } from '@claude-audit/core';
import { buildMonthlyReportView, mergeMonthlyIndex } from '@claude-audit/core';
import {
  MONTHLY_INDEX_PATH,
  monthlyReportIndexSchema,
  monthlyReportPath,
  monthlyReportSchema,
} from '@claude-audit/core/contracts';
import { stableStringify } from '../adapters/storage/file-store.js';
import type { Container } from './container.js';

/**
 * Writes the public monthly cost data (`detail/monthly/<id>.json` plus the month index) for a
 * monthly report document. Both files are validated against the contract at this single write
 * site; the index is read-merge-written so earlier months stay listed. Returns path -> content,
 * or an empty map for any other report kind.
 */
export async function writeMonthlyView(
  c: Container,
  document: ReportDocument,
): Promise<Record<string, string>> {
  const report = buildMonthlyReportView(document, c.clock.now());
  if (!report) return {};
  const previous = monthlyReportIndexSchema.safeParse(await c.store.readJson(MONTHLY_INDEX_PATH));
  const index = mergeMonthlyIndex(previous.success ? previous.data : null, report);
  const out = {
    [monthlyReportPath(report.id)]: stableStringify(monthlyReportSchema.parse(report)),
    [MONTHLY_INDEX_PATH]: stableStringify(monthlyReportIndexSchema.parse(index)),
  };
  await Promise.all(Object.entries(out).map(([path, content]) => c.artifacts.write(path, content)));
  return out;
}
