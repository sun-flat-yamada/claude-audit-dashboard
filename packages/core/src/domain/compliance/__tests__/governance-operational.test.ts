import { describe, expect, it } from 'vitest';
import { daysAgo, snapshot } from '../../../__tests__/fixtures.js';
import { emptyGroups } from '../rules/governance.js';
import { collectionFreshness, dataSourceCoverage } from '../rules/operational.js';
import { evaluate } from './helpers.js';

const group = (id: string, source: string, memberCount: number | null) => ({
  id,
  name: id,
  source,
  roleIds: [],
  memberCount,
});

describe('DG-001 Empty Groups', () => {
  it('flags empty directly created groups only', () => {
    const result = evaluate(
      emptyGroups,
      snapshot({
        groups: [
          group('empty', 'direct', 0),
          group('synced', 'scim', 0),
          group('used', 'direct', 3),
        ],
      }),
    );
    expect(result.evidence.map((e) => e.id)).toEqual(['empty']);
  });

  it('skips when member counts were not collected', () => {
    expect(evaluate(emptyGroups, snapshot({ groups: [group('g', 'direct', null)] })).status).toBe(
      'skipped',
    );
  });
});

describe('OP-001 Collection Freshness', () => {
  it('fails when the snapshot is older than the threshold', () => {
    expect(evaluate(collectionFreshness, snapshot({}, {}, daysAgo(2))).status).toBe('fail');
    expect(evaluate(collectionFreshness, snapshot()).status).toBe('pass');
  });
});

describe('OP-002 Data Source Coverage', () => {
  it('fails for datasets that were not collected unless ignored', () => {
    const snap = snapshot(
      {},
      {
        spendLimits: { status: 'unavailable', reason: 'missing read:spend_limits' },
        usage: { status: 'error', reason: 'schema drift' },
      },
    );
    const result = evaluate(dataSourceCoverage, snap);
    expect(result.status).toBe('fail');
    expect(result.evidence.map((e) => e.id).sort()).toEqual(['spendLimits', 'usage']);
    expect(evaluate(dataSourceCoverage, snap, { ignore: ['spendLimits', 'usage'] }).status).toBe(
      'pass',
    );
  });

  it('skips when nothing is configured rather than passing vacuously', () => {
    const snap = { ...snapshot(), coverage: {} };
    expect(evaluate(dataSourceCoverage, snap).status).toBe('skipped');
  });
});
