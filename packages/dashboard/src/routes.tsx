import type { ReactElement } from 'react';
import type { DashboardView } from '@claude-audit/core/contracts';
import type { NavGroup, NavItem } from './components/NavBar';
import { matchPath } from './lib/router';
import { Activity } from './pages/Activity';
import { Alerts } from './pages/Alerts';
import { Archive } from './pages/Archive';
import { Compliance } from './pages/Compliance';
import { Config } from './pages/Config';
import { ApiKeys } from './pages/ApiKeys';
import { ClaudeCode } from './pages/ClaudeCode';
import { ConsolePage } from './pages/Console';
import { Features } from './pages/Features';
import { GroupDetail } from './pages/GroupDetail';
import { Members } from './pages/Members';
import { Models } from './pages/Models';
import { MonthlyReport } from './pages/MonthlyReport';
import { OrganizationDetail } from './pages/OrganizationDetail';
import { Organizations } from './pages/Organizations';
import { Overview } from './pages/Overview';

export interface RouteDef extends NavItem {
  /** Pattern such as `/members` or `/reports/monthly/:id`. */
  pattern: string;
  /** false hides the route from the navigation (parametrised detail pages). */
  nav: boolean;
  /** Nav item highlighted for a parametrised sub-route (defaults to `path`). */
  navPath?: string;
  render(view: DashboardView, params: Record<string, string>): ReactElement;
}

/** Navigation groups in display order; a route joins one with its `group` id. */
export const NAV_GROUPS: NavGroup[] = [
  { id: 'usage', label: 'Usage' },
  { id: 'directory', label: 'Directory' },
  { id: 'operations', label: 'Operations' },
];

/**
 * Later work units append their pages here (with a `group` from `NAV_GROUPS`); the router and nav
 * need no other change. The navigation shows the ungrouped items first, then each group in order.
 */
export const ROUTES: RouteDef[] = [
  {
    path: '/',
    pattern: '/',
    label: 'Overview',
    nav: true,
    render: (view) => <Overview view={view} />,
  },
  {
    path: '/compliance',
    pattern: '/compliance',
    label: 'Compliance',
    nav: true,
    render: (view) => <Compliance view={view} />,
  },
  {
    path: '/models',
    pattern: '/models',
    label: 'Models',
    group: 'usage',
    nav: true,
    render: (view) => <Models view={view} />,
  },
  {
    path: '/claude-code',
    pattern: '/claude-code',
    label: 'Claude Code',
    group: 'usage',
    nav: true,
    render: (view) => <ClaudeCode view={view} />,
  },
  {
    path: '/console',
    pattern: '/console',
    label: 'Console API',
    group: 'usage',
    nav: true,
    render: (view) => <ConsolePage view={view} />,
  },
  {
    path: '/features',
    pattern: '/features',
    label: 'Skills & connectors',
    group: 'usage',
    nav: true,
    render: (view) => <Features view={view} />,
  },
  {
    path: '/reports/monthly',
    pattern: '/reports/monthly',
    label: 'Monthly report',
    group: 'usage',
    nav: true,
    render: () => <MonthlyReport />,
  },
  {
    path: '/reports/monthly/:id',
    pattern: '/reports/monthly/:id',
    label: 'Monthly report',
    nav: false,
    navPath: '/reports/monthly',
    render: (_view, params) => <MonthlyReport id={params.id ?? ''} />,
  },
  {
    path: '/members',
    pattern: '/members',
    label: 'Members',
    group: 'directory',
    nav: true,
    render: () => <Members />,
  },
  {
    path: '/keys',
    pattern: '/keys',
    label: 'API keys',
    group: 'directory',
    nav: true,
    render: () => <ApiKeys />,
  },
  {
    path: '/orgs',
    pattern: '/orgs',
    label: 'Organizations',
    group: 'directory',
    nav: true,
    render: () => <Organizations />,
  },
  {
    path: '/orgs/:id',
    pattern: '/orgs/:id',
    label: 'Organization',
    nav: false,
    navPath: '/orgs',
    render: (_view, params) => <OrganizationDetail id={params.id ?? ''} />,
  },
  {
    path: '/groups/:id',
    pattern: '/groups/:id',
    label: 'Group',
    nav: false,
    navPath: '/orgs',
    render: (_view, params) => <GroupDetail id={params.id ?? ''} />,
  },
  {
    path: '/activity',
    pattern: '/activity',
    label: 'Activity',
    group: 'operations',
    nav: true,
    render: () => <Activity />,
  },
  {
    path: '/alerts',
    pattern: '/alerts',
    label: 'Alerts',
    group: 'operations',
    nav: true,
    render: () => <Alerts />,
  },
  {
    path: '/config',
    pattern: '/config',
    label: 'Configuration',
    group: 'operations',
    nav: true,
    render: () => <Config />,
  },
  {
    path: '/archive',
    pattern: '/archive',
    label: 'Archive',
    group: 'operations',
    nav: true,
    render: () => <Archive />,
  },
];

export function findRoute(
  path: string,
  routes: RouteDef[] = ROUTES,
): { route: RouteDef; params: Record<string, string> } | null {
  for (const route of routes) {
    const params = matchPath(route.pattern, path);
    if (params) return { route, params };
  }
  return null;
}

export function NotFound({ path, onHome }: { path: string; onHome: () => void }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-3 text-[var(--text-secondary)]">
        There is no page at <code>{path}</code>.
      </p>
      <p className="mt-3">
        <a
          href="#/"
          className="underline"
          onClick={(event) => {
            event.preventDefault();
            onHome();
          }}
        >
          Back to the overview
        </a>
      </p>
    </section>
  );
}
