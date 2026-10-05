import {
  ALERT_CHANNELS,
  ALERT_FINDING_STATUSES,
  ALERT_RULE_ID,
  ALERTS_VIEW_SCHEMA_VERSION,
  type AlertChannel,
  type AlertEntry,
  type DetailAlerts,
} from '../../contracts/alerts-view.js';
import {
  MAX_SENT_HISTORY,
  alertId,
  parseSentRecords,
  sanitizeAckLabel,
  sanitizeAlertTitle,
  type AckRecord,
  type SentRecord,
} from '../alerts-history.js';

export interface AlertsViewInput {
  now: Date;
  /** `state.json` `notifications.history` as stored (validated record by record here). */
  sent: readonly unknown[];
  /** `state.json` `notifications.lastSent`: sends from before the history was recorded. */
  lastSent: Readonly<Record<string, string>>;
  /** `alerts/ack.json` acknowledgements. */
  acks: readonly AckRecord[];
}

type Kind = AlertEntry['kind'];

const KIND_PREFIX: readonly (readonly [string, Kind, string])[] = [
  ['compliance:', 'compliance', 'Compliance alert'],
  ['collection:', 'collection', 'Collection alert'],
  ['document:', 'report', 'Report notification'],
];

const kindOf = (key: string): { kind: Kind; title: string } => {
  const hit = KIND_PREFIX.find(([prefix]) => key.startsWith(prefix));
  return hit ? { kind: hit[1], title: hit[2] } : { kind: 'other', title: 'Alert' };
};

const isStatus = (value: string): value is AlertEntry['findings'][number]['status'] =>
  (ALERT_FINDING_STATUSES as readonly string[]).includes(value);

/** `compliance:AC-001=fail,AK-002=warning` -> rule ids and statuses (anything else is dropped). */
function findingsOf(key: string): AlertEntry['findings'] {
  if (!key.startsWith('compliance:')) return [];
  return key
    .slice('compliance:'.length)
    .split(',')
    .flatMap((part) => {
      const [ruleId = '', status = ''] = part.split('=');
      return ALERT_RULE_ID.test(ruleId) && isStatus(status) ? [{ ruleId, status }] : [];
    });
}

const isChannel = (value: string): value is AlertChannel =>
  (ALERT_CHANNELS as readonly string[]).includes(value);

const channelsOf = (ids: readonly string[]): AlertChannel[] =>
  [...new Set(ids.filter(isChannel))].sort();

interface SendRow {
  record: SentRecord;
  /** Sent before the history was recorded: only the key and the time are known. */
  legacy: boolean;
}

/** History records plus the `lastSent` entries that have no record (older sends). */
function sendRows(input: AlertsViewInput): SendRow[] {
  const recorded = parseSentRecords(input.sent);
  const seen = new Set(recorded.map((r) => `${r.key}|${r.sentAt}`));
  const legacy = Object.entries(input.lastSent)
    .filter(([key, sentAt]) => !seen.has(`${key}|${sentAt}`))
    .map(([key, sentAt]) => ({
      legacy: true,
      record: { key, sentAt, severity: 'info' as const, channels: [], title: kindOf(key).title },
    }));
  return [...recorded.map((record) => ({ record, legacy: false })), ...legacy];
}

const byNewest = (a: AlertEntry, b: AlertEntry): number =>
  a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Joins the send records with the acknowledgements into the public alert history. Pure and
 * deterministic: newest first, one row per (key, send time), the first acknowledgement of an
 * alert wins, acknowledgements of unknown alerts are dropped, and the title and the acknowledger
 * label are redacted (`[hidden]` for anything that looks like an address, URL, token or path).
 */
export function buildAlertsView(input: AlertsViewInput): DetailAlerts {
  const acks = new Map<string, AckRecord>();
  for (const ack of input.acks) if (!acks.has(ack.alertId)) acks.set(ack.alertId, ack);
  const rows = new Map<string, AlertEntry>();
  for (const { record, legacy } of sendRows(input)) {
    const id = alertId(record.key, record.sentAt);
    if (rows.has(id) || Number.isNaN(Date.parse(record.sentAt))) continue;
    const ack = acks.get(id);
    rows.set(id, {
      id,
      sentAt: record.sentAt,
      kind: kindOf(record.key).kind,
      severity: legacy ? 'unknown' : record.severity,
      title: sanitizeAlertTitle(record.title),
      channels: channelsOf(record.channels),
      findings: findingsOf(record.key),
      acknowledged: ack !== undefined,
      acknowledgedAt: ack?.at ?? null,
      acknowledgedBy: ack ? sanitizeAckLabel(ack.by) : null,
    });
  }
  const alerts = [...rows.values()].sort(byNewest).slice(0, MAX_SENT_HISTORY);
  const acknowledged = alerts.filter((a) => a.acknowledged).length;
  return {
    schemaVersion: ALERTS_VIEW_SCHEMA_VERSION,
    generatedAt: input.now.toISOString(),
    totals: { alerts: alerts.length, acknowledged, unacknowledged: alerts.length - acknowledged },
    alerts,
  };
}
