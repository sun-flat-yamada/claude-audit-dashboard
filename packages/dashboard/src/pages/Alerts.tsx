import { useMemo, useState } from 'react';
import {
  ALERT_ACK_COMMAND,
  ALERT_ACK_WORKFLOW,
  DETAIL_ALERTS_PATH,
  DETAIL_MANIFEST_PATH,
  detailAlertsSchema,
  detailManifestSchema,
  type AlertEntry,
  type DetailAlerts,
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
  ACK_FILTER_LABEL,
  ACK_FILTERS,
  ackStatus,
  channelsText,
  countByAck,
  filterAlerts,
  rulesText,
  type AckFilter,
} from '../lib/alerts-view';
import { useDetailFile } from '../lib/detail-data';
import { formatInteger, formatTimestamp } from '../lib/format';

export interface AlertsProps {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const SUBJECT = { kind: 'alerts', plural: 'alert history', title: 'Alert history' } as const;

/** The page cannot write: it only says how a person with repository write access acknowledges. */
function HowToAcknowledge() {
  return (
    <Card
      title="How to acknowledge an alert"
      subtitle="This page is read-only. Acknowledgements are recorded on the data/audit branch by someone with write access to the repository."
    >
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>
          Command: <code className="[overflow-wrap:anywhere]">{ALERT_ACK_COMMAND}</code> with the
          alert id from the table below.
        </li>
        <li>
          Or run the <strong>{ALERT_ACK_WORKFLOW}</strong> workflow in GitHub Actions (inputs: alert
          id and an optional label).
        </li>
        <li>
          The status here updates after the next data collection or the workflow run has rebuilt the
          data.
        </li>
      </ul>
    </Card>
  );
}

function Totals({ data }: { data: DetailAlerts }) {
  const rows: [string, string][] = [
    ['Alerts sent', formatInteger(data.totals.alerts)],
    ['Acknowledged', formatInteger(data.totals.acknowledged)],
    ['Unacknowledged', formatInteger(data.totals.unacknowledged)],
  ];
  return (
    <Card
      title="Alert totals"
      subtitle={`History built at ${formatTimestamp(data.generatedAt)}. The newest alerts are listed first.`}
    >
      <dl
        aria-label="Alert totals"
        className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3"
      >
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[var(--text-secondary)]">{label}</dt>
            <dd className="tabular font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const COLUMNS = ['Sent', 'Severity', 'Rules', 'Channels', 'Alert', 'Acknowledgement'];

function Acknowledgement({ alert }: { alert: AlertEntry }) {
  return (
    <div className="space-y-0.5">
      <StatusBadge status={ackStatus(alert)} />
      {alert.acknowledged && alert.acknowledgedAt && (
        <p className="text-xs text-[var(--text-secondary)]">
          by {alert.acknowledgedBy ?? 'unspecified'} · {formatTimestamp(alert.acknowledgedAt)}
        </p>
      )}
    </div>
  );
}

function AlertsTable({ alerts }: { alerts: readonly AlertEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Alert history</caption>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className={HEAD}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id}>
              <td className={`${CELL} tabular whitespace-nowrap`}>
                {formatTimestamp(alert.sentAt)}
              </td>
              <td className={CELL}>
                <SeverityLabel severity={alert.severity} />
              </td>
              <td className={CELL}>{rulesText(alert)}</td>
              <td className={CELL}>{channelsText(alert)}</td>
              <th scope="row" className={`${CELL} text-left font-normal`}>
                <span className="block">{alert.title}</span>
                <code className="text-xs text-[var(--text-secondary)]">{alert.id}</code>
              </th>
              <td className={CELL}>
                <Acknowledgement alert={alert} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertsList({ data }: { data: DetailAlerts }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AckFilter>('all');
  const shown = useMemo(
    () => filterAlerts(data.alerts, query, status),
    [data.alerts, query, status],
  );
  return (
    <Card title="Alert history" subtitle={`${shown.length} of ${data.alerts.length} alerts shown`}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <SearchField label="Search alerts" value={query} onChange={setQuery} />
        </div>
        <FilterChips
          label="Filter by acknowledgement"
          options={['all', ...ACK_FILTERS]}
          labels={ACK_FILTER_LABEL}
          value={status}
          counts={countByAck(data.alerts)}
          total={data.alerts.length}
          onChange={setStatus}
        />
        {shown.length === 0 ? (
          <Empty>No alerts match the current search and filter.</Empty>
        ) : (
          <AlertsTable alerts={shown} />
        )}
      </div>
    </Card>
  );
}

function AlertsContent({ data }: { data: DetailAlerts }) {
  return (
    <div className="space-y-6">
      <HowToAcknowledge />
      <Totals data={data} />
      {data.alerts.length === 0 ? (
        <Empty>No alerts sent yet. Alerts appear here after the notify step has sent one.</Empty>
      ) : (
        <AlertsList data={data} />
      )}
    </div>
  );
}

export function Alerts(options: AlertsProps = {}) {
  const alerts = useDetailFile(DETAIL_ALERTS_PATH, detailAlertsSchema, options);
  const manifest = useDetailFile(DETAIL_MANIFEST_PATH, detailManifestSchema, options);
  const notice = detailNotice(alerts, manifest, SUBJECT);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Alerts</h1>
      {notice && <Notice role={notice.role}>{notice.text}</Notice>}
      {alerts.status === 'ready' && <AlertsContent data={alerts.data} />}
    </div>
  );
}
