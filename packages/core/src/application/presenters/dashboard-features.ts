import { FEATURE_TOP_LIMIT, type DashboardFeatures } from '../../contracts/dashboard-view.js';
import type {
  ChatProjectUsage,
  ConnectorUsage,
  FeatureProductCounts,
  PluginUsage,
  SkillUsage,
} from '../../domain/model/optional-entities.js';

/** Rows of each dataset; null when that dataset was not collected. */
export interface FeaturesInput {
  skills: readonly SkillUsage[] | null;
  connectors: readonly ConnectorUsage[] | null;
  plugins: readonly PluginUsage[] | null;
  projects: readonly ChatProjectUsage[] | null;
  window: DashboardFeatures['window'];
}

interface Ranked {
  key: string;
  label: string;
  users: number;
}

/** Most distinct users first, then the larger `use`, then by key; the top `FEATURE_TOP_LIMIT`. */
function top<T extends Ranked>(items: T[], use: (item: T) => number): T[] {
  return items
    .sort((a, b) => b.users - a.users || use(b) - use(a) || a.key.localeCompare(b.key))
    .slice(0, FEATURE_TOP_LIMIT);
}

const products = (r: FeatureProductCounts): FeatureProductCounts => ({
  chatConversations: r.chatConversations,
  claudeCodeSessions: r.claudeCodeSessions,
  coworkSessions: r.coworkSessions,
  officeSessions: r.officeSessions,
});

/** A row's sessions and conversations over every product (unknown counts as 0, for ranking). */
const productTotal = (r: FeatureProductCounts): number =>
  (r.chatConversations ?? 0) +
  (r.claudeCodeSessions ?? 0) +
  (r.coworkSessions ?? 0) +
  (r.officeSessions ?? 0);

type Skills = NonNullable<DashboardFeatures['skills']>;
type Connectors = NonNullable<DashboardFeatures['connectors']>;
type Plugins = NonNullable<DashboardFeatures['plugins']>;
type Projects = NonNullable<DashboardFeatures['projects']>;

function skills(rows: readonly SkillUsage[]): Skills {
  const items = rows.map((r) => ({
    key: r.name,
    label: r.displayName ?? r.name,
    users: r.users,
    invocations: r.invocations,
    shareStatus: r.shareStatus,
    ...products(r),
  }));
  return { total: rows.length, items: top(items, (i) => i.invocations ?? productTotal(i)) };
}

const callsOf = (r: Connectors['items'][number]): number =>
  (r.readCalls ?? 0) + (r.writeCalls ?? 0) + (r.unclassifiedCalls ?? 0);

/** Org-wide call split; null when no row stated any of the three counts. */
function callTotals(rows: readonly ConnectorUsage[]): Connectors['calls'] {
  const stated = rows.filter(
    (r) => r.readCalls !== null || r.writeCalls !== null || r.unclassifiedCalls !== null,
  );
  if (stated.length === 0) return null;
  const sum = (pick: (r: ConnectorUsage) => number | null) =>
    stated.reduce((total, r) => total + (pick(r) ?? 0), 0);
  return {
    read: sum((r) => r.readCalls),
    write: sum((r) => r.writeCalls),
    unclassified: sum((r) => r.unclassifiedCalls),
  };
}

function connectors(rows: readonly ConnectorUsage[]): Connectors {
  const items = rows.map((r) => ({
    key: r.name,
    label: r.displayName ?? r.name,
    users: r.users,
    readCalls: r.readCalls,
    writeCalls: r.writeCalls,
    unclassifiedCalls: r.unclassifiedCalls,
    ...products(r),
  }));
  return {
    total: rows.length,
    items: top(items, (i) => callsOf(i) || productTotal(i)),
    calls: callTotals(rows),
  };
}

function plugins(rows: readonly PluginUsage[]): Plugins {
  const items = rows.map((r) => ({
    key: r.pluginId ?? r.name,
    label: r.name,
    users: r.users,
    invocations: r.invocations,
    installs: r.installs,
    claudeCodeSessions: r.claudeCodeSessions,
    coworkSessions: r.coworkSessions,
  }));
  return { total: rows.length, items: top(items, (i) => i.invocations) };
}

/** Project id and name only: the creator never reaches the snapshot, let alone this view. */
function projects(rows: readonly ChatProjectUsage[]): Projects {
  const items = rows.map((r) => ({
    key: r.id,
    label: r.name,
    users: r.users,
    messages: r.messages,
    conversations: r.conversations,
  }));
  return { total: rows.length, items: top(items, (i) => i.messages) };
}

const section = <R, S>(rows: R | null, build: (rows: R) => S): S | null =>
  rows === null ? null : build(rows);

/** Feature adoption aggregate (AN-6): top entities per kind, aggregates only. */
export function featuresView(input: FeaturesInput): DashboardFeatures {
  return {
    window: input.window,
    skills: section(input.skills, skills),
    connectors: section(input.connectors, connectors),
    plugins: section(input.plugins, plugins),
    projects: section(input.projects, projects),
  };
}
