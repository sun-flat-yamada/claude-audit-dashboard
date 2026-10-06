import type {
  ChatProjectUsage,
  CollectResult,
  ConnectorUsage,
  FeatureProductCounts,
  PluginUsage,
  SkillUsage,
} from '@claude-audit/core';
import { addDays, laterOf, startOfUtcDay, toIsoDate } from '@claude-audit/core';
import { z } from 'zod';
import { ANALYTICS_EPOCH } from './analytics-api.js';
import type { HttpClient } from './http-client.js';
import { collectTokenPages, parseResponse, tokenPage } from './paginate.js';

export const FEATURE_PATHS = {
  skills: '/v1/organizations/analytics/skills',
  connectors: '/v1/organizations/analytics/connectors',
  plugins: '/v1/organizations/analytics/plugins',
  projects: '/v1/organizations/analytics/apps/chat/projects',
} as const;

const count = z.number().nullish();
const text = z.string().nullish();

/** `{ <field>: number | null }`, absent or null block alike. */
const metric = (field: string) => z.looseObject({ [field]: count }).nullish();

const officeSchema = (field: string) =>
  z
    .looseObject({
      excel: metric(field),
      outlook: metric(field),
      powerpoint: metric(field),
      word: metric(field),
    })
    .nullish();

/** The per-product blocks shared by skills and connectors (`<kind>` = `skill` / `connector`). */
const productShape = (kind: string) => ({
  chat_metrics: metric(`distinct_conversation_${kind}_used_count`),
  claude_code_metrics: metric(`distinct_session_${kind}_used_count`),
  cowork_metrics: metric(`distinct_session_${kind}_used_count`),
  office_metrics: officeSchema(`distinct_session_${kind}_used_count`),
});

const skillSchema = z.looseObject({
  skill_name: z.string(),
  skill_display_name: text,
  distinct_user_count: z.number(),
  invocation_count: count,
  share_status: text,
  ...productShape('skill'),
});

const connectorSchema = z.looseObject({
  connector_name: z.string(),
  connector_display_name: text,
  distinct_user_count: z.number(),
  read_call_count: count,
  write_call_count: count,
  unclassified_call_count: count,
  managed_auth_distinct_user_count: count,
  individual_auth_distinct_user_count: count,
  ...productShape('connector'),
});

const pluginSchema = z.looseObject({
  plugin_name: z.string(),
  plugin_id: text,
  distinct_user_count: z.number(),
  invocation_count: z.number(),
  install_count: count,
  claude_code_metrics: metric('distinct_session_plugin_used_count'),
  cowork_metrics: metric('distinct_session_plugin_used_count'),
});

/** `created_by` (a person with an e-mail address) is not part of the schema and never read. */
const projectSchema = z.looseObject({
  project_id: z.string(),
  project_name: z.string(),
  distinct_user_count: z.number(),
  message_count: z.number(),
  distinct_conversation_count: count,
  created_at: text,
});

type Block = Record<string, unknown> | null | undefined;

const valueOf = (block: Block, field: string): number | null => {
  const value = block?.[field];
  return typeof value === 'number' ? value : null;
};

/** Excel + Outlook + PowerPoint + Word sessions; null when none of them was stated. */
function officeSessions(office: Record<string, Block> | null | undefined, field: string) {
  const values = ['excel', 'outlook', 'powerpoint', 'word']
    .map((product) => valueOf(office?.[product], field))
    .filter((v): v is number => v !== null);
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0);
}

interface ProductRow {
  chat_metrics?: Block;
  claude_code_metrics?: Block;
  cowork_metrics?: Block;
  office_metrics?: Record<string, Block> | null | undefined;
}

function productCounts(row: ProductRow, kind: string): FeatureProductCounts {
  const session = `distinct_session_${kind}_used_count`;
  return {
    chatConversations: valueOf(row.chat_metrics, `distinct_conversation_${kind}_used_count`),
    claudeCodeSessions: valueOf(row.claude_code_metrics, session),
    coworkSessions: valueOf(row.cowork_metrics, session),
    officeSessions: officeSessions(row.office_metrics, session),
  };
}

const toSkill = (r: z.output<typeof skillSchema>): SkillUsage => ({
  name: r.skill_name,
  displayName: r.skill_display_name ?? null,
  users: r.distinct_user_count,
  invocations: r.invocation_count ?? null,
  shareStatus: r.share_status ?? null,
  ...productCounts(r as ProductRow, 'skill'),
});

const toConnector = (r: z.output<typeof connectorSchema>): ConnectorUsage => ({
  name: r.connector_name,
  displayName: r.connector_display_name ?? null,
  users: r.distinct_user_count,
  readCalls: r.read_call_count ?? null,
  writeCalls: r.write_call_count ?? null,
  unclassifiedCalls: r.unclassified_call_count ?? null,
  managedAuthUsers: r.managed_auth_distinct_user_count ?? null,
  individualAuthUsers: r.individual_auth_distinct_user_count ?? null,
  ...productCounts(r as ProductRow, 'connector'),
});

const toPlugin = (r: z.output<typeof pluginSchema>): PluginUsage => ({
  name: r.plugin_name,
  pluginId: r.plugin_id ?? null,
  users: r.distinct_user_count,
  invocations: r.invocation_count,
  installs: r.install_count ?? null,
  claudeCodeSessions: valueOf(r.claude_code_metrics, 'distinct_session_plugin_used_count'),
  coworkSessions: valueOf(r.cowork_metrics, 'distinct_session_plugin_used_count'),
});

const toProject = (r: z.output<typeof projectSchema>): ChatProjectUsage => ({
  id: r.project_id,
  name: r.project_name,
  users: r.distinct_user_count,
  messages: r.message_count,
  conversations: r.distinct_conversation_count ?? null,
  createdAt: r.created_at ?? null,
});

/**
 * Feature adoption endpoints of the Claude Enterprise Analytics API (`read:analytics`, the
 * Analytics key). Each list is a range roll-up: one row per skill / connector / plugin / chat
 * project over `starting_date` .. today (`ending_date` omitted, so the API uses today), paged with
 * `page` / `next_page`. No `group_by[]`: rows never carry a user.
 */
export class FeatureUsageApi {
  constructor(private readonly http: HttpClient) {}

  private async rollup<S extends z.ZodType, T>(
    path: string,
    schema: S,
    map: (row: z.output<S>) => T,
    lookbackDays: number,
    now: Date,
  ): Promise<CollectResult<T[]>> {
    const start = laterOf(startOfUtcDay(addDays(now, -lookbackDays)), ANALYTICS_EPOCH);
    const rows = await collectTokenPages(async (page) =>
      parseResponse(
        tokenPage(schema),
        await this.http.getJson(path, { starting_date: toIsoDate(start), limit: 1000, page }),
        path,
      ),
    );
    return { items: rows.map(map), window: { from: start.toISOString(), to: now.toISOString() } };
  }

  skills(lookbackDays: number, now: Date) {
    return this.rollup(FEATURE_PATHS.skills, skillSchema, toSkill, lookbackDays, now);
  }

  connectors(lookbackDays: number, now: Date) {
    return this.rollup(FEATURE_PATHS.connectors, connectorSchema, toConnector, lookbackDays, now);
  }

  plugins(lookbackDays: number, now: Date) {
    return this.rollup(FEATURE_PATHS.plugins, pluginSchema, toPlugin, lookbackDays, now);
  }

  projects(lookbackDays: number, now: Date) {
    return this.rollup(FEATURE_PATHS.projects, projectSchema, toProject, lookbackDays, now);
  }
}
