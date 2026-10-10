import {
  DETAIL_MANIFEST_PATH,
  DETAIL_MEMBERS_PATH,
  detailManifestSchema,
  detailMembersSchema,
  type DetailOrgGroups,
} from '@claude-audit/core/contracts';
import { Card, Empty } from '../components/Card';
import { detailNotice, Notice } from '../components/DetailControls';
import { useDetailFile } from '../lib/detail-data';
import { findGroup, membersOfGroup, spendShare } from '../lib/drilldown-view';
import { formatMoney } from '../lib/format';
import { BackLink, MemberRows, NotFoundNotice } from './DrilldownParts';
import { countText } from './Organizations';
import { useOrgGroups, type DrilldownOptions } from './useOrgGroups';

const MEMBERS_SUBJECT = { kind: 'members', plural: 'members', title: 'Member' } as const;

function GroupMembers({
  group,
  options,
}: {
  group: DetailOrgGroups['groups'][number];
  options: DrilldownOptions;
}) {
  const members = useDetailFile(DETAIL_MEMBERS_PATH, detailMembersSchema, options);
  const manifest = useDetailFile(DETAIL_MANIFEST_PATH, detailManifestSchema, options);
  const notice = detailNotice(members, manifest, MEMBERS_SUBJECT);
  if (notice) return <Notice role={notice.role}>{notice.text}</Notice>;
  if (members.status !== 'ready') return null;
  if (!group.memberIds)
    return (
      <Empty>Member list was not collected for this group, only member count is available.</Empty>
    );
  const rows = membersOfGroup(members.data.members, group);
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
        <Empty>No members in this group.</Empty>
      ) : (
        <MemberRows label="Group members" members={rows} />
      )}
    </div>
  );
}

function GroupContent({
  data,
  id,
  options,
}: {
  data: DetailOrgGroups;
  id: string;
  options: DrilldownOptions;
}) {
  const group = findGroup(data, id);
  if (!group) return <NotFoundNotice kind="Group" />;
  const share = spendShare(group, data.groups);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{group.name}</h1>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-[var(--text-secondary)]">Source</dt>
          <dd>{group.source}</dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--text-secondary)]">Members</dt>
          <dd className="tabular">{countText(group.memberCount)}</dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--text-secondary)]">Month-to-date spend</dt>
          <dd className="tabular">
            {group.monthToDateCost === null
              ? 'Not collected'
              : formatMoney(group.monthToDateCost, data.currency)}
          </dd>
        </div>
      </dl>
      <Card title="Spend breakdown">
        {share === null ? (
          <Empty>Cost data was not collected, so there is no spend breakdown.</Empty>
        ) : (
          <p className="text-sm">
            <span className="tabular">{share}%</span> of the highest-spending group. Groups overlap
            (a person can belong to several), so group spend must not be added up.
          </p>
        )}
      </Card>
      <Card title="Configuration deviations">
        <p className="text-sm text-[var(--text-secondary)]">
          Configuration deviations are evaluated per organization (see Organizations page), not per
          RBAC group.
        </p>
      </Card>
      <Card title="Members">
        <GroupMembers group={group} options={options} />
      </Card>
    </div>
  );
}

export function GroupDetail({ id, ...options }: { id: string } & DrilldownOptions) {
  const { file, notice } = useOrgGroups(options);
  return (
    <div className="space-y-6">
      <BackLink />
      {file.status !== 'ready' && <h1 className="text-2xl font-semibold">Group</h1>}
      {notice && <Notice role={notice.role}>{notice.text}</Notice>}
      {file.status === 'ready' && <GroupContent data={file.data} id={id} options={options} />}
    </div>
  );
}
