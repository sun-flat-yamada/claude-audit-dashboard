import type { DashboardView } from '@claude-audit/core/contracts';
import { KpiTiles } from '../components/KpiTiles';
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
} from '../components/sections';
import { stampFrom } from '../lib/export';
import { formatTimestamp } from '../lib/format';

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

export function Overview({ view }: { view: DashboardView }) {
  return (
    <div className="space-y-6">
      <Header view={view} />
      <KpiTiles view={view} />
      <InsightSection insights={view.insights} />
      <div className="grid gap-6 *:min-w-0 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ComplianceSection
            compliance={view.compliance}
            stamp={stampFrom(view.collectedAt, view.generatedAt)}
          />
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
    </div>
  );
}
