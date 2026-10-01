import { describe, expect, it } from 'vitest';
import { NOW, activity } from '../../__tests__/fixtures.js';
import { advanceActivityWindow, nextActivityWindow } from '../activity-window.js';
import { credentialUsageProjection } from '../projections/credential-usage.js';
import { emptyData } from '../model/dataset.js';
import { maskEmails } from '../util/mask.js';
import { minorToMajor } from '../util/numbers.js';
import { monthRange, previousMonth, timestampId } from '../util/time.js';

const config = { initialLookbackHours: 24, overlapMinutes: 10, lagMinutes: 2 };

describe('activity window polling', () => {
  it('starts with the initial lookback and ends lagMinutes before now', () => {
    const window = nextActivityWindow(null, NOW, config);
    expect(window?.from.toISOString()).toBe('2026-09-29T12:00:00.000Z');
    expect(window?.to.toISOString()).toBe('2026-09-30T11:58:00.000Z');
  });

  it('overlaps the previous window and returns null when the window would be empty', () => {
    const cursor = { windowStart: '2026-09-30T06:00:00.000Z', recentIds: [] };
    expect(nextActivityWindow(cursor, NOW, config)?.from.toISOString()).toBe(
      '2026-09-30T05:50:00.000Z',
    );
    // A run right after the previous one still re-polls the overlap for late arrivals.
    expect(
      nextActivityWindow(
        { windowStart: NOW.toISOString(), recentIds: [] },
        NOW,
        config,
      )?.from.toISOString(),
    ).toBe('2026-09-30T11:50:00.000Z');
    expect(
      nextActivityWindow({ windowStart: '2026-09-30T12:08:00.000Z', recentIds: [] }, NOW, config),
    ).toBeNull();
  });

  it('drops ids already delivered and remembers the ids inside the next overlap', () => {
    const window = { from: new Date('2026-09-30T05:50:00Z'), to: new Date('2026-09-30T11:58:00Z') };
    const fetched = [
      activity('old', { createdAt: '2026-09-30T05:55:00Z' }),
      activity('mid', { createdAt: '2026-09-30T09:00:00Z' }),
      activity('late', { createdAt: '2026-09-30T11:50:00Z' }),
      activity('late', { createdAt: '2026-09-30T11:50:00Z' }),
    ];
    const next = advanceActivityWindow(
      fetched,
      { windowStart: '2026-09-30T06:00:00Z', recentIds: ['old'] },
      window,
      config,
    );
    expect(next.items.map((a) => a.id)).toEqual(['mid', 'late']);
    expect(next.cursor).toEqual({ windowStart: '2026-09-30T11:58:00.000Z', recentIds: ['late'] });
  });
});

describe('credential usage projection', () => {
  it('accumulates the latest api_actor sighting per key across runs', () => {
    const data = {
      ...emptyData(),
      activities: [
        activity('1', {
          actor: { kind: 'api_actor', id: 'key-1', email: null, ip: null },
          createdAt: '2026-09-30T01:00:00Z',
        }),
        activity('2', { actor: { kind: 'user_actor', id: 'user-1', email: null, ip: null } }),
      ],
    };
    const first = credentialUsageProjection.reduce({ previous: undefined, data, now: NOW });
    expect(first.items).toEqual([{ credentialId: 'key-1', lastSeenAt: '2026-09-30T01:00:00Z' }]);
    expect(first.window.from).toBe(NOW.toISOString());

    const older = {
      ...emptyData(),
      activities: [
        activity('3', {
          actor: { kind: 'api_actor', id: 'key-1', email: null, ip: null },
          createdAt: '2026-09-01T00:00:00Z',
        }),
      ],
    };
    const second = credentialUsageProjection.reduce({
      previous: first.state,
      data: older,
      now: NOW,
    });
    expect(second.items[0]?.lastSeenAt).toBe('2026-09-30T01:00:00Z');
  });
});

describe('utilities', () => {
  it('converts minor units, masks e-mails and formats time ids', () => {
    expect(minorToMajor('41280.125')).toBe(412.80125);
    expect(maskEmails('by jane.doe@example.com and a@b.io')).toBe(
      'by j***@example.com and a***@b.io',
    );
    expect(timestampId(NOW)).toBe('2026-09-30T12-00-00Z');
    expect(monthRange('2026-02')).toEqual({
      start: new Date('2026-02-01T00:00:00Z'),
      end: new Date('2026-03-01T00:00:00Z'),
    });
    expect(previousMonth(new Date('2026-01-15T00:00:00Z'))).toBe('2025-12');
    expect(() => monthRange('2026/02')).toThrow();
    expect(() => monthRange('2026-13')).toThrow(/Invalid month/);
    expect(() => monthRange('2026-00')).toThrow(/Invalid month/);
  });
});
