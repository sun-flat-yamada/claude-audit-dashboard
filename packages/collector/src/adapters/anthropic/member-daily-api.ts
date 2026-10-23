import type { CollectResult, MemberDayActivity } from '@claude-audit/core';
import { addDays, laterOf, startOfUtcDay, toIsoDate } from '@claude-audit/core';
import { ANALYTICS_EPOCH, memberActivityOf, userActivitySchema } from './analytics-api.js';
import { ApiError, type HttpClient } from './http-client.js';
import { collectTokenPages, parseResponse, tokenPage } from './paginate.js';

export const MEMBER_DAILY_PATH = '/v1/organizations/analytics/users';

/**
 * A day's per-user activity is published on the next UTC day from 13:30 (Issue #158; the API
 * documents "typically a 1-day lag" and rejects a too-recent `date`). Before that time the newest
 * requested day is the day before yesterday.
 */
export const DAILY_PUBLISHED_AFTER_MS = (13 * 60 + 30) * 60_000;

/**
 * Minimum time between two requests of the daily series: at most 40 of the 60 requests a minute
 * the Analytics API allows per organization, so the other analytics datasets of the same run
 * (about ten requests) still fit; a 429 with `retry-after` remains the backstop.
 */
export const MEMBER_DAILY_MIN_INTERVAL_MS = 1500;

/** The newest UTC day whose activity is published at `now`. */
export function latestPublishedDay(now: Date): Date {
  const today = startOfUtcDay(now);
  const published = now.getTime() - today.getTime() >= DAILY_PUBLISHED_AFTER_MS;
  return addDays(today, published ? -1 : -2);
}

/** The last `lookbackDays` published days, oldest first, never before 2026-01-01. */
export function dailyActivityDays(lookbackDays: number, now: Date): Date[] {
  const latest = latestPublishedDay(now);
  const first = laterOf(addDays(latest, 1 - lookbackDays), ANALYTICS_EPOCH);
  const days: Date[] = [];
  for (let day = first; day.getTime() <= latest.getTime(); day = addDays(day, 1)) days.push(day);
  return days;
}

/** A 400 for the newest day means it is not published yet (the error names the latest day). */
const notYetPublished = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 400;

/**
 * Enterprise Analytics `users` in single-day mode (`date=<YYYY-MM-DD>`, `read:analytics`): one
 * `next_page` series per day, serially and paced by the client, with the shared 410 restart
 * (a cursor expired by a data refresh starts that day again from its first page). Rows are per
 * member, so the dataset is recorded for the ledger only and never published.
 */
export class MemberDailyActivityApi {
  constructor(private readonly http: HttpClient) {}

  private async day(date: string): Promise<MemberDayActivity[]> {
    const rows = await collectTokenPages(async (page) =>
      parseResponse(
        tokenPage(userActivitySchema),
        await this.http.getJson(MEMBER_DAILY_PATH, { date, limit: 1000, page }),
        MEMBER_DAILY_PATH,
      ),
    );
    return rows.flatMap((row) => {
      const activity = memberActivityOf(row);
      return activity ? [{ date, ...activity }] : [];
    });
  }

  /**
   * The last `lookbackDays` published days. Re-fetching a day a later run is the point: the API
   * revises recent days by a few percent, and the ledger keeps the newest collection of a day.
   */
  async listDailyActivity(
    lookbackDays: number,
    now: Date,
  ): Promise<CollectResult<MemberDayActivity[]>> {
    const days = dailyActivityDays(lookbackDays, now);
    const items: MemberDayActivity[] = [];
    let end = days[0] ?? startOfUtcDay(now);
    const start = end;
    for (const [index, day] of days.entries()) {
      try {
        items.push(...(await this.day(toIsoDate(day))));
      } catch (error) {
        if (index === days.length - 1 && notYetPublished(error)) break;
        throw error;
      }
      end = addDays(day, 1);
    }
    return { items, window: { from: start.toISOString(), to: end.toISOString() } };
  }
}
