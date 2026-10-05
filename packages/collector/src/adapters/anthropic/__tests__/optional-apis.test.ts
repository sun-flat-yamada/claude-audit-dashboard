import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeApi } from '../claude-code-api.js';
import { ConsoleAdminApi } from '../console-admin-api.js';
import { ApiError, HttpClient } from '../http-client.js';
import { SchemaDriftError } from '../paginate.js';
import { loadCaptureEntries } from '../raw-capture.js';
import { replayFetch } from '../replay-fetch.js';
import { withOptionalFixtures } from '../../fixture/optional-fixture.js';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const range = { start: new Date('2026-08-31T00:00:00.000Z'), end: NOW };
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

const KEY = 'sk-ant-admin01-mock000000000000000000000000';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** Both gateways on the official-shape fixtures (paging included). */
async function onFixtures() {
  const base = replayFetch(await loadCaptureEntries(`${FIXTURES}tenant`));
  const replay = await withOptionalFixtures(base, FIXTURES);
  const http = new HttpClient({ apiKey: KEY, fetchImpl: replay.fetch, sleep: async () => {} });
  return { replay, console: new ConsoleAdminApi(http), claudeCode: new ClaudeCodeApi(http) };
}

/** A queue of canned responses; every request is recorded. */
function queued(responses: (Response | Error)[]) {
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error('no response queued');
    return next;
  }) as unknown as typeof fetch;
  const http = new HttpClient({ apiKey: KEY, fetchImpl, sleep });
  return { api: new ConsoleAdminApi(http), claudeCode: new ClaudeCodeApi(http), fetchImpl, sleep };
}

const urlOf = (fetchImpl: typeof fetch, call: number): URL =>
  new URL(String(vi.mocked(fetchImpl).mock.calls[call]?.[0]));

describe('ConsoleAdminApi on the official-shape fixtures', () => {
  it('lists workspaces across two ID-cursor pages, including archived ones', async () => {
    const { console: api, replay } = await onFixtures();
    const items = await api.listWorkspaces();
    expect(items.map((w) => w.id)).toEqual([
      'wrkspc_01DemoExampleProd00001',
      'wrkspc_01DemoExampleStag00002',
      'wrkspc_01DemoExampleSand00003',
    ]);
    expect(items[2]).toMatchObject({ name: 'Example Sandbox', archivedAt: '2026-08-30T09:00:00Z' });
    expect(items[0]?.archivedAt).toBeNull();
    const [first, second] = replay.calls;
    expect(first?.searchParams.get('include_archived')).toBe('true');
    expect(first?.searchParams.has('starting_after')).toBe(false);
    expect(second?.searchParams.get('after_id')).toBe('wrkspc_01DemoExampleStag00002');
  });

  it('maps the key inventory without the key hint and keeps null workspaces', async () => {
    const { console: api } = await onFixtures();
    const keys = await api.listApiKeys();
    expect(keys).toEqual([
      {
        id: 'apikey_01DemoExampleKey000001',
        name: 'production-backend',
        status: 'active',
        workspaceId: 'wrkspc_01DemoExampleProd00001',
        createdAt: '2025-08-13T09:00:00Z',
        createdBy: 'user_01DemoExampleOwner01',
      },
      {
        id: 'apikey_01DemoExampleKey000002',
        name: 'default-workspace-key',
        status: 'inactive',
        workspaceId: null,
        createdAt: '2025-07-01T09:00:00Z',
        createdBy: null,
      },
    ]);
    expect(JSON.stringify(keys)).not.toContain('partial_key_hint');
    expect(JSON.stringify(keys)).not.toContain('sk-ant');
  });

  it('reads the usage report page by page with workspace and model grouping', async () => {
    const { console: api, replay } = await onFixtures();
    const result = await api.usageReport(range, NOW);
    expect(result.items).toHaveLength(4);
    expect(result.items[0]).toEqual({
      date: '2026-09-28',
      workspaceId: 'wrkspc_01DemoExampleProd00001',
      model: 'claude-demo-large',
      uncachedInputTokens: 1_200_000,
      cacheReadInputTokens: 800_000,
      cacheCreationInputTokens: 50_000,
      outputTokens: 310_000,
      webSearchRequests: 4,
    });
    // A bucket without workspace is the default workspace (null), never dropped.
    expect(result.items[2]).toMatchObject({ date: '2026-09-29', workspaceId: null });
    expect(result.window).toEqual({ from: range.start.toISOString(), to: NOW.toISOString() });
    const usage = replay.calls.filter((u) => u.pathname.endsWith('/messages'));
    expect(usage).toHaveLength(2);
    expect(usage[0]?.searchParams.getAll('group_by[]')).toEqual(['workspace_id', 'model']);
    expect(usage[0]?.searchParams.get('bucket_width')).toBe('1d');
    expect(usage[0]?.searchParams.get('limit')).toBe('31');
    expect(usage[1]?.searchParams.get('page')).toBe('page_demo_usage_2');
  });

  it('converts cost amounts from cents to major units across pages', async () => {
    const { console: api } = await onFixtures();
    const { items } = await api.costReport(range, NOW);
    expect(items.map((r) => r.amount)).toEqual([42.105, 1.2625, 0.12, 38.9075]);
    expect(items[0]).toMatchObject({
      date: '2026-09-28',
      workspaceId: 'wrkspc_01DemoExampleProd00001',
      model: 'claude-demo-large',
      costType: 'tokens',
      currency: 'USD',
    });
    expect(items[2]).toMatchObject({ costType: 'web_search', model: null });
  });

  it('reads tolerantly: unknown fields are ignored, missing optional fields become null', async () => {
    const { api } = queued([
      json({
        data: [{ id: 'wrkspc_x', name: 'W', brand_new_field: { a: 1 } }],
        has_more: false,
        last_id: 'wrkspc_x',
      }),
    ]);
    await expect(api.listWorkspaces()).resolves.toEqual([
      { id: 'wrkspc_x', name: 'W', createdAt: null, archivedAt: null },
    ]);
  });

  it('raises schema drift when a required field is missing', async () => {
    const usage = queued([
      json({
        data: [{ starting_at: '2026-09-28T00:00:00Z', results: [{ output_tokens: 1 }] }],
        has_more: false,
        next_page: null,
      }),
    ]);
    await expect(usage.api.usageReport(range, NOW)).rejects.toBeInstanceOf(SchemaDriftError);
    const cost = queued([
      json({
        data: [{ starting_at: '2026-09-28T00:00:00Z', results: [{ amount: 12.5 }] }],
        has_more: false,
      }),
    ]);
    await expect(cost.api.costReport(range, NOW)).rejects.toBeInstanceOf(SchemaDriftError);
    const keys = queued([json({ items: [] })]);
    await expect(keys.api.listApiKeys()).rejects.toBeInstanceOf(SchemaDriftError);
  });
});

describe('ConsoleAdminApi HTTP behavior (fake fetch)', () => {
  it.each([401, 403, 404])(
    'surfaces %i as an ApiError the collector classifies',
    async (status) => {
      const { api } = queued([
        json({ error: { type: 'permission_error', message: 'no' } }, status),
      ]);
      await expect(api.listWorkspaces()).rejects.toMatchObject({ status });
      await expect(queued([json({}, status)]).api.listApiKeys()).rejects.toBeInstanceOf(ApiError);
    },
  );

  it('honors retry-after on 429 and then succeeds', async () => {
    const { api, sleep } = queued([
      json({}, 429, { 'retry-after': '7' }),
      json({ data: [], has_more: false }),
    ]);
    await expect(api.listApiKeys()).resolves.toEqual([]);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('retries 5xx with backoff and gives up with the API error', async () => {
    const { api, sleep, fetchImpl } = queued(
      Array.from({ length: 6 }, () => json({ error: { type: 'api_error', message: 'x' } }, 503)),
    );
    await expect(api.listWorkspaces()).rejects.toMatchObject({ status: 503 });
    expect(sleep).toHaveBeenCalledTimes(5);
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(6);
  });

  it('restarts a report once when the page token expired (410)', async () => {
    const page = { data: [], has_more: true, next_page: 'p2' };
    const { api, fetchImpl } = queued([
      json(page),
      json({}, 410),
      json({ data: [], has_more: false, next_page: null }),
    ]);
    await expect(api.costReport(range, NOW)).resolves.toMatchObject({ items: [] });
    expect(urlOf(fetchImpl, 2).searchParams.has('page')).toBe(false);
  });

  it('never sends a body or non-GET method and puts the key only in the x-api-key header', async () => {
    const { api, fetchImpl } = queued([json({ data: [], has_more: false })]);
    await api.listWorkspaces();
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(String(url)).not.toContain(KEY);
    expect(init.headers).toMatchObject({ 'x-api-key': KEY });
  });
});

describe('ClaudeCodeApi on the official-shape fixtures', () => {
  it('requests one series per day (oldest first) and follows next_page', async () => {
    const { claudeCode, replay } = await onFixtures();
    const result = await claudeCode.listActivity(1, NOW);
    const calls = replay.calls.filter((u) => u.pathname.endsWith('/claude_code'));
    expect(
      calls.map((u) => [u.searchParams.get('starting_at'), u.searchParams.get('page')]),
    ).toEqual([
      ['2026-09-29', null],
      ['2026-09-30', null],
      ['2026-09-30', 'page_demo_claude_code_2'],
    ]);
    expect(calls[0]?.searchParams.get('limit')).toBe('1000');
    expect(result.items).toHaveLength(4);
    expect(result.window).toEqual({
      from: '2026-09-29T00:00:00.000Z',
      to: NOW.toISOString(),
    });
  });

  it('maps core metrics, tool actions and the model breakdown (cents to major units)', async () => {
    const { claudeCode } = await onFixtures();
    const { items } = await claudeCode.listActivity(1, NOW);
    const alice = items.find((i) => i.date === '2026-09-30' && i.actor?.startsWith('alice'));
    expect(alice).toEqual({
      date: '2026-09-30',
      actorKind: 'user',
      actor: 'alice.engineer@example.com',
      customerType: 'subscription',
      terminalType: 'iTerm.app',
      sessions: 5,
      linesAdded: 240,
      linesRemoved: 70,
      commits: 3,
      pullRequests: 1,
      toolAccepted: 43,
      toolRejected: 7,
      models: [
        {
          model: 'claude-demo-large',
          inputTokens: 90_000,
          outputTokens: 22_000,
          cacheReadTokens: 310_000,
          cacheCreationTokens: 24_000,
          estimatedCost: 3.4,
        },
      ],
    });
    const bot = items.find((i) => i.actorKind === 'api');
    expect(bot).toMatchObject({ actor: 'ci-code-review-bot', terminalType: 'non-interactive' });
    expect(items.find((i) => i.actor?.startsWith('bob'))?.models).toHaveLength(2);
  });

  it('accepts a decimal-string cost and unknown actor types', async () => {
    const { claudeCode } = queued([
      json({
        data: [
          {
            date: '2026-09-30T00:00:00Z',
            actor: { type: 'service_actor' },
            core_metrics: {
              num_sessions: 1,
              commits_by_claude_code: 0,
              pull_requests_by_claude_code: 0,
            },
            model_breakdown: [{ model: 'm', estimated_cost: { amount: '250.5', currency: 'USD' } }],
            new_field: true,
          },
        ],
        has_more: false,
        next_page: null,
      }),
    ]);
    const { items } = await claudeCode.listActivity(0, NOW);
    expect(items[0]).toMatchObject({ actorKind: 'service_actor', actor: null, linesAdded: 0 });
    expect(items[0]?.models[0]).toMatchObject({ estimatedCost: 2.505, inputTokens: 0 });
  });

  it('raises schema drift on a response without the documented metrics', async () => {
    const { claudeCode } = queued([
      json({
        data: [{ date: '2026-09-30T00:00:00Z', actor: { type: 'user_actor' } }],
        has_more: false,
      }),
    ]);
    await expect(claudeCode.listActivity(0, NOW)).rejects.toBeInstanceOf(SchemaDriftError);
  });

  it.each([401, 403])('surfaces %i as an ApiError', async (status) => {
    const { claudeCode } = queued([
      json({ error: { type: 'authentication_error', message: 'x' } }, status),
    ]);
    await expect(claudeCode.listActivity(0, NOW)).rejects.toMatchObject({ status });
  });
});
