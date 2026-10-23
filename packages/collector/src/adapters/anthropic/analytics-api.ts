import type {
  ActiveUserProduct,
  AdoptionDay,
  CollectResult,
  CostRow,
  DateRange,
  MatrixCostRow,
  MemberActivity,
  ProductActiveUsers,
  UsageDimension,
  UsageRow,
} from '@claude-audit/core';
import {
  ACTIVE_USER_PRODUCTS,
  MINOR_AMOUNT,
  addDays,
  earlierOf,
  laterOf,
  minorToMajor,
  startOfUtcDay,
  toIsoDate,
} from '@claude-audit/core';
import { z } from 'zod';
import type { HttpClient, Query } from './http-client.js';
import { collectTokenPages, parseResponse, tokenPage } from './paginate.js';
import { engagementShape, memberEngagement } from './user-engagement.js';

/** The Enterprise Analytics API has no data before this date. */
export const ANALYTICS_EPOCH = new Date('2026-01-01T00:00:00.000Z');

/** `cost_report` / `usage_report`: one request may span at most this many days. */
export const MAX_REPORT_RANGE_DAYS = 31;

/** `group_by[]` returns at most this many rows per time bucket (there is no remainder row). */
export const GROUP_ROW_CAP = 100;

const nullableNumber = z.number().nullish();

export const userActivitySchema = z.looseObject({
  user: z.looseObject({ id: z.string(), email_address: z.string().nullish() }).nullish(),
  last_activity_date: z.string().nullish(),
  ...engagementShape,
});

const PERIODS = ['daily', 'weekly', 'monthly'] as const;

/** `<product>_<period>_active_user_count`; every one is read leniently (`cowork_*` included). */
const productCountField = (product: ActiveUserProduct, period: (typeof PERIODS)[number]) =>
  `${product}_${period}_active_user_count`;

const productCountShape = Object.fromEntries(
  ACTIVE_USER_PRODUCTS.flatMap(({ product }) =>
    PERIODS.map((period) => [productCountField(product, period), nullableNumber]),
  ),
);

const summarySchema = z.looseObject({
  starting_at: z.string(),
  daily_active_user_count: z.number(),
  weekly_active_user_count: z.number(),
  monthly_active_user_count: z.number(),
  assigned_seat_count: nullableNumber,
  monthly_adoption_rate: nullableNumber,
  pending_invite_count: nullableNumber,
  ...productCountShape,
});

const countOf = (row: Record<string, unknown>, field: string): number | null => {
  const value = row[field];
  return typeof value === 'number' ? value : null;
};

/** Products whose daily, weekly and monthly counts are all present; omitted or null ones are skipped. */
export function productActiveUsers(row: Record<string, unknown>): ProductActiveUsers[] {
  return ACTIVE_USER_PRODUCTS.flatMap(({ product }) => {
    const [dau, wau, mau] = PERIODS.map((period) =>
      countOf(row, productCountField(product, period)),
    );
    return dau != null && wau != null && mau != null ? [{ product, dau, wau, mau }] : [];
  });
}

const usageResultSchema = z.looseObject({
  uncached_input_tokens: z.number(),
  cache_read_input_tokens: z.number().default(0),
  cache_creation: z
    .looseObject({
      ephemeral_1h_input_tokens: z.number().default(0),
      ephemeral_5m_input_tokens: z.number().default(0),
    })
    .nullish(),
  output_tokens: z.number(),
  server_tool_use: z.looseObject({ web_search_requests: z.number().default(0) }).nullish(),
  requests: nullableNumber,
});

const costResultSchema = z.looseObject({
  amount: z.string().regex(MINOR_AMOUNT),
  list_amount: z.string().regex(MINOR_AMOUNT).nullish(),
  currency: z.string().default('USD'),
});

const bucketPage = <T extends z.ZodType>(result: T) =>
  tokenPage(z.looseObject({ starting_at: z.string(), results: z.array(result) })).extend({
    data_refreshed_at: z.string().nullish(),
  });

/** API field that carries the group key for each dimension (`null`: ungrouped total). */
const GROUP_FIELD: Readonly<Record<UsageDimension, string | null>> = {
  total: null,
  product: 'product',
  model: 'model',
  group: 'rbac_group_id',
};

const DIMENSIONS = Object.keys(GROUP_FIELD) as UsageDimension[];

/** True when any numeric counter below the row is positive (robust to new metric fields). */
function hasActivity(value: unknown, depth = 0): boolean {
  if (typeof value === 'number') return value > 0;
  if (depth > 3 || typeof value !== 'object' || value === null) return false;
  return Object.values(value).some((v) => hasActivity(v, depth + 1));
}

/**
 * One `users` row as member activity (range roll-up or single day); null for a row without a
 * user (grouped rows). `active` also holds when last-activity reporting is off but a counter moved.
 */
export function memberActivityOf(row: z.output<typeof userActivitySchema>): MemberActivity | null {
  if (!row.user) return null;
  const engagement = memberEngagement(row);
  return {
    userId: row.user.id,
    email: row.user.email_address ?? null,
    active: row.last_activity_date != null || hasActivity(row),
    lastActiveOn: row.last_activity_date ?? null,
    ...(engagement ? { engagement } : {}),
  };
}

const keyOf = (row: Record<string, unknown>, dimension: UsageDimension): string | null => {
  const field = GROUP_FIELD[dimension];
  const value = field ? row[field] : null;
  return typeof value === 'string' ? value : null;
};

const fieldsOf = (dimension: UsageDimension): string[] => {
  const field = GROUP_FIELD[dimension];
  return field ? [field] : [];
};

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const clampStart = (date: Date): Date => laterOf(date, ANALYTICS_EPOCH);

/**
 * `ending_date` (exclusive, `YYYY-MM-DD`) of a date-granular range: the end date when the range
 * ends before today, otherwise undefined (the parameter is omitted and the API uses today).
 */
export const endingDate = (end: Date, now: Date): string | undefined =>
  end.getTime() < startOfUtcDay(now).getTime() ? toIsoDate(startOfUtcDay(end)) : undefined;

/** The period a date-granular request covered: its dates, or up to `now` without an end date. */
export const dateWindow = (start: string, ending: string | undefined, now: Date) => ({
  from: `${start}T00:00:00.000Z`,
  to: ending ? `${ending}T00:00:00.000Z` : now.toISOString(),
});

/** Consecutive windows of at most `days` days that cover `range` exactly (none when it is empty). */
export function splitRange(range: DateRange, days = MAX_REPORT_RANGE_DAYS): DateRange[] {
  const windows: DateRange[] = [];
  for (let start = range.start; start.getTime() < range.end.getTime();) {
    const end = earlierOf(addDays(start, days), range.end);
    windows.push({ start, end });
    start = end;
  }
  return windows;
}

/** The oldest watermark wins so no part is treated as fresher than the others. */
const oldestMark = (marks: readonly (string | undefined)[]): string | undefined =>
  marks.filter((m): m is string => m !== undefined).sort()[0];

/** One bucketed report request: `group_by[]` fields and an optional `rbac_group_ids[]` filter. */
interface BucketRequest {
  groupBy: readonly string[];
  groups?: readonly string[];
}

interface MatrixPart {
  items: MatrixCostRow[];
  asOf: string | undefined;
  capped: boolean;
}

const PATHS = {
  users: '/v1/organizations/analytics/users',
  summaries: '/v1/organizations/analytics/summaries',
  usage: '/v1/organizations/analytics/usage_report',
  cost: '/v1/organizations/analytics/cost_report',
};

/** Claude Enterprise Analytics API (`read:analytics`, 60 requests/minute per organization). */
export class AnalyticsApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * Range roll-up: one row per member with `last_activity_date` and the per-product metric blocks
   * (mapped to `engagement` when any is present; activity and last-active day do not depend on it).
   */
  listUserActivity(from: Date, now: Date): Promise<CollectResult<MemberActivity[]>> {
    return this.listUserActivityIn({ start: from, end: now }, now);
  }

  /**
   * The roll-up over `range` (`starting_date` .. `ending_date`, at most 366 days); a range that
   * reaches today omits `ending_date`, so the API uses today (ledger backfill, #159).
   */
  async listUserActivityIn(range: DateRange, now: Date): Promise<CollectResult<MemberActivity[]>> {
    const start = toIsoDate(clampStart(range.start));
    const ending = endingDate(range.end, now);
    const rows = await collectTokenPages(async (page) =>
      parseResponse(
        tokenPage(userActivitySchema),
        await this.http.getJson(PATHS.users, {
          starting_date: start,
          ending_date: ending,
          limit: 1000,
          page,
        }),
        PATHS.users,
      ),
    );
    const items = rows.flatMap((row) => {
      const activity = memberActivityOf(row);
      return activity ? [activity] : [];
    });
    return { items, window: dateWindow(start, ending, now) };
  }

  async listSummaries(range: DateRange, now: Date): Promise<CollectResult<AdoptionDay[]>> {
    const query: Query = {
      starting_date: toIsoDate(clampStart(range.start)),
      ending_date: endingDate(range.end, now),
    };
    const body = parseResponse(
      tokenPage(summarySchema),
      await this.http.getJson(PATHS.summaries, query),
      PATHS.summaries,
    );
    const items = body.data.map((d) => ({
      date: d.starting_at.slice(0, 10),
      dailyActiveUsers: d.daily_active_user_count,
      weeklyActiveUsers: d.weekly_active_user_count,
      monthlyActiveUsers: d.monthly_active_user_count,
      assignedSeats: d.assigned_seat_count ?? null,
      monthlyAdoptionRate: d.monthly_adoption_rate ?? null,
      pendingInvites: d.pending_invite_count ?? null,
      byProduct: productActiveUsers(d),
    }));
    return { items, window: { from: range.start.toISOString(), to: range.end.toISOString() } };
  }

  /**
   * Daily buckets for one request; returns rows, the `data_refreshed_at` watermark and whether a
   * bucket reached the per-bucket group cap (rows beyond it are missing).
   */
  private async buckets<T extends z.ZodType>(
    path: string,
    result: T,
    range: DateRange,
    now: Date,
    request: BucketRequest,
  ) {
    let asOf: string | undefined;
    const buckets = await collectTokenPages(async (page) => {
      const query: Query = {
        starting_at: clampStart(range.start).toISOString(),
        ending_at: earlierOf(range.end, now).toISOString(),
        bucket_width: '1d',
        limit: 31,
        group_by: request.groupBy.length > 0 ? request.groupBy : undefined,
        rbac_group_ids: request.groups,
        page,
      };
      const body = parseResponse(bucketPage(result), await this.http.getJson(path, query), path);
      asOf = body.data_refreshed_at ?? asOf;
      return body;
    });
    const rows = buckets.flatMap((b) =>
      b.results.map((r) => ({
        date: b.starting_at.slice(0, 10),
        record: r as Record<string, unknown>,
        raw: r as z.output<T>,
      })),
    );
    const capped = buckets.some((b) => b.results.length >= GROUP_ROW_CAP);
    return { rows, asOf, capped };
  }

  /**
   * `buckets` over consecutive windows of at most 31 days (a longer range is HTTP 400), one
   * window after the other; the oldest watermark of the windows wins.
   */
  private async windowedBuckets<T extends z.ZodType>(
    path: string,
    result: T,
    range: DateRange,
    now: Date,
    request: BucketRequest,
  ) {
    const parts: Awaited<ReturnType<typeof this.buckets<T>>>[] = [];
    for (const window of splitRange({
      start: clampStart(range.start),
      end: earlierOf(range.end, now),
    })) {
      parts.push(await this.buckets(path, result, window, now, request));
    }
    return { rows: parts.flatMap((p) => p.rows), asOf: oldestMark(parts.map((p) => p.asOf)) };
  }

  /** Total, product, model (`group_by[]=model` alone) and RBAC group series, 31-day windows. */
  async usageReport(range: DateRange, now: Date): Promise<CollectResult<UsageRow[]>> {
    const parts = await Promise.all(
      DIMENSIONS.map(async (dimension) => {
        const { rows, asOf } = await this.windowedBuckets(
          PATHS.usage,
          usageResultSchema,
          range,
          now,
          { groupBy: fieldsOf(dimension) },
        );
        const items: UsageRow[] = rows.map(({ date, record, raw }) => ({
          date,
          dimension,
          key: keyOf(record, dimension),
          uncachedInputTokens: raw.uncached_input_tokens,
          cacheReadInputTokens: raw.cache_read_input_tokens,
          cacheCreationInputTokens:
            (raw.cache_creation?.ephemeral_1h_input_tokens ?? 0) +
            (raw.cache_creation?.ephemeral_5m_input_tokens ?? 0),
          outputTokens: raw.output_tokens,
          webSearchRequests: raw.server_tool_use?.web_search_requests ?? 0,
          requests: raw.requests ?? null,
        }));
        return { items, asOf };
      }),
    );
    return collate(parts, range);
  }

  /** Same series as `usageReport`; the model rows add up to the total row of each day. */
  async costReport(range: DateRange, now: Date): Promise<CollectResult<CostRow[]>> {
    const parts = await Promise.all(
      DIMENSIONS.map(async (dimension) => {
        const { rows, asOf } = await this.windowedBuckets(
          PATHS.cost,
          costResultSchema,
          range,
          now,
          { groupBy: fieldsOf(dimension) },
        );
        const items: CostRow[] = rows.map(({ date, record, raw }) => ({
          date,
          dimension,
          key: keyOf(record, dimension),
          amount: minorToMajor(raw.amount),
          listAmount: raw.list_amount ? minorToMajor(raw.list_amount) : null,
          currency: raw.currency,
        }));
        return { items, asOf };
      }),
    );
    return collate(parts, range);
  }

  /**
   * Opt-in model x RBAC group cost (F-010): the pairwise `group_by[]=model&group_by[]=rbac_group_id`
   * request plus the ungrouped-by-group per-model request that gives the additive model mix, both
   * split into windows of at most 31 days (the report rejects longer ranges with HTTP 400). A
   * pairwise window that reaches the per-bucket group cap is re-fetched per RBAC group. A rejected
   * request throws, and the caller records it as unavailable.
   */
  async costMatrix(
    range: DateRange,
    now: Date,
  ): Promise<CollectResult<{ pairs: MatrixCostRow[]; byModel: MatrixCostRow[] }>> {
    const windows = splitRange({ start: clampStart(range.start), end: earlierOf(range.end, now) });
    const pairs: MatrixPart[] = [];
    const byModel: MatrixPart[] = [];
    for (const window of windows) {
      pairs.push(await this.matrixPairs(window, now));
      byModel.push(await this.matrixRows(window, now, { groupBy: ['model'] }));
    }
    return {
      items: { pairs: pairs.flatMap((p) => p.items), byModel: byModel.flatMap((p) => p.items) },
      asOf: oldestMark([...pairs, ...byModel].map((p) => p.asOf)),
      window: { from: range.start.toISOString(), to: range.end.toISOString() },
    };
  }

  /** Cost rows of one window; rows of a group-filtered request are tagged with that group. */
  private async matrixRows(
    window: DateRange,
    now: Date,
    request: BucketRequest,
    group: string | null = null,
  ): Promise<MatrixPart> {
    const { rows, asOf, capped } = await this.buckets(
      PATHS.cost,
      costResultSchema,
      window,
      now,
      request,
    );
    const items = rows.map(({ date, record, raw }) => ({
      date,
      model: stringOrNull(record.model),
      group: group ?? stringOrNull(record.rbac_group_id),
      amount: minorToMajor(raw.amount),
      currency: raw.currency,
    }));
    return { items, asOf, capped };
  }

  /**
   * Pairwise rows of one window. When a bucket reached the group cap, the named groups of the
   * window are re-fetched one by one (`rbac_group_ids[]` + `group_by[]=model`); the filter never
   * matches unassigned usage, so the "no group" rows of the capped response are kept as they are.
   */
  private async matrixPairs(window: DateRange, now: Date): Promise<MatrixPart> {
    const pairwise = await this.matrixRows(window, now, { groupBy: ['model', 'rbac_group_id'] });
    if (!pairwise.capped) return pairwise;
    const listed = await this.matrixRows(window, now, { groupBy: ['rbac_group_id'] });
    const ids = [...new Set(listed.items.map((r) => r.group))].filter(
      (id): id is string => id !== null,
    );
    const perGroup: MatrixPart[] = [];
    for (const id of ids) {
      perGroup.push(await this.matrixRows(window, now, { groupBy: ['model'], groups: [id] }, id));
    }
    return {
      items: [
        ...pairwise.items.filter((r) => r.group === null),
        ...perGroup.flatMap((p) => p.items),
      ],
      asOf: oldestMark([pairwise, listed, ...perGroup].map((p) => p.asOf)),
      capped: false,
    };
  }
}

/** Joins per-dimension rows; the oldest watermark wins so no dimension is treated as fresher. */
function collate<T>(
  parts: { items: T[]; asOf: string | undefined }[],
  range: DateRange,
): CollectResult<T[]> {
  return {
    items: parts.flatMap((p) => p.items),
    asOf: oldestMark(parts.map((p) => p.asOf)),
    window: { from: range.start.toISOString(), to: range.end.toISOString() },
  };
}
