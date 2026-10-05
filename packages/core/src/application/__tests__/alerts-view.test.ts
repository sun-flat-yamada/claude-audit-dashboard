import { describe, expect, it } from 'vitest';
import {
  ALERT_REDACTED,
  checkDetailBundle,
  detailAlertsSchema,
  type DetailAlerts,
} from '../../contracts/index.js';
import {
  ACK_LABEL_MAX,
  MAX_SENT_HISTORY,
  alertId,
  appendSent,
  applyAck,
  emptyAckStore,
  parseAckStore,
  parseSentRecords,
  sanitizeAckLabel,
  sanitizeAlertTitle,
  type AckRecord,
  type SentRecord,
} from '../alerts-history.js';
import { buildAlertsView } from '../presenters/alerts-view.js';
import { buildDetailView, DEFAULT_DETAIL_THRESHOLDS } from '../presenters/detail-view.js';
import { initialState, parseState } from '../state.js';

// Assembled at run time so the source holds no webhook-shaped literal for the secret scan.
const WEBHOOK = ['https://hooks', 'slack.com/services/T0/B0/X'].join('.');
const NOW = new Date('2026-09-29T12:00:00.000Z');
const sent = (over: Partial<SentRecord> = {}): SentRecord => ({
  key: 'compliance:AC-001=fail,AK-002=warning',
  sentAt: '2026-09-28T06:00:00.000Z',
  severity: 'high',
  channels: ['slack', 'console'],
  title: 'Claude Enterprise audit: 2 finding(s), score 80%',
  ...over,
});
const ack = (record: SentRecord, over: Partial<AckRecord> = {}): AckRecord => ({
  alertId: alertId(record.key, record.sentAt),
  at: '2026-09-28T09:00:00.000Z',
  by: 'ops-team',
  ...over,
});
const view = (input: Partial<Parameters<typeof buildAlertsView>[0]> = {}): DetailAlerts =>
  buildAlertsView({ now: NOW, sent: [], lastSent: {}, acks: [], ...input });

describe('alertId', () => {
  it('is stable, prefixed and depends on the key and the time', () => {
    const a = alertId('k', '2026-01-01T00:00:00Z');
    expect(a).toMatch(/^al_[0-9a-f]{12}$/);
    expect(alertId('k', '2026-01-01T00:00:00Z')).toBe(a);
    expect(alertId('k', '2026-01-02T00:00:00Z')).not.toBe(a);
    expect(alertId('k2', '2026-01-01T00:00:00Z')).not.toBe(a);
  });
});

describe('sanitizeAckLabel / sanitizeAlertTitle', () => {
  it('keeps plain labels, trims, collapses whitespace and truncates', () => {
    expect(sanitizeAckLabel('  ops   team ')).toBe('ops team');
    expect(sanitizeAckLabel('x'.repeat(100))).toHaveLength(ACK_LABEL_MAX);
    expect(sanitizeAckLabel('line\nbreak\u0000')).toBe('line break');
  });

  it('defaults an empty label', () => {
    expect(sanitizeAckLabel(undefined)).toBe('unspecified');
    expect(sanitizeAckLabel('   ')).toBe('unspecified');
  });

  it.each([
    'jane.doe@example.com',
    WEBHOOK,
    'see https://example.com/x',
    '/home/jane/.ssh',
    'sk-ant-api03-abcdefghijkl',
    'ghp_abcdefghijklmnop',
  ])('hides %s', (value) => {
    expect(sanitizeAckLabel(value)).toBe(ALERT_REDACTED);
    expect(sanitizeAlertTitle(value)).toBe(ALERT_REDACTED);
  });

  it('truncates a long title', () => {
    expect(sanitizeAlertTitle('t'.repeat(500)).length).toBeLessThanOrEqual(160);
  });
});

describe('applyAck', () => {
  const known = new Set([alertId(sent().key, sent().sentAt)]);
  const id = alertId(sent().key, sent().sentAt);

  it('records an acknowledgement with a sanitized label', () => {
    const r = applyAck(emptyAckStore(), { alertId: id, by: ' me ', at: 'T1' }, known);
    expect(r.outcome).toBe('acknowledged');
    expect(r.store.acks).toEqual([{ alertId: id, at: 'T1', by: 'me' }]);
  });

  it('masks an address-like label when it is written', () => {
    const r = applyAck(emptyAckStore(), { alertId: id, by: 'a@b.co', at: 'T1' }, known);
    expect(r.store.acks[0]?.by).toBe(ALERT_REDACTED);
  });

  it('keeps the first acknowledgement of a duplicate', () => {
    const first = applyAck(emptyAckStore(), { alertId: id, by: 'first', at: 'T1' }, known).store;
    const second = applyAck(first, { alertId: id, by: 'second', at: 'T2' }, known);
    expect(second.outcome).toBe('already-acknowledged');
    expect(second.store).toBe(first);
  });

  it('rejects unknown and malformed ids without touching the store', () => {
    const store = emptyAckStore();
    expect(applyAck(store, { alertId: 'al_000000000000', by: 'x', at: 'T' }, known).outcome).toBe(
      'unknown-alert',
    );
    expect(applyAck(store, { alertId: 'nope', by: 'x', at: 'T' }, new Set(['nope'])).outcome).toBe(
      'unknown-alert',
    );
  });

  it('keeps the store sorted by alert id and deterministic', () => {
    const records = ['a', 'b', 'c'].map((k) => sent({ key: `collection:${k}` }));
    const ids = new Set(records.map((r) => alertId(r.key, r.sentAt)));
    const forward = records.reduce(
      (s, r) => applyAck(s, { alertId: alertId(r.key, r.sentAt), by: 'x', at: 'T' }, ids).store,
      emptyAckStore(),
    );
    const backward = [...records]
      .reverse()
      .reduce(
        (s, r) => applyAck(s, { alertId: alertId(r.key, r.sentAt), by: 'x', at: 'T' }, ids).store,
        emptyAckStore(),
      );
    expect(forward).toEqual(backward);
    expect(forward.acks.map((a) => a.alertId)).toEqual(
      [...forward.acks.map((a) => a.alertId)].sort(),
    );
  });
});

describe('parseAckStore', () => {
  it('reads a valid store', () => {
    const store = { schemaVersion: 1, acks: [ack(sent())] };
    expect(parseAckStore(store)).toEqual({ store, valid: true });
  });

  it.each([
    null,
    undefined,
    'text',
    42,
    [],
    { schemaVersion: 2, acks: [] },
    { acks: [] },
    { schemaVersion: 1, acks: [{ alertId: 'x' }] },
  ])('reads %j as empty and invalid', (raw) => {
    expect(parseAckStore(raw)).toEqual({ store: emptyAckStore(), valid: false });
  });
});

describe('send records in state.json', () => {
  it('older state files without a history still parse (no reset)', () => {
    const old = {
      schemaVersion: 2,
      collections: { count: 3, lastAt: '2026-01-01T00:00:00Z' },
      cursors: { a: 1 },
      projections: {},
      notifications: { lastSent: { k: '2026-01-01T00:00:00Z' } },
    };
    const parsed = parseState(old);
    expect(parsed.collections.count).toBe(3);
    expect(parsed.notifications).toEqual({ lastSent: { k: '2026-01-01T00:00:00Z' }, history: [] });
  });

  it('a malformed history record never resets the state and is skipped', () => {
    const state = {
      ...initialState(),
      notifications: { lastSent: {}, history: [sent(), { x: 1 }, 7] },
    };
    const parsed = parseState(state);
    expect(parseSentRecords(parsed.notifications.history)).toEqual([sent()]);
  });

  it('appendSent keeps the newest records up to the cap', () => {
    let history: unknown[] = [];
    for (let i = 0; i < MAX_SENT_HISTORY + 5; i += 1)
      history = appendSent(history, sent({ key: `collection:${String(i)}` }));
    expect(history).toHaveLength(MAX_SENT_HISTORY);
    expect((history.at(-1) as SentRecord).key).toBe(`collection:${String(MAX_SENT_HISTORY + 4)}`);
  });
});

describe('buildAlertsView', () => {
  it('is empty without sends', () => {
    const v = view();
    expect(v.alerts).toEqual([]);
    expect(v.totals).toEqual({ alerts: 0, acknowledged: 0, unacknowledged: 0 });
    expect(detailAlertsSchema.parse(v)).toEqual(v);
  });

  it('joins sends and acknowledgements, newest first', () => {
    const a = sent();
    const b = sent({
      key: 'collection:failure',
      sentAt: '2026-09-29T06:00:00.000Z',
      severity: 'high',
      channels: ['console'],
      title: 'Claude audit collection failure',
    });
    const v = view({ sent: [a, b], acks: [ack(a)] });
    expect(v.alerts.map((x) => x.kind)).toEqual(['collection', 'compliance']);
    expect(v.alerts[1]).toMatchObject({
      id: alertId(a.key, a.sentAt),
      acknowledged: true,
      acknowledgedBy: 'ops-team',
      acknowledgedAt: '2026-09-28T09:00:00.000Z',
      channels: ['console', 'slack'],
      findings: [
        { ruleId: 'AC-001', status: 'fail' },
        { ruleId: 'AK-002', status: 'warning' },
      ],
    });
    expect(v.alerts[0]).toMatchObject({
      acknowledged: false,
      acknowledgedAt: null,
      acknowledgedBy: null,
    });
    expect(v.totals).toEqual({ alerts: 2, acknowledged: 1, unacknowledged: 1 });
  });

  it('lists legacy lastSent entries with unknown severity and no channels', () => {
    const v = view({ lastSent: { 'compliance:AC-001=fail': '2026-09-27T00:00:00Z' } });
    expect(v.alerts).toHaveLength(1);
    expect(v.alerts[0]).toMatchObject({
      severity: 'unknown',
      channels: [],
      title: 'Compliance alert',
    });
  });

  it('does not duplicate a send that is in both the history and lastSent', () => {
    const a = sent();
    const v = view({ sent: [a], lastSent: { [a.key]: a.sentAt } });
    expect(v.alerts).toHaveLength(1);
    expect(v.alerts[0]?.severity).toBe('high');
  });

  it('drops acknowledgements of unknown alerts and keeps the first of a duplicate', () => {
    const a = sent();
    const v = view({
      sent: [a],
      acks: [
        ack(a, { by: 'first' }),
        ack(a, { by: 'second' }),
        { alertId: 'al_ffffffffffff', at: 'T', by: 'x' },
      ],
    });
    expect(v.totals.acknowledged).toBe(1);
    expect(v.alerts[0]?.acknowledgedBy).toBe('first');
  });

  it('skips malformed records and unparseable times, and ignores unknown channels', () => {
    const v = view({
      sent: [
        { nope: true },
        sent({ sentAt: 'yesterday' }),
        sent({ channels: ['pagerduty', 'email'] }),
      ],
    });
    expect(v.alerts).toHaveLength(1);
    expect(v.alerts[0]?.channels).toEqual(['email']);
  });

  it('redacts a sensitive title and acknowledger label and drops free-text finding parts', () => {
    const a = sent({
      key: 'compliance:AC-001=fail,evil@example.com=fail,AK-001=bogus',
      title: WEBHOOK,
    });
    const v = view({ sent: [a], acks: [ack(a, { by: 'jane@example.com' })] });
    expect(v.alerts[0]?.title).toBe(ALERT_REDACTED);
    expect(v.alerts[0]?.acknowledgedBy).toBe(ALERT_REDACTED);
    expect(v.alerts[0]?.findings).toEqual([{ ruleId: 'AC-001', status: 'fail' }]);
    expect(JSON.stringify(v)).not.toMatch(/@|https?:/);
  });

  it('is deterministic regardless of input order', () => {
    const records = [0, 1, 2, 3].map((i) =>
      sent({ key: `collection:${String(i)}`, sentAt: `2026-09-2${String(i)}T00:00:00Z` }),
    );
    expect(view({ sent: records })).toEqual(view({ sent: [...records].reverse() }));
  });

  it('caps the history at MAX_SENT_HISTORY rows', () => {
    const lastSent = Object.fromEntries(
      Array.from({ length: MAX_SENT_HISTORY + 20 }, (_, i) => [
        `k${String(i)}`,
        '2026-09-01T00:00:00Z',
      ]),
    );
    expect(view({ lastSent }).alerts).toHaveLength(MAX_SENT_HISTORY);
  });
});

describe('detail manifest and bundle check', () => {
  const build = (alerts: Parameters<typeof buildDetailView>[0]['alerts']) =>
    buildDetailView({
      now: NOW,
      source: 'demo',
      maskPii: true,
      snapshot: null,
      report: null,
      thresholds: DEFAULT_DETAIL_THRESHOLDS,
      alerts,
    });
  const alertEntries = (b: ReturnType<typeof build>) =>
    b.manifest.files.filter((f) => f.kind === 'alerts');
  const bundle = (alerts: DetailAlerts, mutate?: (a: DetailAlerts) => unknown) => {
    const built = build({ sent: [sent()], lastSent: {}, acks: [ack(sent())] });
    const files: Record<string, string> = {
      'detail/index.json': JSON.stringify(built.manifest),
      'detail/alerts.json': JSON.stringify(mutate ? mutate(alerts) : alerts),
    };
    return files;
  };
  const good = (): DetailAlerts => view({ sent: [sent()], acks: [ack(sent())] });

  it('lists the alert history as ok and passes the bundle check', () => {
    const built = build({ sent: [sent()], lastSent: {}, acks: [] });
    expect(alertEntries(built)).toEqual([
      expect.objectContaining({
        kind: 'alerts',
        path: 'detail/alerts.json',
        status: 'ok',
        count: 1,
      }),
    ]);
    expect(checkDetailBundle(bundle(good()), { requireDemo: true })).toEqual([]);
  });

  it('has no alerts entry unless the caller supplies the history, and unavailable when unreadable', () => {
    expect(alertEntries(build(undefined))).toEqual([]);
    expect(alertEntries(build(null))).toEqual([
      expect.objectContaining({
        kind: 'alerts',
        status: 'unavailable',
        count: null,
        reason: 'the alert history could not be read',
      }),
    ]);
    expect(build(null).files).toEqual([]);
  });

  it('rejects inconsistent totals, half acknowledgements, duplicates and leaks', () => {
    const wrongTotals = (a: DetailAlerts) => ({
      ...a,
      totals: { alerts: 1, acknowledged: 0, unacknowledged: 1 },
    });
    expect(checkDetailBundle(bundle(good(), wrongTotals)).join()).toMatch(/totals differ/);
    const half = (a: DetailAlerts) => ({
      ...a,
      alerts: a.alerts.map((x) => ({ ...x, acknowledgedBy: null })),
    });
    expect(checkDetailBundle(bundle(good(), half)).join()).toMatch(/inconsistent/);
    const dup = (a: DetailAlerts) => ({
      ...a,
      totals: { alerts: 2, acknowledged: 2, unacknowledged: 0 },
      alerts: [...a.alerts, ...a.alerts],
    });
    expect(checkDetailBundle(bundle(good(), dup)).join()).toMatch(/duplicate alert ids/);
    const leakTitle = (a: DetailAlerts) => ({
      ...a,
      alerts: a.alerts.map((x) => ({ ...x, title: WEBHOOK })),
    });
    expect(checkDetailBundle(bundle(good(), leakTitle)).join()).toMatch(/look like a secret/);
    const leakLabel = (a: DetailAlerts) => ({
      ...a,
      alerts: a.alerts.map((x) => ({ ...x, acknowledgedBy: 'jane@corp.com' })),
    });
    expect(checkDetailBundle(bundle(good(), leakLabel)).join()).toMatch(/non-example.com e-mail/);
    expect(checkDetailBundle(bundle(good(), () => ({ nope: 1 }))).join()).toMatch(/does not match/);
  });
});
