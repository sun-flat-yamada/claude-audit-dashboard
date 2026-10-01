import type { UsageRow } from './entities.js';

export const inputTokens = (r: UsageRow): number =>
  r.uncachedInputTokens + r.cacheReadInputTokens + r.cacheCreationInputTokens;

export const totalTokens = (r: UsageRow): number => inputTokens(r) + r.outputTokens;
