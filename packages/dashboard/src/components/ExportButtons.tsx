import type { DashboardCheckResult } from '@claude-audit/core/contracts';
import {
  complianceCsv,
  complianceJson,
  downloadText,
  exportFileName,
  MEDIA_TYPE,
  type ExportFormat,
} from '../lib/export';
import type { StatusFilter } from '../lib/view';

const BUTTON =
  'rounded border border-[var(--border)] px-3 py-1 text-sm enabled:hover:border-[var(--text-secondary)] disabled:opacity-50';

function save(
  results: readonly DashboardCheckResult[],
  filter: StatusFilter,
  format: ExportFormat,
  stamp: string,
): void {
  const content = format === 'csv' ? complianceCsv(results) : complianceJson(results, filter);
  downloadText(exportFileName(stamp, format, filter), content, MEDIA_TYPE[format]);
}

/**
 * Export of the filtered view (named after the filter) and of all results. Files are built in the
 * browser from the already-masked `dashboard.json` rows; nothing is uploaded.
 */
export function ExportButtons({
  visible,
  all,
  filter,
  filterLabel,
  stamp,
}: {
  visible: readonly DashboardCheckResult[];
  all: readonly DashboardCheckResult[];
  filter: StatusFilter;
  filterLabel: string;
  stamp: string;
}) {
  const formats: ExportFormat[] = ['csv', 'json'];
  return (
    <div role="group" aria-label="Export compliance results" className="mb-3 flex flex-wrap gap-2">
      {formats.map((f) => (
        <button
          key={`view-${f}`}
          type="button"
          className={BUTTON}
          disabled={visible.length === 0}
          onClick={() => save(visible, filter, f, stamp)}
        >
          Export {f.toUpperCase()} ({filterLabel})
        </button>
      ))}
      {formats.map((f) => (
        <button
          key={`all-${f}`}
          type="button"
          className={BUTTON}
          disabled={all.length === 0}
          onClick={() => save(all, 'all', f, stamp)}
        >
          Export all {f.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
