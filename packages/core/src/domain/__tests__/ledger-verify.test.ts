import { describe, expect, it } from 'vitest';
import {
  buildLedgerManifest,
  dayGapFinding,
  digestFindings,
  emptyLedgerStatus,
  entryDays,
  failingDays,
  ledgerHealthOf,
  listDates,
  missingDays,
  staleFinding,
  type LedgerManifest,
} from '../ledger/index.js';

describe('missingDays / dayGapFinding', () => {
  it('lists the days of the month in [from, until) without rows', () => {
    const present = new Set(['2026-09-01', '2026-09-03']);
    expect(missingDays('2026-09', present, '2026-09-01', '2026-09-05')).toEqual([
      '2026-09-02',
      '2026-09-04',
    ]);
    // Days before the first recorded day are not a gap.
    expect(missingDays('2026-09', present, '2026-09-03', '2026-09-04')).toEqual([]);
  });

  it('describes a gap with the dates and stays silent for a complete month', () => {
    const finding = dayGapFinding({
      month: '2026-09',
      dataset: 'usage',
      present: new Set(['2026-09-01']),
      firstDay: '2026-08-15',
      until: '2026-09-03',
    });
    expect(finding).toEqual({
      check: 'gap',
      month: '2026-09',
      dataset: 'usage',
      message: 'usage 2026-09: 1 day(s) without rows: 2026-09-02',
      dates: ['2026-09-02'],
    });
    expect(
      dayGapFinding({
        month: '2026-09',
        dataset: 'usage',
        present: new Set(['2026-09-01', '2026-09-02']),
        firstDay: '2026-09-01',
        until: '2026-09-03',
      }),
    ).toBeNull();
  });

  it('shortens long date lists', () => {
    const dates = Array.from({ length: 12 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
    expect(listDates(dates)).toMatch(/2026-09-10 and 2 more$/);
  });

  it('reads the days of daily and event entries', () => {
    expect([
      ...entryDays('usage', [{ key: 'k', recordedAt: 'r', item: { date: '2026-09-02' } }]),
    ]).toEqual(['2026-09-02']);
    expect([
      ...entryDays('activities', [
        { key: 'a', recordedAt: 'r', item: { createdAt: '2026-09-02T23:00:00Z' } },
      ]),
    ]).toEqual(['2026-09-02']);
  });
});

describe('staleFinding', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  it('flags a missing or old collection only', () => {
    expect(staleFinding(null, now, 24)?.message).toBe('No collection is recorded');
    expect(staleFinding('2026-09-29T11:00:00Z', now, 24)?.message).toBe(
      'Last recorded collection 25.0h ago (max 24h)',
    );
    expect(staleFinding('2026-09-30T06:00:00Z', now, 24)).toBeNull();
  });
});

describe('digestFindings', () => {
  const manifest = (): LedgerManifest => ({
    ...buildLedgerManifest('2026-08', [], { sealed: true }),
    datasets: {
      usage: { kind: 'daily', count: 2, sha256: 'aa', window: null },
      cost: { kind: 'daily', count: 1, sha256: 'bb', window: null },
      members: { kind: 'state', count: 1, sha256: 'cc', window: null },
    },
    revisions: { usage: { count: 1, sha256: 'dd', lastRecordedAt: null } },
  });

  it('passes when every file matches', () => {
    const files = [
      { dataset: 'usage', sha256: 'aa', count: 2 },
      { dataset: 'cost', sha256: 'bb', count: 1 },
      { dataset: 'members', sha256: 'cc', count: 1 },
    ];
    expect(
      digestFindings(manifest(), files, [{ dataset: 'usage', sha256: 'dd', count: 1 }]),
    ).toEqual([]);
  });

  it('compares the stored hash of encrypted files (#162 U8)', () => {
    const encrypted = (): LedgerManifest => {
      const m = manifest();
      return {
        ...m,
        datasets: {
          usage: { ...m.datasets.usage!, encryptedSha256: 'e1' },
          cost: { ...m.datasets.cost!, encryptedSha256: 'e2' },
          members: m.datasets.members!,
        },
      };
    };
    const files = [
      { dataset: 'usage', sha256: 'aa', count: 2, encryptedSha256: 'e1' },
      { dataset: 'cost', sha256: 'bb', count: 1, encryptedSha256: 'zz' },
      { dataset: 'members', sha256: 'cc', count: 1, encryptedSha256: 'e3' },
    ];
    const revisions = [{ dataset: 'usage', sha256: 'dd', count: 1 }];
    expect(digestFindings(encrypted(), files, revisions).map((f) => f.message)).toEqual([
      '2026-08 cost: encrypted file hash differs from MANIFEST.json',
      '2026-08 members: stored encrypted, listed as a plain file',
    ]);
    const plainCost = [files[0]!, { dataset: 'cost', sha256: 'bb', count: 1 }, files[2]!];
    expect(digestFindings(encrypted(), plainCost, revisions).map((f) => f.message)).toContain(
      '2026-08 cost: stored as a plain file, listed as encrypted',
    );
  });

  it('reports changed, missing, miscounted and unlisted files', () => {
    const files = [
      { dataset: 'usage', sha256: 'xx', count: 2 },
      { dataset: 'members', sha256: 'cc', count: 2 },
      { dataset: 'adoption', sha256: 'ee', count: 3 },
    ];
    expect(digestFindings(manifest(), files, []).map((f) => f.message)).toEqual([
      '2026-08 usage: content hash differs from MANIFEST.json',
      '2026-08 cost: file missing',
      '2026-08 members: 2 entries, 1 listed',
      '2026-08 adoption: file not listed in MANIFEST.json',
      '2026-08 revisions/usage: file missing',
    ]);
  });
});

describe('failingDays', () => {
  it('counts UTC calendar days, both ends included', () => {
    expect(failingDays('2026-09-30T05:30:00Z', new Date('2026-09-30T23:00:00Z'))).toBe(1);
    expect(failingDays('2026-09-24T05:30:00Z', new Date('2026-09-30T05:30:00Z'))).toBe(7);
  });
});

describe('ledgerHealthOf', () => {
  it('is null for an empty ledger without a status', () => {
    expect(ledgerHealthOf(emptyLedgerStatus(), [])).toBeNull();
  });

  it('joins the manifests, the last verification and the seal attempts', () => {
    const status = {
      ...emptyLedgerStatus(),
      verify: {
        checkedAt: '2026-09-30T05:30:00Z',
        status: 'pass' as const,
        failingSince: null,
        findings: [],
        lastRecordedAt: '2026-09-30T00:00:00Z',
      },
      seals: {
        '2026-08': { attemptedAt: '2026-09-10T04:00:00Z', outcome: 'sealed' as const, reasons: [] },
      },
    };
    const sealed = {
      ...buildLedgerManifest('2026-08', [], {
        sealed: true,
        seal: { sealedAt: '2026-09-10T04:00:00Z', datasets: {} },
      }),
      revisions: { usage: { count: 2, sha256: 'x', lastRecordedAt: null } },
    };
    const health = ledgerHealthOf(status, [
      { month: '2026-08', manifest: sealed },
      { month: '2026-09', manifest: buildLedgerManifest('2026-09', []) },
    ]);
    expect(health).toEqual({
      verifiedAt: '2026-09-30T05:30:00Z',
      status: 'pass',
      failingSince: null,
      findings: [],
      lastRecordedAt: '2026-09-30T00:00:00Z',
      months: [
        {
          month: '2026-08',
          sealed: true,
          sealedAt: '2026-09-10T04:00:00Z',
          revisions: 2,
          lastSeal: { attemptedAt: '2026-09-10T04:00:00Z', outcome: 'sealed' },
        },
        { month: '2026-09', sealed: false, sealedAt: null, revisions: 0, lastSeal: null },
      ],
    });
  });
});

describe('buildLedgerManifest carry', () => {
  it('keeps the seal record and drops an empty revision list', () => {
    const seal = {
      sealedAt: '2026-09-10T04:00:00Z',
      datasets: { usage: { policy: 'compare' as const } },
    };
    const manifest = buildLedgerManifest('2026-08', [], { sealed: true, seal, revisions: {} });
    expect(manifest.seal).toEqual(seal);
    expect(manifest).not.toHaveProperty('revisions');
    expect(buildLedgerManifest('2026-08', [], true).sealed).toBe(true);
  });
});
