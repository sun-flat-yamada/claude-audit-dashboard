import type { DashboardClaudeCode, DashboardView } from '@claude-audit/core/contracts';
import { Card, Empty, TableView } from '../components/Card';
import { CELL, HEAD, Notice } from '../components/DetailControls';
import { ScrollRegion } from '../components/ScrollRegion';
import { ShareBars } from '../components/ShareBars';
import { TimeSeriesChart } from '../components/TimeSeriesChart';
import {
  costText,
  dailyAcceptRate,
  headlineStats,
  notCollected,
  rangeText,
  rateText,
  terminalBars,
  terminalRows,
} from '../lib/claude-code-view';
import { formatCompact, formatInteger, formatPercent } from '../lib/format';

type ClaudeCode = DashboardClaudeCode;

function StatTiles({ cc }: { cc: ClaudeCode }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
      {headlineStats(cc).map((s) => (
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

function DailyCharts({ cc }: { cc: ClaudeCode }) {
  return (
    <div className="grid gap-6 *:min-w-0 lg:grid-cols-2">
      <Card
        title="Daily users and sessions"
        subtitle="Distinct users and API keys active per day, and their sessions"
      >
        <TimeSeriesChart
          data={cc.daily}
          series={[
            { key: 'actors', label: 'Active users and keys', color: 'var(--series-1)' },
            { key: 'sessions', label: 'Sessions', color: 'var(--series-2)' },
          ]}
          format={formatInteger}
          tickFormat={formatCompact}
        />
      </Card>
      <Card title="Lines of code per day" subtitle="Lines added and removed with Claude Code">
        <TimeSeriesChart
          data={cc.daily}
          series={[
            { key: 'addedLines', label: 'Lines added', color: 'var(--series-1)' },
            { key: 'removedLines', label: 'Lines removed', color: 'var(--series-2)' },
          ]}
          format={formatInteger}
          tickFormat={formatCompact}
        />
      </Card>
      <Card
        title="Suggestion accept rate per day"
        subtitle="Accepted edit and write proposals, of accepted + rejected"
      >
        <TimeSeriesChart
          data={dailyAcceptRate(cc)}
          series={[{ key: 'acceptRate', label: 'Accept rate', color: 'var(--series-1)' }]}
          format={formatPercent}
          tickFormat={(v) => `${String(v)}%`}
          domain={[0, 100]}
        />
      </Card>
      <Card title="Sessions by terminal" subtitle="Sessions over the window, share of all sessions">
        {cc.byTerminal.length === 0 ? (
          <Empty>No sessions were reported.</Empty>
        ) : (
          <>
            <ShareBars items={terminalBars(cc)} />
            <TableView columns={['Terminal', 'Sessions', 'Share']} rows={terminalRows(cc)} />
          </>
        )}
      </Card>
    </div>
  );
}

const MODEL_HEADERS = ['Input', 'Output', 'Cache read', 'Cache write', 'Estimated cost'];

function ModelTable({ cc }: { cc: ClaudeCode }) {
  return (
    <ScrollRegion label="Tokens and estimated cost by model" className="overflow-x-auto">
      <table className="tabular w-full text-left text-sm">
        <caption className="sr-only">Tokens and estimated cost by model</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              Model
            </th>
            {MODEL_HEADERS.map((h) => (
              <th key={h} scope="col" className={`${HEAD} text-right whitespace-nowrap`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cc.byModel.map((m) => (
            <tr key={m.model}>
              <th scope="row" className={`${CELL} font-medium`}>
                {m.model}
              </th>
              {[m.inputTokens, m.outputTokens, m.cacheReadTokens, m.cacheCreationTokens].map(
                (value, i) => (
                  <td key={MODEL_HEADERS[i]} className={`${CELL} text-right`}>
                    {formatInteger(value)}
                  </td>
                ),
              )}
              <td className={`${CELL} text-right`}>{costText(m.estimatedCost, cc.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function ModelCard({ cc }: { cc: ClaudeCode }) {
  return (
    <Card
      title="Tokens and estimated cost by model"
      subtitle={`Cache reads are ${rateText(cc.cacheReadShare)} of all input tokens. Costs are the API's estimates.`}
    >
      {cc.byModel.length === 0 ? (
        <Empty>No model usage was reported.</Empty>
      ) : (
        <ModelTable cc={cc} />
      )}
    </Card>
  );
}

function Populated({ cc }: { cc: ClaudeCode }) {
  const range = rangeText(cc.window);
  return (
    <>
      <p className="text-sm text-[var(--text-secondary)]">
        {range ? `${range} · ` : ''}Totals of the Claude Code Analytics API. People and API keys are
        counted, never listed.
      </p>
      <StatTiles cc={cc} />
      {cc.daily.length === 0 ? (
        <Empty>No Claude Code activity was reported in the collected period.</Empty>
      ) : (
        <DailyCharts cc={cc} />
      )}
      <ModelCard cc={cc} />
    </>
  );
}

function EnableNote() {
  return (
    <section aria-labelledby="claude-code-enable" className="space-y-2 text-sm">
      <h2 id="claude-code-enable" className="text-base font-semibold">
        Claude Code activity is not collected
      </h2>
      <p className="text-[var(--text-secondary)]">
        This optional source reads the Claude Code Analytics API of a linked Claude Console
        organization. To show daily users, sessions, lines of code, the suggestion accept rate,
        terminals and cost by model here:
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-[var(--text-secondary)]">
        <li>
          Store a Console Admin API key as <code>ANTHROPIC_CONSOLE_ADMIN_API_KEY</code> (the
          Enterprise keys do not work for this API).
        </li>
        <li>
          Set <code>sources.claudeCode.enabled</code> to <code>true</code> in the collector
          configuration and run the next collection.
        </li>
      </ol>
    </section>
  );
}

/** Claude Code page (AN-4): aggregates of the optional `claudeCodeActivity` dataset. */
export function ClaudeCode({ view }: { view: DashboardView }) {
  const missing = view.claudeCode ? null : notCollected(view.coverage);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Claude Code</h1>
      {missing && (
        <Notice role={missing.status === 'error' ? 'alert' : 'status'}>
          {`Claude Code activity was not collected (${missing.reason ?? missing.status}).`}
        </Notice>
      )}
      {view.claudeCode ? <Populated cc={view.claudeCode} /> : <EnableNote />}
    </div>
  );
}
