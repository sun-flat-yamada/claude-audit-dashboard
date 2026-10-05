import { useMemo, useState } from 'react';
import {
  DETAIL_API_KEYS_PATH,
  DETAIL_MANIFEST_PATH,
  detailApiKeysSchema,
  detailManifestSchema,
  type DetailApiKeys,
} from '@claude-audit/core/contracts';
import { StatusBadge } from '../components/Badges';
import { Card, Empty } from '../components/Card';
import {
  CELL,
  detailNotice,
  FilterChips,
  HEAD,
  Notice,
  SearchField,
  SortControls,
} from '../components/DetailControls';
import { useDetailFile } from '../lib/detail-data';
import { formatTimestamp } from '../lib/format';
import {
  countByRecommendation,
  filterKeys,
  keyAgeDays,
  keyContext,
  keyFindings,
  keyRecommendation,
  KEY_RECOMMENDATIONS,
  scopeLabel,
  sortKeys,
  type ApiKey,
  type KeyContext,
  type KeyFilter,
  type KeyRecommendation,
  type KeyRecommendationFilter,
  type KeySortKey,
  type SortDirection,
} from '../lib/keys-view';
import { ScrollRegion } from '../components/ScrollRegion';

export interface ApiKeysProps {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const SUBJECT = { kind: 'api-keys', plural: 'API keys', title: 'API key' } as const;
const RECOMMENDATION_LABEL: Record<KeyRecommendationFilter, string> = {
  all: 'All',
  rotate: 'Rotate',
  unused: 'Unused',
  privileged: 'Write scope',
  rotate_soon: 'Rotate soon',
  unknown: 'Use unknown',
  ok: 'OK',
  inactive: 'Deactivated',
};
const SORT_LABEL: Record<KeySortKey, string> = {
  name: 'Name',
  age: 'Age',
  lastSeen: 'Last used',
  recommendation: 'Recommendation',
};
const SORT_KEYS = Object.keys(SORT_LABEL) as KeySortKey[];
const NEEDS_ACTION: readonly KeyRecommendation[] = ['rotate', 'unused', 'privileged'];

type Sort = { key: KeySortKey; direction: SortDirection };

function Summary({ data, ctx }: { data: DetailApiKeys; ctx: KeyContext }) {
  const counts = countByRecommendation(data.keys, ctx);
  const action = NEEDS_ACTION.reduce((sum, r) => sum + counts[r], 0);
  const active = data.keys.length - counts.inactive;
  return (
    <p className="text-sm text-[var(--text-secondary)]">
      {data.keys.length} keys ({active} active): {action} need action. A key is old after{' '}
      {data.maxAgeDays} days (AK-003) and unused after {data.unusedDays} days without API calls
      (AK-001). Ages are counted at {formatTimestamp(data.generatedAt)}.
      {data.usageObservedFrom
        ? ` Key usage has been observed since ${data.usageObservedFrom.slice(0, 10)}.`
        : ' Key usage was not observed.'}{' '}
      Key secrets are never collected or shown.
    </p>
  );
}

function Controls({
  filter,
  onFilter,
  sort,
  onSort,
}: {
  filter: KeyFilter;
  onFilter: (next: KeyFilter) => void;
  sort: Sort;
  onSort: (next: Sort) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <SearchField
        label="Search keys"
        value={filter.query}
        onChange={(query) => onFilter({ ...filter, query })}
      />
      <SortControls
        keys={SORT_KEYS}
        labels={SORT_LABEL}
        sortKey={sort.key}
        descending={sort.direction === 'desc'}
        onChange={({ key, descending }) => onSort({ key, direction: descending ? 'desc' : 'asc' })}
      />
    </div>
  );
}

function KeyRow({ apiKey, ctx }: { apiKey: ApiKey; ctx: KeyContext }) {
  const recommendation = keyRecommendation(apiKey, ctx);
  const age = keyAgeDays(apiKey, ctx);
  return (
    <tr data-recommendation={recommendation}>
      <th scope="row" className={`${CELL} text-left font-medium`}>
        {apiKey.name}
        <span className="block font-mono text-xs font-normal text-[var(--text-secondary)]">
          {apiKey.id}
        </span>
      </th>
      <td className={CELL}>
        {apiKey.scopes.length === 0 ? (
          <span className="text-[var(--text-muted)]">No scopes</span>
        ) : (
          <ul className="space-y-0.5 text-xs">
            {apiKey.scopes.map((scope) => (
              <li key={scope}>{scopeLabel(scope)}</li>
            ))}
          </ul>
        )}
      </td>
      <td className={`${CELL} tabular`}>{age === null ? '–' : `${age} days`}</td>
      <td className={`${CELL} tabular`}>
        {apiKey.expiresAt ? formatTimestamp(apiKey.expiresAt) : 'No expiry'}
      </td>
      <td className={`${CELL} tabular`}>
        {apiKey.lastSeenAt ? (
          formatTimestamp(apiKey.lastSeenAt)
        ) : (
          <span className="text-[var(--text-muted)]">Not seen</span>
        )}
      </td>
      <td className={CELL}>
        <StatusBadge status={`key-${recommendation}`} />
        <ul className="mt-1 space-y-0.5 text-xs text-[var(--text-secondary)]">
          {keyFindings(apiKey, ctx).map((finding) => (
            <li key={finding.kind}>{finding.detail}</li>
          ))}
        </ul>
      </td>
    </tr>
  );
}

const COLUMNS = ['Key', 'Scopes', 'Age', 'Expires', 'Last used', 'Recommendation'];

function KeysTable({ keys, ctx }: { keys: readonly ApiKey[]; ctx: KeyContext }) {
  return (
    <ScrollRegion label="API keys" className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">API keys</caption>
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
          {keys.map((apiKey) => (
            <KeyRow key={apiKey.id} apiKey={apiKey} ctx={ctx} />
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function KeysContent({ data, masked }: { data: DetailApiKeys; masked: boolean | null }) {
  const [filter, setFilter] = useState<KeyFilter>({ query: '', recommendation: 'all' });
  const [sort, setSort] = useState<Sort>({ key: 'recommendation', direction: 'asc' });
  const ctx = useMemo(() => keyContext(data), [data]);
  const shown = useMemo(
    () => sortKeys(filterKeys(data.keys, filter, ctx), sort.key, sort.direction, ctx),
    [data.keys, filter, sort, ctx],
  );
  return (
    <div className="space-y-6">
      <Summary data={data} ctx={ctx} />
      {masked !== null && (
        <p className="text-sm text-[var(--text-secondary)]">
          {masked
            ? 'Key IDs are masked (maskPii is on).'
            : 'Key IDs are shown unmasked (maskPii is off).'}
        </p>
      )}
      <Card title="API keys" subtitle={`${shown.length} of ${data.keys.length} shown`}>
        <div className="space-y-3">
          <Controls filter={filter} onFilter={setFilter} sort={sort} onSort={setSort} />
          <FilterChips
            label="Filter by recommendation"
            options={['all', ...KEY_RECOMMENDATIONS]}
            labels={RECOMMENDATION_LABEL}
            value={filter.recommendation}
            counts={countByRecommendation(data.keys, ctx)}
            total={data.keys.length}
            onChange={(recommendation) => setFilter({ ...filter, recommendation })}
          />
          {data.keys.length === 0 ? (
            <Empty>No API keys in this organization.</Empty>
          ) : shown.length === 0 ? (
            <Empty>No keys match the current filters.</Empty>
          ) : (
            <KeysTable keys={shown} ctx={ctx} />
          )}
        </div>
      </Card>
    </div>
  );
}

export function ApiKeys(options: ApiKeysProps = {}) {
  const keys = useDetailFile(DETAIL_API_KEYS_PATH, detailApiKeysSchema, options);
  const manifest = useDetailFile(DETAIL_MANIFEST_PATH, detailManifestSchema, options);
  const notice = detailNotice(keys, manifest, SUBJECT);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">API keys</h1>
      {notice && <Notice role={notice.role}>{notice.text}</Notice>}
      {keys.status === 'ready' && (
        <KeysContent
          data={keys.data}
          masked={manifest.status === 'ready' ? manifest.data.maskPii : null}
        />
      )}
    </div>
  );
}
