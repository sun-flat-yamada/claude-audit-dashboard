import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonthlyReport } from '../MonthlyReport';

const SAMPLE_FILES = import.meta.glob<string>('../../../../../data/sample/detail/monthly/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const fromSample = (name: string): string =>
  Object.entries(SAMPLE_FILES).find(([path]) => path.endsWith(name))?.[1] ?? '{}';

const NOW = '2026-09-29T12:00:00.000Z';
const row = (key: string, name: string, amount: number, share: number) => ({
  key,
  name,
  amount,
  share,
});
const month = (m: string, over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  generatedAt: NOW,
  id: `monthly-${m}`,
  month: m,
  period: { from: `${m}-01T00:00:00.000Z`, to: `${m}-30T00:00:00.000Z` },
  status: 'ok',
  reason: null,
  currency: 'USD',
  totalCost: 100,
  byGroup: [
    row('g-eng', 'Engineering', 70, 70),
    row('g-sales', 'Sales', 30, 30),
    row('g-both', 'Platform', 20, 20),
  ],
  byModel: [row('claude-opus-5', 'claude-opus-5', 100, 100)],
  byProduct: [row('chat', 'chat', 100, 100)],
  notes: ['Group shares can add up to more than 100%.'],
  ...over,
});
const entry = (m: string, over: Record<string, unknown> = {}) => ({
  id: `monthly-${m}`,
  month: m,
  path: `detail/monthly/monthly-${m}.json`,
  status: 'ok',
  currency: 'USD',
  totalCost: 100,
  generatedAt: NOW,
  ...over,
});
const index = (entries: unknown[]) => ({ schemaVersion: 1, generatedAt: NOW, reports: entries });

type Reply = unknown | 404 | 500 | 'broken';
function serve(files: Record<string, Reply>): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url).replace(/^.*\/data\//, '');
    const reply = files[path] ?? 404;
    if (typeof reply === 'number') return new Response('{}', { status: reply });
    if (reply === 'broken') return new Response('{"nope":true}', { status: 200 });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
}
const open = (files: Record<string, Reply>, id?: string) =>
  render(<MonthlyReport id={id} baseUrl="/" fetchImpl={serve(files)} />);

const INDEX = 'detail/monthly/index.json';
const standard = () => ({
  [INDEX]: index([entry('2026-08'), entry('2026-07')]),
  'detail/monthly/monthly-2026-08.json': month('2026-08'),
  'detail/monthly/monthly-2026-07.json': month('2026-07', { totalCost: 50, byGroup: [] }),
});

afterEach(() => {
  window.location.hash = '';
});

describe('MonthlyReport', () => {
  it('shows the newest month: ungrouped total, chargeback table and the overlap notice', async () => {
    open(standard());
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Monthly cost report' }),
    ).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Chargeback by RBAC group' });
    const eng = within(table).getByRole('row', { name: /Engineering/ });
    expect(within(eng).getByText('$70.00')).toBeInTheDocument();
    expect(within(eng).getByText('70.0%')).toBeInTheDocument();
    expect(screen.getByText('Organization total (ungrouped)').parentElement).toHaveTextContent(
      '$100.00',
    );
    const notice = screen.getByRole('complementary', { name: 'Group totals overlap' });
    expect(within(notice).getByText('Groups overlap')).toBeInTheDocument();
    expect(notice).toHaveTextContent(/exceed the organization total/);
    expect(notice).toHaveTextContent(/Do not add them up/);
    // Group amounts are never summed: no total row, no footer.
    expect(within(table).getAllByRole('row')).toHaveLength(4); // header + 3 groups, no sum row
    expect(screen.getByRole('table', { name: 'Cost by model' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Cost by product' })).toBeInTheDocument();
    expect(screen.getByText('Collected')).toBeInTheDocument();
  });

  it('shows the neutral notice, without the exceeds sentence, when groups do not overlap', async () => {
    const files = standard();
    files['detail/monthly/monthly-2026-08.json'] = month('2026-08', {
      byGroup: [row('g-a', 'Engineering', 60, 60), row('g-b', 'Sales', 40, 40)],
    });
    open(files);
    const notice = await screen.findByRole('complementary', { name: 'Group totals overlap' });
    expect(notice).toHaveTextContent(/can add up to more than the organization total/);
    expect(notice).not.toHaveTextContent(/exceed the organization total/);
  });

  it('lists months from the index and loads the chosen one', async () => {
    const user = userEvent.setup();
    open(standard(), 'monthly-2026-07');
    const select = await screen.findByRole('combobox', { name: 'Month' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['August 2026', 'July 2026']);
    expect(select).toHaveValue('monthly-2026-07');
    expect(await screen.findByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('No chargeback by rbac group in this month.')).toBeInTheDocument();
    await user.selectOptions(select, 'monthly-2026-08');
    expect(window.location.hash).toBe('#/reports/monthly/monthly-2026-08');
  });

  it('filters the tables and says so when nothing matches', async () => {
    const user = userEvent.setup();
    open(standard());
    await screen.findByRole('table', { name: 'Chargeback by RBAC group' });
    await user.type(screen.getByRole('searchbox', { name: /Search groups, models/ }), 'platf');
    const table = screen.getByRole('table', { name: 'Chargeback by RBAC group' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    await user.clear(screen.getByRole('searchbox', { name: /Search groups, models/ }));
    await user.type(screen.getByRole('searchbox', { name: /Search groups, models/ }), 'zzz');
    expect(
      screen.queryByRole('table', { name: 'Chargeback by RBAC group' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/No rows match/)).toHaveLength(3);
  });

  it('shows a loading status first', () => {
    open(standard());
    expect(screen.getByRole('status')).toHaveTextContent('Loading monthly cost reports…');
  });

  it('says the data is not published when the index is missing (404)', async () => {
    open({});
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Monthly cost reports are not published.*PAGES_DETAIL_DATA/,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows an error for a failing request and for a file that breaks the contract', async () => {
    const { unmount } = open({ [INDEX]: 500 });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Failed to load monthly cost reports/,
    );
    unmount();
    open({ ...standard(), 'detail/monthly/monthly-2026-08.json': 'broken' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Failed to load the August 2026/);
  });

  it('shows an empty state when the index lists no month', async () => {
    open({ [INDEX]: index([]) });
    expect(
      await screen.findByText(/No monthly cost report has been generated yet/),
    ).toBeInTheDocument();
  });

  it('reports a month whose cost data was not collected, with the reason', async () => {
    open({
      [INDEX]: index([entry('2026-08', { status: 'unavailable', totalCost: null })]),
      'detail/monthly/monthly-2026-08.json': month('2026-08', {
        status: 'unavailable',
        reason: 'cost dataset disabled',
        totalCost: null,
        byGroup: [],
        byModel: [],
        byProduct: [],
      }),
    });
    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('Cost data for August 2026 was not collected (cost dataset disabled).'),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'August 2026 (not collected)' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('reports a listed month whose file is missing as not published', async () => {
    const files = standard();
    delete (files as Record<string, unknown>)['detail/monthly/monthly-2026-08.json'];
    open(files);
    expect(await screen.findByText(/The August 2026 report is not published/)).toBeInTheDocument();
  });

  it('shows a not-found notice for an unknown month id', async () => {
    open(standard(), 'monthly-2020-01');
    expect(
      await screen.findByText(/There is no monthly report “monthly-2020-01”/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show the newest month' })).toHaveAttribute(
      'href',
      '#/reports/monthly',
    );
  });

  it('renders the same personal-data-free content whatever the detail manifest says about maskPii', async () => {
    // Monthly files carry no per-person data, so the page never depends on the manifest flag:
    // the manifest is not requested at all, and no e-mail address can appear.
    const fetchImpl = serve(standard());
    const { container, unmount } = render(<MonthlyReport baseUrl="/" fetchImpl={fetchImpl} />);
    await screen.findByRole('table', { name: 'Chargeback by RBAC group' });
    const masked = container.innerHTML;
    unmount();
    const again = render(<MonthlyReport baseUrl="/" fetchImpl={serve(standard())} />);
    await screen.findByRole('table', { name: 'Chargeback by RBAC group' });
    expect(again.container.innerHTML).toBe(masked);
    expect(masked).not.toMatch(/@/);
    const requested = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      String(c[0]),
    );
    expect(requested.some((u) => u.endsWith('/detail/index.json'))).toBe(false);
  });

  it('renders the synthetic sample months (three months, overlapping groups)', async () => {
    const files: Record<string, Reply> = {};
    for (const [path, text] of Object.entries(SAMPLE_FILES)) {
      files[`detail/monthly/${path.split('/').pop()}`] = JSON.parse(text);
    }
    expect(fromSample('index.json')).not.toBe('{}');
    open(files);
    const select = await screen.findByRole('combobox', { name: 'Month' });
    expect(within(select).getAllByRole('option')).toHaveLength(3);
    expect(
      await screen.findByRole('complementary', { name: 'Group totals overlap' }),
    ).toHaveTextContent(/exceed the organization total/);
    expect(await screen.findByRole('row', { name: /Engineering/ })).toBeInTheDocument();
  });
});
