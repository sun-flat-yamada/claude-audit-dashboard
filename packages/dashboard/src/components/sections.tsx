import type { DashboardView } from '@claude-audit/core/contracts';
import {
  formatCompact,
  formatInteger,
  formatMoney,
  formatPercent,
  formatTimestamp,
} from '../lib/format';
import { humanize } from '../lib/view';
import { StatusBadge } from './Badges';
import { Card, Empty } from './Card';
import { ComplianceResults } from './ComplianceResults';
import { ShareBars } from './ShareBars';
import { TimeSeriesChart } from './TimeSeriesChart';

/**
 * Dashboard sections. Each one takes the published view and renders a self-contained card;
 * adding a section means adding one component here and one line in App.
 */

const scoreFormat = (value: number) => formatInteger(value);

export function ComplianceSection({ compliance }: { compliance: DashboardView['compliance'] }) {
  const history = compliance.history.map((h) => ({ date: h.date.slice(0, 10), score: h.score }));
  return (
    <Card
      title="Compliance checks"
      subtitle={`${compliance.results.length} rules evaluated · failing first`}
    >
      {history.length >= 2 && (
        <div className="mb-4">
          <TimeSeriesChart
            data={history}
            series={[{ key: 'score', label: 'Score', color: 'var(--series-1)' }]}
            format={scoreFormat}
            domain={[0, 100]}
            height={160}
          />
        </div>
      )}
      <ComplianceResults results={compliance.results} />
    </Card>
  );
}

export function CategorySection({ compliance }: { compliance: DashboardView['compliance'] }) {
  return (
    <Card
      title="Failing rules by category"
      subtitle="Failed rules, of rules evaluated in each category"
    >
      <ShareBars
        items={compliance.byCategory.map((c) => ({
          key: c.category,
          label: humanize(c.category),
          value: c.failed,
          display: `${c.failed} of ${c.total}`,
        }))}
      />
    </Card>
  );
}

export function CostSection({ usage }: { usage: DashboardView['usage'] }) {
  if (!usage)
    return (
      <Card title="Daily cost">
        <Empty>Cost data was not collected (see Data coverage).</Empty>
      </Card>
    );
  const money = (value: number) => formatMoney(value, usage.currency);
  const tick = (value: number) => formatMoney(value, usage.currency, true);
  return (
    <Card
      title="Daily cost"
      subtitle={`Total spend per day, ${usage.currency}${usage.asOf ? ` · as of ${formatTimestamp(usage.asOf)}` : ''}`}
    >
      <TimeSeriesChart
        data={usage.daily}
        series={[{ key: 'cost', label: 'Cost', color: 'var(--series-1)' }]}
        format={money}
        tickFormat={tick}
      />
    </Card>
  );
}

export function TokenSection({ usage }: { usage: DashboardView['usage'] }) {
  if (!usage) return null;
  const series = [
    { key: 'inputTokens', label: 'Input tokens', color: 'var(--series-1)' },
    { key: 'outputTokens', label: 'Output tokens', color: 'var(--series-2)' },
  ];
  return (
    <Card title="Daily tokens" subtitle="Input includes cache reads and writes">
      <TimeSeriesChart data={usage.daily} series={series} format={formatCompact} />
    </Card>
  );
}

const SPEND_BREAKDOWNS = [
  { key: 'byProduct', title: 'Spend by product', subtitle: 'Share of total spend' },
  { key: 'byModel', title: 'Spend by model', subtitle: 'Share of total spend' },
  {
    key: 'byGroup',
    title: 'Spend by group',
    subtitle: 'Members can belong to several groups, so shares may add up to more than 100%',
  },
] as const;

export function SpendBreakdowns({ usage }: { usage: DashboardView['usage'] }) {
  if (!usage) return null;
  const money = (value: number) => formatMoney(value, usage.currency);
  return SPEND_BREAKDOWNS.map(({ key, title, subtitle }) => (
    <Card key={key} title={title} subtitle={subtitle}>
      {usage[key].length === 0 ? (
        <Empty>No spend recorded for this breakdown.</Empty>
      ) : (
        <ShareBars
          items={usage[key].map((s) => ({
            key: s.key,
            label: s.label,
            value: s.value,
            display: `${money(s.value)} · ${formatPercent(s.percent)}`,
          }))}
        />
      )}
    </Card>
  ));
}

export function AdoptionSection({ adoption }: { adoption: DashboardView['adoption'] }) {
  if (!adoption)
    return (
      <Card title="Active users">
        <Empty>Adoption data was not collected (see Data coverage).</Empty>
      </Card>
    );
  const facts = [
    adoption.assignedSeats !== null && `${formatInteger(adoption.assignedSeats)} assigned seats`,
    adoption.pendingInvites !== null && `${formatInteger(adoption.pendingInvites)} pending invites`,
    adoption.monthlyAdoptionRate !== null &&
      `${formatPercent(adoption.monthlyAdoptionRate)} monthly adoption`,
  ].filter(Boolean);
  const series = [
    { key: 'dau', label: 'Daily active', color: 'var(--series-1)' },
    { key: 'wau', label: 'Weekly active', color: 'var(--series-2)' },
    { key: 'mau', label: 'Monthly active', color: 'var(--series-3)' },
  ];
  return (
    <Card title="Active users" subtitle={facts.join(' · ')}>
      <TimeSeriesChart data={adoption.daily} series={series} format={formatInteger} />
    </Card>
  );
}

export function ActivitySection({ activity }: { activity: DashboardView['activity'] }) {
  if (!activity)
    return (
      <Card title="Activity feed">
        <Empty>Activity data was not collected (see Data coverage).</Empty>
      </Card>
    );
  const window = activity.window
    ? ` · ${formatTimestamp(activity.window.from)} → ${formatTimestamp(activity.window.to)}`
    : '';
  return (
    <Card
      title="Activity feed"
      subtitle={`${formatInteger(activity.total)} events in the last collection window${window}`}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <ShareBars
          items={activity.topTypes.map((t) => ({
            key: t.type,
            label: t.type,
            value: t.count,
            display: formatInteger(t.count),
          }))}
        />
        <NotableEvents notable={activity.notable} />
      </div>
    </Card>
  );
}

function NotableEvents({
  notable,
}: {
  notable: NonNullable<DashboardView['activity']>['notable'];
}) {
  if (notable.length === 0) return <Empty>No events matched an activity watch.</Empty>;
  return (
    <div className="max-h-80 overflow-auto">
      <table className="tabular w-full text-left text-sm">
        <caption className="mb-2 text-left text-[var(--text-secondary)]">
          Events matched by activity watches
        </caption>
        <thead>
          <tr className="text-[var(--text-secondary)]">
            <th className="border-b border-[var(--grid)] py-1 pr-3 font-medium">Time</th>
            <th className="border-b border-[var(--grid)] py-1 pr-3 font-medium">Event</th>
            <th className="border-b border-[var(--grid)] py-1 font-medium">Actor</th>
          </tr>
        </thead>
        <tbody>
          {notable.map((n) => (
            <tr key={`${n.ruleId}-${n.id}`}>
              <td className="border-b border-[var(--grid)] py-1 pr-3 whitespace-nowrap">
                {formatTimestamp(n.createdAt)}
              </td>
              <td className="border-b border-[var(--grid)] py-1 pr-3">
                <span className="font-mono text-xs">{n.type}</span>{' '}
                <span className="text-[var(--text-muted)]">({n.ruleId})</span>
              </td>
              <td className="border-b border-[var(--grid)] py-1">{n.actor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CoverageSection({ coverage }: { coverage: DashboardView['coverage'] }) {
  return (
    <Card
      title="Data coverage"
      subtitle="Rules that need a dataset that was not collected are reported as skipped, never as passed"
    >
      <div className="overflow-x-auto">
        <table className="tabular w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--text-secondary)]">
              {['Dataset', 'Status', 'Records', 'Source', 'Note'].map((h) => (
                <th key={h} className="border-b border-[var(--grid)] py-1 pr-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coverage.map((c) => (
              <tr key={c.dataset}>
                <td className="border-b border-[var(--grid)] py-1.5 pr-4 font-medium">
                  {c.dataset}
                </td>
                <td className="border-b border-[var(--grid)] py-1.5 pr-4">
                  <StatusBadge status={c.status} />
                </td>
                <td className="border-b border-[var(--grid)] py-1.5 pr-4">
                  {c.count === null ? '—' : formatInteger(c.count)}
                </td>
                <td className="border-b border-[var(--grid)] py-1.5 pr-4 font-mono text-xs">
                  {c.source ?? '—'}
                </td>
                <td className="border-b border-[var(--grid)] py-1.5 text-[var(--text-secondary)]">
                  {c.reason ?? (c.asOf ? `as of ${formatTimestamp(c.asOf)}` : '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function InsightSection({ insights }: { insights: DashboardView['insights'] }) {
  if (insights.length === 0) return null;
  return (
    <Card title="Insights" subtitle="Generated by the analyzers from the latest snapshot">
      <ul className="space-y-3">
        {insights.map((i) => (
          <li key={i.id}>
            <p className="font-medium">{i.title}</p>
            <p className="text-sm text-[var(--text-secondary)]">
              <span className="capitalize">{i.priority}</span> priority · {i.detail}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
