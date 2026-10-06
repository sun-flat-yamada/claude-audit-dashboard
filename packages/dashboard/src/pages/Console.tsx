import type { DashboardConsole, DashboardView } from '@claude-audit/core/contracts';
import { Card, Empty, TableView } from '../components/Card';
import { HEAD, Notice } from '../components/DetailControls';
import { ScrollRegion } from '../components/ScrollRegion';
import { ShareBars } from '../components/ShareBars';
import { TimeSeriesChart } from '../components/TimeSeriesChart';
import {
  headlineStats,
  keyStatusText,
  missingText,
  notCollected,
  rangeText,
  rateText,
  shareBars,
  shareRows,
  tokenRows,
  type Breakdown,
} from '../lib/console-view';
import { formatCompact, formatInteger, formatMoney, formatPercent } from '../lib/format';
import { TOKEN_TYPES } from '../lib/view';

type Console = DashboardConsole;

function StatTiles({ c }: { c: Console }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
      {headlineStats(c).map((s) => (
        <div
          key={s.label}
          className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4"
        >
          <dt className="text-sm text-[var(--text-secondary)]">{s.label}</dt>
          <dd className="tabular mt-1 text-2xl font-semibold">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DailyCharts({ c }: { c: Console }) {
  const money = (value: number) => formatMoney(value, c.currency);
  return (
    <div className="grid gap-6 *:min-w-0 lg:grid-cols-2">
      <Card title="Daily spend" subtitle={`Cost per day after discounts, ${c.currency}`}>
        <TimeSeriesChart
          data={c.daily}
          series={[{ key: 'cost', label: 'Spend', color: 'var(--series-1)' }]}
          format={money}
          tickFormat={(value) => formatMoney(value, c.currency, true)}
        />
      </Card>
      <Card
        title="Daily tokens by type"
        subtitle={`Cache reads are ${rateText(c.cacheReadShare)} of all input tokens`}
      >
        <TimeSeriesChart data={c.daily} series={TOKEN_TYPES} format={formatCompact} />
      </Card>
    </div>
  );
}

const BREAKDOWNS: { key: Breakdown; title: string; column: string }[] = [
  { key: 'byModel', title: 'Spend by model', column: 'Model' },
  { key: 'byWorkspace', title: 'Spend by workspace', column: 'Workspace' },
  { key: 'byCostType', title: 'Spend by cost type', column: 'Cost type' },
];

function Breakdowns({ c }: { c: Console }) {
  return (
    <div className="grid gap-6 *:min-w-0 lg:grid-cols-3">
      {BREAKDOWNS.map((b) => (
        <Card key={b.key} title={b.title} subtitle="Share of the period's spend">
          {c[b.key].length === 0 ? (
            <Empty>No spend was reported.</Empty>
          ) : (
            <>
              <ShareBars items={shareBars(c, b.key)} />
              <TableView columns={[b.column, 'Spend', 'Share']} rows={shareRows(c, b.key)} />
            </>
          )}
        </Card>
      ))}
    </div>
  );
}

/** Numbers never break; the table scrolls inside its own box on narrow screens. */
const CELL = 'border-b border-[var(--grid)] px-2 py-2 whitespace-nowrap';

function TokenTable({ c }: { c: Console }) {
  return (
    <ScrollRegion label="Tokens by type" className="overflow-x-auto">
      <table className="tabular w-full text-left text-sm">
        <caption className="sr-only">Tokens by type</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              Type
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Tokens
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Share of all tokens
            </th>
          </tr>
        </thead>
        <tbody>
          {tokenRows(c).map((t) => (
            <tr key={t.label}>
              <th scope="row" className={`${CELL} font-medium`}>
                {t.label}
              </th>
              <td className={`${CELL} text-right`}>{formatInteger(t.tokens)}</td>
              <td className={`${CELL} text-right`}>
                {t.share === null ? '—' : formatPercent(t.share)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function TokenCard({ c }: { c: Console }) {
  const keys = keyStatusText(c);
  return (
    <Card
      title="Tokens by type"
      subtitle={`Cache read share ${rateText(c.cacheReadShare)} (cache reads ÷ all input)`}
    >
      <TokenTable c={c} />
      <p className="mt-3 text-sm text-[var(--text-secondary)]">
        {`${formatInteger(c.webSearchRequests)} web search requests.`}
        {c.workspaces &&
          ` ${formatInteger(c.workspaces.active)} active and ${formatInteger(c.workspaces.archived)} archived workspaces besides the default one.`}
        {keys && ` API keys: ${keys}.`}
      </p>
    </Card>
  );
}

function Populated({ c }: { c: Console }) {
  const range = rangeText(c.window);
  return (
    <>
      <p className="text-sm text-[var(--text-secondary)]">
        {range ? `${range} · ` : ''}Usage and cost of the linked Claude Console organization (Admin
        API). API keys are counted, never listed.
      </p>
      <StatTiles c={c} />
      {c.daily.length === 0 ? (
        <Empty>No Console usage or cost was reported in the collected period.</Empty>
      ) : (
        <DailyCharts c={c} />
      )}
      <Breakdowns c={c} />
      <TokenCard c={c} />
    </>
  );
}

function EnableNote() {
  return (
    <section aria-labelledby="console-enable" className="space-y-2 text-sm">
      <h2 id="console-enable" className="text-base font-semibold">
        Console API usage and cost are not collected
      </h2>
      <p className="text-[var(--text-secondary)]">
        This optional source reads the Admin API of the Claude Console organization linked to your
        tenant. To show daily spend, spend by model, workspace and cost type, token types and the
        cache read share here:
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-[var(--text-secondary)]">
        <li>
          Store a Console Admin API key as <code>ANTHROPIC_CONSOLE_ADMIN_API_KEY</code> (the
          Enterprise keys do not work for this API).
        </li>
        <li>
          Set <code>sources.console.enabled</code> to <code>true</code> in the collector
          configuration and run the next collection.
        </li>
      </ol>
    </section>
  );
}

/** Console API page (AN-5): aggregates of the optional Console Admin API datasets. */
export function ConsolePage({ view }: { view: DashboardView }) {
  const missing = notCollected(view.coverage);
  const alert = missing.some((m) => m.status === 'error');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Console API usage and cost</h1>
      {missing.length > 0 && (
        <Notice role={alert ? 'alert' : 'status'}>{missingText(missing)}</Notice>
      )}
      {view.console ? <Populated c={view.console} /> : <EnableNote />}
    </div>
  );
}
