import { useMemo, useState } from 'react';
import {
  DETAIL_MANIFEST_PATH,
  DETAIL_MEMBERS_PATH,
  detailManifestSchema,
  detailMembersSchema,
  type DetailMembers,
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
  SelectField,
  SortControls,
} from '../components/DetailControls';
import { useDetailFile } from '../lib/detail-data';
import { formatTimestamp } from '../lib/format';
import {
  countByStatus,
  filterMembers,
  MEMBER_STATUSES,
  memberStatus,
  roleLabel,
  sortMembers,
  uniqueRoles,
  type Member,
  type MemberFilter,
  type SortDirection,
  type SortKey,
  type StatusFilter,
} from '../lib/members-view';
import { ScrollRegion } from '../components/ScrollRegion';

export interface MembersProps {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  active: 'Active',
  inactive: 'Inactive',
  unknown: 'Unknown',
};
const SORT_LABEL: Record<SortKey, string> = {
  name: 'Name',
  role: 'Role',
  lastActiveOn: 'Last active',
  status: 'Status',
};

const SUBJECT = { kind: 'members', plural: 'members', title: 'Member' } as const;

function Summary({ members, inactiveDays }: { members: readonly Member[]; inactiveDays: number }) {
  const counts = countByStatus(members);
  return (
    <p className="text-sm text-[var(--text-secondary)]">
      {members.length} members: {counts.active} active, {counts.inactive} inactive, {counts.unknown}{' '}
      unknown. A member is inactive after {inactiveDays} days without activity (AC-001).
    </p>
  );
}

type Sort = { key: SortKey; direction: SortDirection };
const SORT_KEYS = Object.keys(SORT_LABEL) as SortKey[];

function Controls({
  roles,
  filter,
  onFilter,
  sort,
  onSort,
}: {
  roles: string[];
  filter: MemberFilter;
  onFilter: (next: MemberFilter) => void;
  sort: Sort;
  onSort: (next: Sort) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <SearchField
        label="Search members"
        value={filter.query}
        onChange={(query) => onFilter({ ...filter, query })}
      />
      <SelectField
        label="Role"
        value={filter.role}
        onChange={(role) => onFilter({ ...filter, role })}
      >
        <option value="all">All roles</option>
        {roles.map((role) => (
          <option key={role} value={role}>
            {roleLabel(role)}
          </option>
        ))}
      </SelectField>
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

function MemberRow({ member }: { member: Member }) {
  const status = memberStatus(member);
  return (
    <tr
      data-status={status}
      className={
        status === 'inactive'
          ? 'bg-[color-mix(in_srgb,var(--status-warning)_14%,transparent)]'
          : undefined
      }
    >
      <th scope="row" className={`${CELL} text-left font-medium`}>
        {member.name}
        <span className="block text-xs font-normal text-[var(--text-secondary)]">
          {member.email}
        </span>
      </th>
      <td className={CELL}>{roleLabel(member.role)}</td>
      <td className={`${CELL} tabular`}>
        {member.lastActiveOn ?? (
          <span className="text-[var(--text-muted)]">No activity recorded</span>
        )}
      </td>
      <td className={CELL}>
        <StatusBadge status={status} />
      </td>
    </tr>
  );
}

function MembersTable({ members }: { members: readonly Member[] }) {
  return (
    <ScrollRegion label="Members" className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Members</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              Member
            </th>
            <th scope="col" className={HEAD}>
              Role
            </th>
            <th scope="col" className={HEAD}>
              Last active
            </th>
            <th scope="col" className={HEAD}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <MemberRow key={member.id} member={member} />
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function InvitesTable({ invites }: { invites: DetailMembers['invites'] }) {
  return (
    <ScrollRegion label="Pending invites" className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Pending invites</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              Invitee
            </th>
            <th scope="col" className={HEAD}>
              Role
            </th>
            <th scope="col" className={HEAD}>
              Status
            </th>
            <th scope="col" className={HEAD}>
              Invited
            </th>
            <th scope="col" className={HEAD}>
              Expires
            </th>
          </tr>
        </thead>
        <tbody>
          {invites.map((invite) => (
            <tr key={invite.id}>
              <th scope="row" className={`${CELL} text-left font-normal`}>
                {invite.email}
              </th>
              <td className={CELL}>{roleLabel(invite.role)}</td>
              <td className={CELL}>{roleLabel(invite.status)}</td>
              <td className={`${CELL} tabular`}>{formatTimestamp(invite.invitedAt)}</td>
              <td className={`${CELL} tabular`}>
                {invite.expiresAt ? formatTimestamp(invite.expiresAt) : '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function MembersContent({ data, masked }: { data: DetailMembers; masked: boolean | null }) {
  const [filter, setFilter] = useState<MemberFilter>({ query: '', role: 'all', status: 'all' });
  const [sort, setSort] = useState<Sort>({
    key: 'status',
    direction: 'asc',
  });
  const roles = useMemo(() => uniqueRoles(data.members), [data.members]);
  const shown = useMemo(
    () => sortMembers(filterMembers(data.members, filter), sort.key, sort.direction),
    [data.members, filter, sort],
  );
  return (
    <div className="space-y-6">
      <Summary members={data.members} inactiveDays={data.inactiveDays} />
      {masked !== null && (
        <p className="text-sm text-[var(--text-secondary)]">
          {masked
            ? 'Names and e-mail addresses are masked (maskPii is on).'
            : 'Names and e-mail addresses are shown unmasked (maskPii is off).'}
        </p>
      )}
      <Card title="Members" subtitle={`${shown.length} of ${data.members.length} shown`}>
        <div className="space-y-3">
          <Controls
            roles={roles}
            filter={filter}
            onFilter={setFilter}
            sort={sort}
            onSort={setSort}
          />
          <FilterChips
            label="Filter by status"
            options={['all', ...MEMBER_STATUSES]}
            labels={STATUS_LABEL}
            value={filter.status}
            counts={countByStatus(data.members)}
            total={data.members.length}
            onChange={(status) => setFilter({ ...filter, status })}
          />
          {data.members.length === 0 ? (
            <Empty>No members in this organization.</Empty>
          ) : shown.length === 0 ? (
            <Empty>No members match the current filters.</Empty>
          ) : (
            <MembersTable members={shown} />
          )}
        </div>
      </Card>
      {data.invites.length > 0 && (
        <Card title="Pending invites" subtitle={`${data.invites.length} invites`}>
          <InvitesTable invites={data.invites} />
        </Card>
      )}
    </div>
  );
}

export function Members(options: MembersProps = {}) {
  const members = useDetailFile(DETAIL_MEMBERS_PATH, detailMembersSchema, options);
  const manifest = useDetailFile(DETAIL_MANIFEST_PATH, detailManifestSchema, options);
  const notice = detailNotice(members, manifest, SUBJECT);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Members</h1>
      {notice && <Notice role={notice.role}>{notice.text}</Notice>}
      {members.status === 'ready' && (
        <MembersContent
          data={members.data}
          masked={manifest.status === 'ready' ? manifest.data.maskPii : null}
        />
      )}
    </div>
  );
}
