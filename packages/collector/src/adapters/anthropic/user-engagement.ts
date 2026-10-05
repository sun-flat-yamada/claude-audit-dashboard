import type { CodeTool, MemberEngagement, ToolDecisions } from '@claude-audit/core';
import { z } from 'zod';

/**
 * Metric blocks of an Enterprise Analytics users row (`GET /v1/organizations/analytics/users`).
 * Every block and counter is lenient: a missing block, a `null` counter (distinct counts on
 * aggregated rows, metrics not enabled for the organization) or an unexpected value becomes
 * "absent" and never fails the collection.
 */
const count = z.number().nullish().catch(null);

const block = <T extends z.ZodRawShape>(shape: T) => z.looseObject(shape).nullish().catch(null);

const toolCounts = block({ accepted_count: count, rejected_count: count });

const officeApp = block({
  message_count: count,
  distinct_session_count: count,
  skills_used_count: count,
  connectors_used_count: count,
});

export const engagementShape = {
  chat_metrics: block({
    message_count: count,
    distinct_conversation_count: count,
    distinct_projects_created_count: count,
    distinct_artifacts_created_count: count,
    distinct_files_uploaded_count: count,
    connectors_used_count: count,
    thinking_message_count: count,
  }),
  claude_code_metrics: block({
    core_metrics: block({
      commit_count: count,
      pull_request_count: count,
      distinct_session_count: count,
      artifacts_created_count: count,
      lines_of_code: block({ added_count: count, removed_count: count }),
    }),
    tool_actions: block({
      edit_tool: toolCounts,
      multi_edit_tool: toolCounts,
      notebook_edit_tool: toolCounts,
      write_tool: toolCounts,
    }),
  }),
  cowork_metrics: block({
    message_count: count,
    distinct_session_count: count,
    action_count: count,
    dispatch_turn_count: count,
    skills_used_count: count,
    artifacts_created_count: count,
  }),
  design_metrics: block({
    message_count: count,
    distinct_session_count: count,
    distinct_projects_created_count: count,
  }),
  office_metrics: block({
    excel: officeApp,
    outlook: officeApp,
    powerpoint: officeApp,
    word: officeApp,
  }),
  science_metrics: block({
    message_count: count,
    distinct_session_count: count,
    delegation_count: count,
    remote_compute_job_count: count,
    skills_used_count: count,
  }),
  web_search_count: count,
};

const engagementSchema = z.looseObject(engagementShape);

type Row = z.output<typeof engagementSchema>;
type Value = number | null | undefined;

const n = (value: Value): number | null => value ?? null;

/** Sum of the reported values; null when none was reported. */
function sumOf(values: readonly Value[]): number | null {
  const known = values.filter((v): v is number => typeof v === 'number');
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

const API_TOOLS = {
  edit: 'edit_tool',
  multiEdit: 'multi_edit_tool',
  write: 'write_tool',
  notebookEdit: 'notebook_edit_tool',
} as const satisfies Record<CodeTool, string>;

type ToolActions = NonNullable<Row['claude_code_metrics']>['tool_actions'];

function tools(actions: ToolActions): Partial<Record<CodeTool, ToolDecisions>> {
  const entries = (Object.keys(API_TOOLS) as CodeTool[]).flatMap((tool) => {
    const t = actions?.[API_TOOLS[tool]];
    return t && (t.accepted_count != null || t.rejected_count != null)
      ? [[tool, { accepted: t.accepted_count ?? 0, rejected: t.rejected_count ?? 0 }]]
      : [];
  });
  return Object.fromEntries(entries);
}

function claudeCode(m: Row['claude_code_metrics']): MemberEngagement['claudeCode'] {
  if (!m) return undefined;
  const core = m.core_metrics;
  return {
    sessions: n(core?.distinct_session_count),
    commits: n(core?.commit_count),
    pullRequests: n(core?.pull_request_count),
    addedLines: n(core?.lines_of_code?.added_count),
    removedLines: n(core?.lines_of_code?.removed_count),
    artifactsCreated: n(core?.artifacts_created_count),
    tools: tools(m.tool_actions),
  };
}

const chat = (m: Row['chat_metrics']): MemberEngagement['chat'] =>
  m
    ? {
        messages: n(m.message_count),
        conversations: n(m.distinct_conversation_count),
        projectsCreated: n(m.distinct_projects_created_count),
        artifactsCreated: n(m.distinct_artifacts_created_count),
        filesUploaded: n(m.distinct_files_uploaded_count),
        connectorCalls: n(m.connectors_used_count),
        thinkingMessages: n(m.thinking_message_count),
      }
    : undefined;

const cowork = (m: Row['cowork_metrics']): MemberEngagement['cowork'] =>
  m
    ? {
        messages: n(m.message_count),
        sessions: n(m.distinct_session_count),
        actions: n(m.action_count),
        dispatchTurns: n(m.dispatch_turn_count),
        skillCalls: n(m.skills_used_count),
        artifactsCreated: n(m.artifacts_created_count),
      }
    : undefined;

const design = (m: Row['design_metrics']): MemberEngagement['design'] =>
  m
    ? {
        messages: n(m.message_count),
        sessions: n(m.distinct_session_count),
        projectsCreated: n(m.distinct_projects_created_count),
      }
    : undefined;

/** Summed over Excel, Outlook, PowerPoint and Word; absent when no app was reported. */
function office(m: Row['office_metrics']): MemberEngagement['office'] {
  const apps = [m?.excel, m?.outlook, m?.powerpoint, m?.word].filter((a) => a != null);
  if (apps.length === 0) return undefined;
  return {
    messages: sumOf(apps.map((a) => a.message_count)),
    sessions: sumOf(apps.map((a) => a.distinct_session_count)),
    skillCalls: sumOf(apps.map((a) => a.skills_used_count)),
    connectorCalls: sumOf(apps.map((a) => a.connectors_used_count)),
  };
}

const science = (m: Row['science_metrics']): MemberEngagement['science'] =>
  m
    ? {
        messages: n(m.message_count),
        sessions: n(m.distinct_session_count),
        delegations: n(m.delegation_count),
        computeJobs: n(m.remote_compute_job_count),
      }
    : undefined;

/**
 * Maps the metric blocks of one users row to domain words; undefined when the row carries none
 * (so `MemberActivity.engagement` stays absent).
 */
export function memberEngagement(row: unknown): MemberEngagement | undefined {
  const parsed = engagementSchema.safeParse(row);
  if (!parsed.success) return undefined;
  const r = parsed.data;
  const products: { [K in keyof MemberEngagement]-?: MemberEngagement[K] | undefined } = {
    chat: chat(r.chat_metrics),
    claudeCode: claudeCode(r.claude_code_metrics),
    cowork: cowork(r.cowork_metrics),
    design: design(r.design_metrics),
    office: office(r.office_metrics),
    science: science(r.science_metrics),
    webSearches: r.web_search_count ?? undefined,
  };
  const present = Object.entries(products).filter(([, v]) => v !== undefined);
  return present.length === 0 ? undefined : (Object.fromEntries(present) as MemberEngagement);
}
