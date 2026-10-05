import { useMemo, useState } from 'react';
import {
  DETAIL_ARCHIVE_PATH,
  DETAIL_MANIFEST_PATH,
  detailArchiveSchema,
  detailManifestSchema,
  type ArchiveYear,
  type DetailArchive,
} from '@claude-audit/core/contracts';
import { StatusBadge } from '../components/Badges';
import { Card, Empty } from '../components/Card';
import { CELL, detailNotice, HEAD, Notice, SearchField } from '../components/DetailControls';
import { filterYears, formatBytes, formatSnapshotId, sizeShare } from '../lib/archive-view';
import { useDetailFile } from '../lib/detail-data';
import { formatInteger, formatPercent, formatTimestamp } from '../lib/format';

export interface ArchiveProps {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const SUBJECT = { kind: 'archive', plural: 'archive inventory', title: 'Archive' } as const;

const statusOf = (data: DetailArchive): string => {
  if (data.totals.snapshots === 0) return 'archive-empty';
  return data.ignoredEntries > 0 ? 'archive-ignored' : 'archive-ok';
};

function Totals({ data }: { data: DetailArchive }) {
  const { totals } = data;
  const rows: [string, string][] = [
    ['Archived snapshots', formatInteger(totals.snapshots)],
    ['Compressed size', formatBytes(totals.bytes)],
    ['Years covered', formatInteger(totals.years)],
    ['Oldest snapshot', totals.oldest ? formatSnapshotId(totals.oldest) : '–'],
    ['Newest snapshot', totals.newest ? formatSnapshotId(totals.newest) : '–'],
    ['Retention before archiving', `${formatInteger(data.snapshotDays)} days`],
  ];
  return (
    <Card
      title="Archive totals"
      subtitle={`Inventory built at ${formatTimestamp(data.generatedAt)}. Snapshots older than the retention period are moved to the archive by the archive command.`}
    >
      <div className="space-y-4">
        <StatusBadge status={statusOf(data)} />
        <dl
          aria-label="Archive totals"
          className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3"
        >
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[var(--text-secondary)]">{label}</dt>
              <dd className="tabular font-medium [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
        {data.ignoredEntries > 0 && (
          <p className="text-sm text-[var(--text-secondary)]">
            {formatInteger(data.ignoredEntries)} unrecognized{' '}
            {data.ignoredEntries === 1 ? 'entry was' : 'entries were'} ignored (not named here).
          </p>
        )}
      </div>
    </Card>
  );
}

const COLUMNS = ['Year', 'Snapshots', 'Compressed size', 'Share of size', 'Oldest', 'Newest'];

function YearsTable({ years, totalBytes }: { years: readonly ArchiveYear[]; totalBytes: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Archive by year</caption>
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
          {years.map((y) => (
            <tr key={y.year}>
              <th scope="row" className={`${CELL} text-left font-medium`}>
                {y.year}
              </th>
              <td className={`${CELL} tabular`}>{formatInteger(y.snapshots)}</td>
              <td className={`${CELL} tabular`}>{formatBytes(y.bytes)}</td>
              <td className={`${CELL} tabular`}>{formatPercent(sizeShare(y.bytes, totalBytes))}</td>
              <td className={`${CELL} tabular`}>{formatSnapshotId(y.oldest)}</td>
              <td className={`${CELL} tabular`}>{formatSnapshotId(y.newest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArchiveContent({ data }: { data: DetailArchive }) {
  const [query, setQuery] = useState('');
  const years = useMemo(() => filterYears(data.years, query), [data.years, query]);
  if (data.totals.snapshots === 0)
    return (
      <div className="space-y-6">
        <Totals data={data} />
        <Empty>
          No archived snapshots yet. Snapshots move to the archive once they are older than{' '}
          {formatInteger(data.snapshotDays)} days.
        </Empty>
      </div>
    );
  return (
    <div className="space-y-6">
      <Totals data={data} />
      <SearchField label="Search years" value={query} onChange={setQuery} />
      <Card
        title="Archive by year"
        subtitle={`${years.length} of ${data.years.length} years shown`}
      >
        {years.length === 0 ? (
          <Empty>No years match the current search.</Empty>
        ) : (
          <YearsTable years={years} totalBytes={data.totals.bytes} />
        )}
      </Card>
    </div>
  );
}

export function Archive(options: ArchiveProps = {}) {
  const archive = useDetailFile(DETAIL_ARCHIVE_PATH, detailArchiveSchema, options);
  const manifest = useDetailFile(DETAIL_MANIFEST_PATH, detailManifestSchema, options);
  const notice = detailNotice(archive, manifest, SUBJECT);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Archive</h1>
      {notice && <Notice role={notice.role}>{notice.text}</Notice>}
      {archive.status === 'ready' && <ArchiveContent data={archive.data} />}
    </div>
  );
}
