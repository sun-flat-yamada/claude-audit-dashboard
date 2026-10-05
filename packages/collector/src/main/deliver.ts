import type { AlertMessage } from '@claude-audit/core';
import { appendSent, dispatchAlert, sanitizeAlertTitle } from '@claude-audit/core';
import type { Container } from './container.js';

/** Appends the send to `state.json` history (the alert history view reads it). */
async function recordSend(
  c: Container,
  alert: AlertMessage,
  channels: readonly string[],
  now: Date,
): Promise<void> {
  if (channels.length === 0) return;
  const state = await c.state.load();
  const record = {
    key: alert.key,
    sentAt: now.toISOString(),
    severity: alert.severity,
    channels: [...channels],
    title: sanitizeAlertTitle(alert.title),
  };
  await c.state.save({
    ...state,
    notifications: {
      ...state.notifications,
      history: appendSent(state.notifications.history, record),
    },
  });
}

export async function deliver(
  c: Container,
  alert: AlertMessage,
  now: Date = c.clock.now(),
): Promise<void> {
  const { delivered, failed } = await dispatchAlert(alert, c.notifiers, c.logger);
  c.logger.info(`Sent "${alert.title}" via ${delivered.join(', ') || 'no channel'}`);
  await recordSend(c, alert, delivered, now);
  if (failed.length) throw new Error(`Notification failed for: ${failed.join(', ')}`);
}
