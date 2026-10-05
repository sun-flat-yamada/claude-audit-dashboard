import type { ClaudeCodeActivity, ClaudeCodeModelUsage, CollectResult } from '@claude-audit/core';
import { MINOR_AMOUNT, addDays, minorToMajor, startOfUtcDay, toIsoDate } from '@claude-audit/core';
import { z } from 'zod';
import type { HttpClient } from './http-client.js';
import { collectTokenPages, parseResponse, tokenPage } from './paginate.js';

const PATH = '/v1/organizations/usage_report/claude_code';

/** Documented as a number of cents; a decimal string is accepted as well (tolerant read). */
const cents = z.union([z.number(), z.string().regex(MINOR_AMOUNT)]);

const count = z.number().default(0);

const modelSchema = z.looseObject({
  model: z.string(),
  tokens: z
    .looseObject({
      input: count,
      output: count,
      cache_read: count,
      cache_creation: count,
    })
    .nullish(),
  estimated_cost: z.looseObject({ amount: cents, currency: z.string().nullish() }).nullish(),
});

const rowSchema = z.looseObject({
  date: z.string(),
  actor: z.looseObject({
    type: z.string(),
    email_address: z.string().nullish(),
    api_key_name: z.string().nullish(),
  }),
  customer_type: z.string().nullish(),
  terminal_type: z.string().nullish(),
  core_metrics: z.looseObject({
    num_sessions: count,
    lines_of_code: z.looseObject({ added: count, removed: count }).nullish(),
    commits_by_claude_code: count,
    pull_requests_by_claude_code: count,
  }),
  tool_actions: z.record(z.string(), z.looseObject({ accepted: count, rejected: count })).nullish(),
  model_breakdown: z.array(modelSchema).nullish(),
});

type Row = z.output<typeof rowSchema>;

const ACTOR_KIND: Readonly<Record<string, string>> = { user_actor: 'user', api_actor: 'api' };

const toMajor = (value: number | string): number =>
  typeof value === 'number' ? Number((value / 100).toFixed(6)) : minorToMajor(value);

function modelUsage(m: z.output<typeof modelSchema>): ClaudeCodeModelUsage {
  return {
    model: m.model,
    inputTokens: m.tokens?.input ?? 0,
    outputTokens: m.tokens?.output ?? 0,
    cacheReadTokens: m.tokens?.cache_read ?? 0,
    cacheCreationTokens: m.tokens?.cache_creation ?? 0,
    estimatedCost: m.estimated_cost ? toMajor(m.estimated_cost.amount) : null,
  };
}

/** Edit / write tool proposals summed over every tool the API reports. */
function toolTotals(row: Row): { toolAccepted: number; toolRejected: number } {
  const tools = Object.values(row.tool_actions ?? {});
  return {
    toolAccepted: tools.reduce((sum, t) => sum + t.accepted, 0),
    toolRejected: tools.reduce((sum, t) => sum + t.rejected, 0),
  };
}

function who(actor: Row['actor']): Pick<ClaudeCodeActivity, 'actorKind' | 'actor'> {
  return {
    actorKind: ACTOR_KIND[actor.type] ?? actor.type,
    actor: actor.email_address ?? actor.api_key_name ?? null,
  };
}

function metrics(core: Row['core_metrics']) {
  return {
    sessions: core.num_sessions,
    linesAdded: core.lines_of_code?.added ?? 0,
    linesRemoved: core.lines_of_code?.removed ?? 0,
    commits: core.commits_by_claude_code,
    pullRequests: core.pull_requests_by_claude_code,
  };
}

function toActivity(row: Row): ClaudeCodeActivity {
  return {
    date: row.date.slice(0, 10),
    ...who(row.actor),
    customerType: row.customer_type ?? null,
    terminalType: row.terminal_type ?? null,
    ...metrics(row.core_metrics),
    ...toolTotals(row),
    models: (row.model_breakdown ?? []).map(modelUsage),
  };
}

/**
 * Claude Code Analytics API (Admin API key of the Console organization): one request series
 * per UTC day (`starting_at` is a single date), `page` / `next_page` paging. Rows are per user
 * (e-mail) or per API key name, so the dataset is never published (docs/BLUEPRINT.md section 9).
 */
export class ClaudeCodeApi {
  constructor(private readonly http: HttpClient) {}

  private async day(date: string): Promise<Row[]> {
    return collectTokenPages(async (page) =>
      parseResponse(
        tokenPage(rowSchema),
        await this.http.getJson(PATH, { starting_at: date, limit: 1000, page }),
        PATH,
      ),
    );
  }

  /** The last `lookbackDays` days up to and including today, oldest first. */
  async listActivity(
    lookbackDays: number,
    now: Date,
  ): Promise<CollectResult<ClaudeCodeActivity[]>> {
    const first = startOfUtcDay(addDays(now, -lookbackDays));
    const items: ClaudeCodeActivity[] = [];
    for (let offset = 0; offset <= lookbackDays; offset++) {
      const rows = await this.day(toIsoDate(addDays(first, offset)));
      items.push(...rows.map(toActivity));
    }
    return { items, window: { from: first.toISOString(), to: now.toISOString() } };
  }
}
