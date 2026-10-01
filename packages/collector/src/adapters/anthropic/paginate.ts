import { z } from 'zod';
import { ApiError } from './http-client.js';

/** Unexpected response shape: surfaced as a dataset error instead of a silent empty result. */
export class SchemaDriftError extends Error {
  constructor(endpoint: string, detail: string) {
    super(`Unexpected response from ${endpoint} (API schema drift?): ${detail.slice(0, 600)}`);
    this.name = 'SchemaDriftError';
  }
}

export function parseResponse<S extends z.ZodType>(
  schema: S,
  value: unknown,
  endpoint: string,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SchemaDriftError(endpoint, z.prettifyError(parsed.error));
  return parsed.data;
}

/** ID cursor pages: `after_id` / `has_more` / `last_id` (Activity Feed, Admin users / invites). */
export const idPage = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    has_more: z.boolean(),
    first_id: z.string().nullish(),
    last_id: z.string().nullish(),
  });

/** Page tokens: `page` / `next_page`, with or without `has_more`. */
export const tokenPage = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    has_more: z.boolean().optional(),
    next_page: z.string().nullish(),
  });

const MAX_PAGES = 10_000;

interface IdPage<T> {
  data: T[];
  has_more: boolean;
  last_id?: string | null | undefined;
}

interface TokenPage<T> {
  data: T[];
  has_more?: boolean | undefined;
  next_page?: string | null | undefined;
}

function guard(seen: Set<string>, cursor: string): void {
  if (seen.has(cursor)) throw new Error(`Pagination did not advance (cursor ${cursor} repeated)`);
  seen.add(cursor);
}

export async function collectIdPages<T>(
  fetchPage: (afterId: string | undefined) => Promise<IdPage<T>>,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetchPage(cursor);
    items.push(...response.data);
    if (!response.has_more || !response.last_id) return items;
    guard(seen, response.last_id);
    cursor = response.last_id;
  }
  throw new Error(`Pagination exceeded ${MAX_PAGES} pages`);
}

async function walkTokens<T>(
  fetchPage: (page: string | undefined) => Promise<TokenPage<T>>,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetchPage(token);
    items.push(...response.data);
    if (response.has_more === false || !response.next_page) return items;
    guard(seen, response.next_page);
    token = response.next_page;
  }
  throw new Error(`Pagination exceeded ${MAX_PAGES} pages`);
}

/** Page-token walk. A 410 (cursor expired after a data refresh) restarts from the first page once. */
export async function collectTokenPages<T>(
  fetchPage: (page: string | undefined) => Promise<TokenPage<T>>,
): Promise<T[]> {
  try {
    return await walkTokens(fetchPage);
  } catch (error) {
    if (error instanceof ApiError && error.status === 410) return walkTokens(fetchPage);
    throw error;
  }
}
