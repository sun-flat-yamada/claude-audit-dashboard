import {
  compareIndexSchema,
  diffTimePoints,
  timePointDiffExport,
  timePointDiffFileName,
  timePointSummarySchema,
  type CompareIndex,
  type TimePointSummary,
} from '@claude-audit/core/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Compare } from '../Compare';

// The committed synthetic sample (three time points), never live data.
const FILES = import.meta.glob<string>('../../../../../data/sample/detail/compare/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const byName = (name: string): string =>
  Object.entries(FILES).find(([path]) => path.endsWith(`/${name}`))?.[1] ?? '{}';

const INDEX: CompareIndex = compareIndexSchema.parse(JSON.parse(byName('index.json')));
const [T3, T2, T1] = INDEX.points.map((p) => p.id) as [string, string, string];
const summary = (id: string): TimePointSummary =>
  timePointSummarySchema.parse(JSON.parse(byName(`${id}.json`)));

type Reply = unknown | 404 | 500;
interface Server {
  index?: Reply;
  manifest?: Reply;
  points?: Record<string, Reply>;
}

function serve(server: Server = {}): typeof fetch {
  const { index = INDEX, manifest = 404, points = {} } = server;
  return vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    const id = /compare\/(.+)\.json$/.exec(path)?.[1];
    let reply: Reply;
    if (path.endsWith('/compare/index.json')) reply = index;
    else if (id !== undefined) reply = id in points ? points[id] : JSON.parse(byName(`${id}.json`));
    else reply = manifest;
    if (typeof reply === 'number') return new Response('{}', { status: reply });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
}

function open(server: Server = {}, hash = '#/compare') {
  window.history.replaceState(null, '', hash);
  const fetchImpl = serve(server);
  render(<Compare baseUrl="/" fetchImpl={fetchImpl} />);
  return fetchImpl;
}

const select = (name: string) => screen.getByRole('combobox', { name });
const pointsOf = (...ids: string[]): CompareIndex['points'] =>
  INDEX.points.filter((p) => ids.includes(p.id));
const indexWith = (points: CompareIndex['points']): CompareIndex => ({ ...INDEX, points });

let blobs: Blob[] = [];
let names: string[] = [];
beforeEach(() => {
  blobs = [];
  names = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:test';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '#/');
});

const text = (blob: Blob | undefined) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob ?? new Blob());
  });

describe('Compare page states', () => {
  it('says it is loading first', () => {
    open();
    expect(screen.getByRole('status')).toHaveTextContent('Loading time-point comparison data');
  });

  it('explains that the data is not published (404)', async () => {
    open({ index: 404 });
    expect(await screen.findByText(/Comparison data is not published/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('explains that the data was not collected when the manifest says so', async () => {
    open({
      index: 404,
      manifest: {
        schemaVersion: 2,
        generatedAt: INDEX.generatedAt,
        collectedAt: INDEX.generatedAt,
        source: 'demo',
        maskPii: true,
        files: [
          {
            kind: 'compare',
            path: 'detail/compare/index.json',
            schemaVersion: 1,
            status: 'unavailable',
            reason: 'no judged snapshot',
            count: null,
            month: null,
          },
        ],
      },
    });
    expect(
      await screen.findByText('Comparison data was not collected (no judged snapshot).'),
    ).toBeInTheDocument();
  });

  it('shows a failure as an alert', async () => {
    open({ index: 500 });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load time-point comparison data: HTTP 500',
    );
  });

  it('shows a file that does not match the contract as an alert with regeneration advice', async () => {
    open({ index: { schemaVersion: 99 } });
    expect(await screen.findByRole('alert')).toHaveTextContent('pnpm build:detail');
  });

  it.each([
    ['no point', []],
    ['one point', pointsOf(T3)],
  ])('says comparison is not possible with %s', async (_name, points) => {
    open({ index: indexWith(points) });
    expect(await screen.findByText(/Comparison is not possible yet/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('two are needed');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('counts only points with a summary: one summary plus archived points is not enough', async () => {
    const archived = { ...INDEX.points[1], state: 'archived', score: null, assessed: null };
    open({ index: indexWith([INDEX.points[0], archived] as CompareIndex['points']) });
    expect(await screen.findByText(/Comparison is not possible yet/)).toBeInTheDocument();
    expect(screen.getByText('Archived time points')).toBeInTheDocument();
  });

  it('shows a point whose file is listed but not published', async () => {
    open({ points: { [T3]: 404 } });
    expect(await screen.findByText(/is listed but not published/)).toBeInTheDocument();
  });

  it('shows a point file failure as an alert', async () => {
    open({ points: { [T2]: 500 } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load the summary of');
  });
});

describe('selection', () => {
  it('defaults to the newest point as target and the previous one as base, newest first', async () => {
    open();
    await screen.findByRole('table', { name: 'Rule changes' });
    expect(select('Target time point')).toHaveValue(T3);
    expect(select('Base time point')).toHaveValue(T2);
    const options = within(select('Base time point')).getAllByRole('option');
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([T3, T2, T1]);
    expect(options[0]).toHaveTextContent('2026-09-29 12:00 UTC · score 70');
  });

  it('uses base and target from the hash and ignores unknown parameters', async () => {
    open({}, `#/compare?base=${T1}&target=${T3}&x=1`);
    await screen.findByRole('table', { name: 'Rule changes' });
    expect(select('Base time point')).toHaveValue(T1);
    expect(select('Target time point')).toHaveValue(T3);
  });

  it('with only a target in the hash the base is the point before it, or after it for the oldest', async () => {
    open({}, `#/compare?target=${T2}`);
    await screen.findByRole('table', { name: 'Rule changes' });
    expect(select('Base time point')).toHaveValue(T1);
  });

  it('with the oldest as target the base falls back to a newer point', async () => {
    open({}, `#/compare?target=${T1}`);
    await screen.findByRole('table', { name: 'Rule changes' });
    expect(select('Base time point')).toHaveValue(T3);
  });

  it('changes the diff and the hash when a selector changes (no history entry)', async () => {
    const before = window.history.length;
    open();
    await screen.findByRole('table', { name: 'Rule changes' });
    await userEvent.selectOptions(select('Base time point'), T1);
    await waitFor(() => expect(window.location.hash).toBe(`#/compare?base=${T1}&target=${T3}`));
    expect(window.history.length).toBe(before);
    expect(await screen.findByText(/2026-09-01 12:00 UTC \(collected/)).toBeInTheDocument();
  });

  it('swaps base and target', async () => {
    open();
    await screen.findByRole('table', { name: 'Rule changes' });
    await userEvent.click(screen.getByRole('button', { name: 'Swap base and target' }));
    await waitFor(() => expect(select('Base time point')).toHaveValue(T3));
    expect(select('Target time point')).toHaveValue(T2);
    await waitFor(() => expect(window.location.hash).toBe(`#/compare?base=${T3}&target=${T2}`));
    // The reverse comparison turns the regressions around.
    const row = await screen.findByRole('row', { name: /CF-003/ });
    expect(within(row).getByText('Improved')).toBeInTheDocument();
  });

  it('reports an unknown id without crashing and keeps the selectors usable', async () => {
    open({}, `#/compare?base=nope&target=${T3}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The base time point "nope" is not in the list of comparable points',
    );
    expect(screen.queryByRole('table', { name: 'Rule changes' })).not.toBeInTheDocument();
    await userEvent.selectOptions(select('Base time point'), T2);
    expect(await screen.findByRole('table', { name: 'Rule changes' })).toBeInTheDocument();
  });

  it('lists archived points disabled, with the restore guidance', async () => {
    const archived = [
      {
        id: '2026-08-01T12-00-00Z',
        collectedAt: null,
        state: 'archived',
        score: null,
        assessed: null,
      },
    ] as CompareIndex['points'];
    open({ index: indexWith([...INDEX.points, ...archived]) });
    await screen.findByRole('table', { name: 'Rule changes' });
    const option = within(select('Base time point')).getByRole('option', {
      name: '2026-08-01 12:00 UTC (archived, no summary)',
    });
    expect(option).toBeDisabled();
    expect(screen.getByText('Archived time points')).toBeInTheDocument();
    expect(screen.getByText(/pnpm cli restore/)).toBeInTheDocument();
    expect(screen.getByText(/pnpm build:detail --snapshot/)).toBeInTheDocument();
  });

  it('refuses an archived id from the hash with the restore message', async () => {
    const id = '2026-08-01T12-00-00Z';
    const archived = [
      { id, collectedAt: null, state: 'archived', score: null, assessed: null },
    ] as CompareIndex['points'];
    open({ index: indexWith([...INDEX.points, ...archived]) }, `#/compare?base=${id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('archived without a summary');
    expect(screen.queryByRole('table', { name: 'Rule changes' })).not.toBeInTheDocument();
  });

  it('says there is nothing to compare when base and target are the same point', async () => {
    open({}, `#/compare?base=${T3}&target=${T3}`);
    expect(
      await screen.findByText(/same time point, so there is nothing to compare/),
    ).toBeVisible();
    expect(screen.getByText('No differences between these two time points.')).toBeInTheDocument();
    expect(screen.getByText('No rule changed between these time points.')).toBeInTheDocument();
    expect(screen.getByText('No dataset changed its collection state.')).toBeInTheDocument();
  });
});

describe('results of the sample points', () => {
  const diff = () => diffTimePoints(summary(T2), summary(T3));

  it('shows the score with its delta and the assessed-rule change', async () => {
    open();
    const d = diff().score;
    const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
    expect(
      await screen.findByText(`${d.base} → ${d.target} (${sign(d.delta)})`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${d.baseAssessed} of ${d.baseTotal} → ${d.targetAssessed} of ${d.targetTotal} (${sign(d.assessedDelta)})`,
      ),
    ).toBeInTheDocument();
  });

  it('lists regressed rules first with icon-and-label statuses', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Rule changes' });
    const rows = within(table).getAllByRole('row').slice(1);
    const expected = diff().rules.changes;
    expect(rows).toHaveLength(expected.length);
    expect(within(rows[0] as HTMLElement).getByText(expected[0]?.id ?? '')).toBeInTheDocument();
    const classes = rows.map((r) => within(r).getAllByRole('cell').at(-1)?.textContent);
    const regressed = classes.filter((c) => c?.includes('Regressed')).length;
    expect(regressed).toBe(diff().rules.counts.regressed);
    expect(classes.slice(0, regressed).every((c) => c?.includes('Regressed'))).toBe(true);
    const cf003 = within(table).getByRole('row', { name: /CF-003/ });
    expect(within(cf003).getByText('Pass')).toBeInTheDocument();
    expect(within(cf003).getByText('Fail')).toBeInTheDocument();
    expect(within(cf003).getByText('Regressed')).toBeInTheDocument();
  });

  it('shows added rules with "Not present" on the base side', async () => {
    open();
    const row = await screen.findByRole('row', { name: /AK-002/ });
    expect(within(row).getByText('Not present')).toBeInTheDocument();
    expect(within(row).getByText('Added')).toBeInTheDocument();
  });

  it('filters by change class with counts and by search, and reveals unchanged rules', async () => {
    open();
    await screen.findByRole('table', { name: 'Rule changes' });
    const counts = diff().rules.counts;
    const group = screen.getByRole('group', { name: 'Filter by change' });
    const chip = (label: string) =>
      within(group).getByRole('button', { name: new RegExp(`^${label} \\d+$`) });
    expect(chip('Regressed')).toHaveTextContent(String(counts.regressed));
    expect(chip('Unchanged')).toHaveTextContent(String(counts.unchanged));
    await userEvent.click(chip('Regressed'));
    expect(chip('Regressed')).toHaveAttribute('aria-pressed', 'true');
    let rows = within(screen.getByRole('table', { name: 'Rule changes' })).getAllByRole('row');
    expect(rows).toHaveLength(1 + counts.regressed);
    await userEvent.click(chip('Unchanged'));
    rows = within(screen.getByRole('table', { name: 'Rule changes' })).getAllByRole('row');
    expect(rows).toHaveLength(1 + counts.unchanged);
    await userEvent.click(chip('All changes'));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search rules' }), 'cf-003');
    rows = within(screen.getByRole('table', { name: 'Rule changes' })).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('1 rule shown')).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search rules' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search rules' }), 'zzzz-none');
    expect(screen.getByText('No rules match the current filter and search.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Rule changes' })).not.toBeInTheDocument();
  });

  it('lists dataset coverage changes with Collected / Unavailable / Error labels', async () => {
    open({}, `#/compare?base=${T1}&target=${T2}`);
    const table = await screen.findByRole('table', { name: 'Data coverage changes' });
    const expected = diffTimePoints(summary(T1), summary(T2)).coverage.changes;
    expect(within(table).getAllByRole('row')).toHaveLength(1 + expected.length);
    const labels = ['Collected', 'Unavailable', 'Error'].filter(
      (l) => within(table).queryAllByText(l).length > 0,
    );
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });

  it('shows the key figures with signed deltas and units', async () => {
    open({}, `#/compare?base=${T1}&target=${T2}`);
    const table = await screen.findByRole('table', { name: 'Key figure changes' });
    const members = within(table).getByRole('row', { name: /^Members/ });
    expect(members).toHaveTextContent('34');
    expect(members).toHaveTextContent('43');
    expect(members).toHaveTextContent('+9');
    const cost = within(table).getByRole('row', { name: /^Month-to-date cost/ });
    expect(cost).toHaveTextContent('$');
    expect(within(table).getByRole('row', { name: /^Seat utilization/ })).toHaveTextContent('pp');
  });

  it('uses the tenant currency for cost figures', async () => {
    window.history.replaceState(null, '', '#/compare');
    render(<Compare baseUrl="/" fetchImpl={serve()} currency="JPY" />);
    const table = await screen.findByRole('table', { name: 'Key figure changes' });
    expect(within(table).getByRole('row', { name: /^Month-to-date cost/ })).toHaveTextContent(
      /¥|JP¥/,
    );
  });
});

describe('export', () => {
  it.each([
    ['Export Markdown', 'md', 'text/markdown'],
    ['Export CSV', 'csv', 'text/csv'],
    ['Export JSON', 'json', 'application/json'],
  ] as const)('%s saves exactly what the core formatter produces', async (label, format, type) => {
    open({}, `#/compare?base=${T1}&target=${T3}`);
    await screen.findByRole('table', { name: 'Rule changes' });
    expect(screen.getByRole('group', { name: 'Export comparison' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: label }));
    const diff = diffTimePoints(summary(T1), summary(T3));
    expect(names).toEqual([timePointDiffFileName(diff, format)]);
    expect(blobs[0]?.type).toContain(type);
    expect(await text(blobs[0])).toBe(timePointDiffExport(diff, format));
  });

  it('names the files by both points (deterministic)', async () => {
    open();
    await screen.findByRole('table', { name: 'Rule changes' });
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(names[0]).toBe('time-point-diff-20260915T120000Z-20260929T120000Z.csv');
  });
});
