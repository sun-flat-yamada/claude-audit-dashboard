import {
  ALERT_ID,
  applyAck,
  buildAlertsView,
  type AckOutcome,
  type AlertsViewInput,
} from '@claude-audit/core';
import { FsAckRepository } from '../adapters/storage/ack-store.js';
import type { Container } from './container.js';

/** The send records (`state.json`) and acknowledgements (`alerts/ack.json`), read tolerantly. */
export async function readAlertsInput(c: Container): Promise<Omit<AlertsViewInput, 'now'>> {
  const [state, { store }] = await Promise.all([
    c.state.load(),
    new FsAckRepository(c.store).load(),
  ]);
  return {
    sent: state.notifications.history,
    lastSent: state.notifications.lastSent,
    acks: store.acks,
  };
}

export interface AckResult {
  outcome: AckOutcome;
  alertId: string;
}

/**
 * Records that an alert was acknowledged. Only an alert that exists (is listed by the alert
 * history) can be acknowledged, and an unreadable `alerts/ack.json` is never overwritten, so a
 * damaged file cannot silently lose earlier acknowledgements. The label is free text and is
 * sanitized (an address- or URL-like label becomes `[hidden]`).
 */
export async function ackAlert(
  c: Container,
  alertId: string,
  by: string | undefined,
): Promise<AckResult> {
  if (!ALERT_ID.test(alertId))
    throw new Error(`Invalid alert id "${alertId.slice(0, 40)}": expected al_ and 12 hex digits`);
  const repo = new FsAckRepository(c.store);
  const loaded = await repo.load();
  if (loaded.status === 'corrupt')
    throw new Error(
      'alerts/ack.json is unreadable: fix or remove it on the data/audit branch before acknowledging',
    );
  const input = await readAlertsInput(c);
  const known = new Set(
    buildAlertsView({ ...input, now: c.clock.now(), acks: [] }).alerts.map((a) => a.id),
  );
  const { store, outcome } = applyAck(
    loaded.store,
    { alertId, by, at: c.clock.now().toISOString() },
    known,
  );
  if (outcome === 'acknowledged') await repo.save(store);
  return { outcome, alertId };
}
