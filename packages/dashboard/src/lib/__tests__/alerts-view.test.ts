import type { AlertEntry } from '@claude-audit/core/contracts';
import { describe, expect, it } from 'vitest';
import { ackStatus, channelsText, countByAck, filterAlerts, rulesText } from '../alerts-view';

const alert = (over: Partial<AlertEntry> = {}): AlertEntry => ({
  id: 'al_0123456789ab',
  sentAt: '2026-09-28T12:00:00.000Z',
  kind: 'compliance',
  severity: 'high',
  title: 'Claude Enterprise audit: 2 finding(s)',
  channels: ['console', 'slack'],
  findings: [
    { ruleId: 'AC-001', status: 'fail' },
    { ruleId: 'AK-001', status: 'warning' },
  ],
  acknowledged: false,
  acknowledgedAt: null,
  acknowledgedBy: null,
  ...over,
});
const acked = alert({
  id: 'al_ffffffffffff',
  sentAt: '2026-09-24T12:00:00.000Z',
  kind: 'collection',
  severity: 'medium',
  title: 'Claude audit collection failure',
  channels: ['discord'],
  findings: [],
  acknowledged: true,
  acknowledgedAt: '2026-09-29T00:00:00.000Z',
  acknowledgedBy: 'platform-ops',
});
const all = [alert(), acked];

describe('alert helpers', () => {
  it('names the acknowledgement status key', () => {
    expect(ackStatus(alert())).toBe('ack-unacknowledged');
    expect(ackStatus(acked)).toBe('ack-acknowledged');
  });

  it('formats channels and rules, with placeholders when unknown', () => {
    expect(channelsText(alert())).toBe('Console, Slack');
    expect(channelsText(alert({ channels: [] }))).toBe('Not recorded');
    expect(rulesText(alert())).toBe('AC-001, AK-001');
    expect(rulesText(acked)).toBe('–');
  });

  it('counts by acknowledgement', () => {
    expect(countByAck(all)).toEqual({ acknowledged: 1, unacknowledged: 1 });
    expect(countByAck([])).toEqual({ acknowledged: 0, unacknowledged: 0 });
  });
});

describe('filterAlerts', () => {
  it('returns everything without a query or filter', () => {
    expect(filterAlerts(all, '', 'all')).toHaveLength(2);
    expect(filterAlerts(all, '   ', 'all')).toHaveLength(2);
  });

  it('filters by acknowledgement status', () => {
    expect(filterAlerts(all, '', 'acknowledged')).toEqual([acked]);
    expect(filterAlerts(all, '', 'unacknowledged')).toEqual([alert()]);
  });

  it.each([
    ['ac-001', 1],
    ['SLACK', 1],
    ['discord', 1],
    ['collection', 1],
    ['platform-ops', 1],
    ['al_0123', 1],
    ['2026-09-28', 1],
    ['high', 1],
    ['audit', 2],
    ['slack failure', 0],
    ['nothing matches', 0],
  ])('searches %s', (query, expected) => {
    expect(filterAlerts(all, query, 'all')).toHaveLength(expected);
  });

  it('combines search and status', () => {
    expect(filterAlerts(all, 'audit', 'acknowledged')).toEqual([acked]);
    expect(filterAlerts(all, 'ac-001', 'acknowledged')).toEqual([]);
  });
});
