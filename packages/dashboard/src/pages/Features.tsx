import type { DashboardFeatures, DashboardView } from '@claude-audit/core/contracts';
import type { ReactNode } from 'react';
import { Card, Empty, TableView } from '../components/Card';
import { Notice } from '../components/DetailControls';
import { ShareBars } from '../components/ShareBars';
import { formatInteger, formatPercent } from '../lib/format';
import {
  CALL_KINDS,
  CONNECTOR_COLUMNS,
  PLUGIN_COLUMNS,
  PROJECT_COLUMNS,
  SKILL_COLUMNS,
  callSplits,
  connectorRows,
  connectorUsage,
  headlineStats,
  missingText,
  moreText,
  notCollected,
  pluginRows,
  pluginUsage,
  projectRows,
  projectUsage,
  rangeText,
  skillRows,
  skillUsage,
  userBars,
  type CallSplit,
  type ConnectorItem,
} from '../lib/features-view';

type Features = DashboardFeatures;

function StatTiles({ f }: { f: Features }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
      {headlineStats(f).map((s) => (
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

interface SectionProps<T> {
  title: string;
  /** What an empty list means, e.g. "No skill was used in the period." */
  none: string;
  section: { total: number; items: readonly T[] } | null;
  children: (items: readonly T[]) => ReactNode;
}

/** One ranked list: not collected, empty, or the bars and table twin plus the "top N of" note. */
function Section<T>({ title, none, section, children }: SectionProps<T>) {
  const more = section ? moreText(section) : null;
  return (
    <Card title={title} subtitle="Distinct users in the period">
      {section === null ? (
        <Empty>Not collected in this snapshot.</Empty>
      ) : section.items.length === 0 ? (
        <Empty>{none}</Empty>
      ) : (
        <>
          {children(section.items)}
          {more && <p className="mt-3 text-sm text-[var(--text-secondary)]">{more}</p>}
        </>
      )}
    </Card>
  );
}

const CALL_COLOR: Readonly<Record<CallSplit['segments'][number]['key'], string>> = {
  read: 'var(--series-1)',
  write: 'var(--series-2)',
  unclassified: 'var(--text-muted)',
};

function CallLegend() {
  return (
    <ul aria-label="Call kinds" className="mb-3 flex flex-wrap gap-4 text-sm">
      {CALL_KINDS.map((k) => (
        <li key={k.key} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <span
            aria-hidden
            className="size-3 rounded-sm"
            style={{ background: CALL_COLOR[k.key] }}
          />
          {k.label}
        </li>
      ))}
    </ul>
  );
}

const splitLabel = (s: CallSplit): string =>
  `${s.label}, ${formatInteger(s.total)} calls: ${s.segments
    .map((g) => `${g.label} ${formatInteger(g.calls)} (${formatPercent(g.share)})`)
    .join(', ')}`;

/** One 100 % bar per connector: read-only, write and unclassified tool calls. */
function CallSplitBars({ items }: { items: readonly ConnectorItem[] }) {
  const splits = callSplits(items);
  if (splits.length === 0)
    return <Empty>The API reported no read / write split for this period.</Empty>;
  return (
    <>
      <CallLegend />
      <ul className="space-y-3">
        {splits.map((s) => (
          <li key={s.key} className="text-sm">
            <div className="flex justify-between gap-3">
              <span className="truncate">{s.label}</span>
              <span className="tabular shrink-0 text-[var(--text-secondary)]">
                {`${formatInteger(s.total)} calls`}
              </span>
            </div>
            <div
              role="img"
              aria-label={splitLabel(s)}
              title={splitLabel(s)}
              className="mt-1 flex h-4 w-full gap-0.5 overflow-hidden rounded bg-[var(--grid)]"
            >
              {s.segments.map((g) =>
                g.share > 0 ? (
                  <span
                    key={g.key}
                    className="block h-full"
                    style={{ width: `${String(g.share)}%`, background: CALL_COLOR[g.key] }}
                  />
                ) : null,
              )}
            </div>
          </li>
        ))}
      </ul>
      <TableView
        columns={['Connector', 'Calls', ...CALL_KINDS.map((k) => k.label)]}
        rows={splits.map((s) => [
          s.label,
          formatInteger(s.total),
          ...s.segments.map((g) => `${formatInteger(g.calls)} (${formatPercent(g.share)})`),
        ])}
      />
    </>
  );
}

function CallsCard({ f }: { f: Features }) {
  return (
    <Card
      title="Connector calls by kind"
      subtitle="Tool calls marked read-only or not by the connector; unclassified calls carry no annotation"
    >
      {f.connectors === null ? (
        <Empty>Not collected in this snapshot.</Empty>
      ) : (
        <CallSplitBars items={f.connectors.items} />
      )}
    </Card>
  );
}

function Populated({ f }: { f: Features }) {
  const range = rangeText(f.window);
  return (
    <>
      <p className="text-sm text-[var(--text-secondary)]">
        {range ? `${range} · ` : ''}Adoption of skills, connectors, plugins and claude.ai chat
        projects (Analytics API, totals over the period). People are counted, never listed.
      </p>
      <StatTiles f={f} />
      <div className="grid gap-6 *:min-w-0 lg:grid-cols-2">
        <Section title="Top skills" none="No skill was used in the period." section={f.skills}>
          {(items) => (
            <>
              <ShareBars wrap items={userBars(items, skillUsage)} />
              <TableView columns={SKILL_COLUMNS} rows={skillRows(items)} />
            </>
          )}
        </Section>
        <Section
          title="Top connectors"
          none="No connector was used in the period."
          section={f.connectors}
        >
          {(items) => (
            <>
              <ShareBars wrap items={userBars(items, connectorUsage)} />
              <TableView columns={CONNECTOR_COLUMNS} rows={connectorRows(items)} />
            </>
          )}
        </Section>
        <CallsCard f={f} />
        <Section title="Top plugins" none="No plugin was used in the period." section={f.plugins}>
          {(items) => (
            <>
              <ShareBars wrap items={userBars(items, pluginUsage)} />
              <TableView columns={PLUGIN_COLUMNS} rows={pluginRows(items)} />
            </>
          )}
        </Section>
        <Section
          title="Top chat projects"
          none="No chat project had activity in the period."
          section={f.projects}
        >
          {(items) => (
            <>
              <ShareBars wrap items={userBars(items, projectUsage)} />
              <TableView columns={PROJECT_COLUMNS} rows={projectRows(items)} />
            </>
          )}
        </Section>
      </div>
    </>
  );
}

function EnableNote() {
  return (
    <section aria-labelledby="features-enable" className="space-y-2 text-sm">
      <h2 id="features-enable" className="text-base font-semibold">
        Skill, connector, plugin and project adoption is not collected
      </h2>
      <p className="text-[var(--text-secondary)]">
        This optional source reads the Enterprise Analytics API with the key the built-in analytics
        already use (<code>read:analytics</code>). To show the most used skills, connectors with
        their read / write calls, plugins and claude.ai chat projects here:
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-[var(--text-secondary)]">
        <li>
          Keep <code>ANTHROPIC_ENTERPRISE_API_KEY</code> (or{' '}
          <code>ANTHROPIC_ANALYTICS_API_KEY</code>) with the <code>read:analytics</code> scope.
        </li>
        <li>
          Set <code>sources.featureUsage.enabled</code> to <code>true</code> in the collector
          configuration and run the next collection.
        </li>
      </ol>
      <p className="text-[var(--text-secondary)]">
        The page then shows the names of skills, connectors, plugins and chat projects. People are
        only counted; project creators are never stored.
      </p>
    </section>
  );
}

/** Skills and connectors page (AN-6): aggregates of the optional feature usage datasets. */
export function Features({ view }: { view: DashboardView }) {
  const missing = notCollected(view.coverage);
  const alert = missing.some((m) => m.status === 'error');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Skills, connectors, plugins and projects</h1>
      {missing.length > 0 && (
        <Notice role={alert ? 'alert' : 'status'}>{missingText(missing)}</Notice>
      )}
      {view.features ? <Populated f={view.features} /> : <EnableNote />}
    </div>
  );
}
