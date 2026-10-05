import { z } from 'zod';
import { DETAIL_DIR } from './detail-view.js';

/**
 * Alert history (F-008): which alerts `pnpm notify` sent (time, channel kinds, severity, rule ids,
 * a redacted title) joined with their acknowledgement (when, and a masked free-text label).
 *
 * Built from an explicit allowlist: no webhook URLs, recipient addresses, secrets, paths or
 * finding messages (rule ids and statuses only). The title and the acknowledger label go through
 * the same redaction as the effective configuration (`looksSensitive`): anything that looks like
 * an e-mail address, URL, token or path becomes `[hidden]`. Listed in the detail manifest (`kind:
 * alerts`) and published under the detail publication condition. The page only displays the
 * state; acknowledging is done with the command / workflow below by someone with repository
 * write access. Bump `ALERTS_VIEW_SCHEMA_VERSION` on breaking changes.
 */
export const ALERTS_VIEW_SCHEMA_VERSION = 1 as const;

export const DETAIL_ALERTS_PATH = `${DETAIL_DIR}/alerts.json`;

/** How to acknowledge an alert (shown on the page, documented in docs/DEPLOYMENT.md). */
export const ALERT_ACK_COMMAND = 'pnpm alerts ack <alert-id> [--by <label>]';
export const ALERT_ACK_WORKFLOW = 'Acknowledge Alert';

/** Written instead of a title or label that looks like a secret, URL, address or path. */
export const ALERT_REDACTED = '[hidden]';

/** `al_` + 12 hex characters: a stable hash of the dedupe key and the send time. */
export const ALERT_ID = /^al_[0-9a-f]{12}$/;
/** `AC-001`: rule ids only (no free text can enter through the findings). */
export const ALERT_RULE_ID = /^[A-Z]{2}-\d{3}$/;

export const ALERT_KINDS = ['compliance', 'collection', 'report', 'other'] as const;
export const ALERT_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info', 'unknown'] as const;
export const ALERT_CHANNELS = ['console', 'slack', 'discord', 'email'] as const;
export const ALERT_FINDING_STATUSES = ['pass', 'warning', 'fail', 'error', 'skipped'] as const;

const count = z.number().int().nonnegative();

const alertSchema = z.object({
  id: z.string().regex(ALERT_ID),
  sentAt: z.string(),
  kind: z.enum(ALERT_KINDS),
  /** `unknown` for alerts sent before the history was recorded. */
  severity: z.enum(ALERT_SEVERITIES),
  title: z.string(),
  /** Channel kinds that delivered the alert; empty when it was not recorded. */
  channels: z.array(z.enum(ALERT_CHANNELS)),
  findings: z.array(
    z.object({
      ruleId: z.string().regex(ALERT_RULE_ID),
      status: z.enum(ALERT_FINDING_STATUSES),
    }),
  ),
  acknowledged: z.boolean(),
  /** Both are set when `acknowledged`, both null otherwise. */
  acknowledgedAt: z.string().nullable(),
  acknowledgedBy: z.string().nullable(),
});

export const detailAlertsSchema = z.object({
  schemaVersion: z.literal(ALERTS_VIEW_SCHEMA_VERSION),
  generatedAt: z.string(),
  totals: z.object({ alerts: count, acknowledged: count, unacknowledged: count }),
  /** Newest first. */
  alerts: z.array(alertSchema),
});

export type AlertEntry = z.infer<typeof alertSchema>;
export type DetailAlerts = z.infer<typeof detailAlertsSchema>;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
