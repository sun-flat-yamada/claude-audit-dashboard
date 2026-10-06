import {
  compareIndexSchema,
  timePointSummarySchema,
  type CompareIndex,
  type TimePointSummary,
} from '@claude-audit/core/contracts';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Compare } from '../Compare';
import golden from './fixtures/compare-index-archived.json';

// F-015 PR4: the Compare page fed with the index the collector writes for archived points
// (`fixtures/compare-index-archived.json`, pinned by the collector's compare-archived test), and
// the restore guidance checked against the real command names.

const SOURCES = import.meta.glob<string>(
  ['../../../../../package.json', '../../../../collector/src/main/commands.ts'],
  { eager: true, query: '?raw', import: 'default' },
);
const source = (suffix: string): string =>
  Object.entries(SOURCES).find(([path]) => path.endsWith(suffix))?.[1] ?? '';

const SAMPLE = import.meta.glob<string>('../../../../../data/sample/detail/compare/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const sampleSummary = (): TimePointSummary => {
  const raw = Object.entries(SAMPLE).find(([path]) => !path.endsWith('index.json'))?.[1] ?? '{}';
  return timePointSummarySchema.parse(JSON.parse(raw));
};

const INDEX: CompareIndex = compareIndexSchema.parse(golden);
const live = INDEX.points.filter((p) => p.state === 'summary');
const archived = INDEX.points.filter((p) => p.state === 'archived');

/** Serves the golden index and a summary for every live point (the shape is the sample's). */
function serve(): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith('/compare/index.json')) return new Response(JSON.stringify(INDEX));
    const id = /compare\/(.+)\.json$/.exec(path)?.[1];
    const point = live.find((p) => p.id === id);
    if (!point) return new Response('{}', { status: 404 });
    return new Response(
      JSON.stringify({ ...sampleSummary(), id: point.id, collectedAt: point.collectedAt }),
    );
  }) as unknown as typeof fetch;
}

afterEach(() => window.history.replaceState(null, '', '#/'));

describe('Compare page with the collector index of archived points', () => {
  it('has live and archived points in the golden index', () => {
    expect(live.length).toBeGreaterThanOrEqual(2);
    expect(archived).toHaveLength(2);
  });

  it('lists the archived points disabled and keeps the live ones selectable', async () => {
    window.history.replaceState(null, '', '#/compare');
    render(<Compare baseUrl="/" fetchImpl={serve()} />);
    const base = await screen.findByRole('combobox', { name: 'Base time point' });
    const options = within(base).getAllByRole('option');
    expect(options).toHaveLength(INDEX.points.length);
    expect(options.filter((o) => (o as HTMLOptionElement).disabled)).toHaveLength(archived.length);
    expect(
      within(base).getByRole('option', { name: /2025-01-08 00:00 UTC \(archived/ }),
    ).toBeDisabled();
    expect(screen.getByText('Archived time points')).toBeInTheDocument();
    expect(screen.getByText(/2 archived points have no summary/)).toBeInTheDocument();
  });

  it('names commands that exist: pnpm cli restore <id>, then pnpm build:detail --snapshot <id>', async () => {
    window.history.replaceState(null, '', '#/compare');
    render(<Compare baseUrl="/" fetchImpl={serve()} />);
    await screen.findByText('Archived time points');
    const commands = [...document.querySelectorAll('code')].map((c) => c.textContent ?? '');
    expect(commands).toEqual(['pnpm cli restore <id>', 'pnpm build:detail --snapshot <id>']);

    const scripts = (JSON.parse(source('/package.json')) as { scripts: Record<string, string> })
      .scripts;
    // `pnpm cli` forwards to the collector CLI; `pnpm build:detail` is `cli detail`.
    expect(scripts['cli']).toContain('cli');
    expect(scripts['build:detail']).toMatch(/cli detail$/);
    const usage = source('/commands.ts');
    expect(usage).toContain("usage: 'restore <id|year> [--out <dir>]'");
    expect(usage).toContain("usage: 'detail [--snapshot <id>]'");
  });
});
