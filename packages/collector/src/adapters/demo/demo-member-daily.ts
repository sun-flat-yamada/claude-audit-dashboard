import type { MemberDayActivity } from '@claude-audit/core';
import { addDays, startOfUtcDay, toIsoDate } from '@claude-audit/core';

/**
 * Deterministic synthetic per-day member activity (optional `memberActivityDaily`, ledger only),
 * used by the `optional-sources` demo profile and tests. Fictional members, example.com only.
 */
const DAILY_MEMBERS = [
  { id: 'user_demo_001', email: 'alice.engineer@example.com', messages: 14 },
  { id: 'user_demo_002', email: 'bob.engineer@example.com', messages: 6 },
  { id: 'user_demo_003', email: 'carol.engineer@example.com', messages: 0 },
  { id: 'user_demo_011', email: 'alice.analyst@example.com', messages: 9 },
] as const;

/** The `lookbackDays` days before today (UTC), oldest first: one row per member and day. */
export function demoMemberDaily(now: Date, lookbackDays: number): MemberDayActivity[] {
  const today = startOfUtcDay(now);
  return Array.from({ length: lookbackDays }, (_, i) =>
    toIsoDate(addDays(today, i - lookbackDays)),
  ).flatMap((date, day) =>
    DAILY_MEMBERS.map((member, m) => {
      const messages = member.messages === 0 ? 0 : member.messages + ((day + m) % 4);
      return {
        date,
        userId: member.id,
        email: member.email,
        active: messages > 0,
        lastActiveOn: messages > 0 ? date : null,
        engagement: {
          chat: {
            messages,
            conversations: Math.ceil(messages / 4),
            projectsCreated: 0,
            artifactsCreated: messages > 10 ? 1 : 0,
            filesUploaded: null,
            connectorCalls: 0,
            thinkingMessages: Math.floor(messages / 5),
          },
        },
      };
    }),
  );
}
