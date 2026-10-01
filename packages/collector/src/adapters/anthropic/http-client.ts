export const ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_VERSION = '2023-06-01';

/** Arrays become `key[]=v` (repeated); objects become dotted keys (`created_at.gte=...`). */
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly string[]
  | Readonly<Record<string, string | undefined>>;

export type Query = Readonly<Record<string, QueryValue>>;

/** Non-2xx response from the Anthropic API (message includes the API's own explanation). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorType: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface HttpClientOptions {
  apiKey: string;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);
const MAX_BACKOFF_MS = 60_000;
const MAX_RETRY_AFTER_MS = 300_000;

export function buildUrl(baseUrl: string, path: string, query: Query): URL {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) appendParam(url.searchParams, key, value);
  return url;
}

function appendParam(params: URLSearchParams, key: string, value: QueryValue): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'object') {
    params.set(key, String(value));
  } else if (Array.isArray(value)) {
    for (const item of value as readonly string[]) params.append(`${key}[]`, item);
  } else {
    for (const [sub, item] of Object.entries(value)) {
      if (item !== undefined) params.set(`${key}.${sub}`, item);
    }
  }
}

/** 1 s doubling up to 60 s (Anthropic's documented fallback schedule). */
export const backoffMs = (attempt: number): number => Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);

const retryable = (res: Response): boolean =>
  RETRYABLE_STATUS.has(res.status) &&
  !(res.status === 500 && res.headers.get('x-should-retry') === 'false');

function retryDelayMs(res: Response, attempt: number): number {
  const seconds = Number(res.headers.get('retry-after'));
  if (res.status === 429 && res.headers.has('retry-after') && Number.isFinite(seconds)) {
    return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_AFTER_MS);
  }
  return backoffMs(attempt);
}

async function toApiError(res: Response, url: URL): Promise<ApiError> {
  const text = await res.text().catch(() => '');
  let type = 'http_error';
  let detail = text.slice(0, 500);
  try {
    const body = JSON.parse(text) as { error?: { type?: string; message?: string } };
    type = body.error?.type ?? type;
    detail = body.error?.message ?? detail;
  } catch {
    // non-JSON body: keep the raw text
  }
  const requestId = res.headers.get('request-id');
  const suffix = requestId ? ` (request-id ${requestId})` : '';
  return new ApiError(
    res.status,
    type,
    `GET ${url.pathname} → ${res.status} ${type}: ${detail}${suffix}`,
    requestId,
  );
}

/**
 * Minimal GET client for the Anthropic management APIs: auth headers, timeout, and the
 * documented retry contract (honour `retry-after` on 429, back off on 5xx / 529 unless
 * `x-should-retry: false`, never retry other 4xx).
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: HttpClientOptions) {
    this.baseUrl = options.baseUrl ?? ANTHROPIC_API_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 5;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async getJson(path: string, query: Query = {}): Promise<unknown> {
    const url = buildUrl(this.baseUrl, path, query);
    for (let attempt = 0; ; attempt++) {
      const outcome = await this.request(url).catch((error: unknown) => error);
      if (outcome instanceof Response && outcome.ok) return outcome.json();
      const canRetry = outcome instanceof Response ? retryable(outcome) : true;
      if (!canRetry || attempt >= this.maxRetries) throw await this.failure(outcome, url);
      await this.sleep(
        outcome instanceof Response ? retryDelayMs(outcome, attempt) : backoffMs(attempt),
      );
    }
  }

  private request(url: URL): Promise<Response> {
    return this.fetchImpl(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.options.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async failure(outcome: unknown, url: URL): Promise<Error> {
    if (outcome instanceof Response) return toApiError(outcome, url);
    const cause = outcome instanceof Error ? outcome.message : String(outcome);
    return new Error(`GET ${url.pathname} failed: ${cause}`);
  }
}
