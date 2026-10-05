import type { DashboardUsage } from '@claude-audit/core/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { tokenSeries, tokenSubtitle } from '../../lib/view';
import { TokenSection } from '../sections';

const day = (date: string, extra: Partial<DashboardUsage['daily'][number]> = {}) => ({
  date,
  cost: 1,
  inputTokens: 1000,
  outputTokens: 200,
  ...extra,
});

const breakdown = {
  uncachedInputTokens: 300,
  cacheReadInputTokens: 600,
  cacheCreationInputTokens: 100,
};

const usage = (over: Partial<DashboardUsage> = {}): DashboardUsage => ({
  currency: 'USD',
  asOf: null,
  daily: [day('2026-09-28', breakdown), day('2026-09-29', breakdown)],
  cacheHitRate: 60,
  byProduct: [],
  byModel: [],
  byGroup: [],
  ...over,
});

const columns = () => screen.getAllByRole('columnheader').map((h) => h.textContent);

describe('Daily tokens by type (AN-1)', () => {
  it('charts uncached input, cache read, cache write and output with the cache hit rate', () => {
    render(<TokenSection usage={usage()} />);
    expect(screen.getByText('Daily tokens')).toBeInTheDocument();
    expect(screen.getByText(/Cache hit rate 60(\.0)?%/)).toBeInTheDocument();
    expect(columns()).toEqual(['Date', 'Uncached input', 'Cache read', 'Output', 'Cache write']);
  });

  it('shows a dash when the period had no input tokens', () => {
    expect(tokenSubtitle(usage({ cacheHitRate: null }))).toMatch(/Cache hit rate —/);
  });

  it('falls back to summed input and output for a dashboard.json without the breakdown', () => {
    const legacy = usage({ daily: [day('2026-09-28'), day('2026-09-29')] });
    delete legacy.cacheHitRate;
    render(<TokenSection usage={legacy} />);
    expect(columns()).toEqual(['Date', 'Input tokens', 'Output tokens']);
    expect(screen.getByText('Input includes cache reads and writes')).toBeInTheDocument();
    expect(tokenSeries([]).map((s) => s.key)).toEqual(['inputTokens', 'outputTokens']);
  });
});
