import { useMemo } from 'react';
import {
  COMPARE_INDEX_PATH,
  comparePointPath,
  compareIndexSchema,
  DETAIL_MANIFEST_PATH,
  detailManifestSchema,
  diffTimePoints,
  timePointSummarySchema,
  type ComparePoint,
  type CompareIndex,
  type TimePointSummary,
} from '@claude-audit/core/contracts';
import { Card } from '../components/Card';
import { detailNotice, FIELD, Notice, SelectField } from '../components/DetailControls';
import {
  checkPoint,
  defaultSelection,
  formatPointId,
  pointLabel,
  selectablePoints,
} from '../lib/compare-view';
import { useDetailFile, type DetailState } from '../lib/detail-data';
import { replaceQuery, useHashQuery } from '../lib/router';
import { CoverageCard, ExportBar, KpiCard, RuleChangesCard, SummaryCard } from './ComparisonParts';

export interface CompareProps {
  /** Currency of the tenant's cost figures (the overview's `usage.currency`). */
  currency?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const SUBJECT = {
  kind: 'compare',
  plural: 'time-point comparison data',
  title: 'Comparison',
} as const;

const PATH = '/compare';

function PointSelect({
  label,
  value,
  points,
  onChange,
}: {
  label: string;
  value: string;
  points: readonly ComparePoint[];
  onChange: (id: string) => void;
}) {
  const known = points.some((p) => p.id === value);
  return (
    <SelectField label={label} value={known ? value : ''} onChange={onChange}>
      {!known && (
        <option value="" disabled>
          Select a time point
        </option>
      )}
      {points.map((p) => (
        <option key={p.id} value={p.id} disabled={p.state === 'archived'}>
          {pointLabel(p)}
        </option>
      ))}
    </SelectField>
  );
}

function Selectors({
  points,
  base,
  target,
}: {
  points: readonly ComparePoint[];
  base: string;
  target: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <PointSelect
        label="Base time point"
        value={base}
        points={points}
        onChange={(id) => replaceQuery(PATH, { base: id, target })}
      />
      <PointSelect
        label="Target time point"
        value={target}
        points={points}
        onChange={(id) => replaceQuery(PATH, { base, target: id })}
      />
      <button
        type="button"
        className={FIELD}
        onClick={() => replaceQuery(PATH, { base: target, target: base })}
      >
        Swap base and target
      </button>
    </div>
  );
}

function ArchivedGuide({ points }: { points: readonly ComparePoint[] }) {
  const archived = points.filter((p) => p.state === 'archived');
  if (archived.length === 0) return null;
  return (
    <Card
      title="Archived time points"
      subtitle={`${archived.length} archived ${archived.length === 1 ? 'point has' : 'points have'} no summary and cannot be selected yet.`}
    >
      <p className="text-sm text-[var(--text-secondary)]">
        Bring a snapshot back with <code>pnpm cli restore &lt;id&gt;</code>, then write its summary
        with <code>pnpm build:detail --snapshot &lt;id&gt;</code>. It is selectable after the next
        publication.
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {archived.map((p) => (
          <li key={p.id} className="tabular">
            {formatPointId(p.id)}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Why a point file is not usable yet, or null when it is ready. */
function fileNotice(file: DetailState<TimePointSummary>, id: string) {
  if (file.status === 'loading')
    return { role: 'status', text: 'Loading the comparison…' } as const;
  if (file.status === 'missing')
    return {
      role: 'status',
      text: `The summary of ${formatPointId(id)} is listed but not published.`,
    } as const;
  if (file.status === 'error')
    return { role: 'alert', text: `Failed to load the summary of ${id}: ${file.message}` } as const;
  return null;
}

function Results({
  baseId,
  targetId,
  currency,
  options,
}: {
  baseId: string;
  targetId: string;
  currency: string;
  options: Pick<CompareProps, 'baseUrl' | 'fetchImpl'>;
}) {
  const base = useDetailFile(comparePointPath(baseId), timePointSummarySchema, options);
  const target = useDetailFile(comparePointPath(targetId), timePointSummarySchema, options);
  const diff = useMemo(
    () =>
      base.status === 'ready' && target.status === 'ready'
        ? diffTimePoints(base.data, target.data)
        : null,
    [base, target],
  );
  const notice = fileNotice(base, baseId) ?? fileNotice(target, targetId);
  if (notice) return <Notice role={notice.role}>{notice.text}</Notice>;
  if (!diff || base.status !== 'ready' || target.status !== 'ready') return null;
  return (
    <div className="space-y-6">
      {baseId === targetId && (
        <Notice role="status">
          Base and target are the same time point, so there is nothing to compare.
        </Notice>
      )}
      <SummaryCard diff={diff} />
      <ExportBar diff={diff} />
      <RuleChangesCard diff={diff} base={base.data} target={target.data} />
      <CoverageCard diff={diff} />
      <KpiCard diff={diff} currency={currency} />
    </div>
  );
}

/** What is wrong with a chosen id (unknown or archived), as a message; null when usable. */
function selectionProblem(
  points: readonly ComparePoint[],
  role: string,
  id: string,
): string | null {
  const check = checkPoint(points, id);
  if (check.status === 'unknown')
    return `The ${role} time point "${id}" is not in the list of comparable points. Choose one below.`;
  if (check.status === 'archived')
    return `The ${role} time point ${formatPointId(id)} is archived without a summary: restore it first (see below).`;
  return null;
}

function CompareContent({
  index,
  currency,
  options,
}: {
  index: CompareIndex;
  currency: string;
  options: Pick<CompareProps, 'baseUrl' | 'fetchImpl'>;
}) {
  const query = useHashQuery();
  const selectable = selectablePoints(index.points);
  if (selectable.length < 2)
    return (
      <div className="space-y-6">
        <Notice role="status">
          {`Comparison is not possible yet: ${selectable.length === 0 ? 'no' : 'only one'} collected time point has a summary, and two are needed. The next collection adds one.`}
        </Notice>
        <ArchivedGuide points={index.points} />
      </div>
    );
  const { base, target } = defaultSelection(index.points, query);
  const problems = [
    selectionProblem(index.points, 'base', base),
    selectionProblem(index.points, 'target', target),
  ].filter((p): p is string => p !== null);
  return (
    <div className="space-y-6">
      <Selectors points={index.points} base={base} target={target} />
      {problems.map((text) => (
        <Notice key={text} role="alert">
          {text}
        </Notice>
      ))}
      {problems.length === 0 && (
        <Results baseId={base} targetId={target} currency={currency} options={options} />
      )}
      <ArchivedGuide points={index.points} />
    </div>
  );
}

export function Compare({ currency = 'USD', ...options }: CompareProps = {}) {
  const index = useDetailFile(COMPARE_INDEX_PATH, compareIndexSchema, options);
  const manifest = useDetailFile(DETAIL_MANIFEST_PATH, detailManifestSchema, options);
  const notice = detailNotice(index, manifest, SUBJECT);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Compare time points</h1>
      <p className="text-[var(--text-secondary)]">
        See which rules regressed or improved, which datasets changed their collection state and how
        the key figures moved between two collections.
      </p>
      {notice && <Notice role={notice.role}>{notice.text}</Notice>}
      {index.status === 'ready' && (
        <CompareContent index={index.data} currency={currency} options={options} />
      )}
    </div>
  );
}
