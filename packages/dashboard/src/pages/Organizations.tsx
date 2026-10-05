import { useMemo, useState } from 'react';
import type { DetailOrgGroups } from '@claude-audit/core/contracts';
import { Card, Empty } from '../components/Card';
import { DeviationsTable } from '../components/DeviationsTable';
import { CELL, HEAD, Notice, SearchField } from '../components/DetailControls';
import {
  deviationsFor,
  filterGroups,
  filterOrganizations,
  orgSummaries,
  type Group,
  type OrgSummary,
} from '../lib/drilldown-view';
import { formatInteger, formatMoney } from '../lib/format';
import { formatHash } from '../lib/router';
import { useOrgGroups, type DrilldownOptions } from './useOrgGroups';

export const countText = (value: number | null): string =>
  value === null ? 'Not available' : formatInteger(value);

export const costText = (group: Group, currency: string): string =>
  group.monthToDateCost === null ? 'Not collected' : formatMoney(group.monthToDateCost, currency);

function OrganizationsTable({ rows }: { rows: readonly OrgSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Linked organizations</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              Organization
            </th>
            <th scope="col" className={HEAD}>
              Members
            </th>
            <th scope="col" className={HEAD}>
              Configuration deviations
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ organization, deviations }) => (
            <tr key={organization.id}>
              <th scope="row" className={`${CELL} text-left font-medium`}>
                <a className="underline" href={formatHash(`/orgs/${organization.id}`)}>
                  {organization.name}
                </a>
              </th>
              <td className={`${CELL} tabular`}>{countText(organization.memberCount)}</td>
              <td className={`${CELL} tabular`}>{deviations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupsTable({ groups, currency }: { groups: readonly Group[]; currency: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">RBAC groups</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              Group
            </th>
            <th scope="col" className={HEAD}>
              Source
            </th>
            <th scope="col" className={HEAD}>
              Members
            </th>
            <th scope="col" className={HEAD}>
              Month-to-date spend
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.id}>
              <th scope="row" className={`${CELL} text-left font-medium`}>
                <a className="underline" href={formatHash(`/groups/${group.id}`)}>
                  {group.name}
                </a>
              </th>
              <td className={CELL}>{group.source}</td>
              <td className={`${CELL} tabular`}>{countText(group.memberCount)}</td>
              <td className={`${CELL} tabular`}>{costText(group, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrganizationsContent({ data }: { data: DetailOrgGroups }) {
  const [query, setQuery] = useState('');
  const summaries = useMemo(() => orgSummaries(data), [data]);
  const orgs = filterOrganizations(summaries, query);
  const groups = filterGroups(data.groups, query);
  const unattributed = deviationsFor(data, null);
  return (
    <div className="space-y-6">
      <SearchField label="Search organizations and groups" value={query} onChange={setQuery} />
      <Card title="Organizations" subtitle={`${orgs.length} of ${data.organizations.length} shown`}>
        {data.organizations.length === 0 ? (
          <Empty>No linked organizations.</Empty>
        ) : orgs.length === 0 ? (
          <Empty>No organizations match the search.</Empty>
        ) : (
          <OrganizationsTable rows={orgs} />
        )}
      </Card>
      <Card
        title="RBAC groups"
        subtitle={`${groups.length} of ${data.groups.length} shown. Groups overlap, so spend is not additive.`}
      >
        {data.groups.length === 0 ? (
          <Empty>No RBAC groups.</Empty>
        ) : groups.length === 0 ? (
          <Empty>No groups match the search.</Empty>
        ) : (
          <GroupsTable groups={groups} currency={data.currency} />
        )}
      </Card>
      {unattributed.length > 0 && (
        <Card
          title="Unattributed deviations"
          subtitle="Configuration deviations whose evidence does not identify a linked organization."
        >
          <DeviationsTable caption="Unattributed deviations" deviations={unattributed} />
        </Card>
      )}
    </div>
  );
}

export function Organizations(options: DrilldownOptions = {}) {
  const { file, notice } = useOrgGroups(options);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Organizations</h1>
      {notice && <Notice role={notice.role}>{notice.text}</Notice>}
      {file.status === 'ready' && <OrganizationsContent data={file.data} />}
    </div>
  );
}
