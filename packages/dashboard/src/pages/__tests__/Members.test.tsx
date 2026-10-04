import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Members } from '../Members';

const raw = (files: Record<string, string>): string | undefined => Object.values(files)[0];
// Synthetic sample only (never live data).
const SAMPLE_MEMBERS = raw(
  import.meta.glob<string>('../../../../../data/sample/detail/members.json', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
);
const SAMPLE_MANIFEST = raw(
  import.meta.glob<string>('../../../../../data/sample/detail/index.json', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
);

const NOW = '2026-09-29T12:00:00.000Z';
const member = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  email: 'p***@example.com',
  name: 'P*** Q***',
  role: 'user',
  organizationId: null,
  joinedAt: null,
  active: true,
  lastActiveOn: '2026-09-20',
  ...over,
});
const membersFile = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  generatedAt: NOW,
  inactiveDays: 60,
  members: [
    member('u_1', { name: 'A*** B***', email: 'a***@example.com', role: 'owner' }),
    member('u_2', {
      name: 'C*** D***',
      email: 'c***@example.com',
      active: false,
      lastActiveOn: null,
    }),
    member('u_3', { name: 'E*** F***', email: 'e***@example.com', active: null }),
  ],
  invites: [
    {
      id: 'i_1',
      email: 'n***@example.com',
      role: 'user',
      status: 'pending',
      invitedAt: NOW,
      expiresAt: null,
    },
  ],
  ...over,
});
const manifest = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  generatedAt: NOW,
  collectedAt: NOW,
  source: 'demo',
  maskPii: true,
  files: [
    {
      kind: 'members',
      path: 'detail/members.json',
      schemaVersion: 1,
      status: 'ok',
      reason: null,
      count: 3,
      month: null,
    },
  ],
  ...over,
});

type Reply = unknown | 404 | 500;
function serve(routes: { members: Reply; manifest: Reply }): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const reply = String(url).endsWith('/members.json') ? routes.members : routes.manifest;
    if (typeof reply === 'number') return new Response('{}', { status: reply });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
}
const open = (routes: { members: Reply; manifest: Reply }) =>
  render(<Members baseUrl="/" fetchImpl={serve(routes)} />);

describe('Members page', () => {
  it('lists members with role, last activity and an icon + label status', async () => {
    open({ members: membersFile(), manifest: manifest() });
    expect(await screen.findByRole('table', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    const inactive = screen.getByRole('row', { name: /C\*\*\* D\*\*\*/ });
    expect(within(inactive).getByText('Inactive')).toBeInTheDocument();
    expect(within(inactive).getByText('No activity recorded')).toBeInTheDocument();
    expect(inactive).toHaveAttribute('data-status', 'inactive');
    const owner = screen.getByRole('row', { name: /A\*\*\* B\*\*\*/ });
    expect(within(owner).getByText('Owner')).toBeInTheDocument();
    expect(within(owner).getByText('2026-09-20')).toBeInTheDocument();
    expect(within(owner).getByText('Active')).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /E\*\*\* F\*\*\*/ })).getByText('Unknown'),
    ).toBeInTheDocument();
  });

  it('takes the inactivity threshold from the data and lists inactive members first', async () => {
    open({ members: membersFile({ inactiveDays: 45 }), manifest: manifest() });
    expect(await screen.findByText(/inactive after 45 days/)).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveAttribute('data-status', 'inactive');
  });

  it('shows pending invites in their own table', async () => {
    open({ members: membersFile(), manifest: manifest() });
    const table = await screen.findByRole('table', { name: 'Pending invites' });
    expect(within(table).getByText('n***@example.com')).toBeInTheDocument();
    expect(within(table).getByText('Pending')).toBeInTheDocument();
  });

  it('filters by status, role and search text', async () => {
    const user = userEvent.setup();
    open({ members: membersFile(), manifest: manifest() });
    await screen.findByRole('table', { name: 'Members' });
    await user.click(screen.getByRole('button', { name: /^Inactive/ }));
    const table = screen.getByRole('table', { name: 'Members' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /^All/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'owner');
    expect(screen.getByText('A*** B***')).toBeInTheDocument();
    expect(screen.queryByText('C*** D***')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'all');
    await user.type(screen.getByRole('searchbox', { name: 'Search members' }), 'nobody');
    expect(screen.getByText('No members match the current filters.')).toBeInTheDocument();
  });

  it('sorts and reverses the order', async () => {
    const user = userEvent.setup();
    open({ members: membersFile(), manifest: manifest() });
    await screen.findByRole('table', { name: 'Members' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name');
    const names = () => screen.getAllByRole('rowheader').map((h) => h.textContent ?? '');
    expect(names()[0]).toContain('A*** B***');
    await user.click(screen.getByRole('button', { name: 'Descending' }));
    expect(screen.getByRole('button', { name: 'Descending' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(names()[0]).toContain('E*** F***');
  });

  it('says so when maskPii is on and shows raw values when it is off', async () => {
    const { unmount } = open({ members: membersFile(), manifest: manifest() });
    expect(await screen.findByText(/masked \(maskPii is on\)/)).toBeInTheDocument();
    unmount();
    const raw = membersFile({
      members: [member('u_9', { name: 'Pat Example', email: 'pat@example.com' })],
    });
    open({ members: raw, manifest: manifest({ maskPii: false }) });
    expect(await screen.findByText(/unmasked \(maskPii is off\)/)).toBeInTheDocument();
    expect(screen.getByText('Pat Example')).toBeInTheDocument();
    expect(screen.getByText('pat@example.com')).toBeInTheDocument();
  });

  it('renders the empty state when there are no members', async () => {
    open({ members: membersFile({ members: [], invites: [] }), manifest: manifest() });
    expect(await screen.findByText('No members in this organization.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('explains an unavailable dataset with the manifest reason', async () => {
    const unavailable = manifest({
      files: [
        {
          kind: 'members',
          path: 'detail/members.json',
          schemaVersion: 1,
          status: 'unavailable',
          reason: 'users endpoint not permitted',
          count: null,
          month: null,
        },
      ],
    });
    open({ members: 404, manifest: unavailable });
    expect(
      await screen.findByText('Member data was not collected (users endpoint not permitted).'),
    ).toBeInTheDocument();
  });

  it('renders "not published" when the detail files are missing, never an error screen', async () => {
    open({ members: 404, manifest: 404 });
    expect(await screen.findByText(/Member data is not published/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a failing request as an alert', async () => {
    open({ members: 500, manifest: 404 });
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load members: HTTP 500');
  });

  it('shows a loading status first', () => {
    open({ members: membersFile(), manifest: manifest() });
    expect(screen.getByRole('status')).toHaveTextContent('Loading members');
  });

  it.skipIf(SAMPLE_MEMBERS === undefined)('renders the synthetic sample', async () => {
    open({
      members: JSON.parse(SAMPLE_MEMBERS ?? '{}'),
      manifest: JSON.parse(SAMPLE_MANIFEST ?? '{}'),
    });
    expect(await screen.findByRole('table', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: 'Pending invites' })).toBeInTheDocument();
  });
});
