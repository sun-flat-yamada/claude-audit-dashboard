import { StatusBadge } from '../components/Badges';
import { CELL, HEAD } from '../components/DetailControls';
import { ScrollRegion } from '../components/ScrollRegion';
import type { Member } from '../lib/drilldown-view';
import { memberStatus, roleLabel } from '../lib/members-view';

export function BackLink() {
  return (
    <a className="text-sm underline" href="#/orgs">
      All organizations and groups
    </a>
  );
}

export function NotFoundNotice({ kind }: { kind: 'Organization' | 'Group' }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{kind} not found</h1>
      <p role="status" className="mt-3 text-[var(--text-secondary)]">
        This {kind.toLowerCase()} is not in the published data. It may have been unlinked or the
        link is out of date.
      </p>
    </section>
  );
}

export function MemberRows({
  members,
  label = 'Members',
}: {
  members: readonly Member[];
  label?: string;
}) {
  return (
    <ScrollRegion label={label} className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{label}</caption>
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
