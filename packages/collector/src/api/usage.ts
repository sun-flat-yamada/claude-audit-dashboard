import { API_ENDPOINTS } from '@claude-audit/shared';
import { HttpClient, type HttpClientOptions } from './client.js';

/** One result row of GET /v1/organizations/usage_report/messages (grouped by workspace and model). */
export interface UsageResult {
  workspace_id: string | null;
  model: string | null;
  uncached_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation: { ephemeral_1h_input_tokens: number; ephemeral_5m_input_tokens: number };
  output_tokens: number;
}

/** One result row of GET /v1/organizations/cost_report (grouped by workspace and description). */
export interface CostResult {
  workspace_id: string | null;
  model: string | null;
  /** Cost in cents as a decimal string, e.g. "123.45" = $1.23. */
  amount: string;
  currency: string;
}

export interface Bucket<R> {
  starting_at: string;
  ending_at: string;
  results: R[];
}

export interface UsageQuery {
  startingAt: string;
  endingAt: string;
}

/** Usage & Cost Admin API client (daily buckets, at most 31 per page). */
export class UsageApi {
  private readonly http: HttpClient;

  constructor(options: HttpClientOptions) {
    this.http = new HttpClient(options);
  }

  listUsage(q: UsageQuery): Promise<Bucket<UsageResult>[]> {
    return this.http.getAllBuckets(API_ENDPOINTS.ORG_USAGE_REPORT_MESSAGES, {
      starting_at: q.startingAt,
      ending_at: q.endingAt,
      bucket_width: '1d',
      limit: 31,
      group_by: ['workspace_id', 'model'],
    });
  }

  listCost(q: UsageQuery): Promise<Bucket<CostResult>[]> {
    return this.http.getAllBuckets(API_ENDPOINTS.ORG_COST_REPORT, {
      starting_at: q.startingAt,
      ending_at: q.endingAt,
      bucket_width: '1d',
      limit: 31,
      group_by: ['workspace_id', 'description'],
    });
  }
}
