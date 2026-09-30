import {
  ANTHROPIC_API_BASE_URL,
  ANTHROPIC_API_VERSION,
  type PaginatedResponse,
} from '@claude-audit/shared';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface HttpClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Base delay for exponential backoff (ms). */
  retryBaseMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Array values are sent as repeated `key[]=v` parameters (e.g. `group_by[]=model`). */
export type QueryParams = Record<string, string | number | string[] | undefined>;

/** Page of time buckets from the usage/cost endpoints (`page` / `next_page` cursor). */
export interface BucketPage<T> {
  data: T[];
  has_more: boolean;
  next_page: string | null;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Base HTTP client: auth headers, timeout, retry with backoff, 429 Retry-After, auto-pagination. */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: HttpClientOptions) {
    this.baseUrl = options.baseUrl ?? ANTHROPIC_API_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 500;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async get<T>(path: string, query: QueryParams = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(`${k}[]`, item);
      } else if (v !== undefined) {
        url.searchParams.set(k, String(v));
      }
    }

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: 'GET',
          headers: {
            'x-api-key': this.options.apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (attempt >= this.maxRetries) throw err;
        await this.sleep(this.retryBaseMs * 2 ** attempt);
        continue;
      }

      if (res.ok) return (await res.json()) as T;

      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        await this.sleep(this.backoffMs(res, attempt));
        continue;
      }
      const body = await res.text();
      throw new ApiRequestError(`GET ${url.pathname} failed: ${res.status}`, res.status, body);
    }
  }

  /** Follows has_more/last_id cursors (`after_id`) and returns every item. */
  async getAll<T>(path: string, query: QueryParams = {}, pageSize = 100): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | undefined;
    do {
      const page: PaginatedResponse<T> = await this.get(path, {
        ...query,
        limit: pageSize,
        ...(cursor ? { after_id: cursor } : {}),
      });
      items.push(...page.data);
      cursor = page.has_more && page.last_id ? page.last_id : undefined;
    } while (cursor);
    return items;
  }

  /** Follows `has_more` / `next_page` and returns every time bucket (usage and cost endpoints). */
  async getAllBuckets<T>(path: string, query: QueryParams = {}): Promise<T[]> {
    const buckets: T[] = [];
    let page: string | undefined;
    do {
      const res: BucketPage<T> = await this.get(path, { ...query, page });
      buckets.push(...res.data);
      page = res.has_more && res.next_page ? res.next_page : undefined;
    } while (page);
    return buckets;
  }

  private backoffMs(res: Response, attempt: number): number {
    const retryAfter = Number(res.headers.get('retry-after'));
    if (res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) {
      return retryAfter * 1000;
    }
    return this.retryBaseMs * 2 ** attempt;
  }
}
