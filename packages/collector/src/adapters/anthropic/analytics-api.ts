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
  earlierOf,
  laterOf,
  minorToMajor,
  startOfUtcDay,
  toIsoDate,
} from '@claude-audit/core';
import { z } from 'zod';
import type { HttpClient, Query } from './http-client.js';
import { collectTokenPages, parseResponse, tokenPage } from './paginate.js';

/** The Enterprise Analytics API has no data before this date. */
export const ANALYTICS_EPOCH = new Date('2026-01-01T00:00:00.000Z');

const nullableNumber = z.number().nullish();

const userActivitySchema = z.looseObject({
  user: z.looseObject({ id: z.string(), email_address: z.string().nullish() }).nullish(),
  last_activity_date: z.string().nullish(),
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

const PATHS = {
  users: '/v1/organizations/analytics/users',
  summaries: '/v1/organizations/analytics/summaries',
  usage: '/v1/organizations/analytics/usage_report',
  cost: '/v1/organizations/analytics/cost_report',
};

/** Claude Enterprise Analytics API (`read:analytics`, 60 requests/minute per organization). */
export class AnalyticsApi {
  constructor(private readonly http: HttpClient) {}

  /** Range roll-up: one row per member with activity counters and `last_activity_date`. */
  async listUserActivity(from: Date, now: Date): Promise<CollectResult<MemberActivity[]>> {
    const start = toIsoDate(clampStart(from));
    const rows = await collectTokenPages(async (page) =>
      parseResponse(
        tokenPage(userActivitySchema),
        await this.http.getJson(PATHS.users, { starting_date: start, limit: 1000, page }),
        PATHS.users,
      ),
    );
    const items = rows.flatMap((row) =>
      row.user
        ? [
            {
              userId: row.user.id,
              email: row.user.email_address ?? null,
              active: row.last_activity_date != null || hasActivity(row),
              lastActiveOn: row.last_activity_date ?? null,
            },
          ]
        : [],
    );
    return { items, window: { from: `${start}T00:00:00.000Z`, to: now.toISOString() } };
  }

  async listSummaries(range: DateRange, now: Date): Promise<CollectResult<AdoptionDay[]>> {
    const endsInPast = range.end < startOfUtcDay(now);
    const query: Query = {
      starting_date: toIsoDate(clampStart(range.start)),
      ending_date: endsInPast ? toIsoDate(range.end) : undefined,
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

  /** Daily buckets for one dimension; returns rows plus the `data_refreshed_at` watermark. */
  private async buckets<T extends z.ZodType>(
    path: string,
    result: T,
    range: DateRange,
    now: Date,
    fields: readonly string[],
  ) {
    let asOf: string | undefined;
    const buckets = await collectTokenPages(async (page) => {
      const query: Query = {
        starting_at: clampStart(range.start).toISOString(),
        ending_at: earlierOf(range.end, now).toISOString(),
        bucket_width: '1d',
        limit: 31,
        group_by: fields.length > 0 ? fields : undefined,
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
    return { rows, asOf };
  }

  async usageReport(range: DateRange, now: Date): Promise<CollectResult<UsageRow[]>> {
    const parts = await Promise.all(
      DIMENSIONS.map(async (dimension) => {
        const { rows, asOf } = await this.buckets(
          PATHS.usage,
          usageResultSchema,
          range,
          now,
          fieldsOf(dimension),
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

  async costReport(range: DateRange, now: Date): Promise<CollectResult<CostRow[]>> {
    const parts = await Promise.all(
      DIMENSIONS.map(async (dimension) => {
        const { rows, asOf } = await this.buckets(
          PATHS.cost,
          costResultSchema,
          range,
          now,
          fieldsOf(dimension),
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
   * request (not confirmed against a real tenant, see docs/API-MAPPING.md) plus the ungrouped
   * per-model request that gives the additive model mix. A rejected request throws, and the caller
   * records it as unavailable.
   */
  async costMatrix(
    range: DateRange,
    now: Date,
  ): Promise<CollectResult<{ pairs: MatrixCostRow[]; byModel: MatrixCostRow[] }>> {
    const load = async (fields: readonly string[]) => {
      const { rows, asOf } = await this.buckets(PATHS.cost, costResultSchema, range, now, fields);
      const items: MatrixCostRow[] = rows.map(({ date, record, raw }) => ({
        date,
        model: stringOrNull(record.model),
        group: stringOrNull(record.rbac_group_id),
        amount: minorToMajor(raw.amount),
        currency: raw.currency,
      }));
      return { items, asOf };
    };
    const [pairs, byModel] = await Promise.all([load(['model', 'rbac_group_id']), load(['model'])]);
    return {
      items: { pairs: pairs.items, byModel: byModel.items },
      asOf: [pairs.asOf, byModel.asOf].filter((m): m is string => m !== undefined).sort()[0],
      window: { from: range.start.toISOString(), to: range.end.toISOString() },
    };
  }
}

/** Joins per-dimension rows; the oldest watermark wins so no dimension is treated as fresher. */
function collate<T>(
  parts: { items: T[]; asOf: string | undefined }[],
  range: DateRange,
): CollectResult<T[]> {
  const marks = parts
    .map((p) => p.asOf)
    .filter((m): m is string => m !== undefined)
    .sort();
  return {
    items: parts.flatMap((p) => p.items),
    asOf: marks[0],
    window: { from: range.start.toISOString(), to: range.end.toISOString() },
  };
}
