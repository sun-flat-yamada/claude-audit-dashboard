import { describe, expect, it } from 'vitest';
import { NOW, daysAgo, snapshot } from '../../__tests__/fixtures.js';
import {
  FEATURE_TOP_LIMIT,
  dashboardViewSchema,
  type DashboardView,
} from '../../contracts/dashboard-view.js';
import type {
  ChatProjectUsage,
  ConnectorUsage,
  PluginUsage,
  SkillUsage,
} from '../../domain/model/optional-entities.js';
import type { AuditSnapshot } from '../../domain/model/snapshot.js';
import { featuresView } from '../presenters/dashboard-features.js';
import { buildDashboardView } from '../presenters/dashboard-view.js';

const view = (snap: AuditSnapshot): DashboardView =>
  buildDashboardView({
    now: NOW,
    title: 'Audit',
    source: 'demo',
    maskPii: false,
    snapshot: snap,
    report: null,
    history: [],
    insights: [],
  });

const WINDOW = { from: daysAgo(30), to: NOW.toISOString() };

const NO_PRODUCTS = {
  chatConversations: null,
  claudeCodeSessions: null,
  coworkSessions: null,
  officeSessions: null,
};

const skill = (over: Partial<SkillUsage> = {}): SkillUsage => ({
  name: 'xlsx',
  displayName: null,
  users: 10,
  invocations: 40,
  shareStatus: null,
  ...NO_PRODUCTS,
  chatConversations: 30,
  ...over,
});

const connector = (over: Partial<ConnectorUsage> = {}): ConnectorUsage => ({
  name: 'github',
  displayName: null,
  users: 8,
  readCalls: 100,
  writeCalls: 20,
  unclassifiedCalls: 5,
  managedAuthUsers: null,
  individualAuthUsers: null,
  ...NO_PRODUCTS,
  ...over,
});

const plugin = (over: Partial<PluginUsage> = {}): PluginUsage => ({
  name: 'code-review',
  pluginId: 'code-review@example-marketplace',
  users: 4,
  invocations: 12,
  installs: 3,
  claudeCodeSessions: 9,
  coworkSessions: null,
  ...over,
});

const project = (over: Partial<ChatProjectUsage> = {}): ChatProjectUsage => ({
  id: 'claude_proj_demo_1',
  name: 'Example Onboarding',
  users: 6,
  messages: 120,
  conversations: 14,
  createdAt: null,
  ...over,
});

const SKILLS = [
  skill(),
  skill({ name: 'skill_01Opaque', displayName: 'Example Brand Voice', users: 12, invocations: 5 }),
  skill({ name: 'pdf', users: 10, invocations: 80, shareStatus: 'organization' }),
];
const CONNECTORS = [
  connector(),
  connector({
    name: 'conn_01Opaque',
    displayName: 'Example Wiki',
    users: 8,
    readCalls: 300,
    writeCalls: null,
    unclassifiedCalls: null,
  }),
  connector({
    name: 'slack',
    users: 2,
    readCalls: null,
    writeCalls: null,
    unclassifiedCalls: null,
  }),
];
const PLUGINS = [plugin(), plugin({ name: 'redacted', pluginId: null, users: 7, installs: null })];
const PROJECTS = [project(), project({ id: 'claude_proj_demo_2', name: 'Example RFPs', users: 9 })];

const collected = (names: string[]) =>
  snapshot(
    {
      skillUsage: SKILLS,
      connectorUsage: CONNECTORS,
      pluginUsage: PLUGINS,
      chatProjectUsage: PROJECTS,
    },
    Object.fromEntries(names.map((n) => [n, { status: 'ok', count: 1, window: WINDOW }])),
  );

const ALL = ['skillUsage', 'connectorUsage', 'pluginUsage', 'chatProjectUsage'];

const input = (over: Partial<Parameters<typeof featuresView>[0]> = {}) => ({
  skills: SKILLS,
  connectors: CONNECTORS,
  plugins: PLUGINS,
  projects: PROJECTS,
  window: WINDOW,
  ...over,
});

describe('feature adoption aggregate (AN-6)', () => {
  it('ranks skills by distinct users, then use, and prefers the display name', () => {
    const s = featuresView(input()).skills;
    expect(s?.total).toBe(3);
    expect(s?.items.map((i) => [i.key, i.label, i.users, i.invocations])).toEqual([
      ['skill_01Opaque', 'Example Brand Voice', 12, 5],
      ['pdf', 'pdf', 10, 80],
      ['xlsx', 'xlsx', 10, 40],
    ]);
    expect(s?.items[1]).toMatchObject({ shareStatus: 'organization', chatConversations: 30 });
  });

  it('splits connector calls by read-only annotation and totals the stated ones', () => {
    const c = featuresView(input()).connectors;
    expect(c?.items.map((i) => i.label)).toEqual(['Example Wiki', 'github', 'slack']);
    expect(c?.items[1]).toMatchObject({ readCalls: 100, writeCalls: 20, unclassifiedCalls: 5 });
    expect(c?.calls).toEqual({ read: 400, write: 20, unclassified: 5 });
    const unstated = featuresView(input({ connectors: [CONNECTORS[2] as ConnectorUsage] }));
    expect(unstated.connectors?.calls).toBeNull();
  });

  it('keys plugins by their stable id when there is one', () => {
    const p = featuresView(input()).plugins;
    expect(p?.items.map((i) => [i.key, i.label, i.installs])).toEqual([
      ['redacted', 'redacted', null],
      ['code-review@example-marketplace', 'code-review', 3],
    ]);
  });

  it('publishes project ids, names and counts, never a creator', () => {
    const p = featuresView(input()).projects;
    expect(p?.items).toEqual([
      {
        key: 'claude_proj_demo_2',
        label: 'Example RFPs',
        users: 9,
        messages: 120,
        conversations: 14,
      },
      {
        key: 'claude_proj_demo_1',
        label: 'Example Onboarding',
        users: 6,
        messages: 120,
        conversations: 14,
      },
    ]);
  });

  it(`keeps the top ${String(FEATURE_TOP_LIMIT)} and counts the rest`, () => {
    const many = Array.from({ length: FEATURE_TOP_LIMIT + 5 }, (_, i) =>
      skill({ name: `skill-${String(i).padStart(2, '0')}`, users: i }),
    );
    const s = featuresView(input({ skills: many })).skills;
    expect(s?.total).toBe(FEATURE_TOP_LIMIT + 5);
    expect(s?.items).toHaveLength(FEATURE_TOP_LIMIT);
    expect(s?.items[0]?.users).toBe(FEATURE_TOP_LIMIT + 4);
  });

  it('gives empty sections without rows and null sections without the dataset', () => {
    const f = featuresView(
      input({ skills: [], connectors: [], plugins: null, projects: null, window: null }),
    );
    expect(f).toEqual({
      window: null,
      skills: { total: 0, items: [] },
      connectors: { total: 0, items: [], calls: null },
      plugins: null,
      projects: null,
    });
  });

  it('is attached when any of the datasets was collected, with null sections for the others', () => {
    expect(view(snapshot()).features).toBeUndefined();
    const projectsOnly = view(collected(['chatProjectUsage'])).features;
    expect(projectsOnly?.projects?.total).toBe(2);
    expect(projectsOnly?.skills).toBeNull();
    expect(projectsOnly?.connectors).toBeNull();
    expect(projectsOnly?.plugins).toBeNull();
    expect(projectsOnly?.window).toEqual(WINDOW);
    const built = view(collected(ALL));
    expect(dashboardViewSchema.parse(built).features).toEqual(built.features);
  });

  it('a v3 view written before the field still parses', () => {
    const older: Partial<DashboardView> = view(collected(ALL));
    delete older.features;
    expect(dashboardViewSchema.parse(older).features).toBeUndefined();
  });
});
