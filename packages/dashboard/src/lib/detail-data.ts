import { useEffect, useState } from 'react';

/** Structural subset of a zod schema, so the dashboard needs no direct zod import. */
export interface Parser<T> {
  parse(value: unknown): T;
}

export type DetailState<T> =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

/** Version of a published file, for the message of an outdated or malformed one. */
const versionOf = (json: unknown): string =>
  String((json as { schemaVersion?: unknown } | null)?.schemaVersion);

/**
 * Fetches `<baseUrl>data/<path>` and validates it. A 404 is "not collected / not published"
 * (`missing`), never an error screen; other failures are `error`.
 */
export async function loadDetailFile<T>(
  baseUrl: string,
  path: string,
  schema: Parser<T>,
  fetchImpl: typeof fetch = fetch,
): Promise<DetailState<T>> {
  try {
    const response = await fetchImpl(`${baseUrl}data/${path}`);
    if (response.status === 404) return { status: 'missing' };
    if (!response.ok) return { status: 'error', message: `HTTP ${response.status} for ${path}` };
    const json: unknown = await response.json();
    try {
      return { status: 'ready', data: schema.parse(json) };
    } catch {
      // A schema mismatch means the files predate this dashboard: say how to regenerate them
      // instead of printing the validator's output.
      return {
        status: 'error',
        message: `${path} is not in the supported format (schemaVersion ${versionOf(json)}). Re-run \`pnpm build:detail\` (or \`pnpm demo\` for the sample data) to regenerate it.`,
      };
    }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

export function useDetailFile<T>(
  path: string,
  schema: Parser<T>,
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): DetailState<T> {
  const { baseUrl = import.meta.env.BASE_URL, fetchImpl } = options;
  const [state, setState] = useState<DetailState<T>>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    void loadDetailFile(baseUrl, path, schema, fetchImpl).then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
    // `schema` is a module-level constant at every call site, so it is not a dependency.
  }, [baseUrl, path, fetchImpl]);
  return state;
}
