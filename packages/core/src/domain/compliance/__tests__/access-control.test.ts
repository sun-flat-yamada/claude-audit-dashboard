import { describe, expect, it } from 'vitest';
import { NOW, daysAgo, dayString, member, snapshot } from '../../../__tests__/fixtures.js';
import {
  excessiveAdmins,
  inactiveMembers,
  primaryOwner,
  stalePendingInvites,
} from '../rules/access-control.js';
import { evaluate } from './helpers.js';

const window90 = {
  memberActivity: { status: 'ok' as const, window: { from: daysAgo(90), to: NOW.toISOString() } },
};

describe('AC-001 Inactive Members', () => {
  const members = [member('u1'), member('u2'), member('new', { joinedAt: daysAgo(10) })];

  it('fails for members without recent activity and ignores recently joined members', () => {
    const result = evaluate(
      inactiveMembers,
      snapshot(
        {
          members,
          memberActivity: [
            { userId: 'u1', email: null, active: true, lastActiveOn: dayString(3) },
            { userId: 'x', email: 'U2@example.com', active: true, lastActiveOn: dayString(200) },
          ],
        },
        window90,
      ),
    );
    expect(result.status).toBe('fail');
    expect(result.evidence.map((e) => e.id)).toEqual(['u2']);
  });

  it('matches activity by e-mail and treats active rows without a date as active', () => {
    const result = evaluate(
      inactiveMembers,
      snapshot(
        {
          members,
          memberActivity: [
            { userId: 'other-id', email: 'U1@example.com', active: true, lastActiveOn: null },
            { userId: 'u2', email: null, active: true, lastActiveOn: null },
          ],
        },
        window90,
      ),
    );
    expect(result.status).toBe('pass');
  });

  it('skips when the analytics window is shorter than the threshold', () => {
    const result = evaluate(
      inactiveMembers,
      snapshot(
        { members },
        { memberActivity: { status: 'ok', window: { from: daysAgo(30), to: NOW.toISOString() } } },
      ),
    );
    expect(result.status).toBe('skipped');
  });

  it('skips instead of passing when member activity is unavailable', () => {
    const result = evaluate(
      inactiveMembers,
      snapshot(
        { members },
        { memberActivity: { status: 'unavailable', reason: 'no analytics key' } },
      ),
    );
    expect(result).toMatchObject({
      status: 'skipped',
      message: expect.stringContaining('no analytics key'),
    });
  });
});

describe('AC-002 Excessive Administrative Roles', () => {
  const staff = (roles: string[], org: string | null = null) =>
    roles.map((role, i) => member(`${org ?? 'o'}-${i}`, { role, organizationId: org }));

  it('evaluates each organization separately with the Enterprise role set', () => {
    const ok = staff(['primary_owner', 'user', 'user', 'managed', 'user'], 'org-a');
    const bad = staff(['owner', 'membership_admin', 'user'], 'org-b');
    const result = evaluate(excessiveAdmins, snapshot({ members: [...ok, ...bad] }));
    expect(result.status).toBe('fail');
    expect(result.evidence).toEqual([
      { kind: 'organization', id: 'org-b', label: '2/3 administrative members (66.7%)' },
    ]);
  });

  it('passes within the threshold and honours minMembers', () => {
    expect(
      evaluate(
        excessiveAdmins,
        snapshot({ members: staff(['primary_owner', 'user', 'user', 'user', 'user']) }),
      ).status,
    ).toBe('pass');
    expect(
      evaluate(excessiveAdmins, snapshot({ members: staff(['owner', 'owner']) }), { minMembers: 5 })
        .status,
    ).toBe('skipped');
  });
});

describe('AC-003 Single Primary Owner', () => {
  it('requires exactly one primary owner per organization', () => {
    const one = [member('a', { role: 'primary_owner' }), member('b')];
    expect(evaluate(primaryOwner, snapshot({ members: one })).status).toBe('pass');
    const two = [...one, member('c', { role: 'primary_owner' })];
    expect(evaluate(primaryOwner, snapshot({ members: two })).status).toBe('fail');
    expect(evaluate(primaryOwner, snapshot({ members: [] })).status).toBe('skipped');
  });
});

describe('AC-004 Stale Pending Invites', () => {
  it('flags pending invites older than the threshold only', () => {
    const invite = (id: string, status: string, age: number) => ({
      id,
      email: `${id}@example.com`,
      role: 'user',
      status,
      invitedAt: daysAgo(age),
      expiresAt: null,
    });
    const result = evaluate(
      stalePendingInvites,
      snapshot({
        invites: [
          invite('old', 'pending', 45),
          invite('new', 'pending', 5),
          invite('done', 'accepted', 90),
        ],
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.evidence.map((e) => e.id)).toEqual(['old']);
  });
});
