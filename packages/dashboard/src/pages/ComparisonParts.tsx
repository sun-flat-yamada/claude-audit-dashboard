import { useMemo, useState } from 'react';
import {
  TIME_POINT_MEDIA_TYPE,
  timePointDiffExport,
  timePointDiffFileName,
  type ChangeClass,
  type CoverageChange,
  type KpiDelta,
  type TimePointDiff,
  type TimePointExportFormat,
  type TimePointSummary,
} from '@claude-audit/core/contracts';
import { SeverityLabel, StatusBadge } from '../components/Badges';
import { Card, Empty } from '../components/Card';
import { CELL, FilterChips, HEAD, SearchField } from '../components/DetailControls';
import { ScrollRegion } from '../components/ScrollRegion';
import {
  CHANGE_LABEL,
  changedTotal,
  filterRuleRows,
  formatDelta,
  formatKpiDelta,
  formatKpiValue,
  formatPointId,
  RULE_FILTERS,
  unchangedRules,
  type RuleFilter,
  type RuleRow,
} from '../lib/compare-view';
import { downloadText } from '../lib/export';
import { formatInteger, formatTimestamp } from '../lib/format';

const BUTTON =
  'rounded border border-[var(--border)] px-3 py-1 text-sm enabled:hover:border-[var(--text-secondary)] disabled:opacity-50';

const NOT_PRESENT = <span className="text-[var(--text-muted)]">Not present</span>;

const ChangeBadge = ({ change }: { change: ChangeClass }) => (
  <StatusBadge status={`change-${change}`} />
);

const StatusOrNone = ({ status }: { status: string | null }) =>
  status === null ? NOT_PRESENT : <StatusBadge status={status} />;

/** A figure at both points with its signed change. */
function Figure({ label, children }: { label: string; children: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[var(--text-secondary)]">{label}</dt>
      <dd className="tabular font-medium [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function SummaryCard({ diff }: { diff: TimePointDiff }) {
  const { score, base, target } = diff;
  return (
    <Card
      title="Comparison summary"
      subtitle={
        diff.hasChanges
          ? 'Score, assessed rules and the two collections compared.'
          : 'No differences between these two time points.'
      }
    >
      <dl
        aria-label="Comparison summary"
        className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2"
      >
        <Figure label="Base">{`${formatPointId(base.id)} (collected ${formatTimestamp(base.collectedAt)})`}</Figure>
        <Figure label="Target">{`${formatPointId(target.id)} (collected ${formatTimestamp(target.collectedAt)})`}</Figure>
        <Figure label="Compliance score">
          {`${formatInteger(score.base)} → ${formatInteger(score.target)} (${formatDelta(score.delta)})`}
        </Figure>
        <Figure label="Assessed rules">
          {`${formatInteger(score.baseAssessed)} of ${formatInteger(score.baseTotal)} → ${formatInteger(score.targetAssessed)} of ${formatInteger(score.targetTotal)} (${formatDelta(score.assessedDelta)})`}
        </Figure>
      </dl>
      <p className="mt-3 text-sm text-[var(--text-secondary)]">
        The score is the share of assessed rules that pass, so it also moves when rules gain or lose
        a verdict between the two points.
      </p>
    </Card>
  );
}

function RuleTable({ rows }: { rows: readonly RuleRow[] }) {
  return (
    <ScrollRegion label="Rule changes" className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Rule changes</caption>
        <thead>
          <tr>
            {['Rule', 'Name', 'Severity', 'Base', 'Target', 'Change'].map((c) => (
              <th key={c} scope="col" className={HEAD}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className={`${CELL} text-left font-medium whitespace-nowrap`}>
                {r.id}
              </th>
              <td className={CELL}>{r.name}</td>
              <td className={CELL}>
                <SeverityLabel severity={r.severity} />
              </td>
              <td className={CELL}>
                <StatusOrNone status={r.from} />
              </td>
              <td className={CELL}>
                <StatusOrNone status={r.to} />
              </td>
              <td className={CELL}>
                <ChangeBadge change={r.change} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

export function RuleChangesCard({
  diff,
  base,
  target,
}: {
  diff: TimePointDiff;
  base: TimePointSummary;
  target: TimePointSummary;
}) {
  const [filter, setFilter] = useState<RuleFilter>('all');
  const [query, setQuery] = useState('');
  const unchanged = useMemo(() => unchangedRules(base, target), [base, target]);
  const rows = useMemo(
    () => filterRuleRows(diff.rules.changes, unchanged, filter, query),
    [diff.rules.changes, unchanged, filter, query],
  );
  const counts = diff.rules.counts;
  return (
    <Card
      title="Rule changes"
      subtitle="Regressed rules first, then improved, added or removed and rules whose assessment changed. Unchanged rules are behind their own filter."
    >
      <div className="mb-4 space-y-3">
        <FilterChips
          label="Filter by change"
          options={RULE_FILTERS}
          labels={CHANGE_LABEL}
          value={filter}
          counts={counts}
          total={changedTotal(counts)}
          onChange={setFilter}
        />
        <SearchField label="Search rules" value={query} onChange={setQuery} />
      </div>
      <p role="status" className="mb-2 text-sm text-[var(--text-secondary)]">
        {`${rows.length} ${rows.length === 1 ? 'rule' : 'rules'} shown`}
      </p>
      {rows.length === 0 ? (
        <Empty>
          {diff.rules.changes.length === 0 && filter === 'all'
            ? 'No rule changed between these time points.'
            : 'No rules match the current filter and search.'}
        </Empty>
      ) : (
        <RuleTable rows={rows} />
      )}
    </Card>
  );
}

const itemCount = (c: CoverageChange): string => {
  if (c.fromCount === null && c.toCount === null) return '–';
  const before = c.fromCount === null ? '–' : formatInteger(c.fromCount);
  const after = c.toCount === null ? '–' : formatInteger(c.toCount);
  return c.countDelta === null
    ? `${before} → ${after}`
    : `${before} → ${after} (${formatDelta(c.countDelta)})`;
};

export function CoverageCard({ diff }: { diff: TimePointDiff }) {
  const changes = diff.coverage.changes;
  return (
    <Card
      title="Data coverage changes"
      subtitle="Datasets whose collection state changed, or that exist at only one of the two points."
    >
      {changes.length === 0 ? (
        <Empty>No dataset changed its collection state.</Empty>
      ) : (
        <ScrollRegion label="Data coverage changes" className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Data coverage changes</caption>
            <thead>
              <tr>
                {['Dataset', 'Base', 'Target', 'Change', 'Items'].map((c) => (
                  <th key={c} scope="col" className={HEAD}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.dataset}>
                  <th scope="row" className={`${CELL} text-left font-medium`}>
                    {c.dataset}
                  </th>
                  <td className={CELL}>
                    <StatusOrNone status={c.from} />
                  </td>
                  <td className={CELL}>
                    <StatusOrNone status={c.to} />
                  </td>
                  <td className={CELL}>
                    <ChangeBadge change={c.change} />
                  </td>
                  <td className={`${CELL} tabular`}>{itemCount(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </Card>
  );
}

function KpiRow({ kpi, currency }: { kpi: KpiDelta; currency: string }) {
  return (
    <tr>
      <th scope="row" className={`${CELL} text-left font-medium`}>
        {kpi.label}
      </th>
      <td className={`${CELL} tabular`}>{formatKpiValue(kpi.unit, kpi.base, currency)}</td>
      <td className={`${CELL} tabular`}>{formatKpiValue(kpi.unit, kpi.target, currency)}</td>
      <td className={`${CELL} tabular`}>{formatKpiDelta(kpi.unit, kpi.delta, currency)}</td>
    </tr>
  );
}

export function KpiCard({ diff, currency }: { diff: TimePointDiff; currency: string }) {
  return (
    <Card
      title="Key figures"
      subtitle="Members, active users, cost and open findings at each point."
    >
      <ScrollRegion label="Key figure changes" className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Key figure changes</caption>
          <thead>
            <tr>
              {['Figure', 'Base', 'Target', 'Change'].map((c) => (
                <th key={c} scope="col" className={HEAD}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {diff.kpis.map((kpi) => (
              <KpiRow key={kpi.id} kpi={kpi} currency={currency} />
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </Card>
  );
}

const EXPORTS: { format: TimePointExportFormat; label: string }[] = [
  { format: 'md', label: 'Export Markdown' },
  { format: 'csv', label: 'Export CSV' },
  { format: 'json', label: 'Export JSON' },
];

/** The diff as a file, built in the browser from the summaries; nothing is uploaded. */
export function ExportBar({ diff }: { diff: TimePointDiff }) {
  return (
    <div role="group" aria-label="Export comparison" className="flex flex-wrap gap-2">
      {EXPORTS.map(({ format, label }) => (
        <button
          key={format}
          type="button"
          className={BUTTON}
          onClick={() =>
            downloadText(
              timePointDiffFileName(diff, format),
              timePointDiffExport(diff, format),
              TIME_POINT_MEDIA_TYPE[format],
            )
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
