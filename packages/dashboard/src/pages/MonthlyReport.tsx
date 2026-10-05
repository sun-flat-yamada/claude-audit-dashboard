import { useMemo, useState } from 'react';
import {
  MONTHLY_INDEX_PATH,
  monthlyReportIndexSchema,
  monthlyReportPath,
  monthlyReportSchema,
} from '@claude-audit/core/contracts';
import { StatusBadge } from '../components/Badges';
import { Card, Empty } from '../components/Card';
import { CELL, HEAD, Notice, SearchField, SelectField } from '../components/DetailControls';
import { useDetailFile, type DetailState } from '../lib/detail-data';
import { formatMoney, formatPercent, formatTimestamp } from '../lib/format';
import {
  filterRows,
  groupsOverlap,
  monthLabel,
  selectEntry,
  type MonthlyCostRow,
  type MonthlyReport as Report,
  type MonthlyReportIndex,
} from '../lib/monthly-view';
import { formatHash, navigate } from '../lib/router';
import { ScrollRegion } from '../components/ScrollRegion';

export interface MonthlyReportProps {
  /** Route parameter: report id such as `monthly-2026-08`; the newest month when absent. */
  id?: string | undefined;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const SUBJECT = 'monthly cost reports';

/** Why a monthly file has no data: loading, error, or not published. */
function fileNotice(
  state: DetailState<unknown>,
  what: string,
  verb: 'is' | 'are',
): { role: 'status' | 'alert'; text: string } | null {
  if (state.status === 'loading') return { role: 'status', text: `Loading ${what}…` };
  if (state.status === 'error')
    return { role: 'alert', text: `Failed to load ${what}: ${state.message}` };
  if (state.status === 'missing')
    return {
      role: 'status',
      text: `${what[0]?.toUpperCase() ?? ''}${what.slice(1)} ${verb} not published. Monthly cost data is only available for sample data or when the owner enabled PAGES_DETAIL_DATA on a private deployment.`,
    };
  return null;
}

function OverlapNotice({ exceeds }: { exceeds: boolean }) {
  return (
    <aside
      aria-label="Group totals overlap"
      className="rounded border border-[var(--border)] bg-[var(--surface-1)] p-3 text-sm"
      style={exceeds ? { borderColor: 'var(--status-warning)' } : undefined}
    >
      <p className="inline-flex items-center gap-1.5 font-medium">
        <span
          aria-hidden
          className="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ background: 'var(--status-warning)' }}
        >
          !
        </span>
        Groups overlap
      </p>
      <p className="mt-1 text-[var(--text-secondary)]">
        A member counts toward every group they belong to, so the group amounts can add up to more
        than the organization total. Do not add them up: the organization total is the ungrouped
        value.
        {exceeds ? ' In this month the group amounts below exceed the organization total.' : ''}
      </p>
    </aside>
  );
}

function CostTable({
  caption,
  firstColumn,
  rows,
  currency,
  query,
}: {
  caption: string;
  firstColumn: string;
  rows: readonly MonthlyCostRow[];
  currency: string;
  query: string;
}) {
  const shown = filterRows(rows, query);
  if (rows.length === 0) return <Empty>No {caption.toLowerCase()} in this month.</Empty>;
  if (shown.length === 0) return <Empty>No rows match “{query}”.</Empty>;
  return (
    <ScrollRegion label={caption} className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              {firstColumn}
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Cost
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Share of total
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.key}>
              <th scope="row" className={`${CELL} text-left font-medium`}>
                {row.name}
              </th>
              <td className={`${CELL} tabular text-right`}>{formatMoney(row.amount, currency)}</td>
              <td className={`${CELL} tabular text-right`}>{formatPercent(row.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function ReportContent({ report }: { report: Report }) {
  const [query, setQuery] = useState('');
  const exceeds = groupsOverlap(report);
  const tables = [
    { title: 'Chargeback by RBAC group', column: 'Group', rows: report.byGroup },
    { title: 'Cost by model', column: 'Model', rows: report.byModel },
    { title: 'Cost by product', column: 'Product', rows: report.byProduct },
  ];
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-[var(--text-secondary)]">Organization total (ungrouped)</dt>
          <dd className="tabular text-xl font-semibold">
            {report.totalCost === null ? '–' : formatMoney(report.totalCost, report.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--text-secondary)]">Period</dt>
          <dd>
            {report.period
              ? `${report.period.from.slice(0, 10)} to ${report.period.to.slice(0, 10)} (end excluded)`
              : monthLabel(report.month)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--text-secondary)]">Generated</dt>
          <dd>{formatTimestamp(report.generatedAt)}</dd>
        </div>
      </dl>
      <OverlapNotice exceeds={exceeds} />
      <SearchField label="Search groups, models and products" value={query} onChange={setQuery} />
      {tables.map((t) => (
        <Card key={t.title} title={t.title}>
          <CostTable
            caption={t.title}
            firstColumn={t.column}
            rows={t.rows}
            currency={report.currency}
            query={query}
          />
        </Card>
      ))}
      {report.notes.length > 0 && (
        <Card title="Notes">
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
            {report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function MonthView({
  id,
  month,
  options,
}: {
  id: string;
  month: string;
  options: Pick<MonthlyReportProps, 'baseUrl' | 'fetchImpl'>;
}) {
  const file = useDetailFile(monthlyReportPath(id), monthlyReportSchema, options);
  const notice = fileNotice(file, `the ${monthLabel(month)} report`, 'is');
  return (
    <div className="space-y-4">
      {notice && <Notice role={notice.role}>{notice.text}</Notice>}
      {file.status === 'ready' && (
        <>
          <p className="flex items-center gap-2 text-sm">
            <StatusBadge status={file.data.status} />
            <span className="text-[var(--text-secondary)]">{monthLabel(file.data.month)}</span>
          </p>
          {file.data.status === 'unavailable' ? (
            <Notice role="status">
              {`Cost data for ${monthLabel(month)} was not collected${file.data.reason ? ` (${file.data.reason})` : ''}.`}
            </Notice>
          ) : (
            <ReportContent report={file.data} />
          )}
        </>
      )}
    </div>
  );
}

function MonthSelector({ index, selected }: { index: MonthlyReportIndex; selected: string }) {
  return (
    <SelectField
      label="Month"
      value={selected}
      onChange={(id) => navigate(`/reports/monthly/${id}`)}
    >
      {index.reports.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {monthLabel(entry.month)}
          {entry.status === 'unavailable' ? ' (not collected)' : ''}
        </option>
      ))}
    </SelectField>
  );
}

function IndexContent({
  index,
  id,
  options,
}: {
  index: MonthlyReportIndex;
  id: string | undefined;
  options: Pick<MonthlyReportProps, 'baseUrl' | 'fetchImpl'>;
}) {
  const entry = useMemo(() => selectEntry(index, id), [index, id]);
  if (index.reports.length === 0)
    return <Empty>No monthly cost report has been generated yet. Run `pnpm report:monthly`.</Empty>;
  if (!entry)
    return (
      <div className="space-y-3">
        <Notice role="status">{`There is no monthly report “${id ?? ''}” in the published data.`}</Notice>
        <a className="text-sm underline" href={formatHash('/reports/monthly')}>
          Show the newest month
        </a>
      </div>
    );
  return (
    <div className="space-y-4">
      <MonthSelector index={index} selected={entry.id} />
      <MonthView key={entry.id} id={entry.id} month={entry.month} options={options} />
    </div>
  );
}

export function MonthlyReport({ id, ...options }: MonthlyReportProps = {}) {
  const index = useDetailFile(MONTHLY_INDEX_PATH, monthlyReportIndexSchema, options);
  const notice = fileNotice(index, SUBJECT, 'are');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Monthly cost report</h1>
      {notice && <Notice role={notice.role}>{notice.text}</Notice>}
      {index.status === 'ready' && <IndexContent index={index.data} id={id} options={options} />}
    </div>
  );
}
