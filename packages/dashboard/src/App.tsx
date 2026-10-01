import { useEffect, useState } from 'react';
import type { DashboardView } from '@claude-audit/core/contracts';
import { KpiTiles } from './components/KpiTiles';
import {
  ActivitySection,
  AdoptionSection,
  CategorySection,
  ComplianceSection,
  CostSection,
  CoverageSection,
  InsightSection,
  SpendBreakdowns,
  TokenSection,
} from './components/sections';
import { loadDashboard, type LoadState } from './lib/data';
import { formatTimestamp } from './lib/format';

function Header({ view }: { view: DashboardView }) {
  const orgs = view.organizations.map((o) => o.name).join(', ');
  const collected = view.collectedAt
    ? `Collected ${formatTimestamp(view.collectedAt)}`
    : 'Not collected yet';
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{view.title}</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {[orgs, collected].filter(Boolean).join(' · ')}
        </p>
      </div>
      {view.source === 'demo' && (
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-secondary)]">
          Demo data (synthetic tenant)
        </span>
      )}
    </header>
  );
}

function Dashboard({ view }: { view: DashboardView }) {
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <Header view={view} />
      <KpiTiles view={view} />
      <InsightSection insights={view.insights} />
      <div className="grid gap-6 *:min-w-0 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ComplianceSection compliance={view.compliance} />
        </div>
        <CategorySection compliance={view.compliance} />
      </div>
      <div className="grid gap-6 *:min-w-0 lg:grid-cols-2">
        <CostSection usage={view.usage} />
        <TokenSection usage={view.usage} />
      </div>
      <div className="grid gap-6 *:min-w-0 lg:grid-cols-3">
        <SpendBreakdowns usage={view.usage} />
      </div>
      <AdoptionSection adoption={view.adoption} />
      <ActivitySection activity={view.activity} />
      <CoverageSection coverage={view.coverage} />
      <footer className="pb-4 text-sm text-[var(--text-muted)]">
        Aggregated view generated {formatTimestamp(view.generatedAt)}. E-mail addresses are masked
        unless masking is disabled in config.
      </footer>
    </main>
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

  if (state.status === 'ready') return <Dashboard view={state.view} />;
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
