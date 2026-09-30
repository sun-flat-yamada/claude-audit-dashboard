/**
 * Anthropic API common types
 */

/** Anthropic API version header */
export const ANTHROPIC_API_VERSION = '2023-06-01' as const;

/** Base URL for Anthropic API */
export const ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com' as const;

/** Cursor-based pagination response wrapper */
export interface PaginatedResponse<T> {
  data: T[];
  has_more: boolean;
  first_id: string | null;
  last_id: string | null;
}

/** Pagination request parameters */
export interface PaginationParams {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

/** API error response */
export interface ApiError {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

/** Admin API key types */
export type ApiKeyType = 'admin' | 'compliance' | 'workspace';
