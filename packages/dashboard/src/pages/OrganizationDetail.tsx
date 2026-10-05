import {
  DETAIL_MANIFEST_PATH,
  DETAIL_MEMBERS_PATH,
  detailManifestSchema,
  detailMembersSchema,
  type DetailOrgGroups,
} from '@claude-audit/core/contracts';
import { StatusBadge } from '../components/Badges';
import { Card, Empty } from '../components/Card';
import { DeviationsTable } from '../components/DeviationsTable';
import { CELL, detailNotice, HEAD, Notice } from '../components/DetailControls';
import { useDetailFile } from '../lib/detail-data';
import {
  deviationsFor,
  findOrganization,
  membersAreScoped,
  membersOfOrganization,
  type Member,
} from '../lib/drilldown-view';
import { memberStatus, roleLabel } from '../lib/members-view';
import { BackLink, NotFoundNotice } from './DrilldownParts';
import { countText } from './Organizations';
import { useOrgGroups, type DrilldownOptions } from './useOrgGroups';
import { ScrollRegion } from '../components/ScrollRegion';

function MemberRows({ members }: { members: readonly Member[] }) {
  return (
    <ScrollRegion label="Organization members" className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Organization members</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              Member
            </th>
            <th scope="col" className={HEAD}>
              Role
            </th>
            <th scope="col" className={HEAD}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <th scope="row" className={`${CELL} text-left font-medium`}>
                {m.name}
                <span className="block text-xs font-normal text-[var(--text-secondary)]">
                  {m.email}
                </span>
              </th>
              <td className={CELL}>{roleLabel(m.role)}</td>
              <td className={CELL}>
                <StatusBadge status={memberStatus(m)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

const MEMBERS_SUBJECT = { kind: 'members', plural: 'members', title: 'Member' } as const;

function OrganizationMembers({
  organizationId,
  options,
}: {
  organizationId: string;
  options: DrilldownOptions;
}) {
  const members = useDetailFile(DETAIL_MEMBERS_PATH, detailMembersSchema, options);
  const manifest = useDetailFile(DETAIL_MANIFEST_PATH, detailManifestSchema, options);
  const notice = detailNotice(members, manifest, MEMBERS_SUBJECT);
  if (notice) return <Notice role={notice.role}>{notice.text}</Notice>;
  if (members.status !== 'ready') return null;
  if (!membersAreScoped(members.data.members))
    return <Empty>Members carry no organization in this data, so no member list is shown.</Empty>;
  const rows = membersOfOrganization(members.data.members, organizationId);
  const masked = manifest.status === 'ready' ? manifest.data.maskPii : null;
  return (
    <div className="space-y-3">
      {masked !== null && (
        <p className="text-sm text-[var(--text-secondary)]">
          {masked
            ? 'Names and e-mail addresses are masked (maskPii is on).'
            : 'Names and e-mail addresses are shown unmasked (maskPii is off).'}
        </p>
      )}
      {rows.length === 0 ? (
        <Empty>No members in this organization.</Empty>
      ) : (
        <MemberRows members={rows} />
      )}
    </div>
  );
}

function OrganizationContent({
  data,
  id,
  options,
}: {
  data: DetailOrgGroups;
  id: string;
  options: DrilldownOptions;
}) {
  const organization = findOrganization(data, id);
  if (!organization) return <NotFoundNotice kind="Organization" />;
  const deviations = deviationsFor(data, id);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{organization.name}</h1>
      <p className="text-sm text-[var(--text-secondary)]">
        Members: {countText(organization.memberCount)}. Spend is attributed to RBAC groups, not to
        organizations; see the groups on the Organizations page.
      </p>
      <Card title="Configuration deviations" subtitle={`${deviations.length} found`}>
        {deviations.length === 0 ? (
          <Empty>No configuration deviations for this organization.</Empty>
        ) : (
          <DeviationsTable caption="Configuration deviations" deviations={deviations} />
        )}
      </Card>
      <Card title="Members">
        <OrganizationMembers organizationId={id} options={options} />
      </Card>
    </div>
  );
}

export function OrganizationDetail({ id, ...options }: { id: string } & DrilldownOptions) {
  const { file, notice } = useOrgGroups(options);
  return (
    <div className="space-y-6">
      <BackLink />
      {file.status !== 'ready' && <h1 className="text-2xl font-semibold">Organization</h1>}
      {notice && <Notice role={notice.role}>{notice.text}</Notice>}
      {file.status === 'ready' && (
        <OrganizationContent data={file.data} id={id} options={options} />
      )}
    </div>
  );
}
