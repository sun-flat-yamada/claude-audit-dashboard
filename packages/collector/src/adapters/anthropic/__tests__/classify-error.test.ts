import { DataUnavailableError } from '@claude-audit/core';
import { describe, expect, it } from 'vitest';
import { UNAVAILABLE_STATUS, classify } from '../classify-error.js';
import { ApiError } from '../http-client.js';

describe('classify', () => {
  it('converts 401, 403, 404 ApiErrors into DataUnavailableError', () => {
    for (const status of UNAVAILABLE_STATUS) {
      const err = new ApiError(status, 'error', `HTTP ${status}`, null);
      const classified = classify(err);
      expect(classified).toBeInstanceOf(DataUnavailableError);
      expect((classified as DataUnavailableError).message).toBe(`HTTP ${status}`);
    }
  });

  it('preserves other ApiErrors and unknown errors as-is', () => {
    const err500 = new ApiError(500, 'server_error', 'Internal Server Error', null);
    expect(classify(err500)).toBe(err500);

    const err400 = new ApiError(400, 'client_error', 'Bad Request', null);
    expect(classify(err400)).toBe(err400);

    const genericError = new Error('Network failed');
    expect(classify(genericError)).toBe(genericError);

    expect(classify('random string')).toBe('random string');
  });
});
