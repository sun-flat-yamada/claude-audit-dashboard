import type { DashboardCheckResult } from '@claude-audit/core/contracts';
import { buildExport, exportFileName, MEDIA_TYPE, type ExportFormat } from '../lib/export';

function download(name: string, format: ExportFormat, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: MEDIA_TYPE[format] }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const FORMATS: ExportFormat[] = ['csv', 'json'];

/**
 * Client-side download of compliance results. The filtered pair (named after the active filter) is
 * shown only while a status filter narrows the view; "Export all" always covers every result.
 */
export function ExportButtons({
  results,
  allResults,
  collectedAt,
  filter,
  filterLabel,
}: {
  results: readonly DashboardCheckResult[];
  allResults: readonly DashboardCheckResult[];
  collectedAt: string | null;
  filter: string;
  filterLabel: string;
}) {
  const button = (
    format: ExportFormat,
    rows: readonly DashboardCheckResult[],
    name: string,
    label: string,
  ) => (
    <button
      key={`${name}-${format}`}
      type="button"
      onClick={() => download(name, format, buildExport(format, rows))}
      className="rounded border border-[var(--border)] px-3 py-1 text-sm"
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Export" className="mb-3 flex flex-wrap gap-2">
      {filter !== 'all' &&
        FORMATS.map((f) =>
          button(
            f,
            results,
            exportFileName(collectedAt, f, filter),
            `Export ${f.toUpperCase()} (${filterLabel})`,
          ),
        )}
      {FORMATS.map((f) =>
        button(f, allResults, exportFileName(collectedAt, f), `Export all ${f.toUpperCase()}`),
      )}
    </div>
  );
}
