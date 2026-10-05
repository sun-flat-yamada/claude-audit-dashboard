import { z } from 'zod';
import { ALERT_ID, ALERT_REDACTED } from '../contracts/alerts-view.js';
import { looksSensitive } from '../contracts/config-view.js';
import { SEVERITIES } from '../domain/compliance/types.js';
import { hashId } from '../domain/util/mask.js';

/** Where the acknowledgements live inside the data directory (`data/audit` branch). */
export const ACK_STORE_PATH = 'alerts/ack.json';
export const ACK_STORE_SCHEMA_VERSION = 1 as const;

/** Most send records kept in `state.json`, and most acknowledgements kept in the ack store. */
export const MAX_SENT_HISTORY = 200;
export const MAX_ACKS = 1000;
export const ACK_LABEL_MAX = 40;
export const TITLE_MAX = 160;

/** One alert that was sent (`state.json` `notifications.history`). */
export const sentRecordSchema = z.object({
  /** De-duplication key, e.g. `compliance:AC-001=fail`. */
  key: z.string(),
  sentAt: z.string(),
  severity: z.enum(SEVERITIES),
  /** Notifier ids that delivered the alert (`console`, `slack`, ...). */
  channels: z.array(z.string()),
  title: z.string(),
});
export type SentRecord = z.infer<typeof sentRecordSchema>;

const ackRecordSchema = z.object({
  alertId: z.string().regex(ALERT_ID),
  /** ISO time of the acknowledgement. */
  at: z.string(),
  /** Free-text label of the acknowledger (sanitized when written). */
  by: z.string(),
});
export type AckRecord = z.infer<typeof ackRecordSchema>;

/** `alerts/ack.json`. Separate from `state.json`: `parseState()` resets unknown shapes. */
export const ackStoreSchema = z.object({
  schemaVersion: z.literal(ACK_STORE_SCHEMA_VERSION),
  acks: z.array(ackRecordSchema),
});
export type AckStore = z.infer<typeof ackStoreSchema>;

export const emptyAckStore = (): AckStore => ({
  schemaVersion: ACK_STORE_SCHEMA_VERSION,
  acks: [],
});

/** Missing, corrupt or unknown-version content reads as an empty store (`valid: false`). */
export function parseAckStore(raw: unknown): { store: AckStore; valid: boolean } {
  const parsed = ackStoreSchema.safeParse(raw);
  return parsed.success
    ? { store: parsed.data, valid: true }
    : { store: emptyAckStore(), valid: false };
}

/** Stable id of one send: the same key and time always give the same id. */
export const alertId = (key: string, sentAt: string): string => hashId('al', `${key}|${sentAt}`);

/** Valid records only: one malformed entry must never reset or break the state file. */
export const parseSentRecords = (raw: readonly unknown[]): SentRecord[] =>
  raw.flatMap((item) => {
    const parsed = sentRecordSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });

/** Appends a send record and keeps the newest `MAX_SENT_HISTORY`. */
export function appendSent(raw: readonly unknown[], record: SentRecord): SentRecord[] {
  return [...parseSentRecords(raw), record].slice(-MAX_SENT_HISTORY);
}

const isControl = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
};

/** Control characters become spaces, runs of whitespace collapse, the ends are trimmed. */
const collapse = (text: string): string =>
  [...text]
    .map((ch) => (isControl(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

const truncate = (text: string, max: number): string => [...text].slice(0, max).join('');

/**
 * Free-text label of the acknowledger: control characters removed, at most `ACK_LABEL_MAX`
 * characters, and `[hidden]` when it looks like an e-mail address, URL, token or path.
 */
export function sanitizeAckLabel(raw: string | undefined): string {
  const text = collapse(raw ?? '');
  if (text === '') return 'unspecified';
  return looksSensitive(text) ? ALERT_REDACTED : truncate(text, ACK_LABEL_MAX);
}

/** Alert title for the public file: same allowlist approach as the effective configuration. */
export function sanitizeAlertTitle(raw: string): string {
  const text = collapse(raw);
  return looksSensitive(text) ? ALERT_REDACTED : truncate(text, TITLE_MAX);
}

export type AckOutcome = 'acknowledged' | 'already-acknowledged' | 'unknown-alert';

export interface AckInput {
  alertId: string;
  by: string | undefined;
  at: string;
}

const byAlertId = (a: AckRecord, b: AckRecord): number =>
  a.alertId < b.alertId ? -1 : a.alertId > b.alertId ? 1 : 0;

/** Newest acknowledgements win when the store is over `MAX_ACKS`; the result is sorted by id. */
const capAcks = (acks: readonly AckRecord[]): AckRecord[] =>
  [...acks]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : byAlertId(a, b)))
    .slice(0, MAX_ACKS)
    .sort(byAlertId);

/**
 * Records an acknowledgement. Pure: `known` holds the ids of the alerts that exist. An unknown id
 * is rejected, and a second acknowledgement of the same alert keeps the first (who and when).
 */
export function applyAck(
  store: AckStore,
  input: AckInput,
  known: ReadonlySet<string>,
): { store: AckStore; outcome: AckOutcome } {
  if (!ALERT_ID.test(input.alertId) || !known.has(input.alertId))
    return { store, outcome: 'unknown-alert' };
  if (store.acks.some((a) => a.alertId === input.alertId))
    return { store, outcome: 'already-acknowledged' };
  const record = { alertId: input.alertId, at: input.at, by: sanitizeAckLabel(input.by) };
  return {
    store: { schemaVersion: ACK_STORE_SCHEMA_VERSION, acks: capAcks([...store.acks, record]) },
    outcome: 'acknowledged',
  };
}
