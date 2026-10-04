import { useMemo, useState, type ReactNode } from 'react';
import {
  DETAIL_MANIFEST_PATH,
  DETAIL_MEMBERS_PATH,
  detailManifestSchema,
  detailMembersSchema,
  type DetailManifest,
  type DetailMembers,
} from '@claude-audit/core/contracts';
import { StatusBadge } from '../components/Badges';
import { Card, Empty } from '../components/Card';
import { useDetailFile, type DetailState } from '../lib/detail-data';
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
const FIELD =
  'rounded border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]';
const CELL = 'border-b border-[var(--grid)] px-2 py-2 align-top [overflow-wrap:anywhere]';
const HEAD = 'border-b border-[var(--border)] px-2 py-2 font-medium';

function Notice({ role, children }: { role: 'status' | 'alert'; children: string }) {
  return (
    <p role={role} className="text-[var(--text-secondary)]">
      {children}
    </p>
  );
}

/** Why there is no member table: not published, not collected, or a real failure. */
function unavailableMessage(
  members: DetailState<DetailMembers>,
  manifest: DetailState<DetailManifest>,
): { role: 'status' | 'alert'; text: string } | null {
  if (members.status === 'loading') return { role: 'status', text: 'Loading members…' };
  if (members.status === 'error')
    return { role: 'alert', text: `Failed to load members: ${members.message}` };
  if (members.status === 'ready') return null;
  const entry =
    manifest.status === 'ready'
      ? manifest.data.files.find((f) => f.kind === 'members' && f.status === 'unavailable')
      : undefined;
  if (entry) {
    const reason = entry.reason ? ` (${entry.reason})` : '';
    return { role: 'status', text: `Member data was not collected${reason}.` };
  }
  return {
    role: 'status',
    text: 'Member data is not published. Detail files are only available for sample data or when the owner enabled PAGES_DETAIL_DATA on a private deployment.',
  };
}

function Summary({ members, inactiveDays }: { members: readonly Member[]; inactiveDays: number }) {
  const counts = countByStatus(members);
  return (
    <p className="text-sm text-[var(--text-secondary)]">
      {members.length} members: {counts.active} active, {counts.inactive} inactive, {counts.unknown}{' '}
      unknown. A member is inactive after {inactiveDays} days without activity (AC-001).
    </p>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
        {children}
      </select>
    </label>
  );
}

type Sort = { key: SortKey; direction: SortDirection };

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
  const reversed = sort.direction === 'desc';
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1 text-sm">
        Search members
        <input
          type="search"
          value={filter.query}
          onChange={(e) => onFilter({ ...filter, query: e.target.value })}
          className={FIELD}
        />
      </label>
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
      <SelectField
        label="Sort by"
        value={sort.key}
        onChange={(key) => onSort({ ...sort, key: key as SortKey })}
      >
        {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
          <option key={key} value={key}>
            {SORT_LABEL[key]}
          </option>
        ))}
      </SelectField>
      <button
        type="button"
        aria-pressed={reversed}
        onClick={() => onSort({ ...sort, direction: reversed ? 'asc' : 'desc' })}
        className={`${FIELD} aria-pressed:bg-[var(--text-primary)] aria-pressed:text-[var(--page)]`}
      >
        Descending
      </button>
    </div>
  );
}

function StatusFilters({
  value,
  counts,
  total,
  onChange,
}: {
  value: StatusFilter;
  counts: Record<string, number>;
  total: number;
  onChange: (next: StatusFilter) => void;
}) {
  const options: StatusFilter[] = ['all', ...MEMBER_STATUSES];
  return (
    <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className="rounded-full border border-[var(--border)] px-3 py-1 text-sm aria-pressed:bg-[var(--text-primary)] aria-pressed:text-[var(--page)]"
        >
          {STATUS_LABEL[option]}{' '}
          <span className="tabular">{option === 'all' ? total : counts[option]}</span>
        </button>
      ))}
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
    <div className="overflow-x-auto">
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
    </div>
  );
}

function InvitesTable({ invites }: { invites: DetailMembers['invites'] }) {
  return (
    <div className="overflow-x-auto">
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
    </div>
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
          <StatusFilters
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
  const notice = unavailableMessage(members, manifest);
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
