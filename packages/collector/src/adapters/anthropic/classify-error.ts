import { DataUnavailableError } from '@claude-audit/core';
import { ApiError } from './http-client.js';

/** 401 / 403 / 404 mean "not collectable with this key or plan", not a transient failure. */
export const UNAVAILABLE_STATUS = new Set([401, 403, 404]);

export const classify = (error: unknown): unknown =>
  error instanceof ApiError && UNAVAILABLE_STATUS.has(error.status)
    ? new DataUnavailableError(error.message)
    : error;
