import type { ReactElement } from 'react';
import type { DashboardView } from '@claude-audit/core/contracts';
import type { NavItem } from './components/NavBar';
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

/** Later work units append their pages here; the router and nav need no other change. */
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
    path: '/members',
    pattern: '/members',
    label: 'Members',
    nav: true,
    render: () => <Members />,
  },
  {
    path: '/keys',
    pattern: '/keys',
    label: 'API keys',
    nav: true,
    render: () => <ApiKeys />,
  },
  {
    path: '/activity',
    pattern: '/activity',
    label: 'Activity',
    nav: true,
    render: () => <Activity />,
  },
  {
    path: '/reports/monthly',
    pattern: '/reports/monthly',
    label: 'Monthly report',
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
    path: '/models',
    pattern: '/models',
    label: 'Models',
    nav: true,
    render: (view) => <Models view={view} />,
  },
  {
    path: '/claude-code',
    pattern: '/claude-code',
    label: 'Claude Code',
    nav: true,
    render: (view) => <ClaudeCode view={view} />,
  },
  {
    path: '/console',
    pattern: '/console',
    label: 'Console API',
    nav: true,
    render: (view) => <ConsolePage view={view} />,
  },
  {
    path: '/features',
    pattern: '/features',
    label: 'Skills & connectors',
    nav: true,
    render: (view) => <Features view={view} />,
  },
  {
    path: '/config',
    pattern: '/config',
    label: 'Configuration',
    nav: true,
    render: () => <Config />,
  },
  {
    path: '/archive',
    pattern: '/archive',
    label: 'Archive',
    nav: true,
    render: () => <Archive />,
  },
  {
    path: '/alerts',
    pattern: '/alerts',
    label: 'Alerts',
    nav: true,
    render: () => <Alerts />,
  },
  {
    path: '/orgs',
    pattern: '/orgs',
    label: 'Organizations',
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
