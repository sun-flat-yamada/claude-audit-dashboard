import type { DashboardView } from '@claude-audit/core/contracts';
import { ComplianceSection } from '../components/sections';
import { stampFrom } from '../lib/export';

export function Compliance({ view }: { view: DashboardView }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Compliance results</h1>
      <ComplianceSection
        compliance={view.compliance}
        stamp={stampFrom(view.collectedAt, view.generatedAt)}
      />
    </div>
  );
}
