import type { DetailOrgGroups } from '@claude-audit/core/contracts';
import { Card, Empty } from '../components/Card';
import { Notice } from '../components/DetailControls';
import { findGroup, spendShare } from '../lib/drilldown-view';
import { formatMoney } from '../lib/format';
import { BackLink, NotFoundNotice } from './DrilldownParts';
import { countText } from './Organizations';
import { useOrgGroups, type DrilldownOptions } from './useOrgGroups';

function GroupContent({ data, id }: { data: DetailOrgGroups; id: string }) {
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
      <Card title="Members and deviations">
        <p className="text-sm text-[var(--text-secondary)]">
          The data holds only a member count per group, not who belongs to it. Configuration
          deviations are attributed to organizations; see the Organizations page.
        </p>
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
      {file.status === 'ready' && <GroupContent data={file.data} id={id} />}
    </div>
  );
}
