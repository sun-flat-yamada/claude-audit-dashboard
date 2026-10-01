import { describe, expect, it } from 'vitest';
import { NOW, credential, daysAgo, snapshot } from '../../../__tests__/fixtures.js';
import { credentialAge, privilegedCredentials, unusedCredentials } from '../rules/credentials.js';
import { evaluate } from './helpers.js';

const observed = (days: number) => ({
  credentialUsage: {
    status: 'ok' as const,
    window: { from: daysAgo(days), to: NOW.toISOString() },
  },
});

describe('AK-001 Unused API Keys', () => {
  const credentials = [
    credential('used'),
    credential('idle'),
    credential('analytics-only', { scopes: ['read:analytics'] }),
  ];

  it('fails for compliance keys not seen within the threshold', () => {
    const result = evaluate(
      unusedCredentials,
      snapshot(
        {
          credentials,
          credentialUsage: [
            { credentialId: 'used', lastSeenAt: daysAgo(1) },
            { credentialId: 'idle', lastSeenAt: daysAgo(60) },
          ],
        },
        observed(90),
      ),
    );
    expect(result.status).toBe('fail');
    expect(result.evidence.map((e) => e.id)).toEqual(['idle']);
  });

  it('skips while the observation period is shorter than the threshold', () => {
    const result = evaluate(unusedCredentials, snapshot({ credentials }, observed(3)));
    expect(result.status).toBe('skipped');
  });

  it('skips when no observed key id matches the inventory', () => {
    const result = evaluate(
      unusedCredentials,
      snapshot(
        {
          credentials,
          credentialUsage: [{ credentialId: 'someone-else', lastSeenAt: daysAgo(1) }],
        },
        observed(90),
      ),
    );
    expect(result).toMatchObject({
      status: 'skipped',
      message: expect.stringContaining('known key id'),
    });
  });
});

describe('AK-002 Over-privileged API Keys', () => {
  it('flags active keys holding write or delete scopes', () => {
    const result = evaluate(
      privilegedCredentials,
      snapshot({
        credentials: [
          credential('reader'),
          credential('deleter', {
            scopes: ['read:compliance_user_data', 'delete:compliance_user_data'],
          }),
          credential('inactive', { scopes: ['write:members'], active: false }),
        ],
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.evidence).toEqual([
      { kind: 'credential', id: 'deleter', label: 'deleter: delete:compliance_user_data' },
    ]);
  });
});

describe('AK-003 API Key Age', () => {
  it('flags active keys older than the threshold', () => {
    const snap = snapshot({
      credentials: [credential('old', { createdAt: daysAgo(200) }), credential('fresh')],
    });
    expect(evaluate(credentialAge, snap).evidence.map((e) => e.id)).toEqual(['old']);
    expect(evaluate(credentialAge, snap, { maxAgeDays: 365 }).status).toBe('pass');
  });
});
