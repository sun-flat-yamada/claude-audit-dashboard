import type { ChatProjectUsage, ConnectorUsage, PluginUsage, SkillUsage } from '@claude-audit/core';
import { addDays } from '@claude-audit/core';

/**
 * Deterministic synthetic skill, connector, plugin and chat project adoption (AN-6) for the
 * `optional-sources` demo profile: range roll-ups over the 30-day window of a 40-member tenant.
 * Names are fictional (`Example ...`) or generic product names; there is no user field at all.
 */

type Counts = [
  chat: number | null,
  code: number | null,
  cowork: number | null,
  office: number | null,
];

const products = ([chat, code, cowork, office]: Counts) => ({
  chatConversations: chat,
  claudeCodeSessions: code,
  coworkSessions: cowork,
  officeSessions: office,
});

/** name, display name, users, invocations, share status, per-product counts. */
const SKILLS: [string, string | null, number, number | null, string | null, Counts][] = [
  ['xlsx', null, 24, 310, null, [182, 14, 9, 61]],
  ['skill_01DemoBrandVoice', 'Example Brand Voice', 21, 264, 'organization', [205, 11, 18, null]],
  ['docx', null, 19, 188, null, [121, 6, 12, 44]],
  ['pdf', null, 17, 143, null, [102, 21, 8, null]],
  ['pptx', null, 12, 96, null, [58, null, 7, 26]],
  [
    'skill_01DemoReleaseNotes',
    'Example Release Notes',
    9,
    121,
    'organization',
    [12, 88, null, null],
  ],
  [
    'skill_01DemoContractReview',
    'Example Contract Review',
    7,
    54,
    'organization',
    [49, null, 3, 5],
  ],
  ['skill_01DemoSqlStyle', 'Example SQL Style Guide', 6, 77, 'organization', [9, 61, null, null]],
  ['frontend-design', null, 5, 38, null, [null, 33, 4, null]],
  ['skill_01DemoPrivate', null, 2, 11, 'private', [11, null, null, null]],
];

/** name, display name, users, read / write / unclassified calls, per-product counts. */
const CONNECTORS: [string, string | null, number, number, number, number, Counts][] = [
  ['google_drive', null, 26, 1840, 42, 210, [512, 18, 40, 12]],
  ['slack', null, 22, 1210, 236, 155, [430, 9, 31, null]],
  ['github', null, 15, 2260, 388, 120, [96, 402, 14, null]],
  ['jira', null, 11, 690, 214, 64, [148, 77, 6, null]],
  ['mcpsrv_01DemoExampleWiki', 'Example Wiki', 9, 820, 0, 95, [201, 12, null, null]],
  ['gmail', null, 8, 310, 47, 22, [118, null, 9, 4]],
  ['mcpsrv_01DemoExampleCrm', 'Example CRM', 4, 142, 61, 38, [53, null, 2, 7]],
];

/** name, id, users, invocations, installs, Claude Code / Cowork sessions. */
const PLUGINS: [
  string,
  string | null,
  number,
  number,
  number | null,
  number | null,
  number | null,
][] = [
  ['code-review', 'code-review@example-marketplace', 13, 412, 10, 286, null],
  ['commit-commands', 'commit-commands@example-marketplace', 11, 538, 9, 371, null],
  ['example-deploy-helper', 'example-deploy-helper@example-internal', 6, 147, 6, 102, null],
  ['meeting-notes', 'meeting-notes@example-marketplace', 5, 63, 4, null, 41],
  ['third-party-plugin', null, 2, 19, null, 12, 3],
];

/** id, name, users, messages, conversations, age in days. */
const PROJECTS: [string, string, number, number, number | null, number][] = [
  ['claude_proj_demo_onboarding', 'Example Onboarding Handbook', 18, 642, 121, 210],
  ['claude_proj_demo_support', 'Example Support Playbook', 14, 905, 164, 160],
  ['claude_proj_demo_rfp', 'Example RFP Responses', 9, 388, 57, 95],
  ['claude_proj_demo_research', 'Example Market Research', 7, 246, 39, 60],
  ['claude_proj_demo_security', 'Example Security Reviews', 5, 171, null, 40],
  ['claude_proj_demo_offsite', 'Example Team Offsite', 3, 44, 8, 12],
];

export const demoSkillUsage = (): SkillUsage[] =>
  SKILLS.map(([name, displayName, users, invocations, shareStatus, counts]) => ({
    name,
    displayName,
    users,
    invocations,
    shareStatus,
    ...products(counts),
  }));

export const demoConnectorUsage = (): ConnectorUsage[] =>
  CONNECTORS.map(([name, displayName, users, read, write, unclassified, counts]) => ({
    name,
    displayName,
    users,
    readCalls: read,
    writeCalls: write,
    unclassifiedCalls: unclassified,
    managedAuthUsers: null,
    individualAuthUsers: null,
    ...products(counts),
  }));

export const demoPluginUsage = (): PluginUsage[] =>
  PLUGINS.map(([name, pluginId, users, invocations, installs, code, cowork]) => ({
    name,
    pluginId,
    users,
    invocations,
    installs,
    claudeCodeSessions: code,
    coworkSessions: cowork,
  }));

export const demoChatProjectUsage = (now: Date): ChatProjectUsage[] =>
  PROJECTS.map(([id, name, users, messages, conversations, age]) => ({
    id,
    name,
    users,
    messages,
    conversations,
    createdAt: addDays(now, -age).toISOString(),
  }));
