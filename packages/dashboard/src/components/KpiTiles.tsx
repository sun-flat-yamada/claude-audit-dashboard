import type { DashboardKpi, DashboardView } from '@claude-audit/core/contracts';
import { formatKpi } from '../lib/view';

/** The one hero figure of the view: the compliance score with its result breakdown. */
function HeroScore({
  kpi,
  compliance,
}: {
  kpi: DashboardKpi;
  compliance: DashboardView['compliance'];
}) {
  const parts = [
    `${compliance.failed} failed`,
    `${compliance.warnings} to review`,
    `${compliance.errors} errors`,
    `${compliance.skipped} skipped`,
  ];
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
      <p className="text-sm text-[var(--text-secondary)]">{kpi.label}</p>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="text-6xl leading-none font-semibold">{formatKpi(kpi)}</span>
        <span className="text-lg text-[var(--text-muted)]">/ 100</span>
      </p>
      <p className="mt-4 text-sm text-[var(--text-secondary)]">{parts.join(' · ')}</p>
      {kpi.hint && (
        <p className="mt-2 flex items-start gap-1.5 text-sm">
          <span
            aria-hidden
            className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--status-warning)] text-[10px] font-bold text-black"
          >
            !
          </span>
          <span>
            Partial coverage: {kpi.hint}. Rules without data are skipped, not passed (see Data
            coverage).
          </span>
        </p>
      )}
    </div>
  );
}

const StatTile = ({ kpi }: { kpi: DashboardKpi }) => (
  <div
    className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4"
    title={kpi.value === null ? 'Not collected' : String(kpi.value)}
  >
    <p className="text-sm text-[var(--text-secondary)]">{kpi.label}</p>
    <p className="mt-1 text-2xl font-semibold">{formatKpi(kpi)}</p>
  </div>
);

export function KpiTiles({ view }: { view: DashboardView }) {
  const hero = view.kpis.find((k) => k.id === 'score');
  const rest = view.kpis.filter((k) => k !== hero);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(20rem,1fr)_2fr]">
      {hero && <HeroScore kpi={hero} compliance={view.compliance} />}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
        {rest.map((kpi) => (
          <StatTile key={kpi.id} kpi={kpi} />
        ))}
      </div>
    </div>
  );
}
