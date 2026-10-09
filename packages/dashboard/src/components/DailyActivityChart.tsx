import { useState } from 'react';
import type { DailyCount } from '../lib/activity-view';
import { CELL, HEAD } from './DetailControls';
import { ScrollRegion } from './ScrollRegion';

function DailyTable({ counts, month }: { counts: readonly DailyCount[]; month: string }) {
  return (
    <ScrollRegion label="Daily activity table" className="max-h-60 overflow-y-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Daily activity counts for {month}</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              Date
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Events
            </th>
          </tr>
        </thead>
        <tbody>
          {counts.map((c) => (
            <tr key={c.date}>
              <th scope="row" className={`${CELL} tabular text-left font-normal`}>
                {c.date}
              </th>
              <td className={`${CELL} tabular text-right`}>{c.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function DailyBars({ counts, month }: { counts: readonly DailyCount[]; month: string }) {
  const maxCount = Math.max(...counts.map((c) => c.count), 1);
  return (
    <div role="img" aria-label={`Daily activity bar chart for ${month}`} className="pt-2">
      <div className="flex h-24 items-end gap-[2px] sm:gap-1">
        {counts.map((c) => {
          const heightPct = c.count === 0 ? 0 : Math.max(8, Math.round((c.count / maxCount) * 100));
          return (
            <div key={c.date} className="relative flex-1" style={{ height: '100%' }}>
              <div
                className="absolute bottom-0 w-full rounded-t transition-all"
                style={{
                  height: `${heightPct}%`,
                  backgroundColor: c.count > 0 ? 'var(--status-good)' : 'var(--border)',
                  opacity: c.count > 0 ? 0.85 : 0.25,
                }}
                title={`${c.date}: ${c.count}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--text-muted)]">
        <span>{counts[0]?.date ?? ''}</span>
        <span>{counts[counts.length - 1]?.date ?? ''}</span>
      </div>
    </div>
  );
}

export function DailyActivityChart({
  counts,
  month,
}: {
  counts: readonly DailyCount[];
  month: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const totalInMonth = counts.reduce((sum, c) => sum + c.count, 0);

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Activity by day ({totalInMonth} {totalInMonth === 1 ? 'event' : 'events'})
        </h3>
        <button
          type="button"
          className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-3)]"
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? 'View as chart' : 'View as table'}
        </button>
      </div>

      {showTable ? (
        <DailyTable counts={counts} month={month} />
      ) : (
        <DailyBars counts={counts} month={month} />
      )}
    </div>
  );
}
