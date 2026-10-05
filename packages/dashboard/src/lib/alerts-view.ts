import type { AlertChannel, AlertEntry } from '@claude-audit/core/contracts';

export const ACK_FILTERS = ['acknowledged', 'unacknowledged'] as const;
export type AckFilter = (typeof ACK_FILTERS)[number] | 'all';

export const ACK_FILTER_LABEL: Record<AckFilter, string> = {
  all: 'All',
  acknowledged: 'Acknowledged',
  unacknowledged: 'Unacknowledged',
};

export const CHANNEL_LABEL: Record<AlertChannel, string> = {
  console: 'Console',
  slack: 'Slack',
  discord: 'Discord',
  email: 'E-mail',
};

export const KIND_LABEL: Record<AlertEntry['kind'], string> = {
  compliance: 'Compliance',
  collection: 'Collection',
  report: 'Report',
  other: 'Other',
};

/** Key of the badge in `Badges.tsx` (icon + label + color). */
export const ackStatus = (alert: AlertEntry): string =>
  alert.acknowledged ? 'ack-acknowledged' : 'ack-unacknowledged';

export const channelsText = (alert: AlertEntry): string =>
  alert.channels.length === 0
    ? 'Not recorded'
    : alert.channels.map((c) => CHANNEL_LABEL[c]).join(', ');

export const rulesText = (alert: AlertEntry): string =>
  alert.findings.length === 0 ? '–' : alert.findings.map((f) => f.ruleId).join(', ');

export function countByAck(alerts: readonly AlertEntry[]): Record<string, number> {
  const acknowledged = alerts.filter((a) => a.acknowledged).length;
  return { acknowledged, unacknowledged: alerts.length - acknowledged };
}

const haystack = (alert: AlertEntry): string =>
  [
    alert.id,
    alert.title,
    alert.severity,
    KIND_LABEL[alert.kind],
    channelsText(alert),
    ...alert.findings.flatMap((f) => [f.ruleId, f.status]),
    alert.acknowledgedBy ?? '',
    alert.sentAt,
  ]
    .join(' ')
    .toLowerCase();

/** Alerts matching the acknowledgement filter and every word of the search text. */
export function filterAlerts(
  alerts: readonly AlertEntry[],
  query: string,
  status: AckFilter,
): AlertEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return alerts.filter((alert) => {
    if (status === 'acknowledged' && !alert.acknowledged) return false;
    if (status === 'unacknowledged' && alert.acknowledged) return false;
    const text = haystack(alert);
    return words.every((w) => text.includes(w));
  });
}
