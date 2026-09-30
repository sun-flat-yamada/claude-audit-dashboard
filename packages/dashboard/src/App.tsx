import { useEffect, useState } from 'react';
import type { DashboardData } from '@claude-audit/shared';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DashboardData };

/**
 * Phase 1 placeholder view.
 *
 * The full dashboard (F-001 … F-015 in docs/DASHBOARD-FEATURES.md) is
 * scheduled for Phase 3. This view only proves the data pipeline:
 * it loads `data/dashboard.json` staged next to the build and shows headline numbers.
 */
export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/dashboard.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DashboardData>;
      })
      .then((data) => setState({ status: 'ready', data }))
      .catch((err: unknown) =>
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 font-sans text-slate-800 dark:text-slate-100">
      <h1 className="text-2xl font-semibold">Claude Audit Dashboard</h1>
      <p className="mt-2 text-sm text-slate-500">
        Preview build — the full dashboard is under development (see docs/BLUEPRINT.md).
      </p>

      {state.status === 'loading' && <p className="mt-8">Loading…</p>}
      {state.status === 'error' && (
        <p className="mt-8 text-red-600">Failed to load dashboard data: {state.message}</p>
      )}
      {state.status === 'ready' && (
        <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Organization" value={state.data.organization.name} />
          <Stat label="Compliance score" value={String(state.data.compliance.current_score)} />
          <Stat label="Members" value={String(state.data.organization.member_count)} />
          <Stat label="Active alerts" value={String(state.data.alerts.active_alerts.length)} />
        </dl>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-medium">{value}</dd>
    </div>
  );
}
