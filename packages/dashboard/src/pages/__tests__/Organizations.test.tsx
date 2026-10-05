import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GroupDetail } from '../GroupDetail';
import { OrganizationDetail } from '../OrganizationDetail';
import { Organizations } from '../Organizations';

const SAMPLE_FILES = import.meta.glob<string>(
  '../../../../../data/sample/detail/{org-groups,index,members}.json',
  { eager: true, query: '?raw', import: 'default' },
);
const fromSample = (name: string): string =>
  Object.entries(SAMPLE_FILES).find(([path]) => path.endsWith(name))?.[1] ?? '{}';

const NOW = '2026-09-29T12:00:00.000Z';
const O1 = 'org-1';
const O2 = 'org-2';
const orgGroups = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  generatedAt: NOW,
  currency: 'USD',
  organizations: [
    { id: O1, name: 'Example Corp Alpha', memberCount: 2 },
    { id: O2, name: 'Example Corp Beta', memberCount: 0 },
  ],
  groups: [
    { id: 'g-eng', name: 'Engineering', source: 'scim', memberCount: 18, monthToDateCost: 200 },
    { id: 'g-ops', name: 'Operations', source: 'direct', memberCount: 0, monthToDateCost: 50 },
    { id: 'g-new', name: 'Pilot', source: 'direct', memberCount: null, monthToDateCost: null },
  ],
  deviations: [
    {
      ruleId: 'CF-003',
      ruleName: 'IP Allowlist Enabled',
      severity: 'medium',
      status: 'fail',
      organizationId: O1,
      message: '1 of 2 organization(s) deviate on ip_allowlist_enabled',
    },
    {
      ruleId: 'CF-005',
      ruleName: 'Finite Data Retention',
      severity: 'high',
      status: 'warning',
      organizationId: O1,
      message: 'retention differs',
    },
    {
      ruleId: 'CF-009',
      ruleName: 'Invite Domains',
      severity: 'low',
      status: 'fail',
      organizationId: null,
      message: 'Unmatched evidence',
    },
  ],
  ...over,
});
const member = (id: string, organizationId: string | null, name: string, email: string) => ({
  id,
  email,
  name,
  role: 'user',
  organizationId,
  joinedAt: null,
  active: true,
  lastActiveOn: null,
});
const membersFile = (members: unknown[]) => ({
  schemaVersion: 2,
  generatedAt: NOW,
  inactiveDays: 60,
  members,
  invites: [],
});
const manifest = (over: Record<string, unknown> = {}, files: unknown[] = []) => ({
  schemaVersion: 2,
  generatedAt: NOW,
  collectedAt: NOW,
  source: 'demo',
  maskPii: true,
  files,
  ...over,
});
const unavailable = (kind: string, reason: string) => ({
  kind,
  path: `detail/${kind}.json`,
  schemaVersion: 2,
  status: 'unavailable',
  reason,
  count: null,
  month: null,
});

type Reply = unknown | 404 | 500;
function serve(routes: { groups: Reply; manifest?: Reply; members?: Reply }): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    const reply = path.endsWith('/org-groups.json')
      ? routes.groups
      : path.endsWith('/members.json')
        ? (routes.members ?? 404)
        : (routes.manifest ?? manifest());
    if (typeof reply === 'number') return new Response('{}', { status: reply });
    return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('Organizations index', () => {
  const open = (routes: Parameters<typeof serve>[0]) =>
    render(<Organizations baseUrl="/" fetchImpl={serve(routes)} />);

  it('lists organizations and groups with links, counts and deviation totals', async () => {
    open({ groups: orgGroups() });
    const orgs = await screen.findByRole('table', { name: 'Linked organizations' });
    expect(screen.getByRole('heading', { level: 1, name: 'Organizations' })).toBeInTheDocument();
    const alpha = within(orgs).getByRole('row', { name: /Example Corp Alpha/ });
    expect(within(alpha).getByRole('link', { name: 'Example Corp Alpha' })).toHaveAttribute(
      'href',
      '#/orgs/org-1',
    );
    expect(within(alpha).getAllByRole('cell', { name: '2' })).toHaveLength(2);
    const groups = screen.getByRole('table', { name: 'RBAC groups' });
    const eng = within(groups).getByRole('row', { name: /Engineering/ });
    expect(within(eng).getByRole('link', { name: 'Engineering' })).toHaveAttribute(
      'href',
      '#/groups/g-eng',
    );
    expect(within(eng).getByText('$200.00')).toBeInTheDocument();
    expect(within(groups).getByText('Not collected')).toBeInTheDocument();
    expect(within(groups).getByText('Not available')).toBeInTheDocument();
  });

  it('shows deviations that match no organization under "Unattributed"', async () => {
    open({ groups: orgGroups() });
    const table = await screen.findByRole('table', { name: 'Unattributed deviations' });
    expect(within(table).getByText('CF-009')).toBeInTheDocument();
    expect(within(table).queryByText('CF-003')).not.toBeInTheDocument();
  });

  it('omits the unattributed bucket when every deviation is attributed', async () => {
    const data = orgGroups();
    data.deviations = data.deviations.slice(0, 2);
    open({ groups: data });
    await screen.findByRole('table', { name: 'Linked organizations' });
    expect(screen.queryByRole('table', { name: 'Unattributed deviations' })).toBeNull();
  });

  it('filters and reports no match', async () => {
    const user = userEvent.setup();
    open({ groups: orgGroups() });
    await screen.findByRole('table', { name: 'RBAC groups' });
    const search = screen.getByRole('searchbox', { name: 'Search organizations and groups' });
    await user.type(search, 'beta');
    expect(screen.getByRole('link', { name: 'Example Corp Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Example Corp Alpha' })).toBeNull();
    expect(screen.getByText('No groups match the search.')).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'nothing-like-this');
    expect(screen.getByText('No organizations match the search.')).toBeInTheDocument();
  });

  it('renders the empty states', async () => {
    open({ groups: orgGroups({ organizations: [], groups: [], deviations: [] }) });
    expect(await screen.findByText('No linked organizations.')).toBeInTheDocument();
    expect(screen.getByText('No RBAC groups.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('explains a dataset that was not collected, with the manifest reason', async () => {
    open({
      groups: 404,
      manifest: manifest({}, [unavailable('org-groups', 'organizations endpoint not permitted')]),
    });
    expect(
      await screen.findByText(
        'Organization and group data was not collected (organizations endpoint not permitted).',
      ),
    ).toBeInTheDocument();
  });

  it('says "not published" when the files are missing, never an error screen', async () => {
    open({ groups: 404, manifest: 404 });
    expect(await screen.findByText(/Organization and group data is not published/)).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows loading first and reports a failing request as an alert', async () => {
    open({ groups: 500 });
    expect(screen.getByRole('status')).toHaveTextContent('Loading organizations and groups');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load organizations and groups: HTTP 500',
    );
  });

  it('renders the synthetic sample', async () => {
    open({ groups: fromSample('/org-groups.json'), manifest: fromSample('/index.json') });
    const orgs = await screen.findByRole('table', { name: 'Linked organizations' });
    expect(within(orgs).getAllByRole('row')).toHaveLength(4);
    expect(screen.getByRole('table', { name: 'RBAC groups' })).toBeInTheDocument();
  });
});

describe('OrganizationDetail', () => {
  const open = (id: string, routes: Parameters<typeof serve>[0]) =>
    render(<OrganizationDetail id={id} baseUrl="/" fetchImpl={serve(routes)} />);

  it('shows the organization deviations with icon + label severity and status', async () => {
    open(O1, { groups: orgGroups() });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Example Corp Alpha' }),
    ).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Configuration deviations' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('CF-003')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Fail')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('medium')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Review')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All organizations and groups' })).toHaveAttribute(
      'href',
      '#/orgs',
    );
  });

  it('says so when the organization has no deviations', async () => {
    open(O2, { groups: orgGroups() });
    expect(
      await screen.findByText('No configuration deviations for this organization.'),
    ).toBeInTheDocument();
  });

  it('lists the members of the organization, masked as published (maskPii on)', async () => {
    open(O1, {
      groups: orgGroups(),
      members: membersFile([
        member('u1', O1, 'A*** B***', 'a***@example.com'),
        member('u2', O2, 'C*** D***', 'c***@example.com'),
      ]),
    });
    const table = await screen.findByRole('table', { name: 'Organization members' });
    expect(within(table).getByText('A*** B***')).toBeInTheDocument();
    expect(within(table).queryByText('C*** D***')).toBeNull();
    expect(within(table).getByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/masked \(maskPii is on\)/)).toBeInTheDocument();
  });

  it('shows raw values when maskPii is off', async () => {
    open(O1, {
      groups: orgGroups(),
      manifest: manifest({ maskPii: false }),
      members: membersFile([member('u1', O1, 'Pat Example', 'pat@example.com')]),
    });
    expect(await screen.findByText('Pat Example')).toBeInTheDocument();
    expect(screen.getByText('pat@example.com')).toBeInTheDocument();
    expect(screen.getByText(/unmasked \(maskPii is off\)/)).toBeInTheDocument();
  });

  it('shows an empty member state for an organization without members', async () => {
    open(O2, {
      groups: orgGroups(),
      members: membersFile([member('u1', O1, 'A*** B***', 'a***@example.com')]),
    });
    expect(await screen.findByText('No members in this organization.')).toBeInTheDocument();
  });

  it('does not invent a join when members carry no organization', async () => {
    open(O1, {
      groups: orgGroups(),
      members: membersFile([member('u1', null, 'A*** B***', 'a***@example.com')]),
    });
    expect(await screen.findByText(/Members carry no organization/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Organization members' })).toBeNull();
  });

  it('keeps the page usable when the members file is not published or not collected', async () => {
    const first = open(O1, { groups: orgGroups(), members: 404 });
    expect(await screen.findByText(/Member data is not published/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Configuration deviations' })).toBeInTheDocument();
    first.unmount();
    open(O1, {
      groups: orgGroups(),
      members: 404,
      manifest: manifest({}, [unavailable('members', 'users not permitted')]),
    });
    expect(
      await screen.findByText('Member data was not collected (users not permitted).'),
    ).toBeInTheDocument();
  });

  it('renders a not-found page for an unknown id', async () => {
    open('does-not-exist', { groups: orgGroups() });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Organization not found' }),
    ).toBeInTheDocument();
  });

  it('handles not published and error states', async () => {
    const first = open(O1, { groups: 404, manifest: 404 });
    expect(await screen.findByText(/Organization and group data is not published/)).toBeVisible();
    first.unmount();
    open(O1, { groups: 500 });
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 500');
  });
});

describe('GroupDetail', () => {
  const open = (id: string, routes: Parameters<typeof serve>[0]) =>
    render(<GroupDetail id={id} baseUrl="/" fetchImpl={serve(routes)} />);

  it('shows source, member count, spend and the overlap note', async () => {
    open('g-ops', { groups: orgGroups() });
    expect(await screen.findByRole('heading', { level: 1, name: 'Operations' })).toBeVisible();
    expect(screen.getByText('direct')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText(/must not be added up/)).toBeInTheDocument();
  });

  it('states that no member list exists instead of inventing one', async () => {
    open('g-eng', { groups: orgGroups() });
    expect(await screen.findByText(/only a member count per group/)).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('handles uncollected cost and member counts', async () => {
    open('g-new', { groups: orgGroups() });
    expect(await screen.findByText('Not available')).toBeInTheDocument();
    expect(screen.getAllByText('Not collected').length).toBeGreaterThan(0);
    expect(screen.getByText(/Cost data was not collected/)).toBeInTheDocument();
  });

  it('renders not found, not published, not collected and error states', async () => {
    const a = open('missing', { groups: orgGroups() });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Group not found' }),
    ).toBeInTheDocument();
    a.unmount();
    const b = open('g-eng', { groups: 404, manifest: 404 });
    expect(await screen.findByText(/is not published/)).toBeInTheDocument();
    b.unmount();
    const c = open('g-eng', {
      groups: 404,
      manifest: manifest({}, [unavailable('org-groups', 'no access')]),
    });
    expect(await screen.findByText(/was not collected \(no access\)/)).toBeInTheDocument();
    c.unmount();
    open('g-eng', { groups: 500 });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('renders a sample group', async () => {
    open('rbac_group_demo_sales', {
      groups: fromSample('/org-groups.json'),
      manifest: fromSample('/index.json'),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Sales' })).toBeInTheDocument();
  });
});
