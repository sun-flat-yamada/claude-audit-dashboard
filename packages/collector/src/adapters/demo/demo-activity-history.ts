import type { Activity, Member } from '@claude-audit/core';

const ROUTINE = [
  'claude_chat_created',
  'claude_file_uploaded',
  'claude_project_created',
  'sso_login_succeeded',
];
const MONTH_ROWS = [130, 62];
const FIRST_ID = 1000;

const api = (id: string): Activity['actor'] => ({
  kind: 'api_actor',
  id,
  email: null,
  ip: '203.0.113.10',
});

/**
 * Synthetic routine activity for the two UTC months before the month of `now`, so the activity
 * screen can page and switch months. Only benign types are used so no activity-watch rule
 * matches. Row `i` of a month is spread across the month; the first and the last row sit on the
 * month boundaries.
 */
export function activityHistory(
  now: Date,
  people: readonly Member[],
  orgIds: readonly string[],
  rand: () => number,
): Activity[] {
  const rows: Activity[] = [];
  MONTH_ROWS.forEach((count, back) => {
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - back, 1);
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1) - 1000;
    for (let i = 0; i < count; i += 1) {
      const at = i === 0 ? start : i === count - 1 ? end : start + rand() * (end - start);
      const person = people[(i * 11 + back * 5) % people.length] as Member;
      const system = i % 9 === 4;
      rows.push({
        id: `activity_demo_${String(FIRST_ID + back * 500 + i).padStart(4, '0')}`,
        type: system ? 'compliance_api_accessed' : (ROUTINE[i % ROUTINE.length] ?? ROUTINE[0]!),
        createdAt: new Date(at).toISOString(),
        organizationId: orgIds[i % orgIds.length] ?? null,
        actor: system
          ? api('apikey_demo_dashboard')
          : { kind: 'user_actor', id: person.id, email: person.email, ip: '192.0.2.10' },
        attributes: {},
      });
    }
  });
  return rows;
}
