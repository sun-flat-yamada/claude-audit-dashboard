import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { NOW, snapshot } from '../../../__tests__/fixtures.js';
import { defineRule } from '../define-rule.js';
import { evaluateCompliance } from '../engine.js';
import { complianceScore, formatScore } from '../scoring.js';
import { fail, pass } from '../types.js';

const meta = (id: string, severity: 'critical' | 'high' | 'medium' | 'low' = 'high') => ({
  id,
  name: id,
  category: 'operational' as const,
  severity,
  description: '',
  remediation: 'fix it',
});

const needsMembers = defineRule({
  meta: meta('T-001'),
  requires: ['members'],
  params: z.object({ limit: z.number().int().default(1) }),
  evaluate: ({ data, params }) =>
    data.members.length > params.limit ? fail('too many') : pass('ok'),
});

const throws = defineRule({
  meta: meta('T-002'),
  requires: [],
  params: z.object({}),
  evaluate: () => {
    throw new Error('boom');
  },
});

describe('evaluateCompliance', () => {
  it('skips a rule whose required dataset was not collected, with the reason', () => {
    const report = evaluateCompliance(
      [needsMembers],
      snapshot({}, { members: { status: 'unavailable', reason: '403 missing read:members' } }),
      { now: NOW },
    );
    expect(report.results[0]).toMatchObject({
      status: 'skipped',
      message: expect.stringContaining('403 missing read:members'),
    });
    expect(report.summary.score).toBe(100);
  });

  it('applies parameter defaults and overrides, and rejects invalid parameters', () => {
    const snap = snapshot({
      members: [
        {
          id: 'a',
          email: 'a@example.com',
          name: 'a',
          role: 'user',
          organizationId: null,
          joinedAt: null,
        },
        {
          id: 'b',
          email: 'b@example.com',
          name: 'b',
          role: 'user',
          organizationId: null,
          joinedAt: null,
        },
      ],
    });
    expect(evaluateCompliance([needsMembers], snap, { now: NOW }).results[0]?.status).toBe('fail');
    expect(
      evaluateCompliance([needsMembers], snap, { now: NOW, params: { 'T-001': { limit: 5 } } })
        .results[0]?.status,
    ).toBe('pass');
    const invalid = evaluateCompliance([needsMembers], snap, {
      now: NOW,
      params: { 'T-001': { limit: 'x' } },
    });
    expect(invalid.results[0]).toMatchObject({
      status: 'error',
      message: expect.stringContaining('Invalid params'),
    });
  });

  it('isolates a throwing rule and honours disabled rules', () => {
    const report = evaluateCompliance([throws, needsMembers], snapshot(), {
      now: NOW,
      disabled: ['T-001'],
    });
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      ruleId: 'T-002',
      status: 'error',
      message: 'Rule failed: boom',
    });
  });

  it('adds remediation only to failing and warning results and summarises by category', () => {
    const report = evaluateCompliance([needsMembers], snapshot({ members: [] }), { now: NOW });
    expect(report.results[0]?.remediation).toBeNull();
    expect(report.summary.byCategory.operational).toEqual({ total: 1, failed: 0 });
    expect(report.id).toBe('compliance-snap-1');
  });
});

describe('complianceScore', () => {
  it('subtracts severity weights of failed checks only', () => {
    const result = (severity: 'critical' | 'low', status: 'fail' | 'warning') => ({
      ruleId: 'x',
      ruleName: 'x',
      category: 'operational' as const,
      severity,
      status,
      message: '',
      evidence: [],
      details: {},
      remediation: null,
    });
    expect(
      complianceScore([
        result('critical', 'fail'),
        result('low', 'fail'),
        result('critical', 'warning'),
      ]),
    ).toBe(89);
    expect(complianceScore(Array.from({ length: 20 }, () => result('critical', 'fail')))).toBe(0);
  });
});

describe('formatScore', () => {
  it('shows coverage whenever rules were skipped or errored', () => {
    expect(formatScore({ score: 82, total: 30, skipped: 0, errors: 0 })).toBe('82/100');
    expect(formatScore({ score: 95, total: 30, skipped: 27, errors: 1 })).toBe(
      '95/100 (2 of 30 rules assessed)',
    );
  });
});
