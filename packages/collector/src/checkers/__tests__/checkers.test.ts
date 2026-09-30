import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIT_RULES,
  type AuditSnapshot,
  type ComplianceRulePlugin,
} from '@claude-audit/shared';
import { PluginRegistry } from '../../plugins/registry.js';
import { calculateScore, createBuiltinRegistry, runComplianceChecks } from '../index.js';

const NOW = '2026-09-30T00:00:00.000Z';
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

function snapshot(overrides: Partial<AuditSnapshot> = {}): AuditSnapshot {
  return {
    collected_at: NOW,
    collection_id: 'c1',
    organization_id: 'org1',
    activities: [],
    members: [
      {
        id: 'u1',
        email: 'a@example.com',
        name: 'A',
        role: 'primary_owner',
        created_at: daysAgo(400),
        last_active_at: daysAgo(1),
      },
      {
        id: 'u2',
        email: 'b@example.com',
        name: 'B',
        role: 'user',
        created_at: daysAgo(400),
        last_active_at: daysAgo(2),
      },
      {
        id: 'u3',
        email: 'c@example.com',
        name: 'C',
        role: 'user',
        created_at: daysAgo(400),
        last_active_at: daysAgo(3),
      },
      {
        id: 'u4',
        email: 'd@example.com',
        name: 'D',
        role: 'user',
        created_at: daysAgo(400),
        last_active_at: daysAgo(3),
      },
      {
        id: 'u5',
        email: 'e@example.com',
        name: 'E',
        role: 'user',
        created_at: daysAgo(400),
        last_active_at: daysAgo(3),
      },
    ],
    workspaces: [
      { id: 'w1', name: 'Eng', created_at: daysAgo(100), archived_at: null, member_count: 3 },
    ],
    api_keys: [
      {
        id: 'k1',
        name: 'ci',
        type: 'api',
        status: 'active',
        created_at: daysAgo(10),
        last_used_at: daysAgo(1),
        created_by: { id: 'u1', name: null },
        workspace_id: 'w1',
        scopes: [],
      },
    ],
    usage: null,
    metadata: {
      collector_version: '0.1.0',
      duration_ms: 1,
      activity_count: 0,
      sync_type: 'full',
      last_activity_id: null,
    },
    ...overrides,
  };
}

const params = { now: NOW };
const run = async (id: string, snap: AuditSnapshot, extra: Record<string, unknown> = {}) => {
  const rule = createBuiltinRegistry().get(id)!;
  return (await rule.check(snap, { ...rule.defaultParams, ...params, ...extra }))[0]!;
};

describe('builtin registry', () => {
  it('registers exactly the rules defined in shared DEFAULT_AUDIT_RULES', () => {
    expect(
      createBuiltinRegistry()
        .list()
        .map((r) => r.id)
        .sort(),
    ).toEqual(DEFAULT_AUDIT_RULES.map((r) => r.id).sort());
  });

  it('matches shared defaults for params, category and severity', () => {
    const registry = createBuiltinRegistry();
    for (const def of DEFAULT_AUDIT_RULES) {
      const plugin = registry.get(def.id)!;
      expect(plugin.category).toBe(def.category);
      expect(plugin.severity).toBe(def.severity);
      expect(plugin.defaultParams).toMatchObject(def.params);
    }
  });
});

describe('rules', () => {
  it('AC-001 flags inactive members', async () => {
    expect((await run('AC-001', snapshot())).status).toBe('pass');
    const s = snapshot();
    s.members[1]!.last_active_at = daysAgo(120);
    expect((await run('AC-001', s)).status).toBe('fail');
  });

  it('AC-002 flags admin ratio > 20%', async () => {
    const s = snapshot();
    s.members[1]!.role = 'admin';
    s.members[2]!.role = 'admin';
    expect((await run('AC-002', s)).status).toBe('fail');
    expect((await run('AC-002', snapshot())).status).toBe('pass');
  });

  it('AC-003 requires exactly one primary owner', async () => {
    expect((await run('AC-003', snapshot())).status).toBe('pass');
    const s = snapshot();
    s.members[1]!.role = 'primary_owner';
    expect((await run('AC-003', s)).status).toBe('fail');
  });

  it('AK-001/002/003 detect unused, unscoped and old keys', async () => {
    const s = snapshot();
    s.api_keys[0]!.last_used_at = daysAgo(45);
    s.api_keys[0]!.workspace_id = null;
    s.api_keys[0]!.created_at = daysAgo(200);
    expect((await run('AK-001', s)).status).toBe('fail');
    expect((await run('AK-002', s)).status).toBe('fail');
    expect((await run('AK-003', s)).status).toBe('fail');
    expect((await run('AK-001', snapshot())).status).toBe('pass');
  });

  it('AK rules ignore disabled keys', async () => {
    const s = snapshot();
    s.api_keys[0]!.status = 'disabled';
    s.api_keys[0]!.workspace_id = null;
    expect((await run('AK-002', s)).status).toBe('pass');
  });

  it('UA-001 detects spike and skips without history', async () => {
    const usage = {
      period_start: '',
      period_end: '',
      total_input_tokens: 900,
      total_output_tokens: 100,
      total_cost_usd: 1,
      by_workspace: [],
      by_model: [],
    };
    const s = snapshot({ usage });
    expect((await run('UA-001', s)).status).toBe('skipped');
    expect((await run('UA-001', s, { baselineTokens: [100, 100, 100] })).status).toBe('fail');
    expect((await run('UA-001', s, { baselineTokens: [900, 1000] })).status).toBe('pass');
  });

  it('UA-002 compares cost with budget', async () => {
    const usage = {
      period_start: '',
      period_end: '',
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 12000,
      by_workspace: [],
      by_model: [],
    };
    expect((await run('UA-002', snapshot({ usage }))).status).toBe('fail');
    expect((await run('UA-002', snapshot({ usage }), { monthlyBudgetUsd: 20000 })).status).toBe(
      'pass',
    );
    expect((await run('UA-002', snapshot())).status).toBe('skipped');
  });

  it('DG-001 detects empty workspaces', async () => {
    const s = snapshot();
    s.workspaces.push({
      id: 'w2',
      name: 'Empty',
      created_at: daysAgo(1),
      archived_at: null,
      member_count: 0,
    });
    expect((await run('DG-001', s)).status).toBe('fail');
    expect((await run('DG-001', snapshot())).status).toBe('pass');
  });

  it('OP-001 detects stale collection', async () => {
    expect((await run('OP-001', snapshot())).status).toBe('pass');
    expect((await run('OP-001', snapshot({ collected_at: daysAgo(2) }))).status).toBe('fail');
  });
});

describe('runComplianceChecks', () => {
  it('scores by severity weight and summarises', async () => {
    const s = snapshot();
    s.members[1]!.role = 'primary_owner'; // AC-003 critical
    const report = await runComplianceChecks(s, createBuiltinRegistry(), {
      params: Object.fromEntries(DEFAULT_AUDIT_RULES.map((r) => [r.id, { now: NOW }])),
    });
    expect(report.summary.by_severity.critical).toBe(1);
    expect(report.summary.compliance_score).toBe(calculateScore(report.results));
    expect(report.summary.total_checks).toBe(report.results.length);
  });

  it('honours disabled rules and converts throws to error results', async () => {
    const registry = createBuiltinRegistry();
    const report = await runComplianceChecks(snapshot(), registry, {
      disabled: DEFAULT_AUDIT_RULES.map((r) => r.id).filter((id) => id !== 'AC-003'),
    });
    expect(report.results).toHaveLength(1);
    const bad = createBuiltinRegistry().get('AC-003')!;
    const broken = new PluginRegistry<ComplianceRulePlugin>().register({
      ...bad,
      check: async () => {
        throw new Error('boom');
      },
    });
    const errReport = await runComplianceChecks(snapshot(), broken);
    expect(errReport.results[0]!.status).toBe('error');
  });
});
