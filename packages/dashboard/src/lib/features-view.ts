import type { DashboardFeatures, DashboardView } from '@claude-audit/core/contracts';
import type { BarItem } from '../components/ShareBars';
import { formatInteger, formatPercent } from './format';

type Features = DashboardFeatures;
type Coverage = DashboardView['coverage'][number];

export type SkillItem = NonNullable<Features['skills']>['items'][number];
export type ConnectorItem = NonNullable<Features['connectors']>['items'][number];
export type PluginItem = NonNullable<Features['plugins']>['items'][number];
export type ProjectItem = NonNullable<Features['projects']>['items'][number];

/** The optional datasets behind the page (`sources.featureUsage.enabled`), in section order. */
export const FEATURE_DATASETS = [
  'skillUsage',
  'connectorUsage',
  'pluginUsage',
  'chatProjectUsage',
] as const;

export type FeatureDataset = (typeof FEATURE_DATASETS)[number];

/** `2026-09-05 – 2026-10-05`; null without a window. */
export const rangeText = (window: Features['window']): string | null =>
  window ? `${window.from.slice(0, 10)} – ${window.to.slice(0, 10)}` : null;

/** A count that may be unknown: `—` for null. */
export const countText = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : formatInteger(value);

const usersText = (users: number): string =>
  `${formatInteger(users)} ${users === 1 ? 'user' : 'users'}`;

/** Write calls as a percent of every classified connector call; null without calls. */
export function writeShare(f: Features): number | null {
  const calls = f.connectors?.calls;
  if (!calls) return null;
  const total = calls.read + calls.write + calls.unclassified;
  return total === 0 ? null : Math.round((calls.write / total) * 1000) / 10;
}

export interface Stat {
  label: string;
  value: string;
}

/** Headline figures of the window, in display order (`—` when a dataset was not collected). */
export const headlineStats = (f: Features): Stat[] => {
  const share = writeShare(f);
  return [
    { label: 'Skills used', value: countText(f.skills?.total) },
    { label: 'Connectors used', value: countText(f.connectors?.total) },
    { label: 'Plugins used', value: countText(f.plugins?.total) },
    { label: 'Active chat projects', value: countText(f.projects?.total) },
    { label: 'Connector write share', value: share === null ? '—' : formatPercent(share) },
  ];
};

/** Bars of distinct users; the tip also names the main usage figure. */
export const userBars = <T extends { key: string; label: string; users: number }>(
  items: readonly T[],
  usage: (item: T) => string | null,
): BarItem[] =>
  items.map((item) => {
    const extra = usage(item);
    return {
      key: item.key,
      label: item.label,
      value: item.users,
      display: extra ? `${usersText(item.users)} · ${extra}` : usersText(item.users),
    };
  });

const uses = (value: number | null, unit: string): string | null =>
  value === null ? null : `${formatInteger(value)} ${unit}`;

export const skillUsage = (s: SkillItem) => uses(s.invocations, 'uses');
export const connectorUsage = (c: ConnectorItem) => {
  const calls = callTotal(c);
  return calls === null ? null : `${formatInteger(calls)} calls`;
};
export const pluginUsage = (p: PluginItem) => uses(p.invocations, 'uses');
export const projectUsage = (p: ProjectItem) => uses(p.messages, 'messages');

const SHARE_STATUS: Readonly<Record<string, string>> = {
  organization: 'Organization',
  private: 'Private',
  public: 'Public',
};

export const shareStatusText = (status: string | null): string =>
  status === null ? '—' : (SHARE_STATUS[status] ?? status);

const productCells = (i: {
  chatConversations: number | null;
  claudeCodeSessions: number | null;
  coworkSessions: number | null;
  officeSessions: number | null;
}): string[] => [
  countText(i.chatConversations),
  countText(i.claudeCodeSessions),
  countText(i.coworkSessions),
  countText(i.officeSessions),
];

const PRODUCT_COLUMNS = [
  'Chat conversations',
  'Claude Code sessions',
  'Cowork sessions',
  'Office sessions',
];

export const SKILL_COLUMNS = ['Skill', 'Users', 'Uses', ...PRODUCT_COLUMNS, 'Sharing'];
export const skillRows = (items: readonly SkillItem[]): string[][] =>
  items.map((s) => [
    s.label,
    formatInteger(s.users),
    countText(s.invocations),
    ...productCells(s),
    shareStatusText(s.shareStatus),
  ]);

export const CONNECTOR_COLUMNS = [
  'Connector',
  'Users',
  'Read calls',
  'Write calls',
  'Unclassified calls',
  ...PRODUCT_COLUMNS,
];
export const connectorRows = (items: readonly ConnectorItem[]): string[][] =>
  items.map((c) => [
    c.label,
    formatInteger(c.users),
    countText(c.readCalls),
    countText(c.writeCalls),
    countText(c.unclassifiedCalls),
    ...productCells(c),
  ]);

export const PLUGIN_COLUMNS = [
  'Plugin',
  'Users',
  'Uses',
  'Installs',
  'Claude Code sessions',
  'Cowork sessions',
];
export const pluginRows = (items: readonly PluginItem[]): string[][] =>
  items.map((p) => [
    p.label,
    formatInteger(p.users),
    formatInteger(p.invocations),
    countText(p.installs),
    countText(p.claudeCodeSessions),
    countText(p.coworkSessions),
  ]);

export const PROJECT_COLUMNS = ['Project', 'Users', 'Messages', 'Conversations'];
export const projectRows = (items: readonly ProjectItem[]): string[][] =>
  items.map((p) => [
    p.label,
    formatInteger(p.users),
    formatInteger(p.messages),
    countText(p.conversations),
  ]);

/** A connector's classified calls; null when the API stated none of the three counts. */
export function callTotal(c: ConnectorItem): number | null {
  const parts = [c.readCalls, c.writeCalls, c.unclassifiedCalls];
  return parts.every((p) => p === null) ? null : parts.reduce<number>((s, p) => s + (p ?? 0), 0);
}

export interface CallSegment {
  key: 'read' | 'write' | 'unclassified';
  label: string;
  calls: number;
  /** Percent of the connector's calls (one decimal). */
  share: number;
}

export interface CallSplit {
  key: string;
  label: string;
  total: number;
  segments: CallSegment[];
}

export const CALL_KINDS: readonly { key: CallSegment['key']; label: string }[] = [
  { key: 'read', label: 'Read-only' },
  { key: 'write', label: 'Write' },
  { key: 'unclassified', label: 'Unclassified' },
];

/** Connectors with a stated call split, most calls first (at most `limit`). */
export function callSplits(items: readonly ConnectorItem[], limit = 10): CallSplit[] {
  return items
    .flatMap((c): CallSplit[] => {
      const total = callTotal(c);
      if (total === null || total === 0) return [];
      const calls = {
        read: c.readCalls ?? 0,
        write: c.writeCalls ?? 0,
        unclassified: c.unclassifiedCalls ?? 0,
      };
      return [
        {
          key: c.key,
          label: c.label,
          total,
          segments: CALL_KINDS.map((k) => ({
            ...k,
            calls: calls[k.key],
            share: Math.round((calls[k.key] / total) * 1000) / 10,
          })),
        },
      ];
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** `Showing the top 20 of 34.`; null when every entity is listed. */
export const moreText = (section: { total: number; items: readonly unknown[] }): string | null =>
  section.total > section.items.length
    ? `Showing the top ${formatInteger(section.items.length)} of ${formatInteger(section.total)}.`
    : null;

/** Feature datasets that were enabled but not collected (with their reasons). */
export const notCollected = (coverage: readonly Coverage[]): Coverage[] =>
  coverage.filter(
    (c) => (FEATURE_DATASETS as readonly string[]).includes(c.dataset) && c.status !== 'ok',
  );

/** `Not collected: skillUsage, pluginUsage (reason).`: datasets grouped by their reason. */
export function missingText(missing: readonly Coverage[]): string {
  const byReason = new Map<string, string[]>();
  for (const m of missing) {
    const reason = m.reason ?? m.status;
    byReason.set(reason, [...(byReason.get(reason) ?? []), m.dataset]);
  }
  const parts = [...byReason].map(([reason, names]) => `${names.join(', ')} (${reason})`);
  return `Not collected: ${parts.join('; ')}.`;
}
