/**
 * HTTP for the ledger sinks (#161 U7): plain `fetch`, retries with backoff for transient failures
 * (network errors, 408, 429, 5xx; `Retry-After` honored) and errors that name the operation, the
 * HTTP status and an API error code only. Never a URL, a token, a response body or a storage ID.
 */

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
/** Requests per call, including the first. */
export const SINK_HTTP_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 60_000;

export interface SinkHttpOptions {
  fetchImpl?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export interface SinkRequest {
  /** What is done, e.g. `Google Drive upload of 2026-09/usage.jsonl.gz` (no URL, no ID). */
  label: string;
  url: string;
  init: RequestInit;
  /** Statuses returned instead of thrown (e.g. 404 for a lookup). */
  accept?: readonly number[] | undefined;
  /** False for a request that must not be repeated as is (an upload chunk). Default true. */
  retry?: boolean | undefined;
}

export class SinkHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
  ) {
    super(message);
    this.name = 'SinkHttpError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const safe = (value: unknown): string | undefined =>
  typeof value === 'string' && SAFE_CODE.test(value) ? value : undefined;

/**
 * The API error code of a failed response (`error.code` of Graph, `error.status` /
 * `errors[0].reason` of Google, `error` of OAuth token endpoints); only identifier-shaped values.
 */
export async function errorCodeOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown };
    const error = body.error;
    if (typeof error === 'string') return safe(error);
    if (typeof error !== 'object' || error === null) return undefined;
    const e = error as { code?: unknown; status?: unknown; errors?: { reason?: unknown }[] };
    return safe(e.errors?.[0]?.reason) ?? safe(e.code) ?? safe(e.status);
  } catch {
    return undefined;
  }
}

function delayOf(response: Response | undefined, attempt: number): number {
  const header = response?.headers.get('retry-after');
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_DELAY_MS);
  return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
}

async function failure(request: SinkRequest, response: Response): Promise<SinkHttpError> {
  const code = await errorCodeOf(response);
  return new SinkHttpError(
    `${request.label} failed (HTTP ${String(response.status)}${code ? `, ${code}` : ''})`,
    response.status,
  );
}

/** One try: the response to return, or the error and whether a retry may help. */
async function attemptOnce(
  request: SinkRequest,
  fetchImpl: typeof fetch,
): Promise<{ response?: Response; error?: SinkHttpError; retry: boolean }> {
  let response: Response;
  try {
    response = await fetchImpl(request.url, request.init);
  } catch {
    // The cause can quote the URL: only the fact is reported.
    return {
      error: new SinkHttpError(`${request.label} failed (network error)`, undefined),
      retry: true,
    };
  }
  if (response.ok || request.accept?.includes(response.status)) return { response, retry: false };
  return {
    response,
    error: await failure(request, response),
    retry: RETRY_STATUSES.has(response.status),
  };
}

/** One request with retries; resolves an OK or accepted response, throws a `SinkHttpError`. */
export async function sinkFetch(request: SinkRequest, options: SinkHttpOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const attempts = request.retry === false ? 1 : SINK_HTTP_ATTEMPTS;
  for (let attempt = 1; ; attempt += 1) {
    const result = await attemptOnce(request, fetchImpl);
    if (!result.error && result.response) return result.response;
    if (!result.retry || attempt >= attempts)
      throw result.error ?? new SinkHttpError(`${request.label} failed`, undefined);
    await sleep(delayOf(result.response, attempt));
  }
}

/** JSON body of a successful response; a malformed one is an error without its content. */
export async function jsonOf<T>(response: Response, label: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new SinkHttpError(`${label}: unexpected response`, response.status);
  }
}

/** Response bytes. */
export async function bytesOf(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

/** A request body of stored bytes (a copy backed by a plain ArrayBuffer, as `fetch` types it). */
export const bodyOf = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => Uint8Array.from(bytes);
