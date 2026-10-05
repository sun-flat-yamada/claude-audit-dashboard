import { describe, expect, it } from 'vitest';
import { MOCK_KEY, fakeAnthropic } from '../../../__tests__/fake-anthropic.js';
import { AnalyticsApi } from '../analytics-api.js';
import { HttpClient } from '../http-client.js';
import { memberEngagement } from '../user-engagement.js';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const USERS = '/v1/organizations/analytics/users';

const office = (messages: number) => ({
  connectors_used_count: 1,
  distinct_connectors_used_count: 1,
  distinct_session_count: 2,
  distinct_skills_used_count: 1,
  message_count: messages,
  skills_used_count: 3,
});

/**
 * One row in the shape of the official `GET /v1/organizations/analytics/users` example
 * (platform.claude.com/docs, every block present), with synthetic non-zero values.
 */
const OFFICIAL_ROW = {
  chat_metrics: {
    connectors_used_count: 4,
    distinct_artifacts_created_count: 3,
    distinct_connectors_used_count: 2,
    distinct_conversation_count: 12,
    distinct_files_uploaded_count: 5,
    distinct_projects_created_count: 1,
    distinct_projects_used_count: 2,
    distinct_shared_artifacts_viewed_count: 0,
    distinct_skills_used_count: 1,
    message_count: 80,
    shared_conversations_viewed_count: 0,
    thinking_message_count: 9,
  },
  claude_code_metrics: {
    core_metrics: {
      artifacts_created_count: 1,
      commit_count: 7,
      distinct_session_count: 15,
      lines_of_code: { added_count: 1200, removed_count: 300 },
      pull_request_count: 2,
    },
    tool_actions: {
      edit_tool: { accepted_count: 90, rejected_count: 10 },
      multi_edit_tool: { accepted_count: 20, rejected_count: 5 },
      notebook_edit_tool: { accepted_count: 0, rejected_count: 0 },
      write_tool: { accepted_count: 12, rejected_count: 3 },
    },
  },
  cowork_metrics: {
    action_count: 40,
    artifacts_created_count: 2,
    connectors_used_count: 6,
    dispatch_turn_count: 3,
    distinct_connectors_used_count: 2,
    distinct_session_count: 4,
    distinct_skills_used_count: 2,
    message_count: 25,
    skills_used_count: 5,
    distinct_plugins_used_count: null,
    edit_tool_count: null,
    file_edit_count: null,
    multi_edit_tool_count: null,
    notebook_edit_tool_count: null,
    plugins_used_count: null,
    sessions_with_file_edits_count: null,
    write_tool_count: null,
  },
  design_metrics: {
    distinct_projects_created_count: 1,
    distinct_projects_used_count: 1,
    distinct_session_count: 2,
    message_count: 6,
  },
  office_metrics: { excel: office(4), outlook: office(0), powerpoint: office(2), word: office(1) },
  science_metrics: {
    delegation_count: 1,
    distinct_session_count: 1,
    message_count: 3,
    remote_compute_job_count: 2,
    skills_used_count: 0,
  },
  web_search_count: 11,
  distinct_user_count: null,
  last_activity_date: '2026-09-29',
  rbac_group_id: null,
  rbac_group_name: null,
  user: { type: 'user', id: 'user_01', email_address: 'user_alice@example.com' },
};

async function listWith(rows: unknown[]) {
  const api = fakeAnthropic({ [USERS]: () => ({ body: { data: rows, next_page: null } }) });
  const http = new HttpClient({ apiKey: MOCK_KEY, fetchImpl: api.fetch, sleep: async () => {} });
  return (await new AnalyticsApi(http).listUserActivity(new Date('2026-07-02T00:00:00Z'), NOW))
    .items;
}

describe('users metric blocks (official example shape)', () => {
  it('maps every block to engagement in domain words', async () => {
    const [item] = await listWith([OFFICIAL_ROW]);
    expect(item).toMatchObject({ userId: 'user_01', active: true, lastActiveOn: '2026-09-29' });
    expect(item?.engagement).toEqual({
      chat: {
        messages: 80,
        conversations: 12,
        projectsCreated: 1,
        artifactsCreated: 3,
        filesUploaded: 5,
        connectorCalls: 4,
        thinkingMessages: 9,
      },
      claudeCode: {
        sessions: 15,
        commits: 7,
        pullRequests: 2,
        addedLines: 1200,
        removedLines: 300,
        artifactsCreated: 1,
        tools: {
          edit: { accepted: 90, rejected: 10 },
          multiEdit: { accepted: 20, rejected: 5 },
          write: { accepted: 12, rejected: 3 },
          notebookEdit: { accepted: 0, rejected: 0 },
        },
      },
      cowork: {
        messages: 25,
        sessions: 4,
        actions: 40,
        dispatchTurns: 3,
        skillCalls: 5,
        artifactsCreated: 2,
      },
      design: { messages: 6, sessions: 2, projectsCreated: 1 },
      office: { messages: 7, sessions: 8, skillCalls: 12, connectorCalls: 4 },
      science: { messages: 3, sessions: 1, delegations: 1, computeJobs: 2 },
      webSearches: 11,
    });
  });

  it('leaves engagement absent when every block is missing, without changing activity', async () => {
    const [withDate, withoutDate] = await listWith([
      { user: OFFICIAL_ROW.user, last_activity_date: '2026-09-20' },
      { user: { type: 'user', id: 'user_02', email_address: 'user_bob@example.com' } },
    ]);
    expect(withDate).toEqual({
      userId: 'user_01',
      email: 'user_alice@example.com',
      active: true,
      lastActiveOn: '2026-09-20',
    });
    expect(withoutDate).toEqual({
      userId: 'user_02',
      email: 'user_bob@example.com',
      active: false,
      lastActiveOn: null,
    });
  });

  it('keeps only the blocks that are present', async () => {
    const [item] = await listWith([
      {
        user: OFFICIAL_ROW.user,
        last_activity_date: null,
        claude_code_metrics: { core_metrics: { commit_count: 2 } },
      },
    ]);
    expect(item?.active).toBe(true);
    expect(item?.lastActiveOn).toBeNull();
    expect(item?.engagement).toEqual({
      claudeCode: {
        sessions: null,
        commits: 2,
        pullRequests: null,
        addedLines: null,
        removedLines: null,
        artifactsCreated: null,
        tools: {},
      },
    });
  });

  it('reads null distinct counts as unknown and sums Office apps over the known ones', () => {
    const engagement = memberEngagement({
      chat_metrics: { ...OFFICIAL_ROW.chat_metrics, distinct_conversation_count: null },
      claude_code_metrics: {
        core_metrics: {
          ...OFFICIAL_ROW.claude_code_metrics.core_metrics,
          distinct_session_count: null,
        },
      },
      cowork_metrics: { ...OFFICIAL_ROW.cowork_metrics, distinct_session_count: null },
      office_metrics: {
        excel: { ...office(4), distinct_session_count: null },
        word: { ...office(1), distinct_session_count: null },
      },
    });
    expect(engagement?.chat?.conversations).toBeNull();
    expect(engagement?.chat?.messages).toBe(80);
    expect(engagement?.claudeCode?.sessions).toBeNull();
    expect(engagement?.claudeCode?.commits).toBe(7);
    expect(engagement?.cowork?.sessions).toBeNull();
    expect(engagement?.office).toEqual({
      messages: 5,
      sessions: null,
      skillCalls: 6,
      connectorCalls: 2,
    });
  });

  it('never fails the collection on malformed blocks', async () => {
    const [item] = await listWith([
      {
        user: OFFICIAL_ROW.user,
        last_activity_date: '2026-09-29',
        chat_metrics: 'unexpected',
        claude_code_metrics: { core_metrics: { commit_count: 'seven' }, tool_actions: [] },
        science_metrics: null,
        web_search_count: null,
      },
    ]);
    expect(item?.lastActiveOn).toBe('2026-09-29');
    expect(item?.engagement?.chat).toBeUndefined();
    expect(item?.engagement?.claudeCode?.commits).toBeNull();
    expect(item?.engagement?.claudeCode?.tools).toEqual({});
    expect(item?.engagement?.science).toBeUndefined();
  });
});
