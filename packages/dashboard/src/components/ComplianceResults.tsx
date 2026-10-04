import { useMemo, useState } from 'react';
import type { DashboardCheckResult } from '@claude-audit/core/contracts';
import {
  countByStatus,
  filterResults,
  sortResults,
  STATUS_FILTERS,
  type StatusFilter,
} from '../lib/view';
import { SeverityLabel, StatusBadge } from './Badges';
import { Empty } from './Card';
import { ExportButtons } from './ExportButtons';

const FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  fail: 'Fail',
  warning: 'Review',
  error: 'Error',
  skipped: 'Skipped',
  pass: 'Pass',
};

function Filters({
  value,
  counts,
  onChange,
}: {
  value: StatusFilter;
  counts: Record<StatusFilter, number>;
  onChange: (f: StatusFilter) => void;
}) {
  return (
    <div role="group" aria-label="Filter by status" className="mb-3 flex flex-wrap gap-2">
      {STATUS_FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={value === f}
          onClick={() => onChange(f)}
          className="rounded-full border border-[var(--border)] px-3 py-1 text-sm aria-pressed:bg-[var(--text-primary)] aria-pressed:text-[var(--page)]"
        >
          {FILTER_LABEL[f]} <span className="tabular">{counts[f]}</span>
        </button>
      ))}
    </div>
  );
}

/** One expandable row per rule: the summary line answers "what is wrong", the body "what to do". */
function ResultRow({ result }: { result: DashboardCheckResult }) {
  return (
    <details className="border-b border-[var(--grid)] py-2">
      <summary className="grid cursor-pointer grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-x-3 sm:grid-cols-[6.5rem_14rem_5.5rem_minmax(0,1fr)]">
        <StatusBadge status={result.status} />
        <span className="font-medium">
          <span className="font-mono text-xs text-[var(--text-secondary)]">{result.ruleId}</span>{' '}
          {result.ruleName}
        </span>
        <span className="hidden sm:inline">
          <SeverityLabel severity={result.severity} />
        </span>
        <span className="col-span-2 text-sm [overflow-wrap:anywhere] text-[var(--text-secondary)] sm:col-span-1">
          {result.message}
        </span>
      </summary>
      <div className="mt-2 space-y-2 pl-0 text-sm sm:pl-[7.25rem]">
        {result.remediation && <p>{result.remediation}</p>}
        {result.evidence.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {result.evidence.map((e, i) => (
              <li
                key={`${e.label}-${i}`}
                className="max-w-full rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-xs [overflow-wrap:anywhere]"
              >
                {e.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function ComplianceResults({
  results,
  stamp = 'undated',
}: {
  results: readonly DashboardCheckResult[];
  /** `yyyymmdd` of the collection, used in export file names. */
  stamp?: string | undefined;
}) {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const sorted = useMemo(() => sortResults(results), [results]);
  const counts = useMemo(() => countByStatus(sorted), [sorted]);
  const visible = filterResults(sorted, filter);
  return (
    <div>
      <Filters value={filter} counts={counts} onChange={setFilter} />
      <ExportButtons
        visible={visible}
        all={sorted}
        filter={filter}
        filterLabel={FILTER_LABEL[filter]}
        stamp={stamp}
      />
      {visible.length === 0 ? (
        <Empty>No results with this status.</Empty>
      ) : (
        visible.map((r) => <ResultRow key={r.ruleId} result={r} />)
      )}
    </div>
  );
}
