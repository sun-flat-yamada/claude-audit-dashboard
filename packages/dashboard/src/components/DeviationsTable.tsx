import type { Deviation } from '../lib/drilldown-view';
import { SeverityLabel, StatusBadge } from './Badges';
import { CELL, HEAD } from './DetailControls';
import { ScrollRegion } from './ScrollRegion';

/** Configuration deviations (CF-xxx): severity and status as icon / dot + label + color. */
export function DeviationsTable({
  caption,
  deviations,
}: {
  caption: string;
  deviations: readonly Deviation[];
}) {
  return (
    <ScrollRegion label={caption} className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              Rule
            </th>
            <th scope="col" className={HEAD}>
              Severity
            </th>
            <th scope="col" className={HEAD}>
              Status
            </th>
            <th scope="col" className={HEAD}>
              Finding
            </th>
          </tr>
        </thead>
        <tbody>
          {deviations.map((d) => (
            <tr key={`${d.ruleId}-${d.organizationId ?? 'none'}-${d.message}`}>
              <th scope="row" className={`${CELL} text-left font-medium`}>
                {d.ruleId}
                <span className="block text-xs font-normal text-[var(--text-secondary)]">
                  {d.ruleName}
                </span>
              </th>
              <td className={CELL}>
                <SeverityLabel severity={d.severity} />
              </td>
              <td className={CELL}>
                <StatusBadge status={d.status} />
              </td>
              <td className={CELL}>{d.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
