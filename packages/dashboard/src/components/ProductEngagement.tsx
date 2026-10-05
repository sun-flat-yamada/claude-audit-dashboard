import type { DashboardEngagement } from '@claude-audit/core/contracts';
import {
  codeFacts,
  countText,
  engagementTitle,
  highlights,
  rateText,
  toolTableRows,
  windowRange,
} from '../lib/engagement-view';
import { formatInteger } from '../lib/format';
import { Card, TableView } from './Card';
import { ScrollRegion } from './ScrollRegion';

const CELL = 'border-b border-[var(--grid)] py-1.5 pr-4';
const HEADERS = ['Active members', 'Messages', 'Sessions'];

function ProductTable({ engagement }: { engagement: DashboardEngagement }) {
  return (
    <ScrollRegion label="Engagement by product" className="overflow-x-auto">
      <table className="tabular w-full text-left text-sm">
        <thead>
          <tr className="text-[var(--text-secondary)]">
            <th scope="col" className={`${CELL} font-medium`}>
              Product
            </th>
            {HEADERS.map((h) => (
              <th key={h} scope="col" className={`${CELL} text-right font-medium`}>
                {h}
              </th>
            ))}
            <th scope="col" className="border-b border-[var(--grid)] py-1.5 font-medium">
              Highlights
            </th>
          </tr>
        </thead>
        <tbody>
          {engagement.products.map((p) => (
            <tr key={p.product}>
              <th scope="row" className={`${CELL} font-medium whitespace-nowrap`}>
                {p.label}
              </th>
              <td className={`${CELL} text-right`}>
                {formatInteger(p.activeMembers)}
                <span className="text-[var(--text-muted)]">
                  {' '}
                  / {formatInteger(engagement.members)}
                </span>
              </td>
              <td className={`${CELL} text-right`}>{countText(p.messages)}</td>
              <td className={`${CELL} text-right`}>{countText(p.sessions)}</td>
              <td className="min-w-64 border-b border-[var(--grid)] py-1.5 text-[var(--text-secondary)]">
                {highlights(p.counters)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

/** Accept rate per tool on a fixed 0-100% scale (one hue, slot 1); the table twin has the counts. */
function AcceptRateBars({
  tools,
}: {
  tools: NonNullable<DashboardEngagement['claudeCode']>['tools'];
}) {
  return (
    <ul className="space-y-2.5">
      {tools.map((t) => (
        <li key={t.tool}>
          <div className="flex justify-between gap-3 text-sm">
            <span>{t.label}</span>
            <span className="tabular text-[var(--text-secondary)]">
              {rateText(t.acceptRate)} · {formatInteger(t.accepted)} of{' '}
              {formatInteger(t.accepted + t.rejected)}
            </span>
          </div>
          <div className="mt-1 h-3 rounded-r bg-[var(--grid)]">
            <div
              className="h-3 rounded-r bg-[var(--series-1)]"
              style={{ width: `${String(t.acceptRate ?? 0)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ClaudeCodePanel({ cc }: { cc: NonNullable<DashboardEngagement['claudeCode']> }) {
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">Claude Code</h3>
      <dl className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
        {codeFacts(cc).map((f) => (
          <div key={f.label} className="rounded-lg border border-[var(--border)] p-3">
            <dt className="text-sm text-[var(--text-secondary)]">{f.label}</dt>
            <dd className="tabular mt-1 text-xl font-semibold">{f.value}</dd>
          </div>
        ))}
      </dl>
      {cc.tools.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold">Suggestion accept rate by tool</h4>
          <p className="mt-0.5 mb-2 text-sm text-[var(--text-secondary)]">
            Accepted file-modification proposals, of accepted + rejected
          </p>
          <AcceptRateBars tools={cc.tools} />
          <TableView
            columns={['Tool', 'Accepted', 'Rejected', 'Accept rate']}
            rows={toolTableRows(cc)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Product engagement over the member-activity roll-up window (AN-3): members active per product
 * and summed counters (aggregates only), then Claude Code lines, commits, pull requests and the
 * suggestion accept rate per tool. Nothing for a `dashboard.json` without engagement.
 */
export function ProductEngagementSection({
  engagement,
}: {
  engagement: DashboardEngagement | undefined;
}) {
  if (!engagement) return null;
  const range = windowRange(engagement.window);
  const searches =
    engagement.webSearches === null
      ? null
      : `${formatInteger(engagement.webSearches)} web searches`;
  return (
    <Card
      title={engagementTitle(engagement.window)}
      subtitle={[
        range,
        'Members with activity per product and summed counts, no per-person values',
        searches,
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      <ProductTable engagement={engagement} />
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Active members: of {formatInteger(engagement.members)} members with an activity row.
        Sessions and conversations are distinct counts per member, summed.
      </p>
      {engagement.claudeCode && <ClaudeCodePanel cc={engagement.claudeCode} />}
    </Card>
  );
}
