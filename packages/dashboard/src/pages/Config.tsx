import { useMemo, useState } from 'react';
import {
  DETAIL_CONFIG_PATH,
  DETAIL_MANIFEST_PATH,
  detailConfigSchema,
  detailManifestSchema,
  type ConfigCustomRule,
  type ConfigRule,
  type DetailConfig,
} from '@claude-audit/core/contracts';
import { SeverityLabel, StatusBadge } from '../components/Badges';
import { Card, Empty } from '../components/Card';
import {
  CELL,
  detailNotice,
  FilterChips,
  HEAD,
  Notice,
  SearchField,
} from '../components/DetailControls';
import {
  CHANNEL_LABEL,
  countRules,
  filterConfig,
  formatConfigValue,
  RULE_FILTERS,
  sectionTotal,
  type ConfigSections,
  type RuleFilter,
  type Setting,
} from '../lib/config-view';
import { useDetailFile } from '../lib/detail-data';
import { formatTimestamp } from '../lib/format';

export interface ConfigProps {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const SUBJECT = { kind: 'config', plural: 'configuration', title: 'Configuration' } as const;
const FILTER_LABEL: Record<RuleFilter, string> = {
  all: 'All',
  enabled: 'Enabled',
  disabled: 'Disabled',
  custom: 'Custom',
};
const ORIGIN_LABEL: Record<ConfigRule['origin'], string> = {
  builtin: 'Built-in',
  custom: 'Custom rule',
  override: 'Custom (replaces built-in)',
};
const enabledStatus = (enabled: boolean) => (enabled ? 'config-enabled' : 'config-disabled');

function Table({
  caption,
  columns,
  children,
}: {
  caption: string;
  columns: readonly string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className={HEAD}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function RuleCell({ id, name }: { id: string; name: string }) {
  return (
    <th scope="row" className={`${CELL} text-left font-medium`}>
      {name}
      <span className="block font-mono text-xs font-normal text-[var(--text-secondary)]">{id}</span>
    </th>
  );
}

function RulesTable({ rules }: { rules: readonly ConfigRule[] }) {
  return (
    <Table
      caption="Compliance rules"
      columns={['Rule', 'Category', 'Severity', 'State', 'Datasets']}
    >
      {rules.map((rule) => (
        <tr key={rule.id} data-enabled={rule.enabled}>
          <RuleCell id={rule.id} name={rule.name} />
          <td className={CELL}>{rule.category}</td>
          <td className={CELL}>
            <SeverityLabel severity={rule.severity} />
          </td>
          <td className={CELL}>
            <StatusBadge status={enabledStatus(rule.enabled)} />
            {rule.origin !== 'builtin' && (
              <span className="mt-1 block text-xs text-[var(--text-secondary)]">
                {ORIGIN_LABEL[rule.origin]}
              </span>
            )}
          </td>
          <td className={`${CELL} text-xs`}>{rule.requires.join(', ') || 'none'}</td>
        </tr>
      ))}
    </Table>
  );
}

function ParameterRows({ rule }: { rule: ConfigRule }) {
  if (!rule.paramsValid) {
    return (
      <tr>
        <RuleCell id={rule.id} name={rule.name} />
        <td className={CELL} colSpan={3}>
          The configured parameters are rejected by the rule.
        </td>
        <td className={CELL}>
          <StatusBadge status="config-invalid" />
        </td>
      </tr>
    );
  }
  return (
    <>
      {rule.parameters.map((p) => (
        <tr key={`${rule.id}-${p.key}`}>
          <RuleCell id={rule.id} name={rule.name} />
          <td className={`${CELL} font-mono text-xs`}>{p.key}</td>
          <td className={`${CELL} tabular`}>{formatConfigValue(p.value)}</td>
          <td className={`${CELL} tabular text-[var(--text-secondary)]`}>
            {p.defaultValue === null ? '–' : formatConfigValue(p.defaultValue)}
          </td>
          <td className={CELL}>
            <StatusBadge status={p.overridden ? 'config-overridden' : 'config-default'} />
          </td>
        </tr>
      ))}
    </>
  );
}

function ParametersTable({ rules }: { rules: readonly ConfigRule[] }) {
  return (
    <Table
      caption="Rule parameters"
      columns={['Rule', 'Parameter', 'Effective value', 'Default', 'Status']}
    >
      {rules.map((rule) => (
        <ParameterRows key={rule.id} rule={rule} />
      ))}
    </Table>
  );
}

function CustomRulesTable({ rules }: { rules: readonly ConfigCustomRule[] }) {
  return (
    <Table caption="Custom rules" columns={['Rule', 'Type', 'Severity', 'Checks', 'State']}>
      {rules.map((rule) => (
        <tr key={rule.id}>
          <RuleCell id={rule.id} name={rule.name} />
          <td className={CELL}>
            {rule.kind === 'setting-baseline' ? 'Setting baseline' : 'Activity watch'}
            {rule.replacesBuiltin && (
              <span className="block text-xs text-[var(--text-secondary)]">
                Replaces the built-in rule
              </span>
            )}
          </td>
          <td className={CELL}>
            <SeverityLabel severity={rule.severity} />
          </td>
          <td className={CELL}>{rule.summary}</td>
          <td className={CELL}>
            <StatusBadge status={enabledStatus(rule.enabled)} />
          </td>
        </tr>
      ))}
    </Table>
  );
}

function SettingList({ settings, label }: { settings: readonly Setting[]; label: string }) {
  return (
    <dl aria-label={label} className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {settings.map((s) => (
        <div key={s.label} className="min-w-0">
          <dt className="text-[var(--text-secondary)]">{s.label}</dt>
          <dd className="font-medium [overflow-wrap:anywhere]">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StateTable({
  caption,
  column,
  rows,
}: {
  caption: string;
  column: string;
  rows: readonly { key: string; label: string; enabled: boolean }[];
}) {
  return (
    <Table caption={caption} columns={[column, 'State']}>
      {rows.map((row) => (
        <tr key={row.key}>
          <th scope="row" className={`${CELL} text-left font-medium`}>
            {row.label}
          </th>
          <td className={CELL}>
            <StatusBadge status={enabledStatus(row.enabled)} />
          </td>
        </tr>
      ))}
    </Table>
  );
}

function NotificationCard({ sections }: { sections: ConfigSections }) {
  const channels = sections.channels.map((c) => ({
    key: c.kind,
    label: CHANNEL_LABEL[c.kind],
    enabled: c.enabled,
  }));
  return (
    <Card
      title="Notification policy"
      subtitle="Channels are shown by kind only; addresses and webhook URLs are never published."
    >
      <div className="space-y-4">
        {sections.policy.length > 0 && (
          <SettingList settings={sections.policy} label="Notification policy settings" />
        )}
        {channels.length > 0 && (
          <StateTable caption="Notification channels" column="Channel" rows={channels} />
        )}
      </div>
    </Card>
  );
}

function SourcesCard({ sections }: { sections: ConfigSections }) {
  const datasets = sections.datasets.map((d) => ({
    key: d.name,
    label: d.name,
    enabled: d.enabled,
  }));
  return (
    <Card title="Data sources" subtitle="Datasets the collector gathers, and how it collects them.">
      <div className="space-y-4">
        {sections.collection.length > 0 && (
          <SettingList settings={sections.collection} label="Collection settings" />
        )}
        {datasets.length > 0 && (
          <StateTable caption="Data sources" column="Dataset" rows={datasets} />
        )}
      </div>
    </Card>
  );
}

function Summary({ data }: { data: DetailConfig }) {
  const counts = countRules(data.rules);
  const unknown = [...data.unknownRuleIds.disabled, ...data.unknownRuleIds.parameters];
  return (
    <div className="space-y-2 text-sm text-[var(--text-secondary)]">
      <p>
        {counts.all} rules: {counts.enabled} enabled, {counts.disabled} disabled, {counts.custom}{' '}
        custom. Read-only view of the configuration in effect at {formatTimestamp(data.generatedAt)}
        . Secrets, webhook URLs, addresses and file paths are never part of this view.
      </p>
      {unknown.length > 0 && (
        <p>Configured rule IDs that match no rule: {[...new Set(unknown)].join(', ')}.</p>
      )}
    </div>
  );
}

interface SectionProps {
  sections: ConfigSections;
  data: DetailConfig;
}

function RulesCard({
  sections,
  data,
  filter,
  onFilter,
}: SectionProps & { filter: RuleFilter; onFilter: (next: RuleFilter) => void }) {
  return (
    <Card
      title="Compliance rules"
      subtitle={`${sections.rules.length} of ${data.rules.length} shown`}
    >
      <div className="space-y-3">
        <FilterChips
          label="Filter rules by state"
          options={RULE_FILTERS}
          labels={FILTER_LABEL}
          value={filter}
          counts={countRules(data.rules)}
          total={data.rules.length}
          onChange={onFilter}
        />
        {sections.rules.length === 0 ? (
          <Empty>No rules match the current filter.</Empty>
        ) : (
          <RulesTable rules={sections.rules} />
        )}
      </div>
    </Card>
  );
}

function CustomRulesCard({ rules }: { rules: readonly ConfigCustomRule[] }) {
  return (
    <Card title="Custom rules" subtitle="Rules added or replaced in the custom rules file.">
      {rules.length === 0 ? (
        <Empty>No custom rules are defined.</Empty>
      ) : (
        <CustomRulesTable rules={rules} />
      )}
    </Card>
  );
}

function Sections({
  sections,
  query,
  filter,
  data,
  onFilter,
}: SectionProps & {
  query: string;
  filter: RuleFilter;
  onFilter: (next: RuleFilter) => void;
}) {
  const searching = query.trim() !== '';
  const show = (count: number) => count > 0 || !searching;
  return (
    <>
      {(sections.rules.length > 0 || filter !== 'all' || !searching) && (
        <RulesCard sections={sections} data={data} filter={filter} onFilter={onFilter} />
      )}
      {sections.parameterRules.length > 0 && (
        <Card
          title="Rule parameters"
          subtitle="Thresholds and options in effect, with the rule defaults."
        >
          <ParametersTable rules={sections.parameterRules} />
        </Card>
      )}
      {show(sections.customRules.length) && <CustomRulesCard rules={sections.customRules} />}
      {show(sections.channels.length + sections.policy.length) && (
        <NotificationCard sections={sections} />
      )}
      {show(sections.datasets.length + sections.collection.length) && (
        <SourcesCard sections={sections} />
      )}
      {sections.other.length > 0 && (
        <Card title="Other settings">
          <SettingList settings={sections.other} label="Other settings" />
        </Card>
      )}
    </>
  );
}

function ConfigContent({ data }: { data: DetailConfig }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RuleFilter>('all');
  const sections = useMemo(() => filterConfig(data, query, filter), [data, query, filter]);
  if (data.rules.length === 0 && data.sources.datasets.length === 0)
    return <Empty>This file holds no configuration entries.</Empty>;
  const noMatch = query.trim() !== '' && sectionTotal(sections) === 0;
  return (
    <div className="space-y-6">
      <Summary data={data} />
      <SearchField label="Search configuration" value={query} onChange={setQuery} />
      {noMatch ? (
        <Empty>No configuration matches the current search.</Empty>
      ) : (
        <Sections
          sections={sections}
          query={query}
          filter={filter}
          data={data}
          onFilter={setFilter}
        />
      )}
    </div>
  );
}

export function Config(options: ConfigProps = {}) {
  const config = useDetailFile(DETAIL_CONFIG_PATH, detailConfigSchema, options);
  const manifest = useDetailFile(DETAIL_MANIFEST_PATH, detailManifestSchema, options);
  const notice = detailNotice(config, manifest, SUBJECT);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Configuration</h1>
      {notice && <Notice role={notice.role}>{notice.text}</Notice>}
      {config.status === 'ready' && <ConfigContent data={config.data} />}
    </div>
  );
}
