import { describe, expect, it, vi } from 'vitest';
import { NOW, activity, costRow, dayString, snapshot, usageRow } from '../../__tests__/fixtures.js';
import { dashboardViewSchema } from '../../contracts/dashboard-view.js';
import { buildRuleCatalog } from '../../domain/compliance/catalog.js';
import { evaluateCompliance } from '../../domain/compliance/engine.js';
import type { ComplianceReport } from '../../domain/compliance/types.js';
import { buildDashboardView } from '../presenters/dashboard-view.js';
import type { Notifier } from '../ports.js';
import {
  dispatchAlert,
  documentAlert,
  planComplianceAlert,
  pruneLastSent,
} from '../use-cases/alerts.js';
import {
  complianceReportDefinition,
  monthlyReportDefinition,
  weeklyReportDefinition,
} from '../use-cases/reports.js';

const snap = snapshot({
  members: [
    {
      id: 'u1',
      email: 'jane.doe@example.com',
      name: 'Jane',
      role: 'primary_owner',
      organizationId: null,
      joinedAt: null,
    },
    {
      id: 'u2',
      email: 'john.roe@example.com',
      name: 'John',
      role: 'owner',
      organizationId: null,
      joinedAt: null,
    },
  ],
  activities: [
    activity('a1', {
      type: 'org_sso_toggled',
      actor: { kind: 'user_actor', id: 'u1', email: 'jane.doe@example.com', ip: null },
    }),
  ],
  cost: [
    costRow(dayString(1), 100),
    costRow(dayString(1), 60, { dimension: 'model', key: 'claude-opus-5' }),
    costRow(dayString(1), 40, { dimension: 'model', key: 'claude-sonnet-5' }),
  ],
  usage: [usageRow(dayString(1), 1000, { outputTokens: 50 })],
});
const report: ComplianceReport = evaluateCompliance(buildRuleCatalog().rules, snap, { now: NOW });
const policy = {
  statuses: ['fail', 'warning'] as const,
  minSeverity: 'high' as const,
  cooldownMinutes: 60,
};

describe('alert policy', () => {
  it('selects findings by status and severity and sorts the most severe first', () => {
    const alert = planComplianceAlert(
      report,
      { ...policy, statuses: [...policy.statuses] },
      {},
      NOW,
    );
    expect(alert?.lines.every((line) => /^\[(CRITICAL|HIGH)\]/.test(line))).toBe(true);
    expect(alert?.lines.some((line) => line.includes('AM-002'))).toBe(true);
    expect(alert?.title).toContain(`score ${report.summary.score}/100`);
  });

  it('suppresses an identical digest inside the cooldown and prunes old entries', () => {
    const first = planComplianceAlert(
      report,
      { ...policy, statuses: [...policy.statuses] },
      {},
      NOW,
    );
    const lastSent = { [first!.key]: NOW.toISOString(), stale: '2026-01-01T00:00:00Z' };
    expect(
      planComplianceAlert(report, { ...policy, statuses: [...policy.statuses] }, lastSent, NOW),
    ).toBeNull();
    expect(Object.keys(pruneLastSent(lastSent, NOW, 60))).toEqual([first!.key]);
  });

  it('delivers to every notifier even when one fails', async () => {
    const ok: Notifier = { id: 'ok', send: vi.fn(async () => {}) };
    const broken: Notifier = {
      id: 'broken',
      send: async () => {
        throw new Error('webhook 500');
      },
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const result = await dispatchAlert(
      documentAlert(complianceReportDefinition.build(ctx())),
      [broken, ok],
      logger,
    );
    expect(result).toEqual({ delivered: ['ok'], failed: ['broken'] });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('webhook 500'));
  });
});

function ctx() {
  return {
    now: NOW,
    period: weeklyReportDefinition.period(NOW),
    snapshot: snap,
    snapshots: [snap],
    compliance: report,
    complianceHistory: [report],
    insights: [],
  };
}

describe('report definitions', () => {
  it('build format-neutral documents', () => {
    const weekly = weeklyReportDefinition.build(ctx());
    expect(weekly.id).toBe('weekly-2026-09-30');
    expect(weekly.sections.map((s) => s.title)).toContain('Top activity types');
    const month = { ...ctx(), period: monthlyReportDefinition.period(NOW, '2026-09') };
    const monthly = monthlyReportDefinition.build(month);
    expect(monthly.id).toBe('monthly-2026-09');
    const byModel = monthly.sections.find((s) => s.title === 'Cost by model');
    expect(byModel).toMatchObject({
      type: 'table',
      rows: [
        ['claude-opus-5', '$60.00', '60.0%'],
        ['claude-sonnet-5', '$40.00', '40.0%'],
      ],
    });
    expect(
      monthlyReportDefinition.period(new Date('2026-10-01T03:00:00Z')).start.toISOString(),
    ).toBe('2026-09-01T00:00:00.000Z');
    expect(() => complianceReportDefinition.build({ ...ctx(), compliance: null })).toThrow(/check/);
  });
});

describe('dashboard view', () => {
  it('matches the published contract and masks e-mail addresses', () => {
    const view = buildDashboardView({
      now: NOW,
      title: 'Audit',
      source: 'demo',
      maskPii: true,
      snapshot: snap,
      report,
      history: [],
      insights: [],
    });
    expect(dashboardViewSchema.parse(view)).toEqual(view);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('jane.doe@example.com');
    expect(view.activity?.notable[0]).toMatchObject({
      ruleId: 'AM-002',
      actor: 'j***@example.com',
    });
    expect(view.usage?.byModel.map((s) => s.percent)).toEqual([60, 40]);
    expect(view.kpis.find((k) => k.id === 'members')?.value).toBe(2);
  });

  it('keeps sections empty rather than inventing data when datasets are missing', () => {
    const view = buildDashboardView({
      now: NOW,
      title: 'Audit',
      source: 'live',
      maskPii: false,
      snapshot: null,
      report: null,
      history: [],
      insights: [],
    });
    expect(view).toMatchObject({ usage: null, adoption: null, activity: null, coverage: [] });
    expect(view.kpis.every((k) => k.value === null)).toBe(true);
  });
});
