import { useMemo, useState } from 'react';
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
  actorBadge,
  actorKindLabel,
  activityMonths,
  activityUnavailable,
  filterActivity,
  monthEnd,
  monthLabel,
  NO_ACTIVITY_FILTER,
  pageCount,
  pageSlice,
  typeLabel,
  uniqueActorKinds,
  uniqueTypes,
  type ActivityFilter,
  type ActivityItem,
} from '../lib/activity-view';
import { useDetailFile } from '../lib/detail-data';
import { formatTimestamp } from '../lib/format';

export interface ActivityProps {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const SUBJECT = { kind: 'activity', plural: 'activity', title: 'Activity' } as const;
const COLUMNS = ['Time', 'Activity', 'Actor', 'Identity', 'Organization'];

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
    <div className="overflow-x-auto">
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
          {rows.map((item) => (
            <tr key={item.id}>
              <th scope="row" className={`${CELL} tabular text-left font-normal`}>
                {formatTimestamp(item.createdAt)}
              </th>
              <td className={CELL}>{typeLabel(item.type)}</td>
              <td className={CELL}>
                <StatusBadge status={actorBadge(item.actor.kind)} />
              </td>
              <td className={CELL}>
                <Identity actor={item.actor} />
              </td>
              <td className={`${CELL} font-mono text-xs`}>{item.organizationId ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function MonthContent({ data }: { data: DetailActivity }) {
  const [filter, setFilter] = useState<ActivityFilter>(NO_ACTIVITY_FILTER);
  const [page, setPage] = useState(1);
  const matches = useMemo(() => filterActivity(data.items, filter), [data.items, filter]);
  const pages = pageCount(matches.length);
  const current = Math.min(page, pages);
  const first = (current - 1) * ACTIVITY_PAGE_SIZE + 1;
  return (
    <div className="space-y-3">
      {data.truncated && (
        <Notice role="status">
          {`This month has ${data.total} activities; the file keeps only the newest ${data.items.length}. Older activities of ${monthLabel(data.month)} are not shown.`}
        </Notice>
      )}
      <Filters
        items={data.items}
        month={data.month}
        filter={filter}
        onChange={(next) => {
          setFilter(next);
          setPage(1);
        }}
      />
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
          <Pager page={current} pages={pages} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function MonthView({ month, options }: { month: string; options: ActivityProps }) {
  const file = useDetailFile(detailActivityPath(month), detailActivitySchema, options);
  if (file.status === 'loading')
    return <Notice role="status">{`Loading ${monthLabel(month)}…`}</Notice>;
  if (file.status === 'error')
    return <Notice role="alert">{`Failed to load ${monthLabel(month)}: ${file.message}`}</Notice>;
  if (file.status === 'missing')
    return (
      <Notice role="status">{`Activity for ${monthLabel(month)} is listed but not published.`}</Notice>
    );
  return <MonthContent data={file.data} />;
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

function ActivityContent({
  manifest,
  options,
}: {
  manifest: DetailManifest;
  options: ActivityProps;
}) {
  const months = activityMonths(manifest).map((m) => m.month);
  const [chosen, setChosen] = useState<string | null>(null);
  const month = chosen && months.includes(chosen) ? chosen : months[0];
  const unavailable = activityUnavailable(manifest);
  if (!month) {
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
      <Card title="Activity timeline" subtitle={`${monthLabel(month)}, newest first`}>
        <div className="space-y-3">
          <MonthPicker months={months} value={month} onChange={setChosen} />
          <MonthView key={month} month={month} options={options} />
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
