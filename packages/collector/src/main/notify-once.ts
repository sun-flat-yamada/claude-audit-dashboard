import { pruneLastSent, type AlertMessage } from '@claude-audit/core';
import type { Container } from './container.js';
import { deliver } from './deliver.js';

/**
 * Sends an alert through the configured channels unless its key is within the cooldown
 * (`notifications.cooldownMinutes`), and records the send time in `state.json`. Resolves true
 * when the alert was sent.
 */
export async function notifyOnce(c: Container, alert: AlertMessage | null): Promise<boolean> {
  if (!alert) return false;
  const now = c.clock.now();
  const { cooldownMinutes } = c.config.notifications;
  const { lastSent } = (await c.state.load()).notifications;
  if (alert.key in pruneLastSent(lastSent, now, cooldownMinutes)) {
    c.logger.info(`Alert ${alert.key} is within its cooldown`);
    return false;
  }
  await deliver(c, alert, now);
  // Reload: `deliver` has appended the send record to the history.
  const state = await c.state.load();
  await c.state.save({
    ...state,
    notifications: {
      ...state.notifications,
      lastSent: {
        ...pruneLastSent(lastSent, now, cooldownMinutes),
        [alert.key]: now.toISOString(),
      },
    },
  });
  return true;
}
