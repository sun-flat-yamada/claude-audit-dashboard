import type {
  CollectResult,
  ConsoleApiKey,
  ConsoleCostRow,
  ConsoleUsageRow,
  ConsoleWorkspace,
  DateRange,
} from '@claude-audit/core';
import { MINOR_AMOUNT, earlierOf, minorToMajor } from '@claude-audit/core';
import { z } from 'zod';
import type { HttpClient, Query } from './http-client.js';
import { collectIdPages, collectTokenPages, idPage, parseResponse, tokenPage } from './paginate.js';

const PATHS = {
  workspaces: '/v1/organizations/workspaces',
  apiKeys: '/v1/organizations/api_keys',
  usage: '/v1/organizations/usage_report/messages',
  cost: '/v1/organizations/cost_report',
};

const workspaceSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  created_at: z.string().nullish(),
  archived_at: z.string().nullish(),
});

const apiKeySchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  workspace_id: z.string().nullish(),
  created_at: z.string().nullish(),
  created_by: z.looseObject({ id: z.string().nullish() }).nullish(),
});

const usageResultSchema = z.looseObject({
  uncached_input_tokens: z.number(),
  cache_read_input_tokens: z.number().default(0),
  cache_creation: z
    .looseObject({
      ephemeral_1h_input_tokens: z.number().default(0),
      ephemeral_5m_input_tokens: z.number().default(0),
    })
    .nullish(),
  output_tokens: z.number(),
  server_tool_use: z.looseObject({ web_search_requests: z.number().default(0) }).nullish(),
  workspace_id: z.string().nullish(),
  model: z.string().nullish(),
});

const costResultSchema = z.looseObject({
  amount: z.string().regex(MINOR_AMOUNT),
  currency: z.string().default('USD'),
  workspace_id: z.string().nullish(),
  model: z.string().nullish(),
  cost_type: z.string().nullish(),
});

const bucketPage = <T extends z.ZodType>(result: T) =>
  tokenPage(z.looseObject({ starting_at: z.string(), results: z.array(result) }));

/** Admin API list endpoints accept up to 1000 items; reports at most 31 daily buckets per page. */
const LIST_LIMIT = 1000;
const BUCKET_LIMIT = 31;

/**
 * Admin API of a linked Claude Console organization (Admin API key `sk-ant-admin...`, in
 * `ANTHROPIC_CONSOLE_ADMIN_API_KEY`): workspaces, API key inventory, Usage and Cost reports.
 * Read-only. Not available to Claude Enterprise keys (docs/API-MAPPING.md section 6).
 */
export class ConsoleAdminApi {
  constructor(private readonly http: HttpClient) {}

  async listWorkspaces(): Promise<ConsoleWorkspace[]> {
    const rows = await collectIdPages(async (afterId) =>
      parseResponse(
        idPage(workspaceSchema),
        await this.http.getJson(PATHS.workspaces, {
          include_archived: true,
          limit: LIST_LIMIT,
          after_id: afterId,
        }),
        PATHS.workspaces,
      ),
    );
    return rows.map((w) => ({
      id: w.id,
      name: w.name,
      createdAt: w.created_at ?? null,
      archivedAt: w.archived_at ?? null,
    }));
  }

  async listApiKeys(): Promise<ConsoleApiKey[]> {
    const rows = await collectIdPages(async (afterId) =>
      parseResponse(
        idPage(apiKeySchema),
        await this.http.getJson(PATHS.apiKeys, { limit: LIST_LIMIT, after_id: afterId }),
        PATHS.apiKeys,
      ),
    );
    return rows.map((k) => ({
      id: k.id,
      name: k.name,
      status: k.status,
      workspaceId: k.workspace_id ?? null,
      createdAt: k.created_at ?? null,
      createdBy: k.created_by?.id ?? null,
    }));
  }

  /** Daily buckets of one report, flattened to `{ date, record }` rows. */
  private async buckets<T extends z.ZodType>(
    path: string,
    result: T,
    range: DateRange,
    now: Date,
    groupBy: readonly string[],
  ) {
    const buckets = await collectTokenPages(async (page) => {
      const query: Query = {
        starting_at: range.start.toISOString(),
        ending_at: earlierOf(range.end, now).toISOString(),
        bucket_width: '1d',
        limit: BUCKET_LIMIT,
        group_by: groupBy,
        page,
      };
      return parseResponse(bucketPage(result), await this.http.getJson(path, query), path);
    });
    return buckets.flatMap((b) =>
      b.results.map((raw) => ({ date: b.starting_at.slice(0, 10), raw: raw as z.output<T> })),
    );
  }

  async usageReport(range: DateRange, now: Date): Promise<CollectResult<ConsoleUsageRow[]>> {
    const rows = await this.buckets(PATHS.usage, usageResultSchema, range, now, [
      'workspace_id',
      'model',
    ]);
    return {
      items: rows.map(({ date, raw }) => ({
        date,
        workspaceId: raw.workspace_id ?? null,
        model: raw.model ?? null,
        uncachedInputTokens: raw.uncached_input_tokens,
        cacheReadInputTokens: raw.cache_read_input_tokens,
        cacheCreationInputTokens:
          (raw.cache_creation?.ephemeral_1h_input_tokens ?? 0) +
          (raw.cache_creation?.ephemeral_5m_input_tokens ?? 0),
        outputTokens: raw.output_tokens,
        webSearchRequests: raw.server_tool_use?.web_search_requests ?? 0,
      })),
      window: { from: range.start.toISOString(), to: range.end.toISOString() },
    };
  }

  async costReport(range: DateRange, now: Date): Promise<CollectResult<ConsoleCostRow[]>> {
    const rows = await this.buckets(PATHS.cost, costResultSchema, range, now, [
      'workspace_id',
      'description',
    ]);
    return {
      items: rows.map(({ date, raw }) => ({
        date,
        workspaceId: raw.workspace_id ?? null,
        model: raw.model ?? null,
        costType: raw.cost_type ?? null,
        amount: minorToMajor(raw.amount),
        currency: raw.currency,
      })),
      window: { from: range.start.toISOString(), to: range.end.toISOString() },
    };
  }
}
