import { describe, expect, it } from 'vitest';
import {
  DETAIL_ACTIVITY_MONTH_LIMIT,
  checkDetailBundle,
  detailActivitySchema,
  detailApiKeysSchema,
  detailManifestSchema,
  detailMembersSchema,
  detailOrgGroupsSchema,
} from '../../contracts/index.js';
import type { CheckResult } from '../../domain/compliance/types.js';
import type { Activity, Credential, Member } from '../../domain/model/entities.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import { hashId, maskName } from '../../domain/util/mask.js';
import {
  DEFAULT_DETAIL_THRESHOLDS,
  buildDetailView,
  type DetailInput,
} from '../presenters/detail-view.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const ok = { status: 'ok' as const };

const member = (n: number, extra: Partial<Member> = {}): Member => ({
  id: `user_${n}`,
  email: `alice${n}@example.com`,
  name: 'Alice Engineer',
  role: 'user',
  organizationId: null,
  joinedAt: null,
  ...extra,
});

const activity = (id: string, createdAt: string, extra: Partial<Activity> = {}): Activity => ({
  id,
  type: 'login',
  createdAt,
  organizationId: null,
  actor: { kind: 'user_actor', id: 'user_1', email: 'alice1@example.com', ip: '192.0.2.10' },
  attributes: {},
  ...extra,
});

const key: Credential = {
  id: 'key_1',
  name: 'Audit key',
  scopes: ['read:members'],
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
  createdBy: 'alice1@example.com',
};

const snapshot = (activities: Activity[] = [activity('a1', '2026-09-01T00:00:00.000Z')]) =>
  ({
    schemaVersion: 2,
    id: 's1',
    collectedAt: NOW.toISOString(),
    coverage: {
      members: ok,
      memberActivity: ok,
      credentials: ok,
      credentialUsage: {
        ...ok,
        window: { from: '2026-08-01T00:00:00.000Z', to: NOW.toISOString() },
      },
      activities: ok,
      organizations: ok,
      groups: ok,
      cost: ok,
    },
    data: {
      members: [member(1, { organizationId: 'org_1' }), member(2)],
      memberActivity: [
        { userId: 'user_1', email: 'alice1@example.com', active: true, lastActiveOn: '2026-09-20' },
      ],
      invites: [
        {
          id: 'inv_1',
          email: 'new@example.com',
          role: 'user',
          status: 'pending',
          invitedAt: '2026-09-01T00:00:00.000Z',
          expiresAt: null,
        },
      ],
      credentials: [key],
      credentialUsage: [{ credentialId: 'key_1', lastSeenAt: '2026-09-28T00:00:00.000Z' }],
      activities,
      organizations: [{ id: 'org_1', name: 'Org One', createdAt: null }],
      groups: [{ id: 'grp_1', name: 'Group One', source: 'direct', roleIds: null, memberCount: 3 }],
      cost: [
        {
          date: '2026-09-02',
          dimension: 'group',
          key: 'grp_1',
          amount: 12.3456,
          listAmount: null,
          currency: 'USD',
        },
        {
          date: '2026-08-02',
          dimension: 'group',
          key: 'grp_1',
          amount: 99,
          listAmount: null,
          currency: 'USD',
        },
      ],
    },
  }) as AuditSnapshot;

const cf = (status: CheckResult['status'], orgId?: string): CheckResult => ({
  ruleId: 'CF-003',
  ruleName: 'IP Allowlist Enabled',
  category: 'configuration',
  severity: 'medium',
  status,
  message: 'org deviates for owner@example.com',
  evidence: orgId ? [{ kind: 'organization', id: orgId, label: 'Org One' }] : [],
  details: {},
  remediation: null,
});

const input = (extra: Partial<DetailInput> = {}): DetailInput => ({
  now: NOW,
  source: 'demo',
  maskPii: true,
  snapshot: snapshot(),
  report: null,
  thresholds: DEFAULT_DETAIL_THRESHOLDS,
  ...extra,
});

const files = (i: DetailInput): Record<string, string> => {
  const bundle = buildDetailView(i);
  return Object.fromEntries([
    ['detail/index.json', JSON.stringify(bundle.manifest)],
    ...bundle.files.map((f) => [f.path, JSON.stringify(f.content)]),
  ]);
};

const find = <T>(i: DetailInput, path: string): T =>
  buildDetailView(i).files.find((f) => f.path === path)?.content as T;

describe('hashId / maskName', () => {
  it('is stable, prefixed, 12 hex characters and distinguishes inputs', () => {
    expect(hashId('u', 'user_1')).toBe(hashId('u', 'user_1'));
    expect(hashId('u', 'user_1')).toMatch(/^u_[0-9a-f]{12}$/);
    expect(hashId('u', 'user_1')).not.toBe(hashId('u', 'user_2'));
    expect(hashId('k', '')).toMatch(/^k_[0-9a-f]{12}$/);
  });

  it('keeps word initials only', () => {
    expect(maskName('Alice Engineer')).toBe('A*** E***');
    expect(maskName('  Zoe ')).toBe('Z***');
  });
});

describe('buildDetailView with maskPii on', () => {
  const bundle = buildDetailView(input());

  it('lists every file and validates against its schema', () => {
    expect(detailManifestSchema.parse(bundle.manifest).files.map((f) => f.kind)).toEqual([
      'members',
      'api-keys',
      'activity',
      'org-groups',
    ]);
    for (const f of bundle.files) {
      const schema = f.path.includes('activity')
        ? detailActivitySchema
        : f.path.includes('members')
          ? detailMembersSchema
          : f.path.includes('api-keys')
            ? detailApiKeysSchema
            : detailOrgGroupsSchema;
      expect(() => schema.parse(f.content)).not.toThrow();
    }
  });

  it('masks e-mails, names, ids and IPs but keeps rows joinable', () => {
    const members = find<ReturnType<typeof detailMembersSchema.parse>>(
      input(),
      'detail/members.json',
    );
    const act = find<ReturnType<typeof detailActivitySchema.parse>>(
      input(),
      'detail/activity-2026-09.json',
    );
    const keys = find<ReturnType<typeof detailApiKeysSchema.parse>>(
      input(),
      'detail/api-keys.json',
    );
    expect(members.members[0]).toMatchObject({
      id: hashId('u', 'user_1'),
      email: 'a***@example.com',
      name: 'A*** E***',
      active: true,
      lastActiveOn: '2026-09-20',
    });
    expect(members.invites[0]?.email).toBe('n***@example.com');
    expect(act.items[0]?.actor).toEqual({
      kind: 'user_actor',
      id: members.members[0]?.id,
      email: 'a***@example.com',
      ip: null,
    });
    expect(keys.keys[0]).toMatchObject({
      id: hashId('k', 'key_1'),
      createdBy: 'a***@example.com',
      lastSeenAt: '2026-09-28T00:00:00.000Z',
    });
    expect(keys.usageObservedFrom).toBe('2026-08-01T00:00:00.000Z');
    expect(JSON.stringify(bundle)).not.toMatch(/user_1|key_1|inv_1|192\.0\.2|Alice/);
  });

  it('passes the bundle checker', () => {
    expect(checkDetailBundle(files(input()), { requireDemo: true })).toEqual([]);
  });
});

describe('buildDetailView with maskPii off', () => {
  const i = input({ maskPii: false, source: 'live' });

  it('writes raw identifiers, names, e-mails and IPs', () => {
    const members = find<ReturnType<typeof detailMembersSchema.parse>>(i, 'detail/members.json');
    const act = find<ReturnType<typeof detailActivitySchema.parse>>(
      i,
      'detail/activity-2026-09.json',
    );
    const keys = find<ReturnType<typeof detailApiKeysSchema.parse>>(i, 'detail/api-keys.json');
    expect(members.members[0]).toMatchObject({
      id: 'user_1',
      email: 'alice1@example.com',
      name: 'Alice Engineer',
    });
    expect(act.items[0]?.actor).toMatchObject({ id: 'user_1', ip: '192.0.2.10' });
    expect(keys.keys[0]).toMatchObject({ id: 'key_1', createdBy: 'alice1@example.com' });
    expect(buildDetailView(i).manifest.maskPii).toBe(false);
  });

  it('is still a consistent bundle (masking checks are skipped, example.com still enforced)', () => {
    expect(checkDetailBundle(files(i))).toEqual([]);
    expect(checkDetailBundle(files(i), { requireDemo: true }).join()).toMatch(
      /source must be demo/,
    );
  });
});

describe('members / keys details', () => {
  it('marks activity unknown (null) when memberActivity was not collected', () => {
    const s = snapshot();
    s.coverage.memberActivity = { status: 'unavailable', reason: 'no scope' };
    const m = find<ReturnType<typeof detailMembersSchema.parse>>(
      input({ snapshot: s }),
      'detail/members.json',
    );
    expect(m.members.every((x) => x.active === null)).toBe(true);
  });

  it('a member without an activity row is inactive when activity was collected', () => {
    const m = find<ReturnType<typeof detailMembersSchema.parse>>(input(), 'detail/members.json');
    expect(m.members.map((x) => x.active)).toEqual([true, false]);
  });

  it('carries the effective thresholds', () => {
    const t = { inactiveDays: 45, unusedDays: 7, maxAgeDays: 60 };
    const i = input({ thresholds: t });
    expect(find<{ inactiveDays: number }>(i, 'detail/members.json').inactiveDays).toBe(45);
    expect(
      find<{ unusedDays: number; maxAgeDays: number }>(i, 'detail/api-keys.json'),
    ).toMatchObject({
      unusedDays: 7,
      maxAgeDays: 60,
    });
  });

  it('a key never seen has lastSeenAt null; a non-email creator id is hashed', () => {
    const s = snapshot();
    s.data.credentialUsage = [];
    s.data.credentials = [{ ...key, createdBy: 'user_9' }];
    const k = find<ReturnType<typeof detailApiKeysSchema.parse>>(
      input({ snapshot: s }),
      'detail/api-keys.json',
    );
    expect(k.keys[0]?.lastSeenAt).toBeNull();
    expect(k.keys[0]?.createdBy).toBe(hashId('u', 'user_9'));
  });
});

describe('activity paging by month', () => {
  const acts = [
    activity('a1', '2026-08-31T23:59:59.000Z'),
    activity('a2', '2026-09-01T00:00:00.000Z'),
    activity('a3', '2026-09-15T00:00:00.000Z', {
      actor: { kind: 'api_actor', id: 'key_1', email: null, ip: null },
    }),
  ];

  it('splits at the UTC month boundary, newest first, with api actors hashed as keys', () => {
    const i = input({ snapshot: snapshot(acts) });
    const b = buildDetailView(i);
    expect(b.manifest.files.filter((f) => f.kind === 'activity').map((f) => f.month)).toEqual([
      '2026-08',
      '2026-09',
    ]);
    const sep = find<ReturnType<typeof detailActivitySchema.parse>>(
      i,
      'detail/activity-2026-09.json',
    );
    expect(sep.items.map((x) => x.id)).toEqual(['a3', 'a2']);
    expect(sep.items[0]?.actor.id).toBe(hashId('k', 'key_1'));
    expect(sep.total).toBe(2);
    expect(sep.truncated).toBe(false);
  });

  it('caps a month at the limit but keeps the real total', () => {
    const many = Array.from({ length: DETAIL_ACTIVITY_MONTH_LIMIT + 1 }, (_, n) =>
      activity(`a${n}`, `2026-09-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`),
    );
    const sep = find<ReturnType<typeof detailActivitySchema.parse>>(
      input({ snapshot: snapshot(many) }),
      'detail/activity-2026-09.json',
    );
    expect(sep.items).toHaveLength(DETAIL_ACTIVITY_MONTH_LIMIT);
    expect(sep.total).toBe(DETAIL_ACTIVITY_MONTH_LIMIT + 1);
    expect(sep.truncated).toBe(true);
  });

  it('exactly at the limit is not truncated', () => {
    const exact = Array.from({ length: DETAIL_ACTIVITY_MONTH_LIMIT }, (_, n) =>
      activity(`a${n}`, '2026-09-01T00:00:00.000Z'),
    );
    const sep = find<ReturnType<typeof detailActivitySchema.parse>>(
      input({ snapshot: snapshot(exact) }),
      'detail/activity-2026-09.json',
    );
    expect(sep.truncated).toBe(false);
  });
});

describe('org / groups', () => {
  it('counts members per organization (null when the source is single-org) and month-to-date group spend', () => {
    const o = find<ReturnType<typeof detailOrgGroupsSchema.parse>>(
      input(),
      'detail/org-groups.json',
    );
    expect(o.organizations).toEqual([{ id: 'org_1', name: 'Org One', memberCount: 1 }]);
    expect(o.groups[0]).toMatchObject({ id: 'grp_1', memberCount: 3, monthToDateCost: 12.35 });
    const s = snapshot();
    s.data.members = [member(1)];
    const single = find<ReturnType<typeof detailOrgGroupsSchema.parse>>(
      input({ snapshot: s }),
      'detail/org-groups.json',
    );
    expect(single.organizations[0]?.memberCount).toBeNull();
  });

  it('spend is null when cost was not collected', () => {
    const s = snapshot();
    s.coverage.cost = { status: 'unavailable' };
    const o = find<ReturnType<typeof detailOrgGroupsSchema.parse>>(
      input({ snapshot: s }),
      'detail/org-groups.json',
    );
    expect(o.groups[0]?.monthToDateCost).toBeNull();
  });

  it('lists failing / warning CF results per organization with masked messages', () => {
    const report = {
      results: [
        cf('fail', 'org_1'),
        cf('pass'),
        cf('warning'),
        { ...cf('fail'), ruleId: 'AC-001' },
      ],
    } as never;
    const o = find<ReturnType<typeof detailOrgGroupsSchema.parse>>(
      input({ report }),
      'detail/org-groups.json',
    );
    expect(o.deviations.map((d) => [d.ruleId, d.status, d.organizationId])).toEqual([
      ['CF-003', 'fail', 'org_1'],
      ['CF-003', 'warning', null],
    ]);
    expect(o.deviations[0]?.message).toBe('org deviates for o***@example.com');
  });
});

describe('unavailable and empty datasets', () => {
  it('records unavailable entries without files', () => {
    const b = buildDetailView(input({ snapshot: null }));
    expect(b.files).toEqual([]);
    expect(b.manifest.collectedAt).toBeNull();
    expect(b.manifest.files.every((f) => f.status === 'unavailable' && f.count === null)).toBe(
      true,
    );
    expect(b.manifest.files[0]?.reason).toBe('members was not collected');
    expect(checkDetailBundle(files(input({ snapshot: null })))).toEqual([]);
  });

  it('reports the dataset status as the reason', () => {
    const s = snapshot();
    s.coverage.credentials = { status: 'unavailable', reason: 'missing scope' };
    const b = buildDetailView(input({ snapshot: s }));
    expect(b.manifest.files.find((f) => f.kind === 'api-keys')).toMatchObject({
      status: 'unavailable',
      reason: 'credentials unavailable',
    });
    expect(b.files.some((f) => f.path.endsWith('api-keys.json'))).toBe(false);
  });

  it('collected-but-empty datasets still produce a file with count 0', () => {
    const s = snapshot([]);
    const b = buildDetailView(input({ snapshot: s }));
    expect(b.manifest.files.filter((f) => f.kind === 'activity')).toEqual([]);
    s.data.members = [];
    const m = buildDetailView(input({ snapshot: s })).manifest.files[0];
    expect(m).toMatchObject({ status: 'ok', count: 0 });
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildDetailView(input()))).toBe(JSON.stringify(buildDetailView(input())));
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = any;

describe('checkDetailBundle negative cases', () => {
  const good = () => files(input());
  const edit = (path: string, fn: (o: Obj) => void) => {
    const f = good();
    const obj = JSON.parse(f[path] ?? '{}');
    fn(obj);
    return { ...f, [path]: JSON.stringify(obj) };
  };

  it('rejects a missing manifest and an invalid manifest', () => {
    expect(checkDetailBundle({})).toEqual(['detail/index.json: missing']);
    expect(checkDetailBundle({ 'detail/index.json': '{}' })[0]).toMatch(/does not match/);
  });

  it('rejects real-looking e-mail addresses', () => {
    const f = edit('detail/members.json', (o) => (o.members[0].email = 'j***@acme-corp.io'));
    expect(checkDetailBundle(f).join()).toMatch(
      /non-example.com e-mail address j\*\*\*@acme-corp.io/,
    );
  });

  it('rejects an unmasked example.com e-mail while maskPii is on', () => {
    const f = edit('detail/members.json', (o) => (o.members[0].email = 'alice@example.com'));
    expect(checkDetailBundle(f).join()).toMatch(/unmasked e-mail address alice@example.com/);
  });

  it('rejects unmasked identifiers, names and IPs', () => {
    expect(
      checkDetailBundle(edit('detail/members.json', (o) => (o.members[0].id = 'user_1'))).join(),
    ).toMatch(/unmasked user id user_1/);
    expect(
      checkDetailBundle(
        edit('detail/members.json', (o) => (o.members[0].name = 'Alice Engineer')),
      ).join(),
    ).toMatch(/unmasked member name/);
    expect(
      checkDetailBundle(edit('detail/api-keys.json', (o) => (o.keys[0].id = 'key_1'))).join(),
    ).toMatch(/unmasked key id/);
    expect(
      checkDetailBundle(
        edit('detail/activity-2026-09.json', (o) => (o.items[0].actor.ip = '192.0.2.1')),
      ).join(),
    ).toMatch(/unmasked IP/);
    expect(
      checkDetailBundle(
        edit('detail/activity-2026-09.json', (o) => (o.items[0].actor.id = 'user_1')),
      ).join(),
    ).toMatch(/unmasked actor id/);
  });

  it('rejects manifest / file mismatches', () => {
    const f = good();
    const missing = Object.fromEntries(
      Object.entries(f).filter(([path]) => path !== 'detail/api-keys.json'),
    );
    expect(checkDetailBundle(missing).join()).toMatch(
      /api-keys.json: listed in the manifest but missing/,
    );
    expect(checkDetailBundle({ ...f, 'detail/extra.json': '{}' }).join()).toMatch(
      /extra.json: not listed/,
    );
    const count = edit('detail/index.json', (o) => (o.files[0].count = 7));
    expect(checkDetailBundle(count).join()).toMatch(/manifest count 7 differs/);
    const month = edit('detail/activity-2026-09.json', (o) => (o.month = '2026-08'));
    expect(checkDetailBundle(month).join()).toMatch(/month differs/);
    const broken = { ...f, 'detail/members.json': '{"schemaVersion":2}' };
    expect(checkDetailBundle(broken).join()).toMatch(/members.json: does not match/);
  });

  it('requireDemo rejects a manifest with maskPii off', () => {
    const f = files(input({ maskPii: false }));
    expect(checkDetailBundle(f, { requireDemo: true }).join()).toMatch(/maskPii must be true/);
  });
});
