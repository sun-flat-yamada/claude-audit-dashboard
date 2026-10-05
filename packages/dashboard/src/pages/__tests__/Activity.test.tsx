import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Activity } from '../Activity';

const SAMPLE = import.meta.glob<string>(
  '../../../../../data/sample/detail/{index,activity-*}.json',
  { eager: true, query: '?raw', import: 'default' },
);

const NOW = '2026-09-29T12:00:00.000Z';
const mkItem = (month: string, n: number, over: Record<string, unknown> = {}) => ({
  id: `activity_${month}_${String(n).padStart(3, '0')}`,
  type: n % 2 === 0 ? 'claude_chat_created' : 'claude_file_uploaded',
  createdAt: `${month}-${String(1 + (n % 27)).padStart(2, '0')}T10:00:00.000Z`,
  organizationId: 'org-1',
  actor: { kind: 'user_actor', id: `u_${n}`, email: `p${n}***@example.com`, ip: null },
  ...over,
});
const monthFile = (month: string, count: number, over: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  generatedAt: NOW,
  month,
  total: count,
  truncated: false,
  items: Array.from({ length: count }, (_, i) => mkItem(month, i)),
  ...over,
});
const entry = (month: string | null, over: Record<string, unknown> = {}) => ({
  kind: 'activity',
  path: month ? `detail/activity-${month}.json` : 'detail/activity-*.json',
  schemaVersion: 2,
  status: 'ok',
  reason: null,
  count: 0,
  month,
  ...over,
});
const manifest = (files: unknown[], over: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  generatedAt: NOW,
  collectedAt: NOW,
  source: 'demo',
  maskPii: true,
  files,
  ...over,
});

type Reply = unknown | 404 | 500;
function serve(replies: Record<string, Reply>) {
  const spy = vi.fn(async (url: RequestInfo | URL) => {
    const name = String(url).split('/data/')[1] ?? '';
    const reply = replies[name] ?? 404;
    if (typeof reply === 'number') return new Response('{}', { status: reply });
    return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply));
  });
  return spy;
}
const open = (replies: Record<string, Reply>) => {
  const spy = serve(replies);
  const view = render(<Activity baseUrl="/" fetchImpl={spy as unknown as typeof fetch} />);
  return { spy, ...view };
};
const fetched = (spy: ReturnType<typeof serve>) => spy.mock.calls.map(([u]) => String(u));
const REPLIES = {
  'detail/index.json': manifest([entry('2026-08'), entry('2026-09')]),
  'detail/activity-2026-09.json': monthFile('2026-09', 120),
  'detail/activity-2026-08.json': monthFile('2026-08', 3),
};

describe('Activity page', () => {
  it('loads the newest manifest month only and shows the first page', async () => {
    const { spy } = open(REPLIES);
    expect(await screen.findByRole('table', { name: 'Activity timeline' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveValue('2026-09');
    expect(screen.getAllByRole('row')).toHaveLength(51);
    expect(screen.getByText(/Showing 1–50 of 120 matching activities/)).toBeInTheDocument();
    expect(fetched(spy).some((u) => u.endsWith('activity-2026-08.json'))).toBe(false);
  });

  it('pages through the timeline and disables the ends', async () => {
    const user = userEvent.setup();
    open(REPLIES);
    await screen.findByRole('table', { name: 'Activity timeline' });
    const previous = screen.getByRole('button', { name: 'Previous page' });
    expect(previous).toBeDisabled();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(screen.getByText(/Showing 51–100 of 120/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getAllByRole('row')).toHaveLength(21);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('switches month, fetching the other file lazily and resetting the page', async () => {
    const user = userEvent.setup();
    const { spy } = open(REPLIES);
    await screen.findByRole('table', { name: 'Activity timeline' });
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Month' }), '2026-08');
    expect(await screen.findByText(/Showing 1–3 of 3 matching activities/)).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(fetched(spy).filter((u) => u.endsWith('activity-2026-08.json'))).toHaveLength(1);
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  });

  it('searches, filters by type, actor kind and date range, and resets to page 1', async () => {
    const user = userEvent.setup();
    const items = [
      mkItem('2026-09', 1, {
        type: 'sso_login_failed',
        createdAt: '2026-09-05T10:00:00.000Z',
        actor: {
          kind: 'unauthenticated_user_actor',
          id: null,
          email: 'x***@example.com',
          ip: '198.51.100.x',
        },
      }),
      mkItem('2026-09', 2, { createdAt: '2026-09-15T10:00:00.000Z' }),
      mkItem('2026-09', 3, {
        createdAt: '2026-09-25T10:00:00.000Z',
        actor: { kind: 'api_actor', id: 'k_1', email: null, ip: null },
      }),
    ];
    open({ ...REPLIES, 'detail/activity-2026-09.json': monthFile('2026-09', 3, { items }) });
    await screen.findByRole('table', { name: 'Activity timeline' });
    const rows = () => screen.getAllByRole('row').length - 1;
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Activity type' }),
      'sso_login_failed',
    );
    expect(rows()).toBe(1);
    expect(within(screen.getByRole('table')).getByText('Unauthenticated')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Activity type' }), 'all');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Actor kind' }), 'api_actor');
    expect(rows()).toBe(1);
    expect(within(screen.getByRole('table')).getByText('API key')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Actor kind' }), 'all');
    await user.type(screen.getByLabelText('From date'), '2026-09-10');
    await user.type(screen.getByLabelText('To date'), '2026-09-20');
    expect(rows()).toBe(1);
    await user.clear(screen.getByLabelText('From date'));
    await user.clear(screen.getByLabelText('To date'));
    await user.type(screen.getByRole('searchbox', { name: 'Search activity' }), 'k_1');
    expect(rows()).toBe(1);
    await user.clear(screen.getByRole('searchbox', { name: 'Search activity' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search activity' }), 'zzz');
    expect(screen.getByText('No activity matches the current filters.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows icon + label for the actor kind in each row', async () => {
    open(REPLIES);
    const table = await screen.findByRole('table', { name: 'Activity timeline' });
    expect(within(table).getAllByText('User').length).toBeGreaterThan(0);
  });

  it('shows the truncated notice with total and kept rows', async () => {
    open({
      ...REPLIES,
      'detail/activity-2026-09.json': monthFile('2026-09', 5, { total: 2600, truncated: true }),
    });
    expect(
      await screen.findByText(/This month has 2600 activities; the file keeps only the newest 5/),
    ).toBeInTheDocument();
    expect(screen.getByText(/of 5 matching activities \(2600 in the month\)/)).toBeInTheDocument();
  });

  it('omits the truncated notice for a complete month', async () => {
    open(REPLIES);
    await screen.findByRole('table', { name: 'Activity timeline' });
    expect(screen.queryByText(/the file keeps only/)).not.toBeInTheDocument();
  });

  it('shows masked identity with the note when maskPii is on, raw identity when off', async () => {
    const raw = mkItem('2026-09', 1, {
      actor: {
        kind: 'user_actor',
        id: 'user_01Raw',
        email: 'real.person@example.com',
        ip: '192.0.2.44',
      },
    });
    const file = (items: unknown[]) => monthFile('2026-09', 1, { items });
    const masked = open({
      ...REPLIES,
      'detail/activity-2026-09.json': file([mkItem('2026-09', 1)]),
    });
    expect(await screen.findByText(/masked \(maskPii is on\)/)).toBeInTheDocument();
    expect(await screen.findByText('p1***@example.com')).toBeInTheDocument();
    expect(screen.getByText('u_1')).toBeInTheDocument();
    masked.unmount();
    open({
      'detail/index.json': manifest([entry('2026-09')], { maskPii: false }),
      'detail/activity-2026-09.json': file([raw]),
    });
    expect(await screen.findByText(/unmasked \(maskPii is off\)/)).toBeInTheDocument();
    expect(await screen.findByText('real.person@example.com')).toBeInTheDocument();
    expect(screen.getByText('192.0.2.44')).toBeInTheDocument();
  });

  it('explains an empty month', async () => {
    open({ ...REPLIES, 'detail/activity-2026-09.json': monthFile('2026-09', 0) });
    expect(
      await screen.findByText('No activity was recorded in September 2026.'),
    ).toBeInTheDocument();
  });

  it('explains a month file that is listed but missing, and one that fails', async () => {
    const missing = open({ ...REPLIES, 'detail/activity-2026-09.json': 404 });
    expect(
      await screen.findByText(/September 2026 is listed but not published/),
    ).toBeInTheDocument();
    missing.unmount();
    open({ ...REPLIES, 'detail/activity-2026-09.json': 500 });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Failed to load September 2026/);
  });

  it('explains an unavailable dataset with the manifest reason', async () => {
    open({
      'detail/index.json': manifest([
        entry(null, {
          status: 'unavailable',
          reason: 'activities endpoint not permitted',
          count: null,
        }),
      ]),
    });
    expect(
      await screen.findByText(
        'Activity data was not collected (activities endpoint not permitted).',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Month' })).not.toBeInTheDocument();
  });

  it('renders "not published" when the manifest is missing, never an error screen', async () => {
    open({});
    expect(await screen.findByText(/Activity data is not published/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a manifest without activity files', async () => {
    open({ 'detail/index.json': manifest([]) });
    expect(
      await screen.findByText('No activity files are listed in the manifest.'),
    ).toBeInTheDocument();
  });

  it('shows a load error and a loading state', async () => {
    const { unmount } = open({ 'detail/index.json': 500 });
    expect(screen.getByText('Loading activity…')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Failed to load activity/);
    unmount();
  });

  it('renders the synthetic sample files and switches across all three months', async () => {
    const byName = (suffix: string) =>
      Object.entries(SAMPLE).find(([name]) => name.endsWith(suffix))?.[1] ?? 404;
    const user = userEvent.setup();
    const { spy } = open({
      'detail/index.json': byName('/index.json'),
      'detail/activity-2026-07.json': byName('activity-2026-07.json'),
      'detail/activity-2026-08.json': byName('activity-2026-08.json'),
      'detail/activity-2026-09.json': byName('activity-2026-09.json'),
    });
    await screen.findByRole('table', { name: 'Activity timeline' });
    const select = screen.getByRole('combobox', { name: 'Month' });
    expect(within(select).getAllByRole('option')).toHaveLength(3);
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    await user.selectOptions(select, '2026-08');
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    await user.selectOptions(select, '2026-07');
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(fetched(spy).filter((u) => u.includes('activity-'))).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/@(?!example\.com)[a-z0-9-]+\.[a-z]+/i);
  });
});
