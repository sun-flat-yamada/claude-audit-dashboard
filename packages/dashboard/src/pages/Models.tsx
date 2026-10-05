import { useMemo, useState } from 'react';
import {
  DETAIL_MANIFEST_PATH,
  DETAIL_USAGE_MATRIX_PATH,
  detailManifestSchema,
  detailUsageMatrixSchema,
} from '@claude-audit/core/contracts';
import { Heatmap } from '../components/Heatmap';
import { MixTrend } from '../components/MixTrend';
import { Card, Empty } from '../components/Card';
import {
  CELL,
  detailNotice,
  FIELD,
  HEAD,
  Notice,
  SearchField,
  SelectField,
} from '../components/DetailControls';
import { useDetailFile } from '../lib/detail-data';
import { formatMoney, formatPercent, formatTimestamp } from '../lib/format';
import { monthLabel } from '../lib/monthly-view';
import {
  hasSpend,
  heatGrid,
  modelMix,
  type HeatGrid,
  type MixMonth,
  type Period,
  type UsageMatrix,
} from '../lib/usage-matrix-view';

export interface ModelsProps {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const SUBJECT = {
  kind: 'usage-matrix',
  plural: 'model and group spend',
  title: 'Model and group spend',
} as const;

function OverlapNotice() {
  return (
    <aside
      aria-label="Group spend overlaps"
      className="rounded border border-[var(--border)] bg-[var(--surface-1)] p-3 text-sm"
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
        A member counts toward every group they belong to, so the group cells of a model can add up
        to more than that model&apos;s spend. Do not add cells up: the model totals and the monthly
        mix use the ungrouped value, and the heatmap shows no row or column totals.
      </p>
    </aside>
  );
}

function ViewToggle({ table, onToggle }: { table: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className={FIELD}>
      {table ? 'View as chart' : 'View as table'}
    </button>
  );
}

function HeatTable({ grid, currency }: { grid: HeatGrid; currency: string }) {
  const rows = grid.cells
    .flat()
    .filter((c) => c.cost !== null)
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  const nameOf = (list: { key: string; name: string }[], key: string): string =>
    list.find((x) => x.key === key)?.name ?? key;
  return (
    <div className="max-h-96 max-w-full overflow-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Model by group spend</caption>
        <thead>
          <tr>
            {['Model', 'Group', 'Spend', 'Share of the model'].map((h, i) => (
              <th key={h} scope="col" className={`${HEAD} ${i >= 2 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={`${c.model}|${c.group}`}>
              <th scope="row" className={`${CELL} text-left font-medium`}>
                {nameOf(grid.models, c.model)}
              </th>
              <td className={CELL}>{nameOf(grid.groups, c.group)}</td>
              <td className={`${CELL} tabular text-right`}>{formatMoney(c.cost ?? 0, currency)}</td>
              <td className={`${CELL} tabular text-right`}>{formatPercent(c.shareOfModel)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelTotals({ grid, currency }: { grid: HeatGrid; currency: string }) {
  return (
    <table className="mt-4 w-full text-left text-sm">
      <caption className="pb-1 text-left font-medium">Model totals (ungrouped)</caption>
      <thead>
        <tr>
          <th scope="col" className={HEAD}>
            Model
          </th>
          <th scope="col" className={`${HEAD} text-right`}>
            Spend
          </th>
        </tr>
      </thead>
      <tbody>
        {grid.models.map((m) => (
          <tr key={m.key}>
            <th scope="row" className={`${CELL} text-left font-medium`}>
              {m.name}
            </th>
            <td className={`${CELL} tabular text-right`}>{formatMoney(m.total, currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MixTable({ months, currency }: { months: readonly MixMonth[]; currency: string }) {
  return (
    <div className="max-h-96 max-w-full overflow-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Model mix by month</caption>
        <thead>
          <tr>
            {['Month', 'Model', 'Spend', 'Share of the month'].map((h, i) => (
              <th key={h} scope="col" className={`${HEAD} ${i >= 2 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.flatMap((m) =>
            m.segments.map((s) => (
              <tr key={`${m.month}|${s.key}`}>
                <th scope="row" className={`${CELL} text-left font-medium`}>
                  {monthLabel(m.month)}
                </th>
                <td className={CELL}>{s.label}</td>
                <td className={`${CELL} tabular text-right`}>{formatMoney(s.cost, currency)}</td>
                <td className={`${CELL} tabular text-right`}>{formatPercent(s.share)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function omittedNote(matrix: UsageMatrix): string | null {
  const parts = [
    matrix.omittedModels > 0 ? `${String(matrix.omittedModels)} more models` : null,
    matrix.omittedGroups > 0 ? `${String(matrix.omittedGroups)} more groups` : null,
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : `Not shown: ${parts.join(' and ')} (lowest spend).`;
}

function MatrixContent({ matrix }: { matrix: UsageMatrix }) {
  const [period, setPeriod] = useState<Period>('all');
  const [query, setQuery] = useState('');
  const [table, setTable] = useState(false);
  const grid = useMemo(() => heatGrid(matrix, period, query), [matrix, period, query]);
  const mix = useMemo(() => modelMix(matrix), [matrix]);
  if (!hasSpend(matrix)) return <Empty>No model spend was reported in the collected period.</Empty>;
  const note = omittedNote(matrix);
  const noMatch = grid.models.length === 0 || grid.groups.length === 0;
  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--text-secondary)]">
        Cost per model and RBAC group, {matrix.window.from.slice(0, 10)} to{' '}
        {matrix.window.to.slice(0, 10)}
        {matrix.asOf ? `, data as of ${formatTimestamp(matrix.asOf)}` : ''}.{note ? ` ${note}` : ''}
      </p>
      <OverlapNotice />
      <div className="flex flex-wrap items-end gap-3">
        <SelectField label="Period" value={period} onChange={setPeriod}>
          <option value="all">All months</option>
          {matrix.months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </SelectField>
        <SearchField label="Search models and groups" value={query} onChange={setQuery} />
        <ViewToggle table={table} onToggle={() => setTable((t) => !t)} />
      </div>
      <Card
        title="Spend by model and group"
        subtitle="Darker means more spend (linear scale from zero)."
      >
        {noMatch ? (
          <Empty>No models or groups match “{query}”.</Empty>
        ) : table ? (
          <>
            <HeatTable grid={grid} currency={matrix.currency} />
            <ModelTotals grid={grid} currency={matrix.currency} />
          </>
        ) : (
          <Heatmap key={`${period}|${query}`} grid={grid} currency={matrix.currency} />
        )}
      </Card>
      <Card
        title="Model mix by month"
        subtitle="Share of the ungrouped monthly spend per model (all months)."
      >
        {table ? (
          <MixTable months={mix.months} currency={matrix.currency} />
        ) : (
          <MixTrend series={mix.series} months={mix.months} currency={matrix.currency} />
        )}
      </Card>
    </div>
  );
}

export function Models(options: ModelsProps = {}) {
  const matrix = useDetailFile(DETAIL_USAGE_MATRIX_PATH, detailUsageMatrixSchema, options);
  const manifest = useDetailFile(DETAIL_MANIFEST_PATH, detailManifestSchema, options);
  const notice = detailNotice(matrix, manifest, SUBJECT);
  const unlisted =
    matrix.status === 'missing' &&
    manifest.status === 'ready' &&
    !manifest.data.files.some((f) => f.kind === 'usage-matrix');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Models</h1>
      {notice && <Notice role={notice.role}>{notice.text}</Notice>}
      {unlisted && (
        <p className="text-sm text-[var(--text-secondary)]">
          The model and group collection is optional: set <code>sources.usageMatrix.enabled</code>{' '}
          to <code>true</code> in the collector configuration to collect it.
        </p>
      )}
      {matrix.status === 'ready' && <MatrixContent matrix={matrix.data} />}
    </div>
  );
}
