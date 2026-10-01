import type { AlertMessage, Logger, Notifier } from '@claude-audit/core';
import { SEVERITY_COLORS, postJson, truncate } from './webhook.js';

export const consoleNotifier = (logger: Logger): Notifier => ({
  id: 'console',
  send: async (alert) =>
    logger.info([`[${alert.severity}] ${alert.title}`, ...alert.lines].join('\n  ')),
});

/** Slack Incoming Webhook with Block Kit (header, findings, dashboard link). */
export const slackPayload = (alert: AlertMessage): unknown => ({
  text: alert.title,
  blocks: [
    { type: 'header', text: { type: 'plain_text', text: truncate(alert.title, 150) } },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(alert.lines.join('\n') || '-', 2900) },
    },
    ...(alert.link
      ? [
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `<${alert.link}|Open the audit dashboard>` }],
          },
        ]
      : []),
  ],
});

export const slackNotifier = (url: string, fetchImpl: typeof fetch = fetch): Notifier => ({
  id: 'slack',
  send: (alert) => postJson(fetchImpl, url, slackPayload(alert), 'Slack'),
});

/** Discord webhook embed colored by severity. */
export const discordPayload = (alert: AlertMessage): unknown => ({
  embeds: [
    {
      title: truncate(alert.title, 256),
      description: truncate(alert.lines.join('\n') || '-', 4000),
      color: SEVERITY_COLORS[alert.severity],
      ...(alert.link ? { url: alert.link } : {}),
    },
  ],
});

export const discordNotifier = (url: string, fetchImpl: typeof fetch = fetch): Notifier => ({
  id: 'discord',
  send: (alert) => postJson(fetchImpl, url, discordPayload(alert), 'Discord'),
});
