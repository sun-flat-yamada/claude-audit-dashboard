import { describe, expect, it } from 'vitest';
import { NOW, activity, member } from '../../__tests__/fixtures.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import { credentialUsageProjection } from '../../domain/projections/credential-usage.js';
import {
  DataUnavailableError,
  type DatasetCollector,
  type SnapshotRepository,
  type StateRepository,
} from '../ports.js';
import { initialState, parseState, type CollectorState } from '../state.js';
import { collectSnapshot } from '../use-cases/collect-snapshot.js';

function memoryRepos(state: CollectorState = initialState()) {
  const saved: AuditSnapshot[] = [];
  let current = state;
  const snapshots: SnapshotRepository = {
    save: async (s) => void saved.push(s),
    latest: async () => saved.at(-1) ?? null,
    since: async () => saved,
  };
  const stateRepo: StateRepository = {
    load: async () => current,
    save: async (s) => void (current = s),
  };
  return { saved, snapshots, stateRepo, state: () => current };
}

const clock = { now: () => NOW };

describe('collectSnapshot', () => {
  it('isolates failing collectors and records why each dataset is missing', async () => {
    const repos = memoryRepos();
    const collectors: DatasetCollector[] = [
      {
        dataset: 'members',
        source: 'members-api',
        collect: async () => ({ items: [member('u1')] }),
      },
      {
        dataset: 'invites',
        source: 'invites-api',
        collect: async () => {
          throw new DataUnavailableError('403 missing read:members');
        },
      },
      {
        dataset: 'usage',
        source: 'usage-api',
        collect: async () => {
          throw new Error('socket hang up');
        },
      },
    ];
    const snap = await collectSnapshot({
      collectors,
      projections: [],
      snapshots: repos.snapshots,
      state: repos.stateRepo,
      clock,
    });
    expect(snap.id).toBe('2026-09-30T12-00-00Z');
    expect(snap.coverage.members).toMatchObject({ status: 'ok', count: 1, source: 'members-api' });
    expect(snap.coverage.invites).toMatchObject({
      status: 'unavailable',
      reason: '403 missing read:members',
    });
    expect(snap.coverage.usage).toMatchObject({ status: 'error', reason: 'socket hang up' });
    expect(snap.data.invites).toBeUndefined();
    expect(repos.saved).toHaveLength(1);
    expect(repos.state().collections).toEqual({ count: 1, lastAt: NOW.toISOString() });
  });

  it('hands each collector its previous cursor and keeps it when the collector fails', async () => {
    const repos = memoryRepos({
      ...initialState(),
      cursors: { activities: { position: 1 }, members: { keep: true } },
    });
    const seen: unknown[] = [];
    const collectors: DatasetCollector[] = [
      {
        dataset: 'activities',
        source: 'feed',
        collect: async (ctx) => {
          seen.push(ctx.cursor);
          return { items: [], cursor: { position: 2 } };
        },
      },
      {
        dataset: 'members',
        source: 'members-api',
        collect: async () => {
          throw new Error('down');
        },
      },
    ];
    await collectSnapshot({
      collectors,
      projections: [],
      snapshots: repos.snapshots,
      state: repos.stateRepo,
      clock,
    });
    expect(seen).toEqual([{ position: 1 }]);
    expect(repos.state().cursors).toEqual({ activities: { position: 2 }, members: { keep: true } });
  });

  it('derives projections from collected data and persists their state', async () => {
    const repos = memoryRepos();
    const apiCall = activity('a1', {
      actor: { kind: 'api_actor', id: 'key-1', email: null, ip: null },
    });
    const collectors: DatasetCollector[] = [
      { dataset: 'activities', source: 'feed', collect: async () => ({ items: [apiCall] }) },
    ];
    const snap = await collectSnapshot({
      collectors,
      projections: [credentialUsageProjection],
      snapshots: repos.snapshots,
      state: repos.stateRepo,
      clock,
    });
    expect(snap.data.credentialUsage).toEqual([
      { credentialId: 'key-1', lastSeenAt: apiCall.createdAt },
    ]);
    expect(snap.coverage.credentialUsage).toMatchObject({
      status: 'ok',
      source: 'projection:credentialUsage',
    });
    expect(repos.state().projections.credentialUsage).toBeDefined();
  });

  it('marks projections unavailable when their inputs are missing', async () => {
    const repos = memoryRepos();
    const snap = await collectSnapshot({
      collectors: [],
      projections: [credentialUsageProjection],
      snapshots: repos.snapshots,
      state: repos.stateRepo,
      clock,
    });
    expect(snap.coverage.credentialUsage).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('activities was not collected'),
    });
  });

  it('parses persisted state and starts over from unknown versions', () => {
    expect(parseState({ last_activity_id: 'x' })).toEqual(initialState());
    const state = { ...initialState(), collections: { count: 3, lastAt: null } };
    expect(parseState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
});
