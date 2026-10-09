import { useCallback, useMemo } from 'react';
import {
  DETAIL_MANIFEST_PATH,
  detailActivityPath,
  detailActivitySchema,
  detailManifestSchema,
  type DetailActivity,
  type DetailManifest,
} from '@claude-audit/core/contracts';
import { StatusBadge } from '../components/Badges';
import { Card, Empty } from '../components/Card';
import { DailyActivityChart } from '../components/DailyActivityChart';
import {
  CELL,
  DateField,
  detailNotice,
  HEAD,
  Notice,
  SearchField,
  SelectField,
} from '../components/DetailControls';
import {
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_RULES,
  actorBadge,
  actorKindLabel,
  activityMonths,
  activityUnavailable,
  dailyActivityCounts,
  filterActivity,
  formatActivityQuery,
  matchActivityRules,
  monthEnd,
  monthLabel,
  pageCount,
  pageSlice,
  parseActivityQuery,
  typeLabel,
  uniqueActorKinds,
  uniqueTypes,
  type ActivityFilter,
  type ActivityItem,
  type ActivityRouteState,
} from '../lib/activity-view';
import { useDetailFile } from '../lib/detail-data';
import { formatTimestamp } from '../lib/format';
import { replaceQuery, useHashQuery } from '../lib/router';
import { ScrollRegion } from '../components/ScrollRegion';

export interface ActivityProps {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const SUBJECT = { kind: 'activity', plural: 'activity', title: 'Activity' } as const;
const COLUMNS = ['Time', 'Activity', 'Rule', 'Actor', 'Identity', 'Organization'];

function RuleSelect({
  value,
  onChange,
}: {
  value: ActivityRuleFilter;
  onChange: (rule: ActivityRuleFilter) => void;
}) {
  return (
    <SelectField label="Rule match" value={value} onChange={onChange}>
      <option value="all">All events</option>
      <option value="any">Any watch match</option>
      {ACTIVITY_RULES.map((r) => (
        <option key={r.id} value={r.id}>
          {r.id}: {r.name}
        </option>
      ))}
    </SelectField>
  );
}

function Filters({
  items,
  month,
  filter,
  onChange,
}: {
  items: readonly ActivityItem[];
  month: string;
  filter: ActivityFilter;
  onChange: (next: ActivityFilter) => void;
}) {
  const set = (patch: Partial<ActivityFilter>) => onChange({ ...filter, ...patch });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <SearchField
        label="Search activity"
        value={filter.query}
        onChange={(query) => set({ query })}
      />
      <SelectField label="Activity type" value={filter.type} onChange={(type) => set({ type })}>
        <option value="all">All types</option>
        {uniqueTypes(items).map((type) => (
          <option key={type} value={type}>
            {typeLabel(type)}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Actor kind"
        value={filter.actorKind}
        onChange={(actorKind) => set({ actorKind })}
      >
        <option value="all">All actors</option>
        {uniqueActorKinds(items).map((kind) => (
          <option key={kind} value={kind}>
            {actorKindLabel(kind)}
          </option>
        ))}
      </SelectField>
      <RuleSelect value={filter.rule} onChange={(rule) => set({ rule })} />
      <DateField
        label="From date"
        value={filter.from}
        min={`${month}-01`}
        max={monthEnd(month)}
        onChange={(from) => set({ from })}
      />
      <DateField
        label="To date"
        value={filter.to}
        min={`${month}-01`}
        max={monthEnd(month)}
        onChange={(to) => set({ to })}
      />
    </div>
  );
}

function Identity({ actor }: { actor: ActivityItem['actor'] }) {
  const parts = [actor.email, actor.id, actor.ip].filter((p): p is string => Boolean(p));
  if (parts.length === 0) return <span className="text-[var(--text-muted)]">None</span>;
  return (
    <ul className="space-y-0.5 font-mono text-xs">
      {parts.map((part) => (
        <li key={part}>{part}</li>
      ))}
    </ul>
  );
}

function Timeline({ rows }: { rows: readonly ActivityItem[] }) {
  return (
    <ScrollRegion label="Activity timeline" className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Activity timeline</caption>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className={HEAD}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const matched = matchActivityRules(item);
            return (
              <tr key={item.id}>
                <th scope="row" className={`${CELL} tabular text-left font-normal`}>
                  {formatTimestamp(item.createdAt)}
                </th>
                <td className={CELL}>{typeLabel(item.type)}</td>
                <td className={CELL}>
                  {matched.length === 0 ? (
                    <span className="text-[var(--text-muted)]">–</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {matched.map((r) => (
                        <span
                          key={r}
                          className="inline-flex items-center rounded border border-[var(--border)] px-1 py-0.5 font-mono text-[11px] font-medium text-[var(--status-warning)]"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className={CELL}>
                  <StatusBadge status={actorBadge(item.actor.kind)} />
                </td>
                <td className={CELL}>
                  <Identity actor={item.actor} />
                </td>
                <td className={`${CELL} font-mono text-xs`}>{item.organizationId ?? '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (next: number) => void;
}) {
  const button =
    'rounded border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1 text-sm disabled:opacity-50';
  return (
    <nav aria-label="Timeline pages" className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={button}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous page
      </button>
      <span className="tabular text-sm">
        Page {page} of {pages}
      </span>
      <button
        type="button"
        className={button}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next page
      </button>
    </nav>
  );
}

function MonthContent({
  data,
  filter,
  page,
  onFilterChange,
  onPageChange,
}: {
  data: DetailActivity;
  filter: ActivityFilter;
  page: number;
  onFilterChange: (next: ActivityFilter) => void;
  onPageChange: (next: number) => void;
}) {
  const matches = useMemo(() => filterActivity(data.items, filter), [data.items, filter]);
  const counts = useMemo(() => dailyActivityCounts(matches, data.month), [matches, data.month]);
  const pages = pageCount(matches.length);
  const current = Math.min(page, pages);
  const first = (current - 1) * ACTIVITY_PAGE_SIZE + 1;
  return (
    <div className="space-y-4">
      {data.truncated && (
        <Notice role="status">
          {`This month has ${data.total} activities; the file keeps only the newest ${data.items.length}. Older activities of ${monthLabel(data.month)} are not shown.`}
        </Notice>
      )}
      <Filters items={data.items} month={data.month} filter={filter} onChange={onFilterChange} />
      <DailyActivityChart counts={counts} month={monthLabel(data.month)} />
      {data.items.length === 0 ? (
        <Empty>No activity was recorded in {monthLabel(data.month)}.</Empty>
      ) : matches.length === 0 ? (
        <Empty>No activity matches the current filters.</Empty>
      ) : (
        <>
          <p role="status" className="text-sm text-[var(--text-secondary)]">
            {`Showing ${first}–${Math.min(current * ACTIVITY_PAGE_SIZE, matches.length)} of ${matches.length} matching activities (${data.total} in the month).`}
          </p>
          <Timeline rows={pageSlice(matches, current)} />
          <Pager page={current} pages={pages} onPage={onPageChange} />
        </>
      )}
    </div>
  );
}

function MonthView({
  month,
  filter,
  page,
  onFilterChange,
  onPageChange,
  options,
}: {
  month: string;
  filter: ActivityFilter;
  page: number;
  onFilterChange: (next: ActivityFilter) => void;
  onPageChange: (next: number) => void;
  options: ActivityProps;
}) {
  const file = useDetailFile(detailActivityPath(month), detailActivitySchema, options);
  if (file.status === 'loading')
    return <Notice role="status">{`Loading ${monthLabel(month)}…`}</Notice>;
  if (file.status === 'error')
    return <Notice role="alert">{`Failed to load ${monthLabel(month)}: ${file.message}`}</Notice>;
  if (file.status === 'missing')
    return (
      <Notice role="status">{`Activity for ${monthLabel(month)} is listed but not published.`}</Notice>
    );
  return (
    <MonthContent
      data={file.data}
      filter={filter}
      page={page}
      onFilterChange={onFilterChange}
      onPageChange={onPageChange}
    />
  );
}

function MonthPicker({
  months,
  value,
  onChange,
}: {
  months: readonly string[];
  value: string;
  onChange: (month: string) => void;
}) {
  return (
    <SelectField label="Month" value={value} onChange={onChange}>
      {months.map((month) => (
        <option key={month} value={month}>
          {monthLabel(month)}
        </option>
      ))}
    </SelectField>
  );
}

function useActivityRouteState(manifest: DetailManifest) {
  const months = useMemo(() => activityMonths(manifest).map((m) => m.month), [manifest]);
  const defaultMonth = months[0] ?? '';
  const query = useHashQuery();
  const state = useMemo(() => parseActivityQuery(query, months), [query, months]);

  const updateState = useCallback(
    (patch: Partial<ActivityRouteState>) => {
      const next: ActivityRouteState = {
        month: patch.month ?? state.month,
        filter: patch.filter ?? state.filter,
        page: patch.page ?? (patch.filter ? 1 : state.page),
      };
      replaceQuery('/activity', formatActivityQuery(next, defaultMonth));
    },
    [state, defaultMonth],
  );

  return { months, state, updateState };
}

function ActivityContent({
  manifest,
  options,
}: {
  manifest: DetailManifest;
  options: ActivityProps;
}) {
  const { months, state, updateState } = useActivityRouteState(manifest);

  const unavailable = activityUnavailable(manifest);
  if (!state.month) {
    const reason = unavailable?.reason ? ` (${unavailable.reason})` : '';
    return (
      <Notice role="status">
        {unavailable
          ? `Activity data was not collected${reason}.`
          : 'No activity files are listed in the manifest.'}
      </Notice>
    );
  }
  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--text-secondary)]">
        Activity is published per UTC month and only the selected month is loaded.{' '}
        {manifest.maskPii
          ? 'Identifiers, e-mail addresses and IPs are masked (maskPii is on).'
          : 'Identifiers, e-mail addresses and IPs are shown unmasked (maskPii is off).'}
      </p>
      <Card title="Activity timeline" subtitle={`${monthLabel(state.month)}, newest first`}>
        <div className="space-y-3">
          <MonthPicker
            months={months}
            value={state.month}
            onChange={(m) => updateState({ month: m, page: 1 })}
          />
          <MonthView
            key={state.month}
            month={state.month}
            filter={state.filter}
            page={state.page}
            onFilterChange={(f) => updateState({ filter: f, page: 1 })}
            onPageChange={(p) => updateState({ page: p })}
            options={options}
          />
        </div>
      </Card>
    </div>
  );
}

export function Activity(options: ActivityProps = {}) {
  const manifest = useDetailFile(DETAIL_MANIFEST_PATH, detailManifestSchema, options);
  const notice = detailNotice(manifest, manifest, SUBJECT);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Activity</h1>
      {notice && <Notice role={notice.role}>{notice.text}</Notice>}
      {manifest.status === 'ready' && (
        <ActivityContent manifest={manifest.data} options={options} />
      )}
    </div>
  );
}
