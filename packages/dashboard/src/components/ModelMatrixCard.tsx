import type { DashboardView } from '@claude-audit/core/contracts';
import { formatMoney, formatPercent } from '../lib/format';
import { monthLabel } from '../lib/monthly-view';
import { hasSpend, modelMix } from '../lib/usage-matrix-view';
import { Card, Empty, TableView } from './Card';
import { ShareBars } from './ShareBars';

const TOP_MODELS = 4;

/**
 * Overview summary of the optional model x group collection: the ungrouped model mix of the latest
 * month. The heatmap itself lives at `#/models`. Hidden when the collection is off.
 */
export function ModelMatrixCard({ matrix }: { matrix: DashboardView['modelMatrix'] }) {
  if (matrix === null) return null;
  const title = 'Model spend';
  if (matrix.status !== 'ok')
    return (
      <Card title={title}>
        <Empty>{`Model and group spend was not collected (${matrix.reason}).`}</Empty>
      </Card>
    );
  const latest = modelMix(matrix, TOP_MODELS).months.at(-1);
  if (!hasSpend(matrix) || !latest)
    return (
      <Card title={title}>
        <Empty>No model spend was reported in the collected period.</Empty>
      </Card>
    );
  const segments = latest.segments.filter((s) => s.cost > 0);
  return (
    <Card
      title={title}
      subtitle={`Ungrouped spend per model, ${monthLabel(latest.month)} · group cells overlap and are not added up`}
    >
      <ShareBars
        items={segments.map((s) => ({
          key: s.key,
          label: s.label,
          value: s.cost,
          display: `${formatMoney(s.cost, matrix.currency)} · ${formatPercent(s.share)}`,
        }))}
      />
      <TableView
        columns={['Model', 'Spend', 'Share of the month']}
        rows={segments.map((s) => [
          s.label,
          formatMoney(s.cost, matrix.currency),
          formatPercent(s.share),
        ])}
      />
      <p className="mt-3 text-sm">
        <a className="underline" href="#/models">
          Open the model and group heatmap
        </a>
      </p>
    </Card>
  );
}
