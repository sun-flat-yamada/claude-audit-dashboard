import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditActivity, AuditSnapshot } from '@claude-audit/shared';
import { checkLatestSnapshot } from '../../commands/compliance-check.js';
import { loadConfig } from '../../config.js';
import { FileStore } from '../../storage/file-store.js';
import { StateManager } from '../../storage/state-manager.js';
import { collectActivities } from '../audit-collector.js';
import { collectSnapshot, snapshotFileName } from '../snapshot.js';

const activity = (id: string): AuditActivity => ({
  id,
  type: 'api_key.created',
  category: 'access',
  actor: { type: 'user', id: 'u1', name: null, email: null },
  target: null,
  details: {},
  timestamp: '2026-09-29T00:00:00Z',
  organization_id: 'org1',
  workspace_id: null,
});

const org = {
  listMembers: async () => [
    {
      id: 'u1',
      email: 'a@example.com',
      name: 'A',
      role: 'primary_owner' as const,
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    },
  ],
  listWorkspaces: async () => [],
  listApiKeys: async () => [],
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'collect-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('collectActivities', () => {
  it('does a full sync without cursor and advances the cursor to the last id', async () => {
    const calls: (string | undefined)[] = [];
    const source = {
      listActivities: async (after?: string) => (
        calls.push(after),
        [activity('a1'), activity('a2')]
      ),
    };
    const result = await collectActivities(source, null);
    expect(result).toMatchObject({ sync_type: 'full', last_activity_id: 'a2' });
    expect(calls).toEqual([undefined]);
  });

  it('is incremental with a cursor and keeps it when nothing is new', async () => {
    const source = { listActivities: async () => [] };
    expect(await collectActivities(source, 'a2')).toMatchObject({
      sync_type: 'incremental',
      last_activity_id: 'a2',
      activities: [],
    });
  });

  it('returns an empty result without a source', async () => {
    expect(await collectActivities(null, 'x')).toMatchObject({
      activities: [],
      last_activity_id: 'x',
    });
  });
});

describe('collectSnapshot', () => {
  it('stores the snapshot, advances state and feeds the next incremental run', async () => {
    const store = new FileStore(dir);
    const state = new StateManager(store);
    const seen: (string | undefined)[] = [];
    const activities = {
      listActivities: async (after?: string) => (seen.push(after), after ? [] : [activity('a1')]),
    };

    const first = await collectSnapshot({ org, activities, store, state });
    expect(first.organization_id).toBe('org1');
    expect(await store.listJson('snapshots')).toEqual([snapshotFileName(first.collected_at)]);
    expect(await state.load()).toMatchObject({ last_activity_id: 'a1', collection_count: 1 });

    await collectSnapshot({ org, activities, store, state, organizationId: 'org9' });
    expect(seen).toEqual([undefined, 'a1']);
    expect(await state.load()).toMatchObject({ last_activity_id: 'a1', collection_count: 2 });
  });

  it('stores month-to-date usage in the snapshot when a usage source is given', async () => {
    const store = new FileStore(dir);
    const snap = await collectSnapshot({
      org,
      activities: null,
      usage: {
        listUsage: async () => [],
        listCost: async () => [
          {
            starting_at: '',
            ending_at: '',
            results: [{ workspace_id: null, model: null, amount: '1234', currency: 'USD' }],
          },
        ],
      },
      store,
      state: new StateManager(store),
    });
    expect(snap.usage?.total_cost_usd).toBeCloseTo(12.34);
  });

  it('does not advance state when collection fails', async () => {
    const store = new FileStore(dir);
    const state = new StateManager(store);
    const broken = {
      ...org,
      listWorkspaces: async () => {
        throw new Error('api down');
      },
    };
    await expect(collectSnapshot({ org: broken, activities: null, store, state })).rejects.toThrow(
      'api down',
    );
    expect(await state.load()).toMatchObject({ collection_count: 0 });
    expect(await store.listJson('snapshots')).toEqual([]);
  });
});

describe('checkLatestSnapshot', () => {
  it('reports on the newest snapshot and stores the report', async () => {
    const store = new FileStore(dir);
    await collectSnapshot({ org, activities: null, store, state: new StateManager(store) });
    const report = await checkLatestSnapshot(store);
    expect(report.summary.total_checks).toBeGreaterThan(0);
    const [name] = await store.listJson('reports');
    expect(await store.readJson<AuditSnapshot>(`reports/${name}`)).not.toBeNull();
  });

  it('fails clearly when nothing was collected', async () => {
    await expect(checkLatestSnapshot(new FileStore(dir))).rejects.toThrow(/collect-audit/);
  });
});

describe('loadConfig', () => {
  it('requires the admin key and defaults the data dir', () => {
    expect(() => loadConfig({})).toThrow(/ANTHROPIC_ADMIN_API_KEY/);
    expect(loadConfig({ ANTHROPIC_ADMIN_API_KEY: 'k' })).toMatchObject({
      dataDir: 'data',
      complianceApiKey: undefined,
    });
  });
});
