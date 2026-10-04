import type { DashboardView } from '@claude-audit/core/contracts';
import { Card } from '../components/Card';
import { ComplianceResults } from '../components/ComplianceResults';

export function Compliance({ view }: { view: DashboardView }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Compliance results</h1>
      <Card
        title="Compliance checks"
        subtitle={`${view.compliance.results.length} rules evaluated · failing first`}
      >
        <ComplianceResults
          results={view.compliance.results}
          exportFrom={{ collectedAt: view.collectedAt }}
        />
      </Card>
    </div>
  );
}
