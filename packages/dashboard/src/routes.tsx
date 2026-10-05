import type { ReactElement } from 'react';
import type { DashboardView } from '@claude-audit/core/contracts';
import type { NavItem } from './components/NavBar';
import { matchPath } from './lib/router';
import { Activity } from './pages/Activity';
import { Compliance } from './pages/Compliance';
import { ApiKeys } from './pages/ApiKeys';
import { Members } from './pages/Members';
import { Overview } from './pages/Overview';

export interface RouteDef extends NavItem {
  /** Pattern such as `/members` or `/reports/monthly/:id`. */
  pattern: string;
  /** false hides the route from the navigation (parametrised detail pages). */
  nav: boolean;
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
