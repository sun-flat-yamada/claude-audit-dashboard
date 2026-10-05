import { useEffect, useState } from 'react';
import { NavBar } from './components/NavBar';
import { ThemeToggle } from './components/ThemeToggle';
import { loadDashboard, type LoadState } from './lib/data';
import { useHashRoute } from './lib/router';
import { findRoute, NotFound, ROUTES } from './routes';

function Shell({ view }: { view: Extract<LoadState, { status: 'ready' }>['view'] }) {
  const [path, go] = useHashRoute();
  const match = findRoute(path);
  const items = ROUTES.filter((r) => r.nav);
  return (
    <>
      <NavBar
        items={items}
        current={match?.route.navPath ?? match?.route.path ?? ''}
        onNavigate={go}
        actions={<ThemeToggle />}
      />
      <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-8 outline-none sm:px-6">
        {match ? (
          match.route.render(view, match.params)
        ) : (
          <NotFound path={path} onHome={() => go('/')} />
        )}
      </main>
    </>
  );
}

export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    loadDashboard(import.meta.env.BASE_URL)
      .then((view) => setState({ status: 'ready', view }))
      .catch((error: unknown) =>
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
  }, []);

  if (state.status === 'ready') return <Shell view={state.view} />;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Claude Audit Dashboard</h1>
      <p
        className="mt-6 text-[var(--text-secondary)]"
        role={state.status === 'error' ? 'alert' : 'status'}
      >
        {state.status === 'loading'
          ? 'Loading dashboard data…'
          : `Failed to load dashboard data: ${state.message}`}
      </p>
    </main>
  );
}
